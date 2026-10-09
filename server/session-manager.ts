import { Codex } from "@openai/codex-sdk";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getIsolationOverrides, resolveCodexExecutable } from "./codex-config";
import {
  deriveSession,
  parseRecording,
  type Recording,
  type ReefEvent,
} from "../src/core/index";

export type Runner = (
  prompt: string,
  workingDirectory: string,
  signal: AbortSignal,
) => AsyncIterable<Record<string, unknown>>;
export async function* codexRunner(
  prompt: string,
  workingDirectory: string,
  signal: AbortSignal,
) {
  const executable = resolveCodexExecutable();
  const configOverrides = await getIsolationOverrides(
    executable,
    workingDirectory,
    signal,
  );
  const codex = new Codex({ codexPathOverride: executable, configOverrides });
  const thread = codex.startThread({
    model: "gpt-6.1-sol",
    workingDirectory,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });
  const { events } = await thread.runStreamed(prompt, { signal });
  for await (const event of events)
    yield event as unknown as Record<string, unknown>;
}
export class SessionManager {
  recordings = new Map<string, Recording>();
  private controllers = new Map<string, AbortController>();
  private subscribers = new Map<string, Set<(e: ReefEvent) => void>>();
  private writes = new Map<string, Promise<void>>();
  constructor(
    private directory: string,
    private runner: Runner = codexRunner,
  ) {}
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith(".json")) continue;
      try {
        const r = parseRecording(
          await readFile(join(this.directory, name), "utf8"),
        );
        this.recordings.set(r.session.id, r);
        if (["starting", "running"].includes(deriveSession(r).status))
          this.append(r, "session.disconnected", {
            message:
              "Server restarted. This recorded session is not attached to a live process; outcome unknown.",
          });
      } catch {
        /* Incomplete or invalid files are never executed. */
      }
    }
  }
  get(id: string) {
    return this.recordings.get(id);
  }
  list() {
    return [...this.recordings.values()].sort((a, b) =>
      b.session.createdAt.localeCompare(a.session.createdAt),
    );
  }
  get activeCount() {
    return this.controllers.size;
  }
  subscribe(id: string, listener: (e: ReefEvent) => void) {
    const set = this.subscribers.get(id) ?? new Set();
    set.add(listener);
    this.subscribers.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.subscribers.delete(id);
    };
  }
  private append(r: Recording, type: string, data: Record<string, unknown>) {
    const event: ReefEvent = {
      id: randomUUID(),
      sessionId: r.session.id,
      seq: r.events.length + 1,
      at: new Date().toISOString(),
      type,
      data,
    };
    r.events.push(event);
    for (const listener of this.subscribers.get(r.session.id) ?? [])
      listener(event);
    const snapshot = JSON.stringify(r);
    const previous = this.writes.get(r.session.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const file = join(this.directory, `${r.session.id}.json`);
        await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
    this.writes.set(r.session.id, next);
    next.catch((error) =>
      console.error(
        "Recording persistence failed:",
        error instanceof Error ? error.message : "unknown",
      ),
    );
  }
  start(input: {
    prompt: string;
    workingDirectory: string;
    title?: string;
    creatureName?: string;
  }) {
    const id = randomUUID();
    const r: Recording = {
      format: "reef",
      version: 1,
      session: {
        id,
        title: input.title ?? "New session",
        prompt: input.prompt,
        workingDirectory: input.workingDirectory,
        model: "gpt-6.1-sol",
        createdAt: new Date().toISOString(),
        source: "live",
        ...(input.creatureName ? { creatureName: input.creatureName } : {}),
      },
      events: [],
    };
    this.recordings.set(id, r);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.append(r, "session.started", {});
    void this.run(r, controller);
    return r;
  }
  private async run(r: Recording, controller: AbortController) {
    try {
      for await (const event of this.runner(
        r.session.prompt,
        r.session.workingDirectory,
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        const { type, ...data } = event;
        this.append(r, String(type), data);
      }
      if (
        !controller.signal.aborted &&
        ["starting", "running"].includes(deriveSession(r).status)
      )
        this.append(r, "session.disconnected", {
          message:
            "Event stream ended without a terminal turn event. Outcome unknown.",
        });
    } catch (error) {
      if (!controller.signal.aborted)
        this.append(
          r,
          ["completed", "failed", "cancelled"].includes(deriveSession(r).status)
            ? "session.disconnected"
            : "session.error",
          {
            message:
              error instanceof Error ? error.message : "Codex execution failed",
          },
        );
    } finally {
      this.controllers.delete(r.session.id);
    }
  }
  cancel(id: string) {
    const r = this.get(id);
    const controller = this.controllers.get(id);
    if (
      !r ||
      !controller ||
      controller.signal.aborted ||
      ["completed", "failed", "cancelled"].includes(deriveSession(r).status)
    )
      return false;
    controller.abort();
    this.append(r, "session.cancelled", {
      message:
        "Cancellation requested by user; filesystem effects are not rolled back.",
    });
    return true;
  }
  async flush() {
    await Promise.all([...this.writes.values()]);
  }
}
