import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { realpath, stat, readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import type { SessionManager } from "./session-manager";
import { demoRecording } from "../src/core/demo";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65_536) throw new Error("Request too large");
  }
  return JSON.parse(text || "{}") as Record<string, unknown>;
}
export function createApi(
  manager: SessionManager,
  options: { port?: number; workingDirectory?: string } = {},
) {
  const port = options.port ?? 4318;
  return createServer(async (req, res) => {
    const allowedHosts = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]);
    if (!allowedHosts.has(req.headers.host ?? ""))
      return json(res, 403, { error: "Loopback Host required" });
    const origin = req.headers.origin;
    if (
      origin &&
      !new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]).has(origin)
    )
      return json(res, 403, { error: "Origin is not allowed" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      return res.end();
    }
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (req.method === "GET" && url.pathname === "/api/health")
        return json(res, 200, {
          ok: true,
          model: "gpt-6.1-sol",
          mode: "local",
          workingDirectory: resolve("demo/bug-garden"),
        });
      if (req.method === "GET" && url.pathname === "/api/demo")
        return json(res, 200, demoRecording);
      if (req.method === "GET" && url.pathname === "/api/sessions")
        return json(res, 200, { sessions: manager.list() });
      if (req.method === "POST" && url.pathname === "/api/sessions") {
        if (manager.activeCount > 0)
          return json(res, 409, {
            error:
              "A session is already running. Wait for completion or cancel it before launching another.",
          });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return json(res, 415, { error: "application/json required" });
        const input = await body(req);
        if (
          typeof input.prompt !== "string" ||
          !input.prompt.trim() ||
          input.prompt.length > 32_000
        )
          return json(res, 400, {
            error: "Prompt must contain 1–32000 characters",
          });
        const workingDirectory = await realpath(
          resolve(
            typeof input.workingDirectory === "string"
              ? input.workingDirectory
              : (options.workingDirectory ?? process.cwd()),
          ),
        );
        if (!(await stat(workingDirectory)).isDirectory())
          return json(res, 400, {
            error: "Working directory is not a directory",
          });
        // Recheck after async request/directory work so simultaneous launches cannot race.
        if (manager.activeCount > 0)
          return json(res, 409, {
            error:
              "A session is already running. Wait for completion or cancel it before launching another.",
          });
        return json(
          res,
          201,
          manager.start({
            prompt: input.prompt,
            workingDirectory,
            title:
              typeof input.title === "string"
                ? input.title.slice(0, 120)
                : undefined,
            creatureName:
              typeof input.creatureName === "string"
                ? input.creatureName.slice(0, 32)
                : undefined,
          }),
        );
      }
      const match = url.pathname.match(
        /^\/api\/sessions\/([a-zA-Z0-9-]+)(?:\/(events|cancel))?$/,
      );
      if (match) {
        const r = manager.get(match[1]!);
        if (!r) return json(res, 404, { error: "Session not found" });
        if (req.method === "GET" && !match[2]) return json(res, 200, r);
        if (req.method === "POST" && match[2] === "cancel")
          return json(res, 200, { cancelled: manager.cancel(r.session.id) });
        if (req.method === "GET" && match[2] === "events") {
          const cursor = Number(
            req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0,
          );
          if (!Number.isInteger(cursor) || cursor < 0)
            return json(res, 400, { error: "Invalid cursor" });
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          const send = (event: (typeof r.events)[number]) =>
            res.write(
              `id: ${event.seq}\nevent: reef\ndata: ${JSON.stringify(event)}\n\n`,
            );
          for (const event of r.events) if (event.seq > cursor) send(event);
          const unsubscribe = manager.subscribe(r.session.id, send);
          const keepalive = setInterval(
            () => res.write(": heartbeat\n\n"),
            15_000,
          );
          req.on("close", () => {
            clearInterval(keepalive);
            unsubscribe();
          });
          return;
        }
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const root = resolve("dist");
        const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (candidate !== root && !candidate.startsWith(root + sep))
          return json(res, 403, { error: "Invalid path" });
        try {
          const file = (await stat(candidate)).isFile()
            ? candidate
            : resolve(root, "index.html");
          const data = await readFile(file);
          const types: Record<string, string> = {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
          };
          res.writeHead(200, {
            "Content-Type": types[extname(file)] ?? "application/octet-stream",
          });
          return res.end(data);
        } catch {
          try {
            const data = await readFile(resolve(root, "index.html"));
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(data);
          } catch {}
        }
      }
      json(res, 404, { error: "Route not found" });
    } catch (error) {
      json(res, 400, {
        error: error instanceof Error ? error.message : "Invalid request",
      });
    }
  });
}
