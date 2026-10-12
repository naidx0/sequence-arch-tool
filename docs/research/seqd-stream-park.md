# Incremental seqd streaming — parked (Track E)

**Status:** honestly parked on `main` until the provider + `/api/ask/stream` SSE contract exposes real token/delta events.

## Reality

- The ask provider returns **full text** in one shot; `runAskPipeline` emits trace events (`intent:*`, `file:*`, `provider:*`, `usage`) and a single `result`.
- Web `AskStreamClientEvent` mirrors that: `trace` | `result` | `error` — no `token` or `delta` type.
- `sendAsk` commits a diagram only **after** the stream resolves with the complete answer (`commitChatDiagram` post-result). Do not fake live partial drawing on the board.

## Shipped (IO-4 minimal)

- **Auto-fit on commit** remains live: when a chat diagram or ghost proposal lands, `ArchCanvasBoard` fits the camera once to the new nodes (`proposalFitRef`, reduced-motion respected).

## Resume when

1. Provider streaming API yields incremental seqd-safe deltas (or structured partial nodes).
2. `AskStreamEvent` / `AskStreamClientEvent` gain a real delta type wired through `askPipeline` → `aiClient` → `sendAsk`.
3. Camera-follow-per-node during stream replaces (not duplicates) fit-on-commit for the streaming path.

Open queue: `docs/HANDOFF-AGENT-RESTART.md`. The historical `chatbot-input-output-plan.md` (IO-4 / UNFINISHED gaps) was deleted 2026-08-20 with the v1-UI docs.

## Full-product program (Wave 5)

`mxcr/full-product-capability-229d` **does not** unpark this track. Provider still returns full text in one shot (`askPipeline` → single `result`). Do not add fake `token`/`delta`/`seqd` stream event types. Resume only when the three conditions above are met. *(Historical locking stub lived under deleted `packages/web`; do not restore it — park stays owner/P8.)*
