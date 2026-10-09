import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordNativeHook,
  readNativeRecording,
  readNativeSessions,
} from "../plugin/native";
import { deriveSession, exportRecording, parseRecording } from "../src/core";
const hook = (name: string, extra: Record<string, unknown> = {}) => ({
  session_id: "session-123",
  turn_id: "turn-1",
  hook_event_name: name,
  model: "gpt-6.1-sol",
  ...extra,
});
test("resumed native chats reopen on a new SessionStart without declaring prior task success", () =>
  temporary(async (dir) => {
    await recordNativeHook(hook("SessionEnd"), dir);
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "ended",
    );
    await recordNativeHook(hook("SessionStart"), dir);
    await recordNativeHook(
      hook("UserPromptSubmit", { turn_id: "turn-2" }),
      dir,
    );
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "running",
    );
  }));
test("only the matching returned tool clears observed permission waiting", () =>
  temporary(async (dir) => {
    await recordNativeHook(
      hook("PermissionRequest", {
        tool_name: "Bash",
        tool_use_id: "permission-1",
      }),
      dir,
    );
    await recordNativeHook(
      hook("PostToolUse", { tool_name: "Bash", tool_use_id: "other-tool" }),
      dir,
    );
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "waiting",
    );
    await recordNativeHook(
      hook("PostToolUse", { tool_name: "Bash", tool_use_id: "permission-1" }),
      dir,
    );
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "running",
    );
  }));
async function temporary(action: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "reef-native-test-"));
  try {
    await action(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("native tools correlate lifecycle without inventing output or success", () =>
  temporary(async (dir) => {
    await recordNativeHook(hook("SessionStart"), dir);
    await recordNativeHook(hook("UserPromptSubmit"), dir);
    await recordNativeHook(
      hook("PreToolUse", { tool_name: "Bash", tool_use_id: "tool-1" }),
      dir,
    );
    let r = (await readNativeSessions(dir))[0]!;
    assert.equal(deriveSession(r).items[0]?.status, "in_progress");
    await recordNativeHook(
      hook("PostToolUse", { tool_name: "Bash", tool_use_id: "tool-1" }),
      dir,
    );
    await recordNativeHook(hook("Stop"), dir);
    r = (await readNativeSessions(dir))[0]!;
    const state = deriveSession(r);
    assert.equal(state.status, "stopped");
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0]?.type, "command_execution");
    assert.equal(state.items[0]?.status, "observed_finished");
    assert.equal(state.commandFailures, 0);
    assert.equal(state.usage, null);
    assert.equal(state.items[0]?.command, undefined);
    assert.equal(r.session.source, "native");
    assert.deepEqual(
      parseRecording(JSON.stringify(exportRecording(r))),
      exportRecording(r),
    );
  }));
test("post arriving before pre never regresses a returned tool or stopped turn", () =>
  temporary(async (dir) => {
    await recordNativeHook(
      hook("PostToolUse", {
        tool_name: "mcp__example__lookup",
        tool_use_id: "tool-1",
      }),
      dir,
    );
    await recordNativeHook(hook("Stop"), dir);
    await recordNativeHook(
      hook("PreToolUse", {
        tool_name: "mcp__example__lookup",
        tool_use_id: "tool-1",
      }),
      dir,
    );
    const state = deriveSession((await readNativeSessions(dir))[0]!);
    assert.equal(state.items[0]?.status, "observed_finished");
    assert.equal(state.status, "stopped");
  }));
test("permission, subagent, interrupt and end are observed structural states", () =>
  temporary(async (dir) => {
    await recordNativeHook(
      hook("PermissionRequest", {
        tool_name: "Bash",
        tool_use_id: "permission-1",
      }),
      dir,
    );
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "waiting",
    );
    await recordNativeHook(
      hook("SubagentStop", { agent_id: "agent-1", agent_type: "explorer" }),
      dir,
    );
    await recordNativeHook(
      hook("SubagentStart", { agent_id: "agent-1", agent_type: "explorer" }),
      dir,
    );
    let state = deriveSession((await readNativeSessions(dir))[0]!);
    assert.equal(
      state.items.find((item) => item.type === "subagent_observation")?.status,
      "observed_finished",
    );
    await recordNativeHook(hook("Interrupt"), dir);
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "interrupted",
    );
    await recordNativeHook(hook("SessionEnd"), dir);
    await recordNativeHook(hook("Stop"), dir);
    assert.equal(
      deriveSession((await readNativeSessions(dir))[0]!).status,
      "ended",
    );
  }));
