# Verification record

Verified locally on 9 October 2026, Asia/Singapore, with Node.js 22.23.2 on macOS. Tests and source accompany this record so others can reproduce it.

## Real execution

- **14:50:** Reef launched the Codex SDK with the exact requested model `gpt-6.1-sol` and observed 15 events: initial failing test, implementation read, reported file update, successful test rerun, and `turn.completed`. The persisted recording exactly matched the stream. End-of-replay reduction equaled live reduction.
- The public `garden-rescue.reef` is this real run with home/project paths sanitized. It retains actual timings, outputs, statuses, and reported usage. The built-in DEMO is a separate synthetic fixture.
- **15:00:** A second coding run launched through the browser using isolated inherited integrations. The aquarium received 28 events and ended completed with three failed commands, one reported file change, and a passing two-test rerun. This caught an inaccurate demo preset, subsequently corrected to the exact fixture files and test command.
- Launch-error UI was observed on a real failed configuration attempt. The adapter issue was fixed and verified with a successful real model smoke run before the second coding run.
- **15:27:** A separate real SDK run enabled only the installed Reef MCP server and streamed nine events through `SessionManager`. It observed `reef_aquarium` in progress and completed, merged the lifecycle into one tool item, and ended with `turn.completed`. The persisted recording exactly matched the live recording; final replay state matched the live reducer. No shell commands ran. [Sanitized recording](live-mcp-evidence.reef) preserves actual timings and events with local paths replaced. Reproduce with `npx tsx scripts/live-mcp-test.ts` after installing Reef; this is an account-backed manual check, not part of CI.

## Automated checks

`npm test` initially passed 24 tests; the native-hook adaptation adds concurrency, privacy, retention, resumed sessions, permission correlation, and viewer-follow regression checks. **43 tests passed** in the final native-hook and compact-viewer suite. It covers deterministic backward replay, command-failure recovery, missing usage, actual SDK nullable exit codes, malformed imports, selective export allowlists, durable recording, restart/disconnect outcomes, cancellation, terminal cleanup, origin/Host checks, and SSE cursor reconnection. Tests also verify that inherited plugin servers are excluded before standalone MCP overrides are constructed.

`npm run build` checks TypeScript and produces the standalone frontend. `npm run plugin:build` typechecks and bundles the plugin. `npm run plugin:test` checks MCP initialization, file and thread entrypoint metadata, the HTML resource, file input, panel result, and invalid input. The protocol suite also passed against the installed cache bundle, independent of repository dependencies.

Production HTTP checks returned 200 for the built app and real sample recording. The downloaded privacy-default export parsed as 15 events, completed with one historical command failure, and contained no command text or local paths.

The dependency audit reported zero known production vulnerabilities at verification time.

## Browser verification

The standalone UI was inspected at 1440 × 900 and in presentation fullscreen. Live launch, observed failure/recovery/completion, creature selection, failure jump, and replay were exercised in the browser. Export from fullscreen correctly exited fullscreen and showed the field-selection preview. The privacy-default file was downloaded, reimported, scrubbed to completion, and rewound to the beginning; later file reports and usage disappeared on rewind. The original failure displays while the replayed session remains running; later file reports are absent before their event.

The plugin was exercised through an independent browser harness using the official MCP Apps `AppBridge`: file input loads the real recording, end replay derives completion and failure history, rewind removes future selected context, and explicit selected-event sharing reaches the bridge. Session selection and reading through app-only MCP tools were also exercised against the local server.

## Plugin installation and host limitation

Supported `codex plugin` commands registered `reef-local` and installed `reef@reef-local`; listing reported installed and enabled. The installed bundle successfully passed the protocol suite.

A subsequent real activation test caught two defects that the direct protocol test missed: portable `mcp.json` required `type: "stdio"` and `cwd: "./"`. Both are corrected and covered by manifest assertions. A fresh read-only `gpt-6.1-sol` Codex turn then discovered the installed plugin and called `reef_aquarium` once. Its actual JSONL includes MCP start/completion events and the successful panel result. [Sanitized evidence](plugin-activation-evidence.jsonl) and `node scripts/plugin-activation-test.mjs` preserve the result and reproduction. No global approval policy changes were needed.

The actual Codex MCP Apps surface subsequently exposed **Reef Recording**. The public garden recording rendered; event 15 showed completion, seven items and one historical command failure. Rewinding to event 7 showed the failed test and the running snapshot. Explicit selected-event sharing returned the actual host acknowledgement. [Screenshot](images/reef-native-host-context.png). This verifies actual file-viewer rendering, replay and host context-update acknowledgement. Independent conversation-panel entrypoint rendering and a subsequent model answer consuming the context remain separate checks. Public directory submission and npm publication were not performed.

