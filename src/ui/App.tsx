import { useEffect, useMemo, useRef, useState } from "react";
import {
  deriveSession,
  eventsAtTime,
  exportRecording,
  parseRecording,
  type Recording,
  type ReefItem,
  type ExportOptions,
} from "../core";
import { stepReplay } from "./replay";
import { demoRecording } from "../core/demo";
import { Aquarium, type CreatureMood } from "./Aquarium";

const clock = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
const itemLabel = (item: ReefItem) =>
  ({
    command_execution: "Terminal",
    file_change: "Files",
    reasoning: "Thinking",
    agent_message: "Message",
    mcp_tool_call: "Tool call",
    web_search: "Web search",
    todo_list: "Plan",
  })[item.type] ?? item.type.replaceAll("_", " ");
const activityFor = (item?: ReefItem): "terminal" | "files" | "tools" | null =>
  item?.type === "command_execution"
    ? "terminal"
    : item?.type === "file_change"
      ? "files"
      : item && ["mcp_tool_call", "web_search"].includes(item.type)
        ? "tools"
        : null;
const API = "/api";

export function App() {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [sessions, setSessions] = useState<Recording[]>([]);
  const [mode, setMode] = useState<"DEMO" | "LIVE" | "REPLAY">("DEMO");
  const [elapsed, setElapsed] = useState(0);
  const [sequenceCursor, setSequenceCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [observedNow, setObservedNow] = useState(Date.now());
  const stateRef = useRef<ReturnType<typeof deriveSession> | null>(null);
  const [name, setName] = useState("Miso");
  const [dialog, setDialog] = useState<"launch" | "export" | "about" | null>(
    null,
  );
  const [project, setProject] = useState("");
  const [demoDirectory, setDemoDirectory] = useState("");
  const [title, setTitle] = useState("A little maintenance");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"activity" | "files" | "events">("activity");
  const [selected, setSelected] = useState<string | null>(null);
  const [inspector, setInspector] = useState(true);
  const [presentation, setPresentation] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({});
  const importRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const creatureName = recording?.session.creatureName || "Miso";
  const duration =
    recording && recording.events.length
      ? Math.max(
          0,
          Date.parse(recording.events.at(-1)!.at) -
            Date.parse(recording.events[0].at),
        )
      : 0;
  const visibleEvents = useMemo(
    () =>
      !recording
        ? []
        : mode === "LIVE"
          ? recording.events
          : sequenceCursor !== null
            ? recording.events.filter((event) => event.seq <= sequenceCursor)
            : eventsAtTime(recording, elapsed),
    [recording, elapsed, mode, sequenceCursor],
  );
  const state = useMemo(
    () =>
      recording
        ? deriveSession(recording, visibleEvents.at(-1)?.seq ?? 0)
        : null,
    [recording, visibleEvents],
  );
  const latest = state?.items.at(-1);
  const activeItem = state?.items.find((i) => i.id === selected) ?? latest;
  stateRef.current = state;
  const latestItemEvent = [...visibleEvents]
    .reverse()
    .find((e) => (e.data.item as ReefItem | undefined)?.id === latest?.id);
  const viewTimestamp =
    mode === "LIVE"
      ? observedNow
      : (recording?.events[0] ? Date.parse(recording.events[0].at) : 0) +
        elapsed;
  const recentItem =
    !!latestItemEvent &&
    viewTimestamp - Date.parse(latestItemEvent.at) >= 0 &&
    viewTimestamp - Date.parse(latestItemEvent.at) < 1400;
  const commandFailed =
    latest?.type === "command_execution" &&
    (latest.status === "failed" ||
      (typeof latest.exit_code === "number" && latest.exit_code !== 0));
  const station =
    state?.status === "running" &&
    (latest?.status === "in_progress" || recentItem)
      ? activityFor(latest)
      : null;
  const mood: CreatureMood =
    state?.status === "failed" || (commandFailed && recentItem)
      ? "error"
      : state?.status === "completed"
        ? "complete"
        : state?.status === "cancelled"
          ? "idle"
          : state?.status === "running"
            ? station
              ? "working"
              : "thinking"
            : "idle";
  const preview = useMemo(
    () =>
      recording
        ? JSON.stringify(exportRecording(recording, exportOptions), null, 2)
        : "",
    [recording, exportOptions],
  );

  useEffect(() => {
    setSequenceCursor(null);
  }, [recording?.session.id]);
  useEffect(() => {
    if (mode !== "LIVE") return;
    const id = window.setInterval(() => setObservedNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [mode]);

  async function loadDemo() {
    try {
      const r = await fetch(`${API}/demo`);
      if (!r.ok) throw new Error("Sample recording unavailable");
      const data = parseRecording(await r.text());
      setRecording(data);
      setMode("DEMO");
      setElapsed(0);
      setSequenceCursor(null);
      setPlaying(true);
      setSelected(null);
      setNotice("");
    } catch {
      setRecording(structuredClone(demoRecording));
      setMode("DEMO");
      setElapsed(0);
      setSequenceCursor(null);
      setPlaying(true);
      setSelected(null);
      setNotice("");
    }
  }
  useEffect(() => {
    void loadDemo();
    void fetch(`${API}/health`)
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.workingDirectory === "string") {
          setDemoDirectory(data.workingDirectory);
          setProject(data.workingDirectory);
        }
      })
      .catch(() => {});
    void fetch(`${API}/sessions`)
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!playing || mode === "LIVE") return;
    let previous = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed((value) => {
        const next = Math.min(duration, value + delta * speed);
        if (next >= duration) setPlaying(false);
        return next;
      });
    }, 60);
    return () => clearInterval(interval);
  }, [playing, duration, speed, mode]);
  useEffect(() => {
    if (!recording || mode !== "LIVE") return;
    const stream = new EventSource(
      `${API}/sessions/${encodeURIComponent(recording.session.id)}/events?after=${recording.events.at(-1)?.seq ?? 0}`,
    );
    const receive = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data);
        setRecording((previous) =>
          previous &&
          previous.session.id === event.sessionId &&
          !previous.events.some((x) => x.seq === event.seq)
            ? {
                ...previous,
                events: [...previous.events, event].sort(
                  (a, b) => a.seq - b.seq,
                ),
              }
            : previous,
        );
      } catch {
        setNotice("Received an invalid event from the local adapter.");
      }
    };
    stream.addEventListener("reef", receive as EventListener);
    stream.onerror = () => {
      if (
        !["completed", "failed", "cancelled"].includes(
          stateRef.current?.status ?? "",
        )
      )
        setNotice("Event stream disconnected. Reconnecting automatically…");
    };
    stream.onopen = () => setNotice("");
    return () => stream.close();
  }, [recording?.session.id, mode]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [busy]);
  useEffect(() => {
    const change = () => setPresentation(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          workingDirectory: project,
          title,
          creatureName: name,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start task");
      const result = parseRecording(JSON.stringify(data));
      setRecording(result);
      setSessions((old) => [
        result,
        ...old.filter((r) => r.session.id !== result.session.id),
      ]);
      setMode("LIVE");
      setPlaying(false);
      setSelected(null);
      setDialog(null);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not start task",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!recording) return;
    try {
      const response = await fetch(
        `${API}/sessions/${encodeURIComponent(recording.session.id)}/cancel`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Could not cancel task");
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function loadRecordedRun() {
    try {
      const response = await fetch("/garden-rescue.reef");
      if (!response.ok) throw new Error("Recorded sample is unavailable");
      const r = parseRecording(await response.text());
      setRecording(r);
      setMode("REPLAY");
      setElapsed(0);
      setSequenceCursor(null);
      setPlaying(true);
      setSelected(null);
      setNotice("");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not load recorded sample",
      );
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const r = parseRecording(await file.text());
      setRecording(r);
      setMode("REPLAY");
      setPlaying(false);
      setElapsed(0);
      setSequenceCursor(null);
      setSelected(null);
      setNotice("");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Invalid recording");
    }
  }
  function download() {
    const blob = new Blob([preview], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${recording?.session.id ?? "session"}.reef`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDialog(null);
  }
  function jumpToFailure() {
    if (!recording) return;
    const failure = recording.events.find((e) => {
      const item = e.data.item as ReefItem | undefined;
      return (
        item?.type === "command_execution" &&
        (item.status === "failed" ||
          (typeof item.exit_code === "number" && item.exit_code !== 0))
      );
    });
    if (!failure) return;
    setMode(recording.session.source === "demo" ? "DEMO" : "REPLAY");
    setPlaying(false);
    setElapsed(Date.parse(failure.at) - Date.parse(recording.events[0].at));
    setSequenceCursor(failure.seq);
    setTab("activity");
    setInspector(true);
    setSelected((failure.data.item as ReefItem).id);
    window.setTimeout(
      () =>
        document
          .querySelector(".item-details")
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      120,
    );
  }
  function replay() {
    setMode("REPLAY");
    setElapsed(0);
    setSequenceCursor(null);
    setPlaying(true);
    setSelected(null);
  }
  function step(direction: number) {
    if (!recording) return;
    setPlaying(false);
    const next = stepReplay(
      recording,
      visibleEvents.at(-1)?.seq ?? 0,
      direction,
    );
    setElapsed(next.elapsedMs);
    setSequenceCursor(next.seq);
  }
  async function openExport() {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        setNotice("Exit fullscreen to review the export.");
        return;
      }
    }
    setDialog("export");
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      setNotice("Fullscreen is unavailable in this browser.");
    }
  }

  return (
    <div className="reef-app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Reef home">
          <span className="brand-mark">▦</span>reef
          <span className="brand-tag">A QUIET PLACE FOR BUSY AGENTS</span>
        </a>
        <div className="header-actions">
          <button className="text-button" onClick={() => setDialog("about")}>
            How it works <span>↗</span>
          </button>
          <button
            className="outline-button"
            onClick={() => importRef.current?.click()}
          >
            ↥ Import .reef
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setNotice("");
              setName("Miso");
              setDialog("launch");
            }}
          >
            + New session
          </button>
        </div>
      </header>
      <input
        ref={importRef}
        className="visually-hidden"
        type="file"
        accept=".reef,application/json"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <main className="main-layout">
        <section className="workspace-heading">
          <div>
            <div className="eyebrow">
              YOUR AGENT AQUARIUM <span className="small-line" />
            </div>
            <h1>
              A little work. <span>A little wonder.</span>
            </h1>
            <p>Follow the work below the surface.</p>
          </div>
          <div className="workspace-meta">
            <span className="connection-dot" /> LOCAL-FIRST
            <span className="meta-divider" />
            ONE AGENT · ONE REEF
          </div>
        </section>
        {notice && (
          <div className="notice" role="status">
            <span>◈</span>
            {notice}
            <button
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}
        <section
          ref={stageRef}
          className={`reef-stage ${presentation ? "presentation" : ""} ${!inspector ? "inspector-hidden" : ""}`}
        >
          <div className="stage-main">
            <div className="stage-toolbar">
              <div className="session-title">
                <span className={`mode-badge ${mode.toLowerCase()}`}>
                  <i />
                  {mode}
                </span>
                <span>{recording?.session.title ?? "Loading the reef…"}</span>
              </div>
              <div className="stage-tools">
                <button
                  title="Export recording"
                  aria-label="Export recording"
                  disabled={!recording}
                  onClick={() => void openExport()}
                >
                  ↧
                </button>
                <button
                  title="Toggle inspector"
                  aria-label="Toggle inspector"
                  className={inspector ? "tool-active" : ""}
                  onClick={() => setInspector((v) => !v)}
                >
                  ▥
                </button>
                <button
                  title={
                    presentation ? "Exit fullscreen" : "Presentation fullscreen"
                  }
                  aria-label={
                    presentation ? "Exit fullscreen" : "Presentation fullscreen"
                  }
                  onClick={() => void fullscreen()}
                >
                  {presentation ? "⊡" : "⛶"}
                </button>
              </div>
            </div>
            <div className="aquarium-wrap">
              <div className="water-label">
                <span>REEF 001</span>
                <span>AMBIENT MOTION · OBSERVED ACTIVITY</span>
              </div>
              <Aquarium
                name={creatureName}
                mood={mood}
                station={station}
                selected={inspector}
                presentation={presentation}
                onSelect={() => setInspector(true)}
              />
              <div className="station-labels">
                <span className={station === "terminal" ? "active" : ""}>
                  <i /> TERMINAL
                </span>
                <span className={station === "files" ? "active" : ""}>
                  <i /> FILES
                </span>
                <span className={station === "tools" ? "active" : ""}>
                  <i /> TOOLS
                </span>
              </div>
            </div>
            <div className="creature-strip">
              <div className="creature-avatar">✦</div>
              <div className="creature-identity">
                <strong>{creatureName}</strong>
                <span>AXOLOTL · SESSION OBSERVER</span>
              </div>
              <span className={`status-pill ${state?.status ?? ""}`}>
                <i />
                {state?.status ?? "loading"}
              </span>
              <div className="observed-action">
                {state?.status === "completed"
                  ? "Turn completed"
                  : state?.status === "failed"
                    ? "Turn failed"
                    : commandFailed
                      ? "Command reported failure"
                      : latest
                        ? itemLabel(latest)
                        : "Waiting for recorded activity"}
                <span>
                  {latest?.status
                    ? latest.status.replaceAll("_", " ")
                    : "Evidence from session events"}
                </span>
              </div>
            </div>
            <div className="transport">
              {mode === "LIVE" ? (
                <>
                  <span className="live-copy">
                    <i />
                    Following incoming events
                  </span>
                  {["running", "starting"].includes(state?.status ?? "") ? (
                    <button
                      className="outline-button"
                      onClick={() => void cancel()}
                    >
                      Cancel task
                    </button>
                  ) : (
                    <button className="outline-button" onClick={replay}>
                      Replay session ↺
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="playback-buttons">
                    <button
                      onClick={() => step(-1)}
                      aria-label="Previous event"
                      title="Previous event"
                    >
                      ⏮
                    </button>
                    <button
                      className="play-button"
                      onClick={() => {
                        if (!playing) {
                          if (
                            elapsed >= duration &&
                            (visibleEvents.at(-1)?.seq ?? 0) >=
                              (recording?.events.at(-1)?.seq ?? 0)
                          )
                            setElapsed(0);
                          setSequenceCursor(null);
                        }
                        setPlaying((v) => !v);
                      }}
                      aria-label={playing ? "Pause replay" : "Play replay"}
                    >
                      {playing ? "Ⅱ" : "▶"}
                    </button>
                    <button
                      onClick={() => step(1)}
                      aria-label="Next event"
                      title="Next event"
                    >
                      ⏭
                    </button>
                  </div>
                  <span className="timecode">{clock(elapsed)}</span>
                  <div className="timeline">
                    <input
                      aria-label="Replay position"
                      type="range"
                      min="0"
                      max={duration || 1}
                      value={elapsed}
                      onChange={(e) => {
                        setPlaying(false);
                        setSequenceCursor(null);
                        setElapsed(Number(e.target.value));
                      }}
                    />
                    <div className="timeline-markers">
                      {recording?.events
                        .filter((e) =>
                          [
                            "item.completed",
                            "turn.completed",
                            "turn.failed",
                          ].includes(e.type),
                        )
                        .map((e) => (
                          <button
                            aria-label={`Jump to ${e.type} at ${clock(Date.parse(e.at) - Date.parse(recording!.events[0].at))}`}
                            title={`${e.type} · ${clock(Date.parse(e.at) - Date.parse(recording!.events[0].at))}`}
                            onClick={() => {
                              setPlaying(false);
                              setElapsed(
                                Date.parse(e.at) -
                                  Date.parse(recording!.events[0].at),
                              );
                              setSequenceCursor(e.seq);
                              const item = e.data.item as ReefItem | undefined;
                              if (item) setSelected(item.id);
                            }}
                            key={e.id}
                            style={{
                              left: `${duration ? ((Date.parse(e.at) - Date.parse(recording.events[0].at)) / duration) * 100 : 0}%`,
                            }}
                          />
                        ))}
                    </div>
                  </div>
                  <span className="timecode muted">{clock(duration)}</span>
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                  {recording?.events.some((e) => {
                    const item = e.data.item as ReefItem | undefined;
                    return (
                      item?.type === "command_execution" &&
                      (item.status === "failed" ||
                        (typeof item.exit_code === "number" &&
                          item.exit_code !== 0))
                    );
                  }) && (
                    <button
                      className="failure-jump-button"
                      onClick={jumpToFailure}
                      aria-label="Jump to command failure"
                      title="Jump to command failure"
                    >
                      ↪ !
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {inspector && (
            <aside className="inspector">
              <div className="inspector-title">
                <div>
                  <span className="eyebrow">CREATURE INSPECTOR</span>
                  <h2>
                    {creatureName}
                    <span className="inspector-spark">✦</span>
                  </h2>
                </div>
                <button
                  className="close-button"
                  aria-label="Close inspector"
                  onClick={() => setInspector(false)}
                >
                  ×
                </button>
              </div>
              <div className="inspector-tabs">
                <button
                  className={tab === "activity" ? "active" : ""}
                  onClick={() => setTab("activity")}
                >
                  Activity <span>{state?.items.length ?? 0}</span>
                </button>
                <button
                  className={tab === "files" ? "active" : ""}
                  onClick={() => setTab("files")}
                >
                  Files <span>{state?.reportedFiles.length ?? 0}</span>
                </button>
                <button
                  className={tab === "events" ? "active" : ""}
                  onClick={() => setTab("events")}
                >
                  Events
                </button>
              </div>
              <div className="inspector-body">
                {state?.error && (
                  <div className="error-block">
                    <strong>Session error</strong>
                    <p>{state.error}</p>
                  </div>
                )}
                {tab === "activity" && (
                  <>
                    <div className="panel-caption">
                      {mode === "LIVE" ? "OBSERVED SO FAR" : "AT THIS MOMENT"}
                      <span>{visibleEvents.length} events</span>
                    </div>
                    <div className="activity-list">
                      {state?.items.map((item, i) => (
                        <button
                          key={item.id}
                          className={`activity-row ${activeItem?.id === item.id ? "selected" : ""}`}
                          onClick={() => setSelected(item.id)}
                        >
                          <span className={`activity-symbol ${item.type}`}>
                            {item.type === "command_execution"
                              ? "›_"
                              : item.type === "file_change"
                                ? "▤"
                                : item.type === "reasoning"
                                  ? "✧"
                                  : "◈"}
                          </span>
                          <span className="activity-summary">
                            <strong>{itemLabel(item)}</strong>
                            <span>
                              {item.command ??
                                item.text?.slice(0, 55) ??
                                (item.type === "mcp_tool_call"
                                  ? [item.server, item.tool]
                                      .filter((value) => typeof value === "string")
                                      .join(" · ") || "Tool activity"
                                  : `${item.changes?.length ?? 0} ${item.type === "file_change" ? "reported file changes" : "observed item"}`)}
                            </span>
                          </span>
                          <span
                            className={`activity-result ${item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0) ? "has-error" : ""}`}
                          >
                            {item.status === "in_progress"
                              ? "•••"
                              : item.status === "failed" ||
                                  (typeof item.exit_code === "number" &&
                                    item.exit_code !== 0)
                                ? "!"
                                : item.status === "completed"
                                  ? "✓"
                                  : i + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                    {!state?.items.length && (
                      <div className="empty-state">
                        <span>◌</span>
                        <p>The water is quiet.</p>
                        <small>
                          Activity appears as recorded events arrive.
                        </small>
                      </div>
                    )}
                    {activeItem && <ItemDetails item={activeItem} />}
                    {!!state?.commandFailures && (
                      <p className="evidence-note">
                        {state.commandFailures} command
                        {state.commandFailures === 1 ? "" : "s"} reported a
                        nonzero exit or failure. Session status comes from turn
                        events.
                      </p>
                    )}
                  </>
                )}
                {tab === "files" && (
                  <>
                    <div className="panel-caption">
                      REPORTED BY THE AGENT
                      <span>{state?.reportedFiles.length ?? 0} paths</span>
                    </div>
                    {state?.reportedFiles.map((file, i) => (
                      <div className="file-row" key={`${file.path}-${i}`}>
                        <span>▤</span>
                        <div>
                          <code>{file.path}</code>
                          <small>
                            {file.kind} · {file.status}
                          </small>
                        </div>
                      </div>
                    ))}
                    {!state?.reportedFiles.length && (
                      <div className="empty-state">
                        <span>▤</span>
                        <p>No file changes reported.</p>
                        <small>
                          Paths appear when file-change events are observed.
                        </small>
                      </div>
                    )}
                  </>
                )}
                {tab === "events" && (
                  <>
                    <div className="panel-caption">
                      RAW EVENT EVIDENCE
                      <span>{visibleEvents.length} events</span>
                    </div>
                    {visibleEvents.map((e) => (
                      <details className="raw-event" key={e.id}>
                        <summary>
                          <span>{String(e.seq).padStart(2, "0")}</span>
                          {e.type}
                          <time>
                            {clock(
                              Date.parse(e.at) -
                                Date.parse(recording!.events[0].at),
                            )}
                          </time>
                        </summary>
                        <pre>{JSON.stringify(e.data, null, 2)}</pre>
                      </details>
                    ))}
                  </>
                )}
              </div>
              <div className="inspector-footer">
                <span>
                  <i />{" "}
                  {state?.status === "completed"
                    ? "Turn complete"
                    : state?.status === "failed"
                      ? "Turn failed"
                      : state?.status === "cancelled"
                        ? "Cancelled"
                        : "Observing session"}
                </span>
                <span>
                  {state?.usage
                    ? `${state.usage.output_tokens.toLocaleString()} output tokens`
                    : "No token report yet"}
                </span>
              </div>
            </aside>
          )}
        </section>
        <section className="below-stage">
          <div>
            <span className="tiny-reef">⌁</span>
            <p>
              Your agent’s actions, made visible.
              <span>
                Swimming is decorative. Stations reflect recorded commands,
                files, and tools.
              </span>
            </p>
          </div>
          <div className="below-stage-actions">
            {recording?.events.some((e) => {
              const item = e.data.item as ReefItem | undefined;
              return (
                item?.type === "command_execution" &&
                (item.status === "failed" ||
                  (typeof item.exit_code === "number" && item.exit_code !== 0))
              );
            }) && (
              <button className="text-button" onClick={jumpToFailure}>
                Jump to command failure ↗
              </button>
            )}
            <button
              className="text-button"
              onClick={() => void loadRecordedRun()}
            >
              Replay recorded run ↗
            </button>
            <button className="text-button" onClick={() => void loadDemo()}>
              Load sample reef ↺
            </button>
          </div>
        </section>
        {sessions.length > 0 && (
          <section className="session-history">
            <span className="eyebrow">LOCAL SESSIONS</span>
            {sessions.map((r) => (
              <button
                key={r.session.id}
                onClick={() => {
                  void fetch(
                    `${API}/sessions/${encodeURIComponent(r.session.id)}`,
                  )
                    .then((response) => {
                      if (!response.ok)
                        throw new Error("Could not load session");
                      return response.json();
                    })
                    .then((data) => {
                      const next = parseRecording(JSON.stringify(data));
                      const terminal = [
                        "completed",
                        "failed",
                        "cancelled",
                      ].includes(deriveSession(next).status);
                      setRecording(next);
                      setSequenceCursor(null);
                      setMode(terminal ? "REPLAY" : "LIVE");
                      setElapsed(
                        terminal && next.events.length
                          ? Date.parse(next.events.at(-1)!.at) -
                              Date.parse(next.events[0].at)
                          : 0,
                      );
                      setPlaying(false);
                      setSelected(null);
                    })
                    .catch((e) => setNotice(String(e)));
                }}
              >
                {r.session.title}
                <span>{new Date(r.session.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </section>
        )}
      </main>
      <footer className="page-footer">
        <span>
          REEF <span> / </span> OBSERVE THE WORK
        </span>
        <span>Original pixel art · MIT licensed · Runs locally</span>
      </footer>
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <section
            className={`modal ${dialog === "export" ? "export-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="close-button modal-close"
              onClick={() => setDialog(null)}
              disabled={busy}
              aria-label="Close dialog"
            >
              ×
            </button>
            {dialog === "launch" ? (
              <>
                <div className="eyebrow">A NEW INHABITANT</div>
                <h2 id="dialog-title">Let’s give {name} something to do.</h2>
                <p>
                  The local Codex adapter runs your prompt in the selected
                  project. Its real session events bring the reef to life.
                </p>
                <form onSubmit={(e) => void launch(e)}>
                  <label>
                    Creature name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={24}
                    />
                  </label>
                  <label>
                    Session name
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Project directory
                    <input
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                      placeholder="/absolute/path/to/your/project"
                      required
                    />
                    <small>
                      An absolute project path is required. The sample directory
                      is selected by default.
                    </small>
                  </label>
                  {demoDirectory && (
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() => {
                        setProject(demoDirectory);
                        setTitle("Rescue the reef garden");
                        setPrompt(
                          "First run node --test garden.test.mjs to observe the failure. Read garden.mjs and garden.test.mjs, fix only garden.mjs, then rerun node --test garden.test.mjs. Explain briefly. Do not use network or unrelated files.",
                        );
                      }}
                    >
                      Use demo project & task ↗
                    </button>
                  )}
                  <label>
                    Task prompt
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Describe the work you want Codex to carry out…"
                      required
                      rows={4}
                    />
                  </label>
                  {notice && (
                    <p className="form-error" role="alert">
                      {notice}
                    </p>
                  )}
                  <div className="modal-actions">
                    <span>Requires local Codex authentication</span>
                    <button
                      className="primary-button"
                      disabled={busy || !prompt.trim() || !project.trim()}
                    >
                      {busy ? "Starting…" : "Launch session ↗"}
                    </button>
                  </div>
                </form>
              </>
            ) : dialog === "export" ? (
              <>
                <div className="eyebrow">A REEF TO KEEP</div>
                <h2 id="dialog-title">Export your recording.</h2>
                <p>
                  Choose which content to include. Review the exact file before
                  saving.
                </p>
                <div className="export-options">
                  {(
                    [
                      ["includePrompt", "Task prompt"],
                      ["includePaths", "Project & file paths"],
                      ["includeCommands", "Command text"],
                      ["includeContent", "Output, messages & tool content"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={!!exportOptions[key]}
                        onChange={(e) =>
                          setExportOptions((o) => ({
                            ...o,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="export-caution">
                  Included command text, output, messages, and tool content may
                  contain private paths or secrets even when project & file
                  paths are omitted. Review the preview before sharing.
                </p>
                <div className="preview-heading">
                  FILE PREVIEW
                  <span>
                    {(new Blob([preview]).size / 1024).toFixed(1)} KB · .reef
                  </span>
                </div>
                <pre className="export-preview">{preview}</pre>
                <div className="modal-actions">
                  <span>Structural event evidence is always included.</span>
                  <button className="primary-button" onClick={download}>
                    Save .reef ↧
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="eyebrow">BELOW THE SURFACE</div>
                <h2 id="dialog-title">Small creature. Real evidence.</h2>
                <p>
                  Reef turns a Codex session into a pixel aquarium. Your axolotl
                  visits the terminal, file, or tool station when the session
                  reports matching activity.
                </p>
                <div className="about-facts">
                  <p>
                    <strong>LIVE</strong> follows events from the local adapter.
                  </p>
                  <p>
                    <strong>DEMO</strong> plays a bundled, explicitly simulated
                    recording.
                  </p>
                  <p>
                    <strong>REPLAY</strong> rebuilds state from recorded events
                    as you scrub.
                  </p>
                </div>
                <p>
                  Swimming, bubbles, and seaweed are decorative. A failed
                  command does not mean the task failed. Turn events determine
                  session status.
                </p>
                <p>
                  Recordings stay local. You select the content included in each
                  export.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setDialog(null)}
                >
                  Back to the reef
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ItemDetails({ item }: { item: ReefItem }) {
  return (
    <section className="item-details">
      <div className="detail-heading">
        {itemLabel(item).toUpperCase()} DETAILS
        <span>{item.status?.replaceAll("_", " ") ?? "observed"}</span>
      </div>
      {item.command && (
        <>
          <span className="detail-label">COMMAND</span>
          <pre className="command-code">$ {item.command}</pre>
        </>
      )}
      {item.changes?.map((c, i) => (
        <div className="file-detail" key={i}>
          <code>{c.path}</code>
          <span>{c.kind}</span>
        </div>
      ))}
      {item.aggregated_output !== undefined && (
        <>
          <span className="detail-label">
            OUTPUT
            {
              <span>
                EXIT{" "}
                {typeof item.exit_code === "number"
                  ? item.exit_code
                  : "UNKNOWN"}
              </span>
            }
          </span>
          <pre className="output-code">
            {item.aggregated_output || "(No output)"}
          </pre>
        </>
      )}
      {item.text && <p className="message-text">{item.text}</p>}
      {!item.command && !item.text && !item.changes && (
        <pre className="output-code">{JSON.stringify(item, null, 2)}</pre>
      )}
    </section>
  );
}
