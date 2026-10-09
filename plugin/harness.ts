// Local protocol harness only. This is not evidence of ChatGPT host rendering.
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
const iframe = document.querySelector("iframe")!;
const status = document.querySelector("#status")!;
const recording = await (await fetch("/recording")).text();
const appHtml = await (await fetch("/app")).text();
const bridge = new AppBridge(
  null,
  { name: "Reef test harness", version: "1.0.0" },
  {
    serverTools: {},
    serverResources: {},
    logging: {},
    updateModelContext: {},
    experimental: { "openai/resource": {}, "openai/modelContext": {} },
  },
);
bridge.oncalltool = async ({ name }) => {
  if (name !== "reef_sessions")
    return {
      isError: true,
      content: [{ type: "text", text: "Unsupported harness tool" }],
    };
  return {
    content: [],
    structuredContent: { data: await (await fetch("/sessions")).json() },
  };
};
bridge.onreadresource = async ({ uri }) => ({
  contents: [{ uri, text: recording, mimeType: "application/json" }],
});
bridge.onupdatemodelcontext = async (params) => {
  status.textContent = "Context shared: " + JSON.stringify(params);
  return {};
};
bridge.oninitialized = () => {
  status.textContent = "MCP App initialized; file input delivered";
  void bridge.sendToolInput({
    arguments: {
      file: {
        name: "garden-rescue.reef",
        resourceUri: "host-resource://garden-rescue",
      },
    },
  });
};
await bridge.connect(
  new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
);
iframe.srcdoc = appHtml;