## Limits

| Activity or surface                                             | Verification                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Commands, failures, file changes, messages, completion, usage   | Real Reef-launched coding runs, including browser observation and durable replay           |
| Installed plugin discovery and MCP invocation                   | Fresh real Codex CLI turn; successful `reef_aquarium` start/completion                     |
| Live MCP recording and replay                                   | Real Codex SDK stream through SessionManager; nine events and exact disk/replay equality   |
| Import, rewind, privacy-default export                          | Standalone browser exercised with the real recording                                       |
| Plugin file viewer, replay, selected context acknowledgement    | Actual Codex MCP Apps viewer tested; independent conversation-panel dispatch still pending |
| Cancellation, restart, SSE reconnection                         | Automated integration tests; no additional account-backed run claimed                      |
| Arbitrary existing chats, hidden reasoning, every external tool | Not observed or claimed                                                                    |

One active Reef-launched task at a time. Native hooks observe lifecycle events across enabled local Codex sessions without historical transcript discovery. Aquarium animation is decorative. Usage and file activity depend on the events Codex reports. The viewer is not an editor. Actual account/model availability and desktop host support must be checked again before the meetup.

## Native hook integration, 9 October

The first portable-package probes ran real commands but recorded no hooks. Codex 0.161's `/hooks` inventory showed zero entries. Version-matched source explicitly skips portable AgentPlugin hooks. The generated legacy compatibility package exposed all ten Reef hooks, each using the same one-second local observer. After applying the user's Reef-only approval through the supported `/hooks` review UI, the active count became one for each configured event. No bypass flags or global trust policies were used.

A real `gpt-6.1-sol` session ran one harmless `printf` command. The native collector recorded six events: session start, turn start, tool start, tool return, model stop, and session end. The reducer returned `ended` with one `observed_finished` tool; command content was absent and usage remained unknown. [Actual structural recording](native-hook-evidence.reef) and [proof](native-hook-proof.json) preserve the evidence. This is native CLI hook delivery, distinct from the earlier SDK recorder test. `scripts/native-codex-test.ts` is an opt-in account-backed reproducer that requires trusted Reef hooks and preserves normal user configuration.

Codex 0.161 also omits `PLUGIN_DATA` from legacy MCP environments. The compatibility package maps it relative to the verified Codex install cache layout; the portable package uses the documented host injection. Moving the compatibility bundle outside that cache requires supplying `PLUGIN_DATA` explicitly. Protocol tests exercise native session access with the standalone server forced offline.

The installed catalog transport was also tested with its actual command, arguments, environment and working directory: `reef_sessions` listed the real native probe and `reef_recording` returned its six events. A second fresh account-backed run passed `scripts/native-codex-test.ts` after reinstalling the final package, without a hook-trust warning.

The compact viewer was checked with two actual recordings in the independent AppBridge harness: creature selection, failure jump, explicit context acknowledgement, and rewind selection clearing passed. Stepping backward disabled Follow and the position remained stable through subsequent polling. Native tool return showed an unknown outcome and offered no invented failure jump.

Visual QA caught a canvas lifecycle bug when an empty aquarium gained companion sessions. Keeping the canvas mounted across that transition and drawing the initial frame immediately fixed the blank scene. The rebuilt UI was rechecked with two recordings; [compact aquarium screenshot](images/reef-aquarium-focused.png). The final 43 tests, standalone build, plugin build and protocol checks passed, and the installed plugin was refreshed.

## Live-preview correction

The preview left open after visual QA used a fixed two-recording fixture. It could not observe new activity, despite the installed collector working. Added an explicit `--live` mode that resolves the installed Reef MCP transport and polls its actual observation store; the default sample harness now labels itself as a saved sample. Native sessions retain a short identifier so multiple observed chats can be distinguished. At diagnosis, the store contained only CLI probes and no events from the existing desktop chat. Desktop capture must be checked in a fresh session after loading the plugin; CLI proof does not establish capture of an already-running desktop chat.

After switching the preview to the installed transport, a fresh CLI probe ending `eab635` appeared in the browser picker with six native lifecycle events and one observed tool. The previous fixture contained only two sessions; the live store exposed seven at this check. [Live-store preview proof](images/reef-live-store-preview.png). Plugin build and protocol checks passed.
