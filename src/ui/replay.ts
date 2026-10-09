import type { Recording } from "../core";

/** Steps through event sequence, including distinct events at the same timestamp. */
export function stepReplay(
  recording: Recording,
  currentSeq: number,
  direction: number,
): { seq: number; elapsedMs: number } {
  const event =
    direction > 0
      ? recording.events.find((item) => item.seq > currentSeq)
      : [...recording.events].reverse().find((item) => item.seq < currentSeq);
  const seq =
    event?.seq ?? (direction > 0 ? (recording.events.at(-1)?.seq ?? 0) : 0);
  const start = Date.parse(
    recording.events[0]?.at ?? recording.session.createdAt,
  );
  const elapsedMs = event
    ? Date.parse(event.at) - start
    : direction > 0 && recording.events.length
      ? Date.parse(recording.events.at(-1)!.at) - start
      : 0;
  return { seq, elapsedMs };
}
