import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const js = await build({
  entryPoints: ["plugin/harness.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const html =
  '<html><head><title>Reef protocol harness</title></head><body style="margin:0;background:#101b22;color:white;font:14px system-ui"><p id="status">Connecting MCP App</p><iframe style="border:0;width:100%;height:900px" sandbox="allow-scripts allow-same-origin"></iframe><script type="module" src="/harness.js"></script></body></html>';
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } else if (req.url === "/harness.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js.outputFiles[0].text);
    } else if (req.url === "/app") {
      res.setHeader("Content-Type", "text/html");
      res.end(await readFile("plugin/dist/app.html"));
    } else if (req.url === "/sessions") {
      res.setHeader("Content-Type", "application/json");
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
  console.log("Reef test harness at http://127.0.0.1:4320"),
);
