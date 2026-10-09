import type { Recording } from "./types";
const id = "demo-bug-garden";
const start = Date.parse("2026-10-09T06:00:00.000Z");
const steps: [number, string, Record<string, unknown>][] = [
  [0, "session.started", {}],
  [500, "thread.started", { thread_id: "demo-thread" }],
  [1000, "turn.started", {}],
  [
    2000,
    "item.completed",
    {
      item: {
        id: "plan",
        type: "todo_list",
        items: [
          { text: "Reproduce the failing test", completed: false },
          { text: "Fix the boundary condition", completed: false },
          { text: "Verify the fix", completed: false },
        ],
      },
    },
  ],
  [
    3500,
    "item.started",
    {
      item: {
        id: "test1",
        type: "command_execution",
        command: "node --test garden.test.mjs",
        aggregated_output: "",
        status: "in_progress",
      },
    },
  ],
  [
    5500,
    "item.completed",
    {
      item: {
        id: "test1",
        type: "command_execution",
        command: "node --test garden.test.mjs",
        aggregated_output: "AssertionError: 1 !== 0\n1 test failed",
        exit_code: 1,
        status: "completed",
      },
    },
  ],
  [
    8000,
    "item.completed",
    {
      item: {
        id: "note",
        type: "agent_message",
        text: "The empty garden incorrectly reports one plant. I will fix the count.",
      },
    },
  ],
  [
    10000,
    "item.completed",
    {
      item: {
        id: "patch",
        type: "file_change",
        changes: [{ path: "garden.mjs", kind: "update" }],
        status: "completed",
      },
    },
  ],
  [
    12000,
    "item.started",
    {
      item: {
        id: "test2",
        type: "command_execution",
        command: "node --test garden.test.mjs",
        aggregated_output: "",
        status: "in_progress",
      },
    },
  ],
  [
    14500,
    "item.completed",
    {
      item: {
        id: "test2",
        type: "command_execution",
        command: "node --test garden.test.mjs",
        aggregated_output: "2 tests passed",
        exit_code: 0,
        status: "completed",
      },
    },
  ],
  [
    16000,
    "item.completed",
    {
      item: {
        id: "final",
        type: "agent_message",
        text: "Fixed the empty garden count. Both tests now pass.",
      },
    },
  ],
  [
    17500,
    "turn.completed",
    {
      usage: {
        input_tokens: 1520,
        cached_input_tokens: 640,
        output_tokens: 390,
      },
    },
  ],
];
export const demoRecording: Recording = {
  format: "reef",
  version: 1,
  session: {
    id,
    title: "A small bug, a visible recovery",
    prompt: "Fix the failing garden tests.",
    workingDirectory: "demo/bug-garden",
    model: "gpt-6.1-sol",
    createdAt: new Date(start).toISOString(),
    source: "demo",
  },
  events: steps.map(([offset, type, data], index) => ({
    id: `demo-${index + 1}`,
    sessionId: id,
    seq: index + 1,
    at: new Date(start + offset).toISOString(),
    type,
    data,
  })),
};
