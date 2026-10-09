export * from "./types";
import type {
  Recording,
  ReefEvent,
  ReefItem,
  SessionState,
  Usage,
} from "./types";

export function deriveSession(
  recording: Recording,
  throughSeq = Infinity,
): SessionState {
  const state: SessionState = {
    status: "unknown",
    items: [],
    usage: null,
    reportedFiles: [],
    commandFailures: 0,
    lastEventAt: null,
    threadId: null,
    error: null,
  };
  const items = new Map<string, ReefItem>();
  const nativeTerminalTurns = new Set<string>();
  const nativeWaitingTools = new Set<string>();
  for (const event of recording.events) {
    if (event.seq > throughSeq) break;
    state.lastEventAt = event.at;
    switch (event.type) {
      case "native.session_started":
        if (state.status === "unknown" || state.status === "ended") {
          state.status = "starting";
          nativeTerminalTurns.clear();
          nativeWaitingTools.clear();
        }
        break;
      case "native.turn_started":
        if (
          state.status !== "ended" &&
          !nativeTerminalTurns.has(String(event.data.turnId ?? ""))
        )
          state.status = "running";
        break;
      case "native.tool_started":
      case "native.tool_finished":
      case "native.permission_requested":
      case "native.agent_started":
      case "native.agent_finished": {
        const item = event.data.item as ReefItem | undefined;
        const previouslyFinished = item?.id
          ? items.get(item.id)?.status === "observed_finished"
          : false;
        if (item?.id && event.type === "native.tool_finished")
          nativeWaitingTools.delete(item.id);
        if (item?.id) {
          const previous = items.get(item.id);
          if (
            previous?.status !== "observed_finished" ||
            item.status === "observed_finished"
          )
            items.set(item.id, structuredClone(item));
        }
        if (
          !["ended", "stopped", "interrupted"].includes(state.status) &&
          (!previouslyFinished ||
            event.type === "native.tool_finished" ||
            event.type === "native.agent_finished") &&
          !nativeTerminalTurns.has(String(event.data.turnId ?? ""))
        ) {
          if (event.type === "native.permission_requested") {
            if (item?.id) nativeWaitingTools.add(item.id);
            state.status = "waiting";
          } else if (event.type === "native.tool_started")
            state.status = "running";
          else if (
            event.type === "native.tool_finished" &&
            state.status === "waiting" &&
            nativeWaitingTools.size === 0
          )
            state.status = "running";
        }
        break;
      }
      case "native.stopped":
      case "native.interrupted":
        nativeTerminalTurns.add(String(event.data.turnId ?? ""));
        if (state.status !== "ended")
          state.status =
            event.type === "native.stopped" ? "stopped" : "interrupted";
        break;
      case "native.ended":
        state.status = "ended";
        break;
      case "session.started":
        state.status = "starting";
        break;
      case "thread.started":
        state.threadId = String(event.data.thread_id);
        break;
      case "turn.started":
        state.status = "running";
        break;
      case "item.started":
      case "item.updated":
      case "item.completed": {
        const item = event.data.item as ReefItem | undefined;
        if (item?.id) items.set(item.id, structuredClone(item));
        break;
      }
      case "turn.completed":
        state.status = "completed";
        state.usage =
          event.data.usage && typeof event.data.usage === "object"
            ? (structuredClone(event.data.usage) as Usage)
            : null;
        break;
      case "turn.failed":
      case "error":
      case "session.error":
        state.status = "failed";
        state.error = String(
          (event.data.error as { message?: string })?.message ??
            event.data.message ??
            "Unknown error",
        );
        break;
      case "session.cancelled":
        state.status = "cancelled";
        break;
      case "session.disconnected":
        if (!["completed", "failed", "cancelled"].includes(state.status))
          state.status = "unknown";
        break;
    }
  }
  state.items = [...items.values()];
  state.commandFailures = state.items.filter(
    (i) =>
      i.type === "command_execution" &&
      (i.status === "failed" ||
        (typeof i.exit_code === "number" && i.exit_code !== 0)),
  ).length;
  state.reportedFiles = state.items
    .filter((i) => i.type === "file_change")
    .flatMap((i) =>
      (i.changes ?? []).map((c) => ({ ...c, status: i.status ?? "unknown" })),
    );
  return state;
}
export function eventsAtTime(
  recording: Recording,
  elapsedMs: number,
): ReefEvent[] {
  const start = Date.parse(
    recording.events[0]?.at ?? recording.session.createdAt,
  );
  return recording.events.filter((e) => Date.parse(e.at) - start <= elapsedMs);
}
export type ExportOptions = {
  includePrompt?: boolean;
  includePaths?: boolean;
  includeContent?: boolean;
  includeCommands?: boolean;
};
/** Select content deliberately. Structural events are retained; sensitive content is off by default. */
export function exportRecording(
  recording: Recording,
  options: ExportOptions = {},
): Recording {
  const copy = structuredClone(recording);
  copy.session.prompt = options.includePrompt
    ? copy.session.prompt
    : "[omitted]";
  copy.session.workingDirectory = options.includePaths
    ? copy.session.workingDirectory
    : "[omitted]";
  copy.session.title = "Exported session";
  if (!options.includeContent) delete copy.session.creatureName;
  copy.events = copy.events.map((event) => {
    const data: Record<string, unknown> = {};
    if (
      event.type.startsWith("native.") &&
      typeof event.data.turnId === "string"
    )
      data.turnId = event.data.turnId;
    const source = event.data.item as ReefItem | undefined;
    if (source) {
      const item: ReefItem = { id: source.id, type: source.type };
      if (typeof source.status === "string") item.status = source.status;
      if (source.origin === "native-hook") {
        item.origin = "native-hook";
        for (const key of ["toolName", "agentType"])
          if (typeof source[key] === "string") item[key] = source[key];
      }
      if (typeof source.exit_code === "number")
        item.exit_code = source.exit_code;
      if (source.changes)
        item.changes = source.changes.map((c) => ({
          path: options.includePaths ? c.path : "[omitted]",
          kind: c.kind,
        }));
      if (options.includeCommands && typeof source.command === "string")
        item.command = source.command;
      if (options.includeContent) {
        for (const key of [
          "text",
          "aggregated_output",
          "arguments",
          "result",
          "error",
          "message",
          "items",
          "server",
          "tool",
          "query",
        ])
          if (key in source) item[key] = structuredClone(source[key]);
      }
      data.item = item;
    }
    if (
      event.type === "turn.completed" &&
      event.data.usage &&
      typeof event.data.usage === "object"
    ) {
      const usage: Record<string, number> = {};
      for (const [key, value] of Object.entries(event.data.usage))
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          key.endsWith("_tokens")
        )
          usage[key] = value;
      data.usage = usage;
    }
    if (options.includeContent) {
      if (typeof event.data.message === "string")
        data.message = event.data.message;
      if (event.data.error) data.error = structuredClone(event.data.error);
    }
    return {
      id: event.id,
      sessionId: event.sessionId,
      seq: event.seq,
      at: event.at,
      type: event.type,
      data,
    };
  });
  return {
    format: "reef",
    version: 1,
    session: {
      id: copy.session.id,
      title: copy.session.title,
      prompt: copy.session.prompt,
      workingDirectory: copy.session.workingDirectory,
      model: copy.session.model,
      createdAt: copy.session.createdAt,
      source: copy.session.source,
      ...(options.includeContent && copy.session.creatureName
        ? { creatureName: copy.session.creatureName }
        : {}),
      ...(copy.session.source === "native"
        ? {
            observation: {
              adapter: "codex-hooks" as const,
              coverage: "structural" as const,
              limitations: [
                "Structural hook observation only. Stopped generation and returned tools do not establish task success.",
              ],
            },
          }
        : {}),
    },
    events: copy.events,
  };
}
export function parseRecording(text: string): Recording {
  if (text.length > 20_000_000) throw new Error("Recording exceeds 20 MB");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object")
    throw new Error("Expected a Reef recording");
  const r = value as Recording;
  if (
    r.format !== "reef" ||
    r.version !== 1 ||
    !r.session ||
    typeof r.session.id !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(r.session.id) ||
    !Array.isArray(r.events) ||
    !Number.isFinite(Date.parse(r.session.createdAt))
  )
    throw new Error("Unsupported or invalid Reef recording");
  let previous = 0;
  for (const e of r.events) {
    if (
      !e ||
      e.sessionId !== r.session.id ||
      typeof e.id !== "string" ||
      typeof e.type !== "string" ||
      !Number.isInteger(e.seq) ||
      e.seq <= previous ||
      !Number.isFinite(Date.parse(e.at)) ||
      !e.data ||
      typeof e.data !== "object" ||
      Array.isArray(e.data)
    )
      throw new Error("Invalid event sequence");
    previous = e.seq;
  }
  for (const event of r.events) {
    const item = event.data.item;
    if (item !== undefined) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("Invalid item");
      const i = item as ReefItem;
      if (typeof i.id !== "string" || typeof i.type !== "string")
        throw new Error("Invalid item identity");
      for (const key of [
        "text",
        "command",
        "aggregated_output",
        "status",
        "server",
        "tool",
        "query",
        "message",
      ])
        if (i[key] !== undefined && typeof i[key] !== "string")
          throw new Error("Invalid item content");
      if (
        i.exit_code !== undefined &&
        i.exit_code !== null &&
        (typeof i.exit_code !== "number" || !Number.isInteger(i.exit_code))
      )
        throw new Error("Invalid command exit code");
      if (
        i.changes !== undefined &&
        (!Array.isArray(i.changes) ||
          i.changes.some(
            (c) =>
              !c || typeof c.path !== "string" || typeof c.kind !== "string",
          ))
      )
        throw new Error("Invalid reported file changes");
      if (
        i.items !== undefined &&
        (!Array.isArray(i.items) ||
          i.items.some(
            (t: unknown) =>
              !t ||
              typeof t !== "object" ||
              typeof (t as { text?: unknown }).text !== "string" ||
              typeof (t as { completed?: unknown }).completed !== "boolean",
          ))
      )
        throw new Error("Invalid todo list");
    }
    if (
      event.data.usage !== undefined &&
      (!event.data.usage ||
        typeof event.data.usage !== "object" ||
        Array.isArray(event.data.usage) ||
        Object.values(event.data.usage).some(
          (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
        ))
    )
      throw new Error("Invalid usage");
    if (event.data.usage !== undefined) {
      const usage = event.data.usage as Record<string, unknown>;
      if (
        typeof usage.input_tokens !== "number" ||
        typeof usage.output_tokens !== "number"
      )
        throw new Error("Incomplete usage");
    }
  }
  for (const key of ["title", "prompt", "workingDirectory", "model"])
    if (typeof r.session[key as keyof typeof r.session] !== "string")
      throw new Error("Invalid session metadata");
  if (
    r.session.creatureName !== undefined &&
    typeof r.session.creatureName !== "string"
  )
    throw new Error("Invalid creature name");
  return structuredClone(r);
}
