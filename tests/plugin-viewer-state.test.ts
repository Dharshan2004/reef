import test from "node:test";
import assert from "node:assert/strict";
import { demoRecording } from "../src/core/demo";
import {
  updatedCursor,
  isNativeRecording,
  recordingStatus,
  previousCommandFailure,
} from "../plugin/viewer-state";

test("polling preserves a paused replay cursor while new events arrive", () => {
  assert.equal(updatedCursor(3, demoRecording, false), 3);
  assert.equal(updatedCursor(0, demoRecording, false), 0);
});

test("only explicit following advances to latest event", () => {
  assert.equal(
    updatedCursor(3, demoRecording, true),
    demoRecording.events.at(-1)!.seq,
  );
});

test("standalone and demo recordings do not claim native metadata coverage", () => {
  assert.equal(isNativeRecording(demoRecording), false);
});

test("native Stop stays stopped and does not claim task success", () => {
  const recording = structuredClone(demoRecording);
  recording.session.source = "native";
  recording.events = [
    {
      id: "stop",
      sessionId: recording.session.id,
      seq: 1,
      at: recording.session.createdAt,
      type: "native.stopped",
      data: { turnId: "turn-1" },
    },
  ];
  assert.equal(isNativeRecording(recording), true);
  assert.equal(recordingStatus(recording), "stopped");
  assert.notEqual(recordingStatus(recording), "completed");
});

test("failure shortcut uses recorded command exit evidence", () => {
  const failure = previousCommandFailure(demoRecording, 12);
  assert.equal(failure?.seq, 6);
  assert.equal((failure?.data.item as { exit_code: number }).exit_code, 1);
});

test("native observation never offers a command failure shortcut", () => {
  const recording = structuredClone(demoRecording);
  recording.session.source = "native";
  assert.equal(previousCommandFailure(recording, 12), undefined);
});
