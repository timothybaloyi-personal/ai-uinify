# AI Uinify

Extension scaffold plus an orchestrator service that can split a composed prompt into provider-specific dispatches using mention aliases (for example `@gpt`, `@gem`, `@perp`).

## Orchestrator components

- `MentionParser` parses a single input into per-provider message segments.
- `DispatchEnvelope` is the unit sent to adapters, including `conversation_id` and `dispatch_id`.
- `ProviderAdapter` is the adapter contract for provider transports.
- `DispatchCoordinator` coordinates parsing, dispatch, retries/timeouts, persistence, and activity events.
- `ContextComposer` builds outgoing prompt payloads from task cards, role instructions, and scope-filtered memory.
- `ContextMergeEngine` applies merge rules that require explicit approval before provider-private entries can be promoted to global-shared scope.
- `DashboardContextController` exposes dashboard actions for listing/promoting/demoting scoped context entries.

Provider registry lives in `config/providers.ts`.
