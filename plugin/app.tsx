import { useEffect, useState } from "react";
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
  useEffect(() => {
    receiveFile = async (uri) => {
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
              if (params.uri === openedResource) await receiveFile(params.uri);
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
        setRecording(r);
        setSeq(0);
        setError("");
      } catch (e) {
        setError(String(e));
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
    try {
      const result = await host.callServerTool({
        name: "reef_sessions",
        arguments: {},
      });
      if (result.isError)
        throw new Error(
          "Start Reef with npm run dev to connect recorded sessions.",
        );
      const data = (
        result.structuredContent as { data: { sessions: Recording[] } }
      ).data;
      setSessions(data.sessions);
      setError("");
    } catch (e) {
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
        setSeq(current.events.at(-1)?.seq ?? 0);
      }
    }
  }, [sessions]);
  useEffect(() => {
    if (!playing || !recording) return;
    const timer = setInterval(
      () =>
        setSeq((current) => {
          const next = recording.events.find((e) => e.seq > current);
          if (!next) {
            setPlaying(false);
            return current;
          }
          return next.seq;
        }),
      750,
    );
    return () => clearInterval(timer);
  }, [playing, recording]);
  useEffect(() => {
    if (selected && selected.seq > seq) {
      setSelected(null);
      setShared("");
    }
  }, [seq, selected]);
  const state = recording ? deriveSession(recording, seq) : null;
  const active =
    state?.status === "running"
      ? state.items.filter((item) => item.status === "in_progress").at(-1)
      : undefined;
  const station =
    active?.type === "command_execution"
      ? "terminal"
      : active?.type === "file_change"
        ? "files"
        : active?.type === "mcp_tool_call"
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
          : state?.status === "starting"
            ? "waiting"
            : "idle";
  async function share() {
    if (!selected) return;
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
      setShared("Selected event shared with this conversation.");
    } catch (e) {
      setShared(String(e));
    }
  }
  return (
    <main>
      <style>{`*{box-sizing:border-box}body{margin:0;background:#081c27;color:#d3e7e8;font:14px system-ui}main{padding:18px;max-width:1100px;margin:auto}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:24px;margin:0}p{color:#90aeb8;line-height:1.5}button,select,input{font:inherit;color:inherit;background:#163746;border:1px solid #355665;border-radius:7px;padding:8px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.aquarium-canvas{width:100%;height:310px;padding:0;overflow:hidden;position:relative}.aquarium-canvas canvas{width:100%;height:100%;image-rendering:pixelated}.aquarium-hint{position:absolute;bottom:12px;left:12px;font-size:11px;color:#99bbc6}nav{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}input[type=range]{width:100%}article{border-top:1px solid #274957;padding:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:230px;overflow:auto}.events{max-height:240px;overflow:auto;display:grid;gap:5px}.events button{text-align:left}small{color:#8dafba}.error{color:#ffb2a6}.tag{color:#8de1d2}`}</style>
      <header>
        <h1>Reef</h1>
        <span className="tag">
          {!recording
            ? "READY"
            : recording.session.source === "demo"
              ? "DEMO"
              : mode === "file"
                ? "REPLAY"
                : "LIVE"}
        </span>
      </header>
      <p>
        Real recorded events. Aquarium motion is ambient and does not measure
        progress.
      </p>
      <Aquarium
        name={
          recording?.session.creatureName ??
          recording?.session.title.slice(0, 20) ??
          "Miso"
        }
        mood={mood}
        station={station}
        onSelect={() =>
          setSelected(recording?.events.find((e) => e.seq === seq) ?? null)
        }
      />
      <nav>
        {mode === "panel" && (
          <select
            aria-label="Recorded session"
            value={recording?.session.id ?? ""}
            onChange={(e) => {
              const r = sessions.find((x) => x.session.id === e.target.value);
              if (r) {
                setRecording(r);
                setSeq(r.events.at(-1)?.seq ?? 0);
                setSelected(null);
              }
            }}
          >
            <option value="">Choose a recorded session</option>
            {sessions.map((r) => (
              <option key={r.session.id} value={r.session.id}>
                {r.session.title}
              </option>
            ))}
          </select>
        )}
        <label>
          <input
            type="file"
            accept=".reef,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file)
                try {
                  const r = parseRecording(await file.text());
                  setRecording(r);
                  setSeq(0);
                  setMode("file");
                  setSelected(null);
                  setError("");
                } catch (error) {
                  setError(String(error));
                }
            }}
          />{" "}
          Import recording
        </label>
        {mode === "file" && ready && (
          <button
            onClick={() => {
              setMode("panel");
              setPlaying(false);
              setRecording(null);
            }}
          >
            Local sessions
          </button>
        )}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {recording && (
        <>
          <article>
            <strong>{recording.session.title}</strong>
            <p>
              Status: {state?.status} · {state?.items.length} observed items ·{" "}
              {state?.commandFailures} command failures
            </p>
            <small>
              {recording.session.source === "demo"
                ? "Demo fixture"
                : recording.session.source === "live"
                  ? "Recorded live run"
                  : "Imported recording"}{" "}
              · {recording.session.model}
            </small>
            {mode === "file" && (
              <>
                <nav>
                  <button onClick={() => setPlaying(!playing)}>
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button
                    onClick={() => {
                      setPlaying(false);
                      setSeq(0);
                    }}
                  >
                    Restart
                  </button>
                  <span>
                    Event {seq} of {recording.events.at(-1)?.seq ?? 0}
                  </span>
                </nav>
                <input
                  aria-label="Replay event"
                  type="range"
                  min="0"
                  max={recording.events.at(-1)?.seq ?? 0}
                  value={seq}
                  onChange={(e) => {
                    setPlaying(false);
                    setSeq(Number(e.target.value));
                  }}
                />
              </>
            )}
          </article>
          <div className="events">
            {recording.events
              .filter((e) => e.seq <= seq)
              .slice(-150)
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setSelected(e);
                    setShared("");
                  }}
                >
                  {e.seq} · {e.type}{" "}
                  <small>{new Date(e.at).toLocaleTimeString()}</small>
                </button>
              ))}
          </div>
          {selected && (
            <article>
              <strong>{selected.type}</strong>
              <pre>{JSON.stringify(selected.data, null, 2)}</pre>
              <button disabled={!ready} onClick={() => void share()}>
                Share selected event with conversation
              </button>
              <p>
                {shared ||
                  "Shares this event’s displayed content only when you choose this action."}
              </p>
            </article>
          )}
        </>
      )}
      <p>
        <small>
          This plugin reads runs created by the Reef app. It does not
          automatically monitor this conversation.
        </small>
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Viewer />);
