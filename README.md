# AI Uinify

Extension scaffold plus an orchestrator service that can split a composed prompt into provider-specific dispatches using mention aliases (for example `@gpt`, `@gem`, `@perp`).

## Orchestrator components

- `MentionParser` parses a single input into per-provider message segments.
- `DispatchEnvelope` is the unit sent to adapters, including `conversation_id` and `dispatch_id`.
- `ProviderAdapter` is the adapter contract for provider transports.
- `DispatchCoordinator` coordinates parsing, dispatch, retries/timeouts, persistence, and activity events.

Provider registry lives in `config/providers.ts`.
