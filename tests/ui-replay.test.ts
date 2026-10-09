import { test } from "node:test";
import assert from "node:assert/strict";
import { stepReplay } from "../src/ui/replay";
import { deriveSession, type Recording } from "../src/core";
const recording: Recording = {
  format: "reef",
  version: 1,
  session: {
    id: "same-time",
    title: "Same time",
    prompt: "",
    workingDirectory: "",
    model: "test",
    createdAt: "2026-10-09T00:00:00Z",
    source: "demo",
  },
  events: [
    {
      id: "1",
      sessionId: "same-time",
      seq: 1,
      at: "2026-10-09T00:00:00Z",
      type: "turn.started",
      data: {},
    },
    {
      id: "2",
      sessionId: "same-time",
      seq: 2,
      at: "2026-10-09T00:00:00Z",
      type: "item.completed",
      data: {
        item: {
          id: "cmd",
          type: "command_execution",
          status: "failed",
          exit_code: 1,
        },
      },
    },
    {
      id: "3",
      sessionId: "same-time",
      seq: 3,
      at: "2026-10-09T00:00:00Z",
      type: "turn.completed",
      data: {},
    },
  ],
};
test("event stepping reaches every same-timestamp snapshot in both directions", () => {
  let cursor = 0;
  for (const expected of [1, 2, 3]) {
    const next = stepReplay(recording, cursor, 1);
    assert.deepEqual(next, { seq: expected, elapsedMs: 0 });
    cursor = next.seq;
  }
  assert.equal(deriveSession(recording, cursor).status, "completed");
  for (const expected of [2, 1, 0]) {
    cursor = stepReplay(recording, cursor, -1).seq;
    assert.equal(cursor, expected);
  }
  assert.equal(deriveSession(recording, cursor).commandFailures, 0);
  assert.equal(deriveSession(recording, cursor).status, "unknown");
});
test("event stepping clamps at boundaries and handles an empty recording", () => {
  assert.equal(stepReplay(recording, 3, 1).seq, 3);
  assert.equal(stepReplay(recording, 0, -1).seq, 0);
  assert.deepEqual(stepReplay({ ...recording, events: [] }, 0, 1), {
    seq: 0,
    elapsedMs: 0,
  });
});
