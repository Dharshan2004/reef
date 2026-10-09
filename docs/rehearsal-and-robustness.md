# Local Codex demo and robustness checklist

Prepared 9 October 2026. This is a test plan, not a claim that all cases below have passed. See [verification.md](verification.md) for executed evidence.

## What the demo promises

Reef records sessions it launches, shows observed commands/files/tool calls, and reconstructs those events during replay. The installed plugin can expose those recordings inside a supporting Codex host. It does not automatically monitor all existing Codex chats. Swimming is decorative; activity and outcomes come from recorded events.

## Preflight

From the repository root:

```sh
npm test
npm run build
npm run plugin:build
npm run plugin:test
codex login status
codex plugin add reef@reef-local --json
```

Start `npm start` if Reef is not already running, then open http://127.0.0.1:4318. Use the production build for rehearsal. Do not launch a second server on the same port. Keep the companion server running for detailed launched-run recordings. Native hook observation uses the plugin alone.

In a fresh Codex chat with Reef enabled, ask: “Use the Reef plugin to open the aquarium.” Open `public/garden-rescue.reef` and check that it renders as an aquarium, not raw JSON. Select an event and use the explicit context-sharing button; confirm the selected event reaches the conversation. The actual Codex file viewer, replay and context-update acknowledgement passed on 9 October; repeat before presenting. Independent conversation-panel dispatch still needs verification. If it fails, present the standalone viewer and disclose the host limitation.

Three optional checks use real account-backed Codex inference:

```sh
node scripts/plugin-activation-test.mjs
npx tsx scripts/live-mcp-test.ts
npx tsx scripts/native-codex-test.ts
```

The first verifies the installed plugin is discovered and called. The second verifies a real MCP start/completion stream passes through the recorder and matches persisted replay. The third verifies trusted native hooks and their structural recording without collecting command content. These checks do not prove host UI rendering.

## Four-minute rehearsal

1. **0:00–0:30, scope.** “Reef turns recorded Codex work into an inspectable aquarium.” Show the local plugin. Explain that launched runs include command output while trusted native hooks collect activity metadata.
2. **0:30–1:45, live recovery.** With no session active, run `npm run demo:reset`. Create a run named Garden rescue with creature Pip, using the absolute `demo/bug-garden` directory. Use the prompt below. Inspect the first failed test, the file-change report, and the passing rerun. A command failure must not prematurely mark the whole task failed.
3. **1:45–2:45, rewind.** Jump to the failed command. Point out that the later fix and final usage disappear before their events. Step forward to completion.
4. **2:45–3:30, plugin and sharing.** Open the real recording in the Codex plugin if the preflight passed. Select one harmless event and explicitly share it. Show export defaults and the preview before including toy command/output content.
5. **3:30–4:00, close.** Show the source repository and explain the current one-active-session limit. If live inference takes too long, switch to the real recorded fallback and say it is a recording.

Prompt:

> Run `node --test garden.test.mjs` first to observe the failure. Read `garden.mjs` and `garden.test.mjs`, fix only `garden.mjs`, then rerun the test. Explain the fix briefly. Do not use network or unrelated files.

Fallbacks: `public/garden-rescue.reef` is a real coding run; `docs/live-mcp-evidence.reef` is a real tool-call run. Their local paths are sanitized. The built-in DEMO is synthetic and must remain labeled DEMO.

## Robustness acceptance tests

Use the disposable garden fixture or a separate test workspace. Record pass/fail, app/CLI version, exact steps, expected versus actual behavior, and the relevant event sequence. Do not reset a workspace during an active run.

