# Contributing to Reef

Reef is an MIT-licensed experiment in making real agent activity easier to see and revisit. Code, procedural artwork, documentation, and accessibility improvements are welcome.

Use Node.js 22 or newer, run `npm ci`, and start the app with `npm run dev`. The sample recording needs no credentials. Live runs use your local Codex login; never commit recordings of private work, tokens, credentials, or `.env` files.

Before opening a pull request, run:

```sh
npm test
npm run build
npm run plugin:build
npm run plugin:test
```

Keep the adapter, event format, pure reducer, rendering, and plugin boundary separate. Explain observable behavior and include a small regression test for event/replay changes. Update the event-format documentation when the recording contract changes. Unknown SDK events should remain inspectable rather than silently disappear.

Truthfulness is a feature: failed commands do not mean failed tasks, silence does not mean stuck, file activity appears only when reported, absent usage is unknown, and decorative swimming is not a progress estimate. Keep LIVE, REPLAY, and DEMO labels visible.

Contributions must be your own work or appropriately licensed. All original pixel art is drawn by code in this repository and covered by the MIT license. Avoid external sprite packs with unclear redistribution terms.
