import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "reef-plugin-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [process.env.REEF_PLUGIN_SERVER ?? "plugin/dist/server.mjs"],
  }),
);
try {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 4);
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
  const invalid = await client.callTool({
    name: "reef_open_recording",
    arguments: { file: { name: "test" } },
  });
  assert.ok(invalid.isError);
  console.log(
    "PASS: MCP initialization, thread/file metadata, bundled resource, file input, panel result, invalid-input rejection",
  );
} finally {
  await client.close();
}
