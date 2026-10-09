import assert from "node:assert/strict";
import { access, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const manifest = JSON.parse(await readFile("plugin/mcp.json", "utf8"));
assert.equal(
  manifest.mcpServers.reef.type,
  "stdio",
  "Portable MCP servers require an explicit transport type",
);
assert.equal(
  manifest.mcpServers.reef.cwd,
  "./",
  "Portable stdio cwd must use a contained path",
);

const pluginManifest = JSON.parse(await readFile("plugin/plugin.json", "utf8"));
const legacyManifest = JSON.parse(
  await readFile("plugin/codex/.codex-plugin/plugin.json", "utf8"),
);
assert.equal(legacyManifest.hooks, "./hooks/hooks.json");
assert.equal(legacyManifest.mcpServers, "./.mcp.json");
assert.equal(legacyManifest.name, pluginManifest.name);
assert.equal(legacyManifest.version, pluginManifest.version);
await assert.rejects(
  access("plugin/codex/plugin.json"),
  "Portable manifest must not shadow the hook-capable legacy manifest",
);
const legacyMcp = JSON.parse(await readFile("plugin/codex/.mcp.json", "utf8"));
assert.deepEqual(legacyMcp.mcpServers.reef.env, {
  PLUGIN_DATA: "../../../../data/reef-reef-local",
});
assert.equal(legacyMcp.mcpServers.reef.cwd, ".");
assert.equal(
  resolve(
    "/fixture/plugins/cache/reef-local/reef/0.1.0",
    legacyMcp.mcpServers.reef.env.PLUGIN_DATA,
  ),
  "/fixture/plugins/data/reef-reef-local",
  "Legacy data mapping must remain relative to the version-independent Codex plugin store",
);
for (const file of [
  "dist/server.mjs",
  "dist/observe.mjs",
  "dist/app.html",
  "hooks/hooks.json",
]) {
  assert.deepEqual(
    await readFile(`plugin/codex/${file}`),
    await readFile(`plugin/${file}`),
  );
}
assert.equal(
  pluginManifest.extensions["com.openai"].hooks,
  "./hooks/hooks.json",
);
const hookConfig = JSON.parse(
  await readFile("plugin/hooks/hooks.json", "utf8"),
);
const supportedEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "Interrupt",
  "SessionEnd",
];
assert.deepEqual(Object.keys(hookConfig.hooks), supportedEvents);
for (const rules of Object.values(hookConfig.hooks)) {
  for (const rule of rules)
    for (const handler of rule.hooks) {
      assert.equal(handler.type, "command");
      assert.equal(handler.command, 'node "${PLUGIN_ROOT}/dist/observe.mjs"');
      assert.equal(handler.timeout, 1);
      assert.equal(handler.async, undefined);
    }
}
const nativeData = await mkdtemp(join(tmpdir(), "reef-plugin-test-"));
const common = {
  session_id: "reef-native-test-session",
  cwd: "/test/project",
  model: "gpt-6.1-sol",
  transcript_path: "/do-not-read/private-transcript.jsonl",
  turn_id: "turn-test",
};
const hookInputs = [
  { hook_event_name: "SessionStart", source: "startup" },
  { hook_event_name: "UserPromptSubmit", prompt: "private-prompt-sentinel" },
  {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-test",
    tool_input: { command: "private-command-sentinel" },
  },
  {
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_use_id: "tool-test",
    tool_input: { command: "private-command-sentinel" },
  },
  {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_use_id: "tool-test",
    tool_input: { command: "private-command-sentinel" },
    tool_response: "private-output-sentinel",
  },
  {
    hook_event_name: "SubagentStart",
    agent_id: "subagent-test",
    agent_type: "worker",
  },
  {
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: "private-answer-sentinel",
  },
];
for (const payload of hookInputs) {
  const observe = spawnSync(process.execPath, ["plugin/dist/observe.mjs"], {
    input: JSON.stringify({ ...common, ...payload }),
    env: { PATH: process.env.PATH, PLUGIN_DATA: nativeData },
    encoding: "utf8",
  });
  assert.equal(observe.status, 0);
  assert.deepEqual(
    JSON.parse(observe.stdout),
    {},
    "Observer must not alter or block operations",
  );
}

const malformed = spawnSync(process.execPath, ["plugin/dist/observe.mjs"], {
  input: "not-json",
  env: { PLUGIN_DATA: nativeData },
  encoding: "utf8",
});
assert.equal(
  malformed.status,
  0,
  "Malformed observations must not block the native turn",
);
assert.deepEqual(JSON.parse(malformed.stdout), {});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "reef-plugin-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      "data:text/javascript," +
        encodeURIComponent(
          'globalThis.fetch = async () => { throw new Error("Standalone offline for integration test"); };',
        ),
      process.env.REEF_PLUGIN_SERVER ?? "plugin/dist/server.mjs",
    ],
    env: { PLUGIN_DATA: nativeData },
  }),
);
try {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 4);
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true);
  for (const name of ["reef_sessions", "reef_recording", "reef_open_recording"])
    assert.deepEqual(
      tools.find((tool) => tool.name === name)._meta.ui.visibility,
      ["app"],
    );
  assert.deepEqual(
    tools.find((t) => t.name === "reef_open_recording")._meta["openai/ui"]
      .entrypoints,
    [{ type: "file", extensions: [".reef"] }],
  );
  assert.deepEqual(
    tools.find((t) => t.name === "reef_aquarium")._meta["openai/ui"]
      .entrypoints,
    [{ type: "thread" }],
  );
  const { contents } = await client.readResource({ uri: "ui://reef/aquarium" });
  assert.ok(contents[0].text.includes("Reef Aquarium"));
  assert.equal(contents[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(contents[0]._meta["openai/ui"].availableDisplayModes, [
    "inline",
    "fullscreen",
  ]);
  const opened = await client.callTool({
    name: "reef_open_recording",
    arguments: {
      file: { name: "test.reef", resourceUri: "host-resource://test" },
    },
  });
  assert.equal(
    opened.structuredContent.file.resourceUri,
    "host-resource://test",
  );
  const panel = await client.callTool({ name: "reef_aquarium", arguments: {} });
  assert.equal(panel.structuredContent.view, "panel");
  const listed = await client.callTool({
    name: "reef_sessions",
    arguments: {},
  });
  assert.ok(
    !listed.isError,
    "Standalone application availability must not block native observations",
  );
  const observed = listed.structuredContent.data.sessions.find(
    (session) => session.session.source === "native",
  );
  assert.ok(observed, "The plugin must read observations from PLUGIN_DATA");
  assert.equal(
    listed.structuredContent.data.observation.standaloneAvailable,
    false,
  );
  assert.equal(
    listed.structuredContent.data.observation.nativeStoreAvailable,
    true,
  );
  assert.ok(
    !JSON.stringify(observed).includes("private-"),
    "Structural observation must omit transcript paths, prompts, commands, output, and final answers",
  );
  const nativeRecording = await client.callTool({
    name: "reef_recording",
    arguments: { sessionId: observed.session.id },
  });
  assert.ok(!nativeRecording.isError);
  assert.equal(
    nativeRecording.structuredContent.data.session.id,
    observed.session.id,
  );
  const invalid = await client.callTool({
    name: "reef_open_recording",
    arguments: { file: { name: "test" } },
  });
  assert.ok(invalid.isError);
  console.log(
    "PASS: package hook contract, structural observer, MCP metadata/resource, native sessions with standalone offline, and invalid-input rejection",
  );
} finally {
  await client.close();
  await rm(nativeData, { recursive: true, force: true });
}
