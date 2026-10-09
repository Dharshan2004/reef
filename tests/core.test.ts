import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveSession,
  eventsAtTime,
  exportRecording,
  parseRecording,
  type Recording,
} from "../src/core/index";
import { demoRecording } from "../src/core/demo";
test("actual SDK real-run sample imports and replays with nullable in-progress exit code", async () => {
  const r = parseRecording(
    await readFile(
      new URL("../public/garden-rescue.reef", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(deriveSession(r).status, "completed");
  assert.equal(deriveSession(r).commandFailures, 1);
  assert.equal(deriveSession(r).reportedFiles.length, 1);
  const state = deriveSession(r);
  assert.deepEqual(
    state,
    deriveSession({ ...r, events: eventsAtTime(r, Infinity) }),
  );
});
test("command failure is observed without mislabelling the task", () => {
  const state = deriveSession(demoRecording, 6);
  assert.equal(state.status, "running");
  assert.equal(state.commandFailures, 1);
  assert.equal(state.usage, null);
  assert.equal(state.reportedFiles.length, 0);
});
test("completed recovery retains failed command evidence and reported files", () => {
  const state = deriveSession(demoRecording);
  assert.equal(state.status, "completed");
  assert.equal(state.commandFailures, 1);
  assert.equal(state.reportedFiles[0]?.path, "garden.mjs");
  assert.equal(state.usage?.output_tokens, 390);
});
test("replay depends solely on recording and cursor", () => {
  assert.deepEqual(
    deriveSession(demoRecording, 6),
    deriveSession(structuredClone(demoRecording), 6),
  );
  assert.equal(eventsAtTime(demoRecording, 5500).length, 6);
  assert.equal(demoRecording.events[0]?.seq, 1);
});
test("silence alone never establishes a stalled or failed task", () => {
  assert.equal(deriveSession(demoRecording, 3).status, "running");
});
test("default export omits prompt, paths, output and command content", () => {
  const exported = exportRecording(demoRecording);
  const text = JSON.stringify(exported);
  for (const secret of [
    "Fix the failing garden tests.",
    "garden.mjs",
    "node --test",
    "AssertionError",
  ])
    assert.ok(!text.includes(secret));
  assert.equal(deriveSession(exported).commandFailures, 1);
  assert.equal(demoRecording.session.prompt, "Fix the failing garden tests.");
  assert.deepEqual(parseRecording(JSON.stringify(exported)), exported);
});
test("parser rejects duplicate or reordered sequence numbers", () => {
  const bad = structuredClone(demoRecording);
  bad.events[1]!.seq = 1;
  assert.throws(() => parseRecording(JSON.stringify(bad)), /sequence/);
});
test("missing usage remains unknown and disconnect is explicit", () => {
  const r: Recording = structuredClone(demoRecording);
  r.events = r.events.slice(0, 3);
  r.events.push({
    id: "disconnect",
    sessionId: r.session.id,
    seq: 4,
    at: r.events[2]!.at,
    type: "session.disconnected",
    data: {},
  });
  assert.equal(deriveSession(r).status, "unknown");
  assert.equal(deriveSession(r).usage, null);
});
test("default export rebuilds allowlisted fields and drops unknown nested secrets", () => {
  const r = structuredClone(demoRecording);
  r.events[0]!.data = {
    privateToken: "secret-123",
    nested: { url: "private.example" },
  };
  r.events[5]!.data.item = {
    id: "test1",
    type: "command_execution",
    exit_code: 1,
    status: "completed",
    extra: { token: "secret-123" },
    server: "private.example",
  };
  const text = JSON.stringify(exportRecording(r));
  assert.ok(!text.includes("secret-123"));
  assert.ok(!text.includes("private.example"));
});
test("import validates shapes used by inspectors", () => {
  const r = structuredClone(demoRecording);
  (r.events[7]!.data.item as Record<string, unknown>).changes = "invalid";
  assert.throws(() => parseRecording(JSON.stringify(r)), /file changes/);
});
test("disconnect after terminal completion does not erase the outcome", () => {
  const r = structuredClone(demoRecording);
  r.events.push({
    id: "late-close",
    sessionId: r.session.id,
    seq: 13,
    at: r.events.at(-1)!.at,
    type: "session.disconnected",
    data: {},
  });
  assert.equal(deriveSession(r).status, "completed");
});
test("import rejects incomplete usage and nonnumeric nested exit codes", () => {
  const r = structuredClone(demoRecording);
  r.events.at(-1)!.data.usage = { cached_input_tokens: 1 };
  assert.throws(() => parseRecording(JSON.stringify(r)), /usage/);
  const other = structuredClone(demoRecording);
  (other.events[5]!.data.item as Record<string, unknown>).exit_code = {
    unexpected: true,
  };
  assert.throws(() => parseRecording(JSON.stringify(other)), /exit code/);
});
