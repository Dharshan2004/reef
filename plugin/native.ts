import { randomUUID } from "node:crypto";
import {
  mkdir,
  opendir,
  readFile,
  rename,
  rm,
  lstat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Recording, ReefEvent, ReefItem } from "../src/core";

const SESSION_LIMIT = 50,
  EVENT_LIMIT = 500,
  SCAN_LIMIT = 2000,
  BYTE_LIMIT = 4096;
const FILE_PATTERN = /^\d{12}-[a-f0-9-]+\.json$/;
const hooks: Record<string, string> = {
  SessionStart: "native.session_started",
  UserPromptSubmit: "native.turn_started",
  PreToolUse: "native.tool_started",
  PostToolUse: "native.tool_finished",
  PermissionRequest: "native.permission_requested",
  SubagentStart: "native.agent_started",
  SubagentStop: "native.agent_finished",
  Stop: "native.stopped",
  Interrupt: "native.interrupted",
  SessionEnd: "native.ended",
};
const safeId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeName = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_.:@/-]{1,160}$/.test(value);
type NativeEvent = {
  id: string;
  at: string;
  seq: number;
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
  model?: string;
};
function root(dataDir?: string) {
  const base = dataDir ?? process.env.PLUGIN_DATA;
  return base ? join(base, "reef-native") : null;
}
async function names(path: string) {
  const entries: string[] = [];
  const directory = await opendir(path);
  try {
    for await (const entry of directory) {
      if (entries.length >= SCAN_LIMIT) break;
      entries.push(entry.name);
    }
  } finally {
    /* for-await closes the directory, including on break. */
  }
  return entries;
}
function toolType(name: string) {
  if (["Bash", "Shell", "exec_command", "write_stdin"].includes(name))
    return "command_execution";
  if (["apply_patch", "ApplyPatch"].includes(name)) return "file_change";
  if (name.startsWith("mcp__")) return "mcp_tool_call";
  return "tool_observation";
}
function normalize(
  payload: unknown,
): Omit<NativeEvent, "id" | "at" | "seq"> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const p = payload as Record<string, unknown>;
  if (
    !safeId(p.session_id) ||
    typeof p.hook_event_name !== "string" ||
    !hooks[p.hook_event_name]
  )
    return null;
  if (p.turn_id !== undefined && !safeId(p.turn_id)) return null;
  const data: Record<string, unknown> = {};
  if (p.turn_id) data.turnId = p.turn_id;
  const type = hooks[p.hook_event_name]!;
  if (
    ["PreToolUse", "PostToolUse", "PermissionRequest"].includes(
      p.hook_event_name,
    )
  ) {
    if (!safeName(p.tool_name) || !safeId(p.tool_use_id)) return null;
    if (
      p.tool_name.startsWith("mcp__reef__") ||
      ["reef_sessions", "reef_recording", "reef_aquarium"].includes(p.tool_name)
    )
      return null;
    const item: ReefItem = {
      id: `native-tool-${p.tool_use_id}`,
      type: toolType(p.tool_name),
      toolName: p.tool_name,
      origin: "native-hook",
      status:
        p.hook_event_name === "PostToolUse"
          ? "observed_finished"
          : p.hook_event_name === "PermissionRequest"
            ? "waiting"
            : "in_progress",
    };
    if (item.type === "mcp_tool_call") {
      const parts = p.tool_name.split("__");
      item.server = parts[1] ?? "unknown";
      item.tool = parts.slice(2).join("__");
    }
    data.item = item;
  }
  if (["SubagentStart", "SubagentStop"].includes(p.hook_event_name)) {
    if (
      !safeId(p.agent_id) ||
      (p.agent_type !== undefined && !safeName(p.agent_type))
    )
      return null;
    data.item = {
      id: `native-agent-${p.agent_id}`,
      type: "subagent_observation",
      origin: "native-hook",
      agentType: p.agent_type ?? "unknown",
      status:
        p.hook_event_name === "SubagentStop"
          ? "observed_finished"
          : "in_progress",
    };
  }
  return {
    sessionId: p.session_id,
    type,
    data,
    ...(safeName(p.model) ? { model: p.model } : {}),
  };
}
/** Structural allowlist only. No transcript, prompt, cwd, tool input, or output is read. */
async function withWriterLock<T>(
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const lock = join(path, ".writer-lock");
  let acquired = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await lstat(lock)).mtimeMs > 10_000)
          await rm(lock, { recursive: true, force: true });
      } catch {
        /* Another writer released the lock. */
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!acquired) throw new Error("Native observer busy");
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function recordNativeHook(
  payload: unknown,
  dataDir?: string,
): Promise<boolean> {
  const base = root(dataDir),
    normalized = normalize(payload);
  if (!base || !normalized) return false;
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink())
    throw new Error("Invalid native storage root");
  const path = join(base, normalized.sessionId);
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink())
    throw new Error("Invalid native storage directory");
  await withWriterLock(path, async () => {
    const files = (await names(path))
      .filter((name) => FILE_PATTERN.test(name))
      .sort();
    let counter: { seq: number; createdAt: string; model?: string } | undefined;
    try {
      const metaPath = join(path, ".counter.json");
      const info = await lstat(metaPath);
      if (info.isFile() && !info.isSymbolicLink() && info.size <= BYTE_LIMIT)
        counter = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      /* First event or previously interrupted metadata write. */
    }
    const last = Number(files.at(-1)?.slice(0, 12) ?? 0);
    const seq =
      Math.max(last, Number.isSafeInteger(counter?.seq) ? counter!.seq : 0) + 1;
    const event: NativeEvent = {
      ...normalized,
      id: randomUUID(),
      at: new Date().toISOString(),
      seq,
    };
    const file = join(
      path,
      `${seq.toString().padStart(12, "0")}-${event.id}.json`,
    );
    await writeFile(`${file}.tmp`, JSON.stringify(event), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(`${file}.tmp`, file);
    const meta = {
      seq,
      createdAt: counter?.createdAt ?? event.at,
      model: counter?.model ?? event.model,
    };
    const temporary = join(path, `.${randomUUID()}.meta.tmp`);
    await writeFile(temporary, JSON.stringify(meta), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, join(path, ".counter.json"));
    const expired = files.slice(0, Math.max(0, files.length + 1 - EVENT_LIMIT));
    await Promise.all(
      expired.map((name) => rm(join(path, name), { force: true })),
    );
    // Interrupted writes are not recordings. Remove stale temporary files.
    for (const name of await names(path)) {
      if (!name.endsWith(".tmp")) continue;
      try {
        if (Date.now() - (await lstat(join(path, name))).mtimeMs > 60_000)
          await rm(join(path, name), { force: true });
      } catch {
        /* Concurrent cleanup. */
      }
    }
  });
  const sessions = (await names(base)).filter(safeId);
  if (sessions.length > SESSION_LIMIT) {
    const ordered = await Promise.all(
      sessions.map(async (name) => {
        try {
          const info = await lstat(join(base, name));
          return info.isDirectory() && !info.isSymbolicLink()
            ? { name, time: info.mtimeMs }
            : null;
        } catch {
          return null;
        }
      }),
    );
    const present = ordered
      .filter(
        (entry): entry is { name: string; time: number } => entry !== null,
      )
      .sort((a, b) => b.time - a.time);
    await Promise.all(
      present
        .slice(SESSION_LIMIT)
        .map((entry) =>
          rm(join(base, entry.name), { recursive: true, force: true }).catch(
            () => {},
          ),
        ),
    );
  }
  return true;
}
async function readSession(
  sessionId: string,
  base: string,
): Promise<Recording | null> {
  if (!safeId(sessionId)) return null;
  const path = join(base, sessionId);
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const files = (await names(path))
      .filter((name) => FILE_PATTERN.test(name))
      .sort()
      .slice(-EVENT_LIMIT);
    const observed: NativeEvent[] = [];
    for (const name of files) {
      try {
        const file = join(path, name);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > BYTE_LIMIT)
          continue;
        const e = JSON.parse(await readFile(file, "utf8")) as NativeEvent;
        if (
          e.sessionId !== sessionId ||
          !safeId(e.id) ||
          !Number.isSafeInteger(e.seq) ||
          Number(name.slice(0, 12)) !== e.seq ||
          e.seq < 1 ||
          !Number.isFinite(Date.parse(e.at)) ||
          !Object.values(hooks).includes(e.type)
        )
          continue;
        // Rebuild from the structural schema even if a spool file was edited locally.
        const hook = Object.entries(hooks).find(
          ([, type]) => type === e.type,
        )?.[0];
        const item = e.data?.item as ReefItem | undefined;
        const normalized = normalize({
          session_id: e.sessionId,
          hook_event_name: hook,
          turn_id: e.data?.turnId,
          model: e.model,
          tool_name: item?.toolName,
          tool_use_id: item?.id?.replace(/^native-tool-/, ""),
          agent_id: item?.id?.replace(/^native-agent-/, ""),
          agent_type: item?.agentType,
        });
        if (normalized)
          observed.push({ ...normalized, id: e.id, at: e.at, seq: e.seq });
      } catch {
        /* Corrupt or concurrently pruned records are ignored. */
      }
    }
    if (!observed.length) return null;
    observed.sort((a, b) => a.seq - b.seq);
    let metadata: { createdAt?: string; model?: string } | undefined;
    try {
      const metaPath = join(path, ".counter.json");
      const info = await lstat(metaPath);
      if (info.isFile() && !info.isSymbolicLink() && info.size <= BYTE_LIMIT)
        metadata = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      /* Metadata is optional after an interrupted write. */
    }
    const id = `native-${sessionId}`;
    const events: ReefEvent[] = observed.map((e) => ({
      id: e.id,
      sessionId: id,
      seq: e.seq,
      at: e.at,
      type: e.type,
      data: e.data,
    }));
    return {
      format: "reef",
      version: 1,
      session: {
        id,
        title: `Observed Codex chat · ${sessionId.slice(-6)}`,
        prompt: "[not observed]",
        workingDirectory: "[not observed]",
        model: safeName(metadata?.model)
          ? metadata.model
          : (observed.find((e) => e.model)?.model ?? "[not observed]"),
        createdAt:
          metadata?.createdAt && Number.isFinite(Date.parse(metadata.createdAt))
            ? metadata.createdAt
            : observed[0]!.at,
        source: "native",
        observation: {
          adapter: "codex-hooks",
          coverage: "structural",
          limitations: [
            "No prompts, commands, inputs, outputs, file paths, usage, or transcripts collected.",
            "A returned tool and stopped generation do not establish task success.",
            "Only enabled hook activity is observed; older events may be pruned.",
          ],
        },
      },
      events,
    };
  } catch {
    return null;
  }
}
export async function readNativeSessions(
  dataDir?: string,
): Promise<Recording[]> {
  const base = root(dataDir);
  if (!base) return [];
  try {
    if ((await lstat(base)).isSymbolicLink()) return [];
    const ids = (await names(base)).filter(safeId).slice(0, SESSION_LIMIT);
    const sessions = await Promise.all(ids.map((id) => readSession(id, base)));
    return sessions
      .filter((r): r is Recording => r !== null)
      .sort((a, b) => b.session.createdAt.localeCompare(a.session.createdAt));
  } catch {
    return [];
  }
}
export async function readNativeRecording(
  id: string,
  dataDir?: string,
): Promise<Recording | null> {
  const base = root(dataDir);
  if (!base || !id.startsWith("native-")) return null;
  try {
    if ((await lstat(base)).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return readSession(id.slice(7), base);
}
