# Reef recording format, version 1

A `.reef` file is UTF-8 JSON. It contains inert data, never executable instructions.

```json
{
  "format": "reef",
  "version": 1,
  "session": {
    "id": "session-id",
    "title": "Miso",
    "prompt": "[omitted]",
    "workingDirectory": "[omitted]",
    "model": "gpt-6.1-sol",
    "createdAt": "2026-10-09T06:50:11.333Z",
    "source": "live"
  },
  "events": [
    {
      "id": "event-id",
      "sessionId": "session-id",
      "seq": 1,
      "at": "2026-10-09T06:50:11.333Z",
      "type": "session.started",
      "data": {}
    }
  ]
}
```

`seq` is a strictly increasing positive integer, scoped to the session. `at` is the time Reef observed the event, not a claim about when an internal model action began. `model` records the requested model. `source` is provenance (`live`, `demo`, or `import`), distinct from the current UI mode. A live-origin file is still REPLAY when opened from disk.

## Event mapping

SDK event names are preserved. The SDK event's `type` moves to the envelope; remaining fields go in `data`.

| Event | Meaning |
| --- | --- |
| `session.started` | Reef accepted and began launching the task. |
| `thread.started` | SDK reported a thread identifier. |
| `turn.started` | SDK reported an active turn. |
| `item.started`, `item.updated`, `item.completed` | Snapshot of an observed item in `data.item`. |
| `turn.completed` | Turn completed; `data.usage` may contain reported token counts. |
| `turn.failed`, `error`, `session.error` | SDK or adapter reported a terminal failure. |
| `session.cancelled` | User requested cancellation; existing edits are not rolled back. |
| `session.disconnected` | Stream ended without a terminal outcome, or a previous process stopped. Outcome is unknown. |

Item IDs join successive snapshots. Commands use `command_execution` with command, aggregated output, exit code, and observed status. File changes use `file_change` with paths, kind, and reported status. MCP calls and other SDK items remain available as observed. An item of type `error` is an item-level diagnostic and does not by itself fail the whole task.

## Replay rules

The reducer starts from an empty state and reads only events whose sequence is at or before the cursor. The latest snapshot of each item wins. Rewinding therefore removes later output, changed-file reports, and completion. Usage is `null` until reported. Failure counts are derived from command outcomes, independently of task outcome.

Timestamp-based playback moves the cursor through observed event times. Seeking by event makes original failures easy to inspect. Animation uses wall time for decoration and does not affect reconstructed activity state.

## Compatibility and export

Version 1 readers reject unsupported versions, malformed envelopes, invalid timestamps, and non-increasing event sequences. The import limit is 20 MB. Unknown event types are retained as data, with no implicit execution or invented meaning.

Exports can omit prompt, paths, commands, and content. Omission is a privacy choice, not proof a run lacked those fields. The raw recording remains local. Content may contain paths, credentials, or private text regardless of the separate path option; preview every file before sharing it.

The authoritative implementation is `src/core/types.ts` and `src/core/index.ts`. Future incompatible changes require a new format version and migration behavior rather than silently reinterpreting older recordings.
