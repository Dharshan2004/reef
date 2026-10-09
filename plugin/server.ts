import { readFile } from "node:fs/promises";
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
        "Open the Reef aquarium beside this conversation to inspect activity from independently recorded Codex runs. This viewer does not observe the current conversation automatically.",
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
          text: "Reef shows recorded Codex activity. Choose a session or open a .reef recording.",
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
        "List locally recorded Reef Codex runs. Requires the Reef application running on this machine.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => request("/api/sessions"),
  );
  server.registerTool(
    "reef_recording",
    {
      title: "Read Reef Recording",
      description: "Read a recorded Reef session by identifier.",
      inputSchema: { sessionId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ sessionId }) =>
      request(`/api/sessions/${encodeURIComponent(sessionId)}`),
  );
  return server;
}
async function request(path: string) {
  try {
    const response = await fetch(`http://127.0.0.1:4318${path}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Reef returned HTTP ${response.status}`);
    const data = await response.json();
    return { content: [], structuredContent: { data } };
  } catch {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Reef is unavailable. Start the Reef app with npm run dev, then retry. The plugin does not start agent runs.",
        },
      ],
    };
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await createServer().connect(new StdioServerTransport());
