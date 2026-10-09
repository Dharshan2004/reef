import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  OpenAIExtensions,
  OpenAIFileEntrypointInputSchema,
} from "@openai/mcp-extensions/app";
import { Aquarium, type CreatureMood } from "../src/ui/Aquarium";
import {
  deriveSession,
  parseRecording,
  type Recording,
  type ReefEvent,
} from "../src/core";

import {
  isNativeRecording,
  recordingStatus,
  updatedCursor,
  previousCommandFailure,
} from "./viewer-state";

const host = new App({ name: "reef-aquarium", version: "0.1.0" });
const extensions = new OpenAIExtensions(host);
let receiveFile: (uri: string) => Promise<void> = async () => {};
let openedResource: string | null = null;
let disposeResource: (() => void) | undefined;
host.addEventListener("toolinput", async ({ arguments: args }) => {
  const parsed = OpenAIFileEntrypointInputSchema.safeParse(args);
  if (parsed.success) await receiveFile(parsed.data.file.resourceUri);
});
function Viewer() {
  const [recording, setRecording] = useState<Recording | null>(null),
    [sessions, setSessions] = useState<Recording[]>([]),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState<ReefEvent | null>(null),
    [seq, setSeq] = useState(0),
    [playing, setPlaying] = useState(false),
    [mode, setMode] = useState<"panel" | "file">("panel");
  const [shared, setShared] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [following, setFollowing] = useState(false);
  const currentRecording = useRef<Recording | null>(null);
  currentRecording.current = recording;
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const refreshVersion = useRef(0);
  const selectionVersion = useRef(0);
  function inspectEvent(event: ReefEvent | null) {
    selectionVersion.current++;
    setSelected(event);
    setShared("");
  }
  useEffect(() => {
    receiveFile = async (uri) => {
      const version = selectionVersion.current;
      setMode("file");
      try {
        if (openedResource !== uri) {
          if (openedResource)
            await extensions.resources
              ?.unsubscribe({ uri: openedResource })
              .catch(() => {});
          disposeResource?.();
          openedResource = uri;
          disposeResource = extensions.resources?.addUpdateHandler(
            async ({ params }) => {
              if (
                params.uri === openedResource &&
                currentMode.current === "file"
              )
                await receiveFile(params.uri);
            },
          );
          await extensions.resources?.subscribe({ uri }).catch(() => {});
        }
        if (!extensions.resources)
          throw new Error(
            "This host does not support file resources. Import a .reef file below.",
          );
        const result = await extensions.resources.read({ uri });
        const part = result.contents[0];
        if (!part) throw new Error("Empty recording");
        const text =
          "text" in part
            ? part.text
            : "blob" in part
              ? new TextDecoder().decode(
                  Uint8Array.from(atob(part.blob), (c) => c.charCodeAt(0)),
                )
              : "";
        const r = parseRecording(text);
        if (version !== selectionVersion.current) return;
        const same = currentRecording.current?.session.id === r.session.id;
        setRecording(r);
        if (!same) {
          setSeq(0);
          setFollowing(false);
          setPlaying(false);
          inspectEvent(null);
        }
        setError("");
      } catch (e) {
        if (version === selectionVersion.current) setError(String(e));
      }
    };
    host.ontoolresult = (result) => {
      const data = result.structuredContent as
        { file?: { resourceUri: string } } | undefined;
      if (data?.file) void receiveFile(data.file.resourceUri);
    };
    host
      .connect()
      .then(() => setReady(true))
      .catch((e) =>
        setError(
          `Host connection failed: ${String(e)}. You can still import a recording.`,
        ),
      );
  }, []);
  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const result = await host.callServerTool({
        name: "reef_sessions",
        arguments: {},
      });
      if (result.isError)
        throw new Error(
          "Could not read local Reef sessions. Check that the Reef plugin and its hooks are enabled.",
        );
      const data = (
        result.structuredContent as { data: { sessions: Recording[] } }
      ).data;
      if (version !== refreshVersion.current) return;
      setSessions(data.sessions);
      if (currentMode.current === "panel") setError("");
    } catch (e) {
      if (version === refreshVersion.current && currentMode.current === "panel")
        setError(String(e));
    }
  }
  useEffect(() => {
    if (!ready || mode !== "panel") return;
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [ready, mode]);
  useEffect(() => {
    if (mode === "panel" && recording) {
      const current = sessions.find(
        (r) => r.session.id === recording.session.id,
      );
      if (current) {
        setRecording(current);
        setSeq((previous) => updatedCursor(previous, current, following));
      }
    }
  }, [sessions, following]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setSeq((current) => {
          const next = currentRecording.current?.events.find(
            (e) => e.seq > current,
          );
          if (!next) {
            setPlaying(false);
            return current;
          }
          return next.seq;
        }),
      750,
    );
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (selected && selected.seq > seq) {
      inspectEvent(null);
    }
  }, [seq, selected]);
  const state = recording ? deriveSession(recording, seq) : null;
  const native = recording ? isNativeRecording(recording) : false;
  const status = state?.status ?? "unknown";
  const observedRunning =
    following &&
    mode === "panel" &&
    ["running", "starting", "waiting"].includes(status);
  function chooseSession(r: Recording) {
    setRecording(r);
    setMode("panel");
    setSeq(r.events.at(-1)?.seq ?? 0);
    inspectEvent(null);
    setPlaying(false);
    setFollowing(true);
  }
  function pauseForReplay() {
    setFollowing(false);
    setPlaying(false);
  }
  function step(direction: number) {
    if (!recording) return;
    pauseForReplay();
    const next =
      direction > 0
        ? recording.events.find((e) => e.seq > seq)
        : [...recording.events].reverse().find((e) => e.seq < seq);
    setSeq(
      next?.seq ?? (direction > 0 ? (recording.events.at(-1)?.seq ?? 0) : 0),
    );
  }
  const active =
    state?.status === "running"
      ? state.items.filter((item) => item.status === "in_progress").at(-1)
      : undefined;
  const station =
    active?.type === "command_execution"
      ? "terminal"
      : active?.type === "file_change"
        ? "files"
        : active?.type === "mcp_tool_call" ||
            active?.type === "tool_observation"
          ? "tools"
          : null;
  const mood: CreatureMood =
    state?.status === "failed"
      ? "error"
      : state?.status === "completed"
        ? "complete"
        : state?.status === "running"
          ? station
            ? "working"
            : "thinking"
          : state?.status === "starting" || String(state?.status) === "waiting"
            ? "waiting"
            : "idle";
  async function share() {
    if (!selected) return;
    const version = selectionVersion.current;
    try {
      if (!extensions.modelContext)
        throw new Error("This host does not support model context sharing.");
      await extensions.modelContext.update({
        content: [
          {
            type: "text",
            text: `Selected Reef event ${selected.type} at ${selected.at}.\n${JSON.stringify(selected.data)}`,
          },
        ],
        structuredContent: {
          reef: { sessionId: selected.sessionId, event: selected },
        },
      });
      if (version === selectionVersion.current)
        setShared("Selected event shared with this conversation.");
    } catch (e) {
      if (version === selectionVersion.current) setShared(String(e));
    }
  }
  const primarySession = recording ?? sessions[0];
  const creatureName = (r?: Recording) =>
    r?.session.creatureName ?? r?.session.title.slice(0, 20) ?? "Miso";
  const moodFor = (r: Recording): CreatureMood => {
    const status = recordingStatus(r);
    return status === "failed"
      ? "error"
      : status === "completed"
        ? "complete"
        : status === "waiting"
          ? "waiting"
          : status === "running"
            ? "thinking"
            : "idle";
  };
  const companions =
    mode === "panel"
      ? sessions
          .filter((r) => r.session.id !== primarySession?.session.id)
          .slice(0, 3)
          .map((r) => ({
            id: r.session.id,
            name: creatureName(r),
            mood: moodFor(r),
          }))
      : [];
  const failure = recording
    ? previousCommandFailure(recording, seq)
    : undefined;
  const selectedItem = selected?.data.item as
    | {
        command?: string;
        aggregated_output?: string;
        toolName?: string;
        status?: string;
        text?: string;
        exit_code?: number | null;
      }
    | undefined;
  function eventLabel(event: ReefEvent) {
    const item = event.data.item as
      { toolName?: string; command?: string; type?: string } | undefined;
    return (
      item?.toolName ??
      item?.command ??
      (
        {
          "native.session_started": "Session started",
          "native.turn_started": "Thinking",
          "native.stopped": "Response stopped",
          "native.ended": "Session ended",
          "native.interrupted": "Interrupted",
          "native.permission_requested": "Waiting for approval",
          "turn.completed": "Turn completed",
          "turn.failed": "Turn failed",
        } as Record<string, string>
      )[event.type] ??
      item?.type?.replaceAll("_", " ") ??
      event.type.replaceAll(".", " · ")
    );
  }
  function inspectSession(r?: Recording) {
    if (r && r.session.id !== recording?.session.id) chooseSession(r);
    inspectEvent(
      r?.events.find(
        (e) =>
          e.seq ===
          (r.session.id === recording?.session.id ? seq : r.events.at(-1)?.seq),
      ) ?? null,
    );
    setInspecting(true);
  }
  return (
    <main className="reef-viewer">
      <style>{viewerStyles}</style>
      <header className="viewer-toolbar">
        <div className="viewer-brand">
          ⌁ <strong>reef</strong>
          <span className={`mode-label ${observedRunning ? "live" : ""}`}>
            {!recording
              ? "READY"
              : recording.session.source === "demo"
                ? "DEMO"
                : observedRunning
                  ? "LIVE"
                  : "REPLAY"}
          </span>
        </div>
        <div className="toolbar-actions">
          {mode === "panel" && sessions.length > 0 && (
            <select
              aria-label="Choose session"
              value={recording?.session.id ?? ""}
              onChange={(event) => {
                const r = sessions.find(
                  (item) => item.session.id === event.target.value,
                );
                if (r) chooseSession(r);
              }}
            >
              <option value="">Choose a creature</option>
              {sessions.map((r) => (
                <option key={r.session.id} value={r.session.id}>
                  {creatureName(r)} · {recordingStatus(r)}
                </option>
              ))}
            </select>
          )}
          {mode === "file" && ready && (
            <button
              onClick={() => {
                setMode("panel");
                setPlaying(false);
                setRecording(null);
                inspectEvent(null);
                setFollowing(false);
              }}
            >
              Sessions
            </button>
          )}
          <button
            onClick={() => importInput.current?.click()}
            title="Import .reef recording"
            aria-label="Import recording"
          >
            ↥ <span>Import</span>
          </button>
        </div>
      </header>
      <input
        ref={importInput}
        className="hidden-input"
        type="file"
        accept=".reef,application/json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const version = ++selectionVersion.current;
          try {
            const r = parseRecording(await file.text());
            if (version !== selectionVersion.current) return;
            setRecording(r);
            setSeq(0);
            setMode("file");
            setFollowing(false);
            setPlaying(false);
            inspectEvent(null);
            setError("");
          } catch (error) {
            if (version === selectionVersion.current) setError(String(error));
          }
        }}
      />
      <section className="tank" aria-label="Agent aquarium">
        <Aquarium
          name={creatureName(primarySession)}
          mood={
            recording ? mood : primarySession ? moodFor(primarySession) : "idle"
          }
          station={station}
          selected={!!recording}
          companions={companions}
          onSelect={() => inspectSession(primarySession)}
          onSelectCompanion={(id) =>
            inspectSession(sessions.find((r) => r.session.id === id))
          }
        />
        {!recording && sessions.length === 0 && (
          <div className="empty-overlay">
            <strong>Your reef is ready.</strong>
            <button
              className="mint-button"
              onClick={() => importInput.current?.click()}
            >
              Import a recording
            </button>
            <button className="quiet-button" onClick={() => setInfoOpen(true)}>
              Enable live observation ↗
            </button>
          </div>
        )}
        <div className="station-names" aria-hidden="true">
          <span>TERMINAL</span>
          <span>FILES</span>
          <span>TOOLS</span>
        </div>
      </section>
      <div className="status-line">
        <span className="status-dot" />
        <strong>
          {recording
            ? creatureName(recording)
            : sessions.length
              ? `${sessions.length} creatures`
              : "Miso"}
        </strong>
        <span>
          {recording
            ? status
            : sessions.length
              ? "Choose a creature to inspect"
              : "Waiting for a recording"}
        </span>
        {mode === "panel" && sessions.length > 4 && (
          <span className="overflow-count">
            +{sessions.length - 4} in session picker
          </span>
        )}
        {recording && (
          <button
            className="quiet-button inspect-toggle"
            onClick={() => {
              setInspecting((value) => !value);
              if (!selected)
                inspectEvent(
                  recording.events.find((e) => e.seq === seq) ?? null,
                );
            }}
            aria-expanded={inspecting}
          >
            Activity {inspecting ? "▴" : "▾"}
          </button>
        )}
      </div>
      {error && (
        <div className="error-notice" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {recording && (
        <div className="transport">
          <button
            className="play"
            aria-label={playing ? "Pause replay" : "Play replay"}
            onClick={() => {
              setFollowing(false);
              if (!playing && seq >= (recording.events.at(-1)?.seq ?? 0))
                setSeq((recording.events[0]?.seq ?? 1) - 1);
              setPlaying((value) => !value);
            }}
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button
            aria-label="Previous event"
            title="Previous event"
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <input
            type="range"
            aria-label="Replay event"
            min={Math.max(0, (recording.events[0]?.seq ?? 1) - 1)}
            max={recording.events.at(-1)?.seq ?? 0}
            value={seq}
            onChange={(event) => {
              pauseForReplay();
              setSeq(Number(event.target.value));
            }}
          />
          <button
            aria-label="Next event"
            title="Next event"
            onClick={() => step(1)}
          >
            ›
          </button>
          <span className="event-count">
            {seq}/{recording.events.at(-1)?.seq ?? 0}
          </span>
          {failure && (
            <button
              className="failure-button"
              title="Previous command failure"
              aria-label="Previous command failure"
              onClick={() => {
                pauseForReplay();
                setSeq(failure.seq);
                inspectEvent(failure);
                setInspecting(true);
              }}
            >
              ↶ !
            </button>
          )}
          {mode === "panel" && (
            <button
              className={`follow-button ${following ? "active" : ""}`}
              aria-pressed={following}
              onClick={() => {
                setPlaying(false);
                setFollowing((value) => !value);
                if (!following) setSeq(recording.events.at(-1)?.seq ?? 0);
              }}
            >
              {following ? "Following" : "Follow"}
            </button>
          )}
        </div>
      )}
      {recording && inspecting && (
        <section className="activity-drawer" aria-label="Session activity">
          <div className="drawer-heading">
            <strong>Activity</strong>
            <span>{state?.items.length ?? 0} observed items</span>
            <button
              className="quiet-button"
              aria-label="Close activity"
              onClick={() => setInspecting(false)}
            >
              ×
            </button>
          </div>
          {state?.error && <p className="session-error">{state.error}</p>}
          {selected ? (
            <div className="selected-activity">
              <div className="selected-title">
                {eventLabel(selected)}
                <time>{new Date(selected.at).toLocaleTimeString()}</time>
              </div>
              {selectedItem?.command && (
                <pre className="command">$ {selectedItem.command}</pre>
              )}
              {selectedItem?.aggregated_output !== undefined && (
                <pre>{selectedItem.aggregated_output || "(No output)"}</pre>
              )}
              {selectedItem?.text && <p>{selectedItem.text}</p>}
              <details className="event-data">
                <summary>Event data</summary>
                <pre>{JSON.stringify(selected.data, null, 2)}</pre>
              </details>
              <button
                className="share-button"
                disabled={!ready}
                onClick={() => void share()}
              >
                Share selected event ↗
              </button>
              {shared && <small role="status">{shared}</small>}
            </div>
          ) : (
            <p className="quiet-copy">Select a moment in the event log.</p>
          )}
          <details className="event-log">
            <summary>
              Event log{" "}
              <span>{recording.events.filter((e) => e.seq <= seq).length}</span>
            </summary>
            <div className="events">
              {recording.events
                .filter((e) => e.seq <= seq)
                .slice(-150)
                .map((event) => (
                  <button
                    key={event.id}
                    className={selected?.id === event.id ? "chosen" : ""}
                    onClick={() => inspectEvent(event)}
                  >
                    <span>{eventLabel(event)}</span>
                    <time>{new Date(event.at).toLocaleTimeString()}</time>
                  </button>
                ))}
            </div>
          </details>
        </section>
      )}
      <details
        className="viewer-info"
        open={infoOpen}
        onToggle={(event) => setInfoOpen(event.currentTarget.open)}
      >
        <summary>About & setup</summary>
        <div className="info-body">
          <p>
            Enable Reef in Codex. In the Codex CLI, open <code>/hooks</code> to
            review and enable Reef’s lifecycle hooks. New sessions then appear
            in the picker. Native observation needs no API key or standalone
            server.
          </p>
          <p>
            Choose a session explicitly. Reef cannot bind this view to the
            current conversation. Swimming is decorative; stations reflect
            observed activity.
          </p>
          {recording && native && (
            <>
              <p>
                Native hooks record tool activity metadata, not prompts or
                outputs. Stop means the model finished responding, not task
                success. SessionEnd ends observation.
              </p>
              <p>
                Last observed event:{" "}
                {recording.events.at(-1)?.at
                  ? new Date(recording.events.at(-1)!.at).toLocaleString()
                  : "none"}
                . Activity state reflects the last hook, not a connection
                heartbeat.
              </p>
            </>
          )}
          {recording && (recording.events[0]?.seq ?? 0) > 1 && (
            <p>
              Earlier events were pruned; replay begins at retained event{" "}
              {recording.events[0].seq}.
            </p>
          )}
          <p>
            Sharing sends only the selected event when you press Share. The
            standalone adapter is optional for full output recordings.
          </p>
          {ready && mode === "panel" && (
            <button onClick={() => void refresh()}>Refresh sessions</button>
          )}
        </div>
      </details>
    </main>
  );
}
const viewerStyles = `
*{box-sizing:border-box}body{margin:0;background:#081823;color:#cfe3e5;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button,select{color:#afcbd1;background:#102a37;border:1px solid #294451;border-radius:5px;padding:7px 10px;cursor:pointer}button:hover{background:#1b3945}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #a3dfcd;outline-offset:3px}.reef-viewer{max-width:1100px;margin:auto;padding:14px}.viewer-toolbar{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:12px}.viewer-brand{display:flex;align-items:center;gap:9px;color:#a4d9cf;font-size:24px}.viewer-brand strong{font-weight:550;letter-spacing:-1px;color:#d6e9e8}.mode-label{font:8px ui-monospace,monospace;letter-spacing:1px;color:#83a4b0;border:1px solid #2c4754;border-radius:3px;padding:4px 6px;margin-left:4px}.mode-label.live{color:#a1d9bd;background:#17392f;border-color:#2a5a48}.toolbar-actions{display:flex;gap:8px;align-items:center}.toolbar-actions select{max-width:245px;font-size:10px}.toolbar-actions button{font-size:10px}.hidden-input{display:none}.tank{position:relative;border:1px solid #294752;border-radius:8px;overflow:hidden}.aquarium-canvas{display:block;width:100%;height:330px;padding:0;background:none;border:0;position:relative;overflow:hidden;border-radius:0}.aquarium-canvas canvas{display:block;width:100%;height:100%;image-rendering:pixelated}.aquarium-hint{position:absolute;left:14px;top:14px;color:#5f8b98;font:8px ui-monospace,monospace;letter-spacing:.6px;pointer-events:none}.aquarium-primary-hit:hover,.aquarium-companion-hit:hover{background:transparent}.aquarium-companion-hit:hover{box-shadow:inset 0 0 0 1px #7ccbbb55;border-radius:50%}.station-names{position:absolute;left:20%;right:20%;bottom:14px;display:flex;justify-content:space-between;pointer-events:none;font:7px ui-monospace,monospace;letter-spacing:1px;color:#70929b}.station-names span{width:33%;text-align:center}.empty-overlay{position:absolute;inset:45px 0 auto;display:flex;align-items:center;flex-direction:column;gap:13px;pointer-events:none}.empty-overlay button{pointer-events:auto}.empty-overlay strong{font-size:16px;font-weight:450;color:#a6c9cd}.mint-button{background:#9bd9c7;color:#082e31;border-color:#9bd9c7;font-weight:550}.mint-button:hover{background:#b7ead9}.quiet-button{background:none;border:0;color:#6f99a8;padding:4px 0;font-size:10px}.quiet-button:hover{background:none;color:#b5d6d9}.status-line{display:flex;align-items:center;gap:8px;min-height:45px;color:#7299a7;font-size:10px;border-bottom:1px solid #233b48}.status-line strong{color:#b3d2d5;font-weight:500}.status-dot{height:4px;width:4px;background:#719e9b;border-radius:50%}.inspect-toggle{margin-left:auto}.overflow-count{margin-left:auto;font-size:9px;color:#547b8a}.transport{display:flex;gap:9px;align-items:center;padding:12px 0}.transport>button{min-width:25px;padding:4px 7px;font-size:11px;background:transparent;border-color:transparent}.transport .play{background:#1b3c43;border-color:#355b5d;color:#a9e3d4;width:29px;height:27px}.transport input{flex:1;min-width:35px;accent-color:#95d5c4;height:3px;cursor:pointer}.event-count{font:8px ui-monospace,monospace;color:#5b8394;white-space:nowrap}.transport .follow-button{font-size:9px;border:1px solid #2d4a56;color:#779caa;padding:5px 8px}.transport .follow-button.active{background:#18382f;border-color:#3a6555;color:#9cd4be}.transport .failure-button{color:#d7a48a;border-color:#5d483b;background:#2d2a27}.viewer-info{border-top:1px solid #243a47;margin-top:4px;padding-top:12px}.viewer-info>summary{font-size:9px;color:#5e8798;cursor:pointer;width:max-content}.info-body{font-size:11px;line-height:1.8;color:#7d9eac;max-width:720px;padding:4px 0 9px}.info-body code{color:#a0c9c5}.info-body button{font-size:10px}.activity-drawer{border:1px solid #284550;border-radius:6px;background:#0c222f;margin:0 0 14px}.drawer-heading{display:flex;align-items:center;gap:12px;padding:13px 15px;border-bottom:1px solid #25404d}.drawer-heading strong{font-size:11px;font-weight:500}.drawer-heading>span{font-size:9px;color:#648b9b}.drawer-heading>button{margin-left:auto;font-size:17px}.selected-activity{padding:14px 15px}.selected-title{display:flex;gap:15px;justify-content:space-between;color:#9bbfc7;font-size:11px;overflow-wrap:anywhere}.selected-title time{font:9px ui-monospace,monospace;white-space:nowrap;color:#597f90}.selected-activity pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#071824;border:1px solid #213d4b;border-radius:4px;padding:11px;font:10px/1.7 ui-monospace,monospace;color:#8dafbf;max-height:220px;overflow:auto}.selected-activity .command{color:#a2d9c9}.selected-activity p{line-height:1.7;color:#8dafbb}.event-data{margin:12px 0}.event-data>summary{font-size:9px;color:#62899a;cursor:pointer}.share-button{font-size:10px}.selected-activity>small{display:block;margin-top:9px;color:#8dbdaf;font-size:10px}.event-log{border-top:1px solid #25404d;padding:12px 15px}.event-log>summary{cursor:pointer;font-size:10px;color:#92b6c0}.event-log>summary>span{font:9px ui-monospace,monospace;color:#547f91;margin-left:6px}.events{display:grid;gap:4px;max-height:200px;overflow:auto;margin-top:12px}.events>button{display:flex;justify-content:space-between;align-items:center;gap:15px;text-align:left;background:#0c2432;border:1px solid transparent;font-size:10px}.events>button>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.events>button.chosen{border-color:#3d6b70;background:#15353e}.events time{color:#577e91;font:8px ui-monospace,monospace;white-space:nowrap}.quiet-copy{color:#628799;font-size:10px;margin:15px}.error-notice{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;color:#d1a896;font-size:10px;background:#302b27;border:1px solid #5e493b;border-radius:4px;margin:10px 0;overflow-wrap:anywhere}.error-notice button{padding:0;border:0;background:none;font-size:15px}.session-error{margin:13px 15px;font-size:10px;line-height:1.7;color:#d9a294}@media(max-width:500px){.reef-viewer{padding:10px}.aquarium-canvas{height:300px}.toolbar-actions{gap:5px}.toolbar-actions select{max-width:145px}.toolbar-actions button span{display:none}.viewer-brand{font-size:22px;gap:5px}.mode-label{font-size:7px;margin-left:1px}.transport{gap:5px}.transport .follow-button{font-size:8px}.overflow-count{font-size:8px}.status-line{font-size:9px}.selected-title{flex-direction:column;gap:6px}}
`;
createRoot(document.getElementById("root")!).render(<Viewer />);
