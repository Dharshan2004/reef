import { deriveSession, type Recording } from "../src/core";

export function isNativeRecording(recording: Recording): boolean {
  return String(recording.session.source) === "native";
}

export function recordingStatus(
  recording: Recording,
  throughSeq = Infinity,
): string {
  const state = deriveSession(recording, throughSeq);
  return state.status;
}

/** Polling may append evidence, but only explicit follow mode advances playback. */
export function updatedCursor(
  currentSeq: number,
  recording: Recording,
  following: boolean,
): number {
  const lastSeq = recording.events.at(-1)?.seq ?? 0;
  return following ? lastSeq : Math.min(currentSeq, lastSeq);
}

/** A rich recording can establish a command failure; hook metadata cannot. */
export function previousCommandFailure(
  recording: Recording,
  beforeSeq: number,
) {
  if (isNativeRecording(recording)) return undefined;
  const failures = recording.events.filter((event) => {
    const item = event.data.item as
      { type?: string; status?: string; exit_code?: number | null } | undefined;
    return (
      item?.type === "command_execution" &&
      (item.status === "failed" ||
        (typeof item.exit_code === "number" && item.exit_code !== 0))
    );
  });
  return (
    [...failures].reverse().find((event) => event.seq < beforeSeq) ??
    failures.at(-1)
  );
}