test("collector ignores sensitive payload fields and never reads transcript", () =>
  temporary(async (dir) => {
    const secret = "PRIVATE_PAYLOAD_938";
    await recordNativeHook(
      hook("PreToolUse", {
        tool_name: "Bash",
        tool_use_id: "tool-privacy",
        prompt: secret,
        tool_input: { command: secret },
        tool_response: secret,
        cwd: secret,
        transcript_path: "/does/not/exist/private.json",
      }),
      dir,
    );
    const sessionDir = join(dir, "reef-native", "session-123");
    for (const filename of await readdir(sessionDir)) {
      const text = await readFile(join(sessionDir, filename), "utf8");
      assert.ok(!text.includes(secret));
      assert.ok(!text.includes("transcript"));
    }
    const r = (await readNativeSessions(dir))[0]!;
    assert.equal(r.session.prompt, "[not observed]");
    assert.equal(r.session.workingDirectory, "[not observed]");
    assert.ok(!JSON.stringify(r).includes(secret));
  }));
test("invalid IDs and traversal are rejected without touching storage", () =>
  temporary(async (dir) => {
    for (const id of ["../escape", "x/y", "", "a".repeat(129)])
      assert.equal(
        await recordNativeHook(hook("SessionStart", { session_id: id }), dir),
        false,
      );
    assert.equal(
      await recordNativeHook(
        hook("PreToolUse", { tool_name: "Bash", tool_use_id: "../escape" }),
        dir,
      ),
      false,
    );
    assert.equal(await readNativeRecording("native-../escape", dir), null);
    assert.deepEqual(await readNativeSessions(dir), []);
  }));
test("Reef polling tools are excluded to prevent observer feedback loops", () =>
  temporary(async (dir) => {
    for (const name of [
      "reef_sessions",
      "reef_recording",
      "reef_aquarium",
      "mcp__reef__reef_sessions",
    ])
      for (const event of ["PreToolUse", "PostToolUse", "PermissionRequest"])
        assert.equal(
          await recordNativeHook(
            hook(event, { tool_name: name, tool_use_id: "poll-1" }),
            dir,
          ),
          false,
        );
    assert.deepEqual(await readNativeSessions(dir), []);
  }));
test("concurrent observers allocate stable unique sequences", () =>
  temporary(async (dir) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        recordNativeHook(
          hook("PreToolUse", {
            tool_name: "Bash",
            tool_use_id: `tool-${index}`,
          }),
          dir,
        ),
      ),
    );
    const before = (await readNativeSessions(dir))[0]!;
    assert.equal(before.events.length, 20);
    assert.deepEqual(
      before.events.map((event) => event.seq),
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    await recordNativeHook(hook("Stop"), dir);
    const after = await readNativeRecording(before.session.id, dir);
    assert.deepEqual(after!.events.slice(0, 20), before.events);
  }));
test("retention keeps stable sequences rather than reindexing event identity", () =>
  temporary(async (dir) => {
    for (let index = 0; index < 505; index++)
      await recordNativeHook(
        hook("UserPromptSubmit", { turn_id: `turn-${index}` }),
        dir,
      );
    const r = (await readNativeSessions(dir))[0]!;
    assert.equal(r.events.length, 500);
    assert.equal(r.events[0]?.seq, 6);
    assert.equal(r.events.at(-1)?.seq, 505);
    assert.deepEqual(parseRecording(JSON.stringify(r)), r);
  }));
test("symlinked native root is neither read nor written", () =>
  temporary(async (dir) => {
    const target = await mkdtemp(join(tmpdir(), "reef-native-outside-"));
    try {
      await symlink(target, join(dir, "reef-native"));
      await assert.rejects(
        () => recordNativeHook(hook("SessionStart"), dir),
        /storage root/,
      );
      assert.deepEqual(await readNativeSessions(dir), []);
      assert.deepEqual(await readdir(target), []);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  }));
test("edited spool files are projected back to structural fields", () =>
  temporary(async (dir) => {
    await recordNativeHook(
      hook("PreToolUse", { tool_name: "Bash", tool_use_id: "tool-1" }),
      dir,
    );
    const folder = join(dir, "reef-native", "session-123");
    const file = (await readdir(folder)).find((name) => /^\d/.test(name))!;
    const event = JSON.parse(await readFile(join(folder, file), "utf8"));
    event.data.prompt = "secret";
    event.data.item.aggregated_output = "secret";
    await writeFile(join(folder, file), JSON.stringify(event));
    const r = (await readNativeSessions(dir))[0]!;
    assert.ok(!JSON.stringify(r).includes("secret"));
  }));

test("default exports rebuild outer/session metadata instead of carrying imported secrets", () =>
  temporary(async (dir) => {
    await recordNativeHook(hook("SessionStart"), dir);
    const r = (await readNativeSessions(dir))[0]!;
    (r as unknown as Record<string, unknown>).extraSecret =
      "PRIVATE_EXTRA_SECRET";
    (r.session as unknown as Record<string, unknown>).extraSecret =
      "PRIVATE_EXTRA_SECRET";
    r.session.observation!.limitations.push("PRIVATE_EXTRA_SECRET");
    assert.ok(
      !JSON.stringify(exportRecording(r)).includes("PRIVATE_EXTRA_SECRET"),
    );
  }));
