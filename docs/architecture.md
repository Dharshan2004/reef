# Architecture

Reef watches sessions it launches. It does not discover other chats, infer hidden agent reasoning, or coordinate independent agents.

```text
Local Codex login
      │
Codex TypeScript SDK → server/session-manager.ts → .reef-data/*.json
                                   │
                            loopback HTTP / SSE
                                   │
                         React session controller
                                   │
               versioned events → pure reducer → Canvas aquarium + inspector
                                   ↑
                            imported .reef file
                                   ↑
                    ChatGPT custom file viewer / conversation panel
```

## Boundaries

- `server/` owns execution, authentication through the local Codex CLI, HTTP, stream subscriptions, cancellation, and recording persistence.
- `src/core/` defines the recording envelope, validates imports, selects export fields, and reconstructs observable session state. It can run in a browser without Node or credentials.
- `src/ui/` renders state. Ambient bubbles and swimming are decoration. They never estimate progress or imply the agent is stuck.
- `plugin/` integrates the same recording/reducer and aquarium with ChatGPT extension surfaces.
- `demo/` contains a tiny local test fixture whose empty-input bug can be reset for rehearsal.

## Live and replay

Every SDK event receives a session ID, monotonic sequence number, unique event ID, and observation timestamp. The server appends it before notifying subscribers. The browser's source can be a live stream or a recording, but both use the same pure reducer. Backward scrubbing reconstructs state from the beginning through the selected event, so completed items and later file changes cannot leak backward in time.

Command failure is an item outcome. A task can contain failed commands and still finish successfully. File changes reflect SDK reports, including their outcome, rather than interpolated editing progress. Missing token usage remains unknown. A dropped browser connection is a transport condition, not proof of agent failure.

## Local execution and privacy

The server binds to loopback. Host and Origin checks reject remote web origins, and JSON is required for session creation. Live tasks use Codex's workspace-write sandbox with automatic approval disabled and network tools disabled in v0. Inherited plugins/apps are disabled before enumerating configured MCP server names, which are individually disabled for the run. Enumeration projects only names and never logs transports or credentials. `REEF_INHERIT_TOOLS=1` is an explicit opt-in to inherited tools. Choose only a directory you intend Codex to edit.

Raw recordings stay locally in `.reef-data/`, which is ignored by Git. Export is a deliberate preview-and-download flow. Content, commands, prompts, and paths can be selected separately; text may itself contain sensitive paths or other data, so review the preview before sharing. Import and replay never execute a recording's commands.

## Scope

v0 prioritizes one observed session, recordings, and a reliable demo. There is no cloud orchestration, user authentication service, in-app code editor, approval queue, or arbitrary-session discovery. Plugin execution and installation depend on the host's support; see [plugin.md](plugin.md) for the verified status.
