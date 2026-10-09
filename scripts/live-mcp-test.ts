// Manual account-backed integration test. Never include this in CI or npm test.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";
import { SessionManager, type Runner } from "../server/session-manager";
import {
  getIsolationOverrides,
  resolveCodexExecutable,
} from "../server/codex-config";
import {
  deriveSession,
  parseRecording,
  eventsAtTime,
  type ReefItem,
} from "../src/core";

const directory = "/tmp/reef-live-mcp-proof";
const workingDirectory = resolve(".");
const execute = promisify(execFile);
const executable = resolveCodexExecutable();
const deadline = AbortSignal.timeout(120_000);

// The SDK/CLI merges plugin maps. Explicitly disable installed IDs as well as
// the default, rather than assuming a one-entry map replaces inherited policy.
const { stdout: pluginJson } = await execute(
  executable,
  ["plugin", "list", "--json"],
  {
    cwd: workingDirectory,
    timeout: 15_000,
    maxBuffer: 4_000_000,
    signal: deadline,
  },
);
const pluginMetadata = JSON.parse(pluginJson) as {
  installed?: { pluginId?: unknown }[];
};
assert.ok(
  Array.isArray(pluginMetadata.installed),
  "Unexpected installed plugin metadata",
);
const ids = pluginMetadata.installed.map((plugin) => {
  assert.equal(typeof plugin.pluginId, "string");
  return plugin.pluginId as string;
});
const pluginEntries = [
  "_default={enabled=false}",
  ...ids
    .filter((id) => id !== "reef@reef-local")
    .map((id) => `${JSON.stringify(id)}={enabled=false}`),
  '"reef@reef-local"={enabled=true}',
];
const isolated = await getIsolationOverrides(
  executable,
  workingDirectory,
  deadline,
);
assert.ok(
  isolated.length,
  "Unset REEF_INHERIT_TOOLS before running this isolation test",
);
const configOverrides = [
  ...isolated,
  "features.plugins=true",
  `plugins={${pluginEntries.join(",")}}`,
];

// Prove the effective MCP catalog contains only the requested plugin. Metadata
// is kept in memory and projected to names/status only, never recorded as auth.
const args = configOverrides.flatMap((value) => ["-c", value]);
const { stdout: mcpJson } = await execute(
  executable,
  [...args, "mcp", "list", "--json"],
  {
    cwd: workingDirectory,
    timeout: 15_000,
    maxBuffer: 4_000_000,
    signal: deadline,
  },
);
const effective = JSON.parse(mcpJson) as { name: string; enabled: boolean }[];
const enabledNames = effective
  .filter((server) => server.enabled)
  .map((server) => server.name);
assert.deepEqual(
  enabledNames,
  ["reef"],
  "Only the Reef MCP server may be enabled",
);

let finish: () => void = () => {};
const finished = new Promise<void>((resolve) => {
  finish = resolve;
});
const runner: Runner = async function* (prompt, cwd, signal) {
  const combined = AbortSignal.any([signal, deadline]);
  try {
    const codex = new Codex({ codexPathOverride: executable, configOverrides });
    const thread = codex.startThread({
      model: "gpt-6.1-sol",
      workingDirectory: cwd,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    });
    const { events } = await thread.runStreamed(prompt, { signal: combined });
    for await (const event of events)
      yield event as unknown as Record<string, unknown>;
  } finally {
    finish();
  }
};
const manager = new SessionManager(directory, runner);
await manager.load();
const recording = manager.start({
  title: "Actual Reef MCP activity proof",
  workingDirectory,
  prompt:
    "Use @reef. This is a read-only plugin activation test. Discover the installed Reef plugin MCP tool if tool discovery is necessary, then call reef_aquarium exactly once. Do not use shell, filesystem, browser, or any other application tool. Report its tool name and whether it succeeded. If Reef is unavailable, state that and stop.",
});
await finished;
await new Promise<void>((resolve) => setImmediate(resolve));
await manager.flush();
const disk = parseRecording(
  await readFile(join(directory, `${recording.session.id}.json`), "utf8"),
);
const reefFile = join(directory, `${recording.session.id}.reef`);
await writeFile(reefFile, JSON.stringify(disk, null, 2), { mode: 0o600 });
const live = deriveSession(recording);
const proof = {
  sessionId: recording.session.id,
  recordingPath: reefFile,
  enabledServers: enabledNames,
  eventCount: recording.events.length,
  status: live.status,
  mcpStarted: false,
  mcpCompleted: false,
  diskMatches: false,
  replayMatches: false,
};
const calls = recording.events.filter(
  (event) =>
    (event.data.item as ReefItem | undefined)?.type === "mcp_tool_call",
);
const starts = calls.filter(
  (event) => (event.data.item as ReefItem).status === "in_progress",
);
const completed = calls.filter(
  (event) =>
    event.type === "item.completed" &&
    (event.data.item as ReefItem).status === "completed",
);
proof.mcpStarted = starts.some(
  (event) =>
    (event.data.item as ReefItem).server === "reef" &&
    (event.data.item as ReefItem).tool === "reef_aquarium",
);
proof.mcpCompleted = completed.some(
  (event) =>
    (event.data.item as ReefItem).server === "reef" &&
    (event.data.item as ReefItem).tool === "reef_aquarium",
);
proof.diskMatches = JSON.stringify(recording) === JSON.stringify(disk);
proof.replayMatches =
  JSON.stringify(live) ===
  JSON.stringify(
    deriveSession({ ...disk, events: eventsAtTime(disk, Infinity) }),
  );
await writeFile(join(directory, "proof.json"), JSON.stringify(proof, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(proof));
assert.equal(live.status, "completed", "Actual Codex turn must complete");
assert.equal(
  proof.mcpStarted,
  true,
  "Must observe in-progress Reef MCP activity",
);
assert.equal(
  proof.mcpCompleted,
  true,
  "Must observe completed Reef MCP activity",
);
assert.equal(
  completed.length,
  1,
  "Expected exactly one completed application MCP call",
);
assert.equal(
  recording.events.some(
    (event) =>
      (event.data.item as ReefItem | undefined)?.type === "command_execution",
  ),
  false,
  "Shell commands are outside this test",
);
assert.equal(proof.diskMatches, true);
assert.equal(proof.replayMatches, true);
assert.equal(
  live.items.filter((item) => item.type === "mcp_tool_call").length,
  1,
  "Reducer must merge started/completed observations into one MCP item",
);
