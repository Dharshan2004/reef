import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { OpenAIExtensions } from "@openai/mcp-extensions/server";
import { z } from "zod";
import { readNativeSessions, readNativeRecording } from "./native";
import type { Recording } from "../src/core";

export function createServer() {
  const server = new McpServer({ name: "reef", version: "0.1.0" });
  new OpenAIExtensions(server);
  const uri = "ui://reef/aquarium";
  registerAppResource(server, "reef-aquarium", uri, {}, async () => ({
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: await readFile(new URL("./app.html", import.meta.url), "utf8"),
        _meta: {
          "openai/ui": {
            preferredDisplayMode: "inline",
            availableDisplayModes: ["inline", "fullscreen"],
          },
        },
      },
    ],
  }));
  registerAppTool(
    server,
    "reef_aquarium",
    {
      title: "Agent Aquarium",
      description:
        "Open the Reef aquarium beside this conversation to inspect native local Codex sessions observed after Reef hooks are trusted, plus standalone recorded runs. Choose a session; the panel is not automatically bound to this conversation.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: uri },
        "openai/ui": { entrypoints: [{ type: "thread" }] },
      },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Reef shows native local Codex activity after its hooks are reviewed and trusted. Choose an observed session or open a .reef recording; this panel is not automatically bound to the current conversation.",
        },
      ],
      structuredContent: { view: "panel" },
    }),
  );
  registerAppTool(
    server,
    "reef_open_recording",
    {
      title: "Reef Recording",
      description: "Open a .reef activity recording in the aquarium viewer.",
      inputSchema: {
        file: z.object({ name: z.string(), resourceUri: z.string() }),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: uri, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: "file", extensions: [".reef"] }] },
      },
    },
    async ({ file }) => ({
      content: [],
      structuredContent: { view: "file", file },
    }),
  );
  server.registerTool(
    "reef_sessions",
    {
      title: "Recorded Reef Sessions",
      description:
        "List native local Codex sessions observed by trusted Reef hooks, plus any recordings from the optional standalone Reef application. Native observations do not require the standalone application.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => listSessions(),
  );
  server.registerTool(
    "reef_recording",
    {
      title: "Read Reef Recording",
      description:
        "Read a native observed or standalone recorded Reef session by identifier.",
      inputSchema: { sessionId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ sessionId }) => {
      try {
        const native = await readNativeRecording(sessionId);
        if (native) return { content: [], structuredContent: { data: native } };
      } catch {
        /* An unavailable observation store does not block optional recordings. */
      }
      const data = await request(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
      );
      if (data) return { content: [], structuredContent: { data } };
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Session not found. Native sessions appear after Reef hooks are trusted; standalone recordings require the Reef app.",
          },
        ],
      };
    },
  );
  return server;
}
async function listSessions() {
  const [nativeResult, standaloneResult] = await Promise.allSettled([
    Promise.resolve().then(() => readNativeSessions()),
    request("/api/sessions"),
  ]);
  const native = nativeResult.status === "fulfilled" ? nativeResult.value : [];
  const standalone =
    standaloneResult.status === "fulfilled" ? standaloneResult.value : null;
  const recorded =
    standalone &&
    typeof standalone === "object" &&
    "sessions" in standalone &&
    Array.isArray(standalone.sessions)
      ? (standalone.sessions as Recording[])
      : [];
  const sessions = [
    ...new Map(
      [...recorded, ...native].map((recording) => [
        recording.session.id,
        recording,
      ]),
    ).values(),
  ].sort((a, b) => b.session.createdAt.localeCompare(a.session.createdAt));
  return {
    content: [],
    structuredContent: {
      data: {
        sessions,
        observation: {
          nativeStoreAvailable: Boolean(process.env.PLUGIN_DATA),
          standaloneAvailable: standalone !== null,
        },
      },
    },
  };
}
async function request(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(`http://127.0.0.1:4318${path}`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  await createServer().connect(new StdioServerTransport());
