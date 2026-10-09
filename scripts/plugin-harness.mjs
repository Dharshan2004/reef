import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const live = process.argv.includes("--live");
let client;
if (live) {
  // Use only Reef's effective installed transport. Never print the catalog:
  // other entries can contain credentials unrelated to this viewer.
  let reef;
  try {
    const catalog = JSON.parse(
      execFileSync(
        process.env.REEF_CODEX_PATH ?? "codex",
        ["mcp", "list", "--json"],
        {
          encoding: "utf8",
          timeout: 15000,
          maxBuffer: 4_000_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    reef = catalog.find((entry) => entry.name === "reef" && entry.enabled);
  } catch {
    throw new Error(
      "Cannot read the Codex MCP catalog. Check that Codex is installed and Reef is enabled.",
    );
  }
  if (!reef?.transport?.command)
    throw new Error(
      "Installed Reef stdio plugin not found. Build and install reef@reef-local first.",
    );
  client = new Client({ name: "reef-local-preview", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({ ...reef.transport, stderr: "ignore" }),
  );
}
const js = await build({
  entryPoints: ["plugin/harness.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const html =
  '<html><head><title>Reef local preview</title></head><body style="margin:0;background:#101b22;color:white;font:14px system-ui"><p id="status" style="padding:0 14px">Connecting Reef</p><iframe style="border:0;width:100%;height:900px" sandbox="allow-scripts allow-same-origin"></iframe><script type="module" src="/harness.js"></script></body></html>';
const server = createServer(async (req, res) => {
  try {
    if (
      req.headers.host !== "127.0.0.1:4320" &&
      req.headers.host !== "localhost:4320"
    ) {
      res.writeHead(403);
      res.end("Invalid host");
      return;
    }
    if (
      req.headers.origin &&
      !["http://127.0.0.1:4320", "http://localhost:4320"].includes(
        req.headers.origin,
      )
    ) {
      res.writeHead(403);
      res.end("Invalid origin");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } else if (req.url === "/harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js.outputFiles[0].text);
    } else if (req.url === "/app") {
      res.setHeader("Content-Type", "text/html");
      res.end(await readFile("plugin/dist/app.html"));
    } else if (req.url === "/mode") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ live }));
    } else if (req.url === "/sessions") {
      res.setHeader("Content-Type", "application/json");
      if (client) {
        const result = await client.callTool({
          name: "reef_sessions",
          arguments: {},
        });
        if (result.isError || !result.structuredContent?.data)
          throw new Error("Reef observation store unavailable");
        res.end(JSON.stringify(result.structuredContent.data));
        return;
      }
      res.end(
        process.env.REEF_HARNESS_SESSIONS
          ? await readFile(process.env.REEF_HARNESS_SESSIONS)
          : await (await fetch("http://127.0.0.1:4318/api/sessions")).text(),
      );
    } else if (req.url === "/recording") {
      res.setHeader("Content-Type", "application/json");
      res.end(await readFile("public/garden-rescue.reef"));
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
server.listen(4320, "127.0.0.1", () =>
  console.log(
    `Reef ${live ? "live local observation preview" : "saved-sample test harness (not live)"} at http://127.0.0.1:4320`,
  ),
);
async function close() {
  server.close();
  await client?.close();
  process.exit(0);
}
process.once("SIGTERM", close);
process.once("SIGINT", close);
