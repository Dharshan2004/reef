# Reef plugin integration

Reef uses the official OpenAI MCP Extensions SDK and MCP Apps SDK. The plugin is local development software; it has not been published to a public directory.

## Implemented surfaces

- **Conversation panel**: `reef_aquarium` advertises the thread entrypoint. The panel lists runs from the Reef app through app-only MCP tools and refreshes every four seconds. It does not automatically observe the current chat.
- **Custom `.reef` viewer**: `reef_open_recording` advertises a file entrypoint with the spec-required `.reef` extension. The app reads the opaque host resource URI, validates the recording, supports event replay, and subscribes to host file updates when supported. It never interprets that URI as a filesystem path.
- **Selected context**: selecting an event shows its content. The explicit share button sends only that selected event through the host’s supported model-context extension. Unsupported hosts show an actionable message.

The package contains a bundled Node stdio MCP server and a single self-contained HTML app. It needs Node 22+, but no dependency installation inside the installed package. Runtime session access is read-only and restricted to `http://127.0.0.1:4318`. Start the Reef application separately. The plugin cannot start, cancel, or execute agent runs.

## Build and test

```sh
npm run plugin:build
npm run plugin:test
npx tsc --project plugin/tsconfig.json
```

For independent MCP App browser validation:

```sh
node scripts/plugin-harness.mjs
```

Open `http://127.0.0.1:4320`. This local harness uses the official `AppBridge`, delivers a file entrypoint with `public/garden-rescue.reef`, and displays a context-sharing result. Harness rendering is not proof of ChatGPT host rendering. Browser QA on 9 October verified host file input/read, real-recording replay, completed state with seven items and one command failure, explicit context-sharing receipt, backward-scrub selection clearing, and local session selection through the app-only tool bridge.

## Local installation

The repo catalog is `.agents/plugins/marketplace.json`, marketplace `reef-local`, plugin `reef`. These supported CLI commands register and install the development package:

```sh
codex plugin marketplace add /absolute/path/to/Reef
codex plugin add reef@reef-local --json
codex plugin list --marketplace reef-local --json
```

The source path is `./plugin`, resolved from the marketplace root. Both portable `mcp.json` and compatibility `.mcp.json` are present. The server command is `node ./dist/server.mjs`, with the plugin root as cwd.

On 9 October 2026, the supported CLI returned successful installation at `~/.codex/plugins/cache/reef-local/reef/0.1.0`. Listing returned `installed: true` and `enabled: true`. The protocol suite also passed against that absolute installed server path, proving it runs independently of repo dependencies.

After changes, rebuild and run `codex plugin add reef@reef-local --json` to refresh the installed copy. Official documentation also recommends restarting the desktop app so it picks up changed local plugin files.

## Actual host verification status

Native Codex UI automation was denied by the Computer Use tool. The supported `open_in_codex` file action returned `queued` because the calling chat was not visible. The MCP Apps surface was accessible, but listed no open tabs. Therefore actual Codex file-handler and conversation-panel rendering remains unverified. CLI installation and server protocol operation are verified; those facts do not establish that the running desktop session has loaded the extensions.

To finish actual-host QA, show the Reef chat, refresh/restart the desktop app if needed, confirm Reef is enabled under the Reef Development local source in Plugins, and open `public/garden-rescue.reef`. Confirm the custom aquarium renders rather than raw text. Open **Agent Aquarium** from the conversation panel’s plugin entrypoint, select a recorded run, and verify events refresh. Select one non-sensitive event and explicitly share it to verify context.

## Sources

- [OpenAI extension overview](https://developers.openai.com/plugins/build/extensions)
- [Official TypeScript SDK and file-handler examples](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md)
- [Formal extension specification and platform support](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
- [Package and install local plugins](https://developers.openai.com/plugins/build/plugins)
- [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Official Bits & Bolts example](https://github.com/openai/mcp-extensions/tree/main/plugins/bits-and-bolts)
