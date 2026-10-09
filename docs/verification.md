# Verification record

Verified locally on 9 October 2026, Asia/Singapore, with Node.js 22.23.2 on macOS. Tests and source accompany this record so others can reproduce it.

## Real execution

- **14:50:** Reef launched the Codex SDK with the exact requested model `gpt-6.1-sol` and observed 15 events: initial failing test, implementation read, reported file update, successful test rerun, and `turn.completed`. The persisted recording exactly matched the stream. End-of-replay reduction equaled live reduction.
- The public `garden-rescue.reef` is this real run with home/project paths sanitized. It retains actual timings, outputs, statuses, and reported usage. The built-in DEMO is a separate synthetic fixture.
- **15:00:** A second coding run launched through the browser using isolated inherited integrations. The aquarium received 28 events and ended completed with three failed commands, one reported file change, and a passing two-test rerun. This caught an inaccurate demo preset, subsequently corrected to the exact fixture files and test command.
- Launch-error UI was observed on a real failed configuration attempt. The adapter issue was fixed and verified with a successful real model smoke run before the second coding run.
- **15:27:** A separate real SDK run enabled only the installed Reef MCP server and streamed nine events through `SessionManager`. It observed `reef_aquarium` in progress and completed, merged the lifecycle into one tool item, and ended with `turn.completed`. The persisted recording exactly matched the live recording; final replay state matched the live reducer. No shell commands ran. [Sanitized recording](live-mcp-evidence.reef) preserves actual timings and events with local paths replaced. Reproduce with `npx tsx scripts/live-mcp-test.ts` after installing Reef; this is an account-backed manual check, not part of CI.

## Automated checks

`npm test` passed all **24 tests**. It covers deterministic backward replay, command-failure recovery, missing usage, actual SDK nullable exit codes, malformed imports, selective export allowlists, durable recording, restart/disconnect outcomes, cancellation, terminal cleanup, origin/Host checks, and SSE cursor reconnection. Tests also verify that inherited plugin servers are excluded before standalone MCP overrides are constructed.

`npm run build` checks TypeScript and produces the standalone frontend. `npm run plugin:build` typechecks and bundles the plugin. `npm run plugin:test` checks MCP initialization, file and thread entrypoint metadata, the HTML resource, file input, panel result, and invalid input. The protocol suite also passed against the installed cache bundle, independent of repository dependencies.

Production HTTP checks returned 200 for the built app and real sample recording. The downloaded privacy-default export parsed as 15 events, completed with one historical command failure, and contained no command text or local paths.

The dependency audit reported zero known production vulnerabilities at verification time.

## Browser verification

The standalone UI was inspected at 1440 × 900 and in presentation fullscreen. Live launch, observed failure/recovery/completion, creature selection, failure jump, and replay were exercised in the browser. Export from fullscreen correctly exited fullscreen and showed the field-selection preview. The privacy-default file was downloaded, reimported, scrubbed to completion, and rewound to the beginning; later file reports and usage disappeared on rewind. The original failure displays while the replayed session remains running; later file reports are absent before their event.

The plugin was exercised through an independent browser harness using the official MCP Apps `AppBridge`: file input loads the real recording, end replay derives completion and failure history, rewind removes future selected context, and explicit selected-event sharing reaches the bridge. Session selection and reading through app-only MCP tools were also exercised against the local server.

## Plugin installation and host limitation

Supported `codex plugin` commands registered `reef-local` and installed `reef@reef-local`; listing reported installed and enabled. The installed bundle successfully passed the protocol suite.

A subsequent real activation test caught two defects that the direct protocol test missed: portable `mcp.json` required `type: "stdio"` and `cwd: "./"`. Both are corrected and covered by manifest assertions. A fresh read-only `gpt-6.1-sol` Codex turn then discovered the installed plugin and called `reef_aquarium` once. Its actual JSONL includes MCP start/completion events and the successful panel result. [Sanitized evidence](plugin-activation-evidence.jsonl) and `node scripts/plugin-activation-test.mjs` preserve the result and reproduction. No global approval policy changes were needed.

Actual desktop file-viewer and conversation-panel rendering remains **unverified**. Native Codex automation was denied; the supported file-open tool queued the panel because the chat was hidden, and the MCP Apps surface had no open tabs. A working independent bridge harness does not prove host rendering. See [plugin.md](plugin.md) for the exact action needed to complete host QA. Public plugin-directory submission and npm publication were not performed.

## Limits

| Activity or surface | Verification |
| --- | --- |
| Commands, failures, file changes, messages, completion, usage | Real Reef-launched coding runs, including browser observation and durable replay |
| Installed plugin discovery and MCP invocation | Fresh real Codex CLI turn; successful `reef_aquarium` start/completion |
| Live MCP recording and replay | Real Codex SDK stream through SessionManager; nine events and exact disk/replay equality |
| Import, rewind, privacy-default export | Standalone browser exercised with the real recording |
| Plugin file input, session selection, selected context | Official AppBridge harness; actual host UI still unverified |
| Cancellation, restart, SSE reconnection | Automated integration tests; no additional account-backed run claimed |
| Arbitrary existing chats, hidden reasoning, every external tool | Not observed or claimed |

One active session at a time; no discovery of arbitrary existing Codex chats. Aquarium animation is decorative. Usage and file activity depend on the events Codex reports. The viewer is not an editor. Actual account/model availability and desktop host support must be checked again before the meetup.
