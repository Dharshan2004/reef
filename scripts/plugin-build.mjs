import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
await mkdir("plugin/dist", { recursive: true });
const app = await build({
  entryPoints: ["plugin/app.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  minify: true,
  jsx: "automatic",
});
const script = app.outputFiles[0].text.replaceAll("</script", "<\\/script");
await writeFile(
  "plugin/dist/app.html",
  `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reef Aquarium</title></head><body><div id="root"></div><script>${script}</script></body></html>`,
);
await build({
  entryPoints: ["plugin/server.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "plugin/dist/server.mjs",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
await build({
  entryPoints: ["plugin/observe.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: "plugin/dist/observe.mjs",
});
// Codex 0.161 deliberately excludes hooks from portable AgentPlugin packages.
// Keep a separate supported legacy package, with no root plugin.json.
await rm("plugin/codex", { recursive: true, force: true });
await mkdir("plugin/codex/.codex-plugin", { recursive: true });
await cp("plugin/dist", "plugin/codex/dist", { recursive: true });
await cp("plugin/hooks", "plugin/codex/hooks", { recursive: true });
// Legacy 0.161 MCP does not inject PLUGIN_DATA. Its cache layout is
// plugins/cache/<marketplace>/<name>/<version>, beside plugins/data.
const legacyMcp = JSON.parse(await readFile("plugin/.mcp.json", "utf8"));
legacyMcp.mcpServers.reef.env = {
  PLUGIN_DATA: "../../../../data/reef-reef-local",
};
await writeFile(
  "plugin/codex/.mcp.json",
  JSON.stringify(legacyMcp, null, 2) + "\n",
);
await writeFile(
  "plugin/codex/.codex-plugin/plugin.json",
  await readFile("plugin/codex-manifest.json"),
);
console.log(
  "Built portable Reef plugin and hook-capable legacy Codex package into plugin/codex",
);
