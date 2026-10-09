// Manual integration test: starts one real, read-only Codex turn using the installed local plugin.
// This uses account inference and is intentionally separate from plugin:test and CI.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const args = [
  "exec",
  "--ignore-user-config",
  "--ephemeral",
  "--json",
  "-m",
  "gpt-6.1-sol",
  "-s",
  "read-only",
  "-C",
  process.cwd(),
  "-c",
  'plugins={"reef@reef-local"={enabled=true}}',
  "Use @reef. This is a read-only plugin activation test. Discover the installed Reef plugin MCP tool if tool discovery is necessary, then call reef_aquarium exactly once. Do not use shell, filesystem, browser, or any other application tool. Report its tool name and whether it succeeded. If Reef is unavailable, state that and stop.",
];
const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  if (stdout.length > 4_000_000) child.kill();
});
// Keep stderr private; failures identify the validation stage instead of echoing local configuration.
child.stderr.resume();
const timeout = setTimeout(() => child.kill(), 120_000);
const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
clearTimeout(timeout);
assert.equal(exitCode, 0, "Codex activation turn failed");
const events = stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const completed = events.filter(
  (event) =>
    event.type === "item.completed" && event.item?.type === "mcp_tool_call",
);
assert.equal(
  completed.length,
  1,
  "Expected exactly one application MCP tool call",
);
assert.equal(completed[0].item.server, "reef");
assert.equal(completed[0].item.tool, "reef_aquarium");
assert.equal(completed[0].item.status, "completed");
assert.equal(completed[0].item.error, null);
assert.equal(completed[0].item.result?.structured_content?.view, "panel");
console.log(
  "PASS: installed Reef MCP loaded and reef_aquarium invoked successfully inside a real read-only Codex turn",
);
