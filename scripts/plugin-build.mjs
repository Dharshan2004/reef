import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
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
console.log("Built dependency-free Reef plugin into plugin/dist");