| Test                                         | Pass condition                                                                                                                               | Existing evidence                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh install and host rendering             | Installed archive starts outside the repo; native panel and file viewer open; selected context arrives                                       | Package/protocol and real CLI activation passed; actual Codex file viewer/replay/context acknowledgement passed; independent panel dispatch pending |
| Failure followed by recovery                 | Failed command remains inspectable; task completes only after its terminal event                                                             | Real coding runs and automated tests passed                                                                                                         |
| Refresh during a live run                    | Reconnect resumes without duplicate/missing events or losing the run                                                                         | SSE automated checks passed; repeat manually                                                                                                        |
| Cancel a disposable run                      | Status is cancelled; no later success overwrites it; inspect whether the spawned process actually stops                                      | Automated adapter checks passed; real process cancellation still needs testing                                                                      |
| Stop/restart the test server during a run    | Persisted history remains; unfinished run becomes unknown/disconnected, not falsely completed; no orphan process remains                     | Restart state has automated coverage; real process/crash behavior still needs testing                                                               |
| Scrub backward and forward repeatedly        | Future files, usage, selection, and outcomes never leak into earlier snapshots                                                               | Automated and browser replay checks passed                                                                                                          |
| Export/import round trip                     | Same event ordering and included outcomes; fields omitted by export remain absent                                                            | Real browser round trip and automated checks passed                                                                                                 |
| Privacy sentinel                             | Put an obviously fake secret in test prompt/output/path; privacy-default export excludes it; included-content preview makes exposure visible | Default allowlist has automated coverage; rehearse sentinel check explicitly                                                                        |
| Invalid/oversized file                       | Friendly error; current recording remains usable; nothing in the import executes                                                             | Parser has automated coverage; add malformed nested fields and UI cases                                                                             |
| Two simultaneous launch requests             | Exactly one session starts; the other gets a clear busy response                                                                             | Guard exists; add an explicit concurrent-request regression test                                                                                    |
| Missing login, model access, or local server | Clear actionable error; UI does not claim an active or successful run                                                                        | Real launch error observed; other combinations unqualified                                                                                          |
| Long history and large output                | No missing events, frozen UI, or unbounded memory growth; disk and replay still agree                                                        | Not yet measured                                                                                                                                    |

For scale tests, generate clearly labeled local test fixtures with 1,000, 10,000, and 50,000 events rather than paying for long model runs. Measure import time, scrub latency, memory, saved size, and history-response size. Provisional targets on the demo laptop: a 10,000-event import within 2 seconds and scrub responses within 100 ms. These are proposed targets, not achieved results. Also test below and above the current 20-million-character recording limit.

For the meetup, require native plugin preflight (if presenting it as working), one complete live failure/fix run, export/reimport, server recovery, and an offline replay rehearsal. Three consecutive clean rehearsals are a useful confidence check, not proof of universal robustness.

## Improvements in priority order

1. **Finish native host qualification and simplify startup.** Add a doctor command checking Node, Codex login/model access, plugin bundle/version, and companion-server reachability. Provide one reliable install/start flow. Keep UI-host verification separate from protocol checks.
2. **Harden persistence and shutdown.** Surface disk-write failures in the UI, coordinate shutdown with active runners, and test real child-process cancellation. Currently persistence errors are logged and recordings are fully rewritten after each event. Move to an append-only event log with periodic snapshots.
3. **Align recording limits and scale behavior.** Live recordings can grow while import/reload has a size cap; startup currently skips invalid or oversized files. Add explicit limits and recovery reporting so large saved runs do not silently disappear. Paginate session summaries, fetch a selected recording on demand, and virtualize large event lists. The plugin currently polls full session data every four seconds.
4. **Make privacy easier to inspect.** Add optional secret/path redaction and a clear raw-versus-exported preview, retaining explicit selection before sharing. Redaction should supplement field exclusion, not replace it.
5. **Expand useful observation.** Improve tool argument/result/error presentation, event search, named failure bookmarks, run comparison, and portable annotated recordings. Trusted native hooks now observe new lifecycle activity across local sessions. Historical chat backfill and complete external-tool coverage remain outside the contract.
6. **Qualify more environments.** Test a clean second machine, paths with spaces, Windows/Linux, stale or missing bundles, model unavailability, and long-running sessions. Keep account-backed checks opt-in; automate deterministic import/protocol/replay checks in CI.

No hosted service or tunnel API key is needed for this local rehearsal plan.
