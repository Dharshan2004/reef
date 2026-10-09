# Three-minute meetup demo

Target: 9 October 2026, 8:00 pm, Asia/Singapore.

## Rehearsal before going on stage

1. Run `npm ci`, `npm test`, `npm run build`, `npm run plugin:build`, and `npm run plugin:test`.
2. Run `codex login status`. A working account must support `gpt-6.1-sol`; Reef does not substitute another model.
3. Start `npm run dev`, open http://127.0.0.1:5173, and use presentation fullscreen. Confirm your projector can read the inspector.
4. Keep `public/garden-rescue.reef` ready as the offline fallback. This is a real recorded run with paths sanitized. The built-in DEMO is synthetic and labeled as such.
5. Confirm the Reef plugin is enabled and open the fallback recording in the host. If it renders as plain JSON, use the standalone replay and explicitly say host viewer activation has not been verified.
6. Run `npm run demo:reset` immediately before the live demonstration. It deliberately restores the tiny fixture's bug. Do not run it during an active task.

## 0:00–0:25: Introduce the reef

“Reef gives a Codex session a little underwater home. The swimming is decorative. The commands, file reports, and errors come from real events.”

Point to the mode badge. Start a new session named **Garden rescue**, creature **Pip**, in the absolute `demo/bug-garden` directory.

Prompt:

> Run `node --test garden.test.mjs` first to observe the failure. Read the implementation, fix only `garden.mjs`, then rerun the test. Explain the fix briefly.

## 0:25–1:20: Watch real activity

Show the **LIVE** badge and terminal station. Click Pip. Open the failed command and its test output. Let Codex report its file change and successful test rerun.

“That command failed. The task is still running. Reef keeps those two outcomes separate.”

If the network or model takes longer, switch to the real recorded fallback and state clearly: “This is the run I recorded earlier.” Never present replay as live.

## 1:20–2:05: Rewind

After turn completion, choose **Replay session**. Pause and scrub backward to the original failed command. Inspect `1 !== 0`, then move forward to the reported `garden.mjs` update and passing tests.

“Rewinding reconstructs the state at that moment. The later fix disappears until we reach it again.”

## 2:05–2:40: Export and open in the plugin

Open **Export**. Show the fields off by default and the JSON preview. For this public toy fixture, deliberately include command text and output; check the preview before saving `.reef`.

Open the file with the Reef plugin custom viewer. Show the conversation panel if available in the host. If host activation is blocked, show the packaged extension and the standalone viewer, and state the exact limitation.

“The DevDay feature here is ChatGPT plugin extensions: a custom file viewer and conversation panel. The Codex SDK is the existing adapter that feeds the aquarium.”

## 2:40–3:00: Close

Show https://github.com/Dharshan2004/reef.

“It's local, open source, and MIT licensed, including the pixel art. Record a run, inspect what actually happened, and share only the fields you choose.”

## Recovery checklist

- **No model access:** load `public/garden-rescue.reef`; keep the REPLAY badge visible.
- **Stream disconnect:** Reef reports reconnection; do not call the agent stuck or failed without an outcome event.
- **Plugin does not activate:** use standalone replay and report host activation as unverified.
- **Fixture already fixed:** reset it while no session is active, then launch once.
- **Presentation too small:** hide the inspector for the opening, then reveal it for the failed command.
