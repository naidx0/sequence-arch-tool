# ADR-005 — Chat edits the live canvas through validated patches, inline accept/reject

- **Status:** Accepted (2026-07-24, owner-directed)
- **Drives:** `v20-plan.md` Phase 3

## Context

Talk-to-draw today is fragmented: NL starters exist on Home/Scratch (`/api/design-suggest`),
and grounded fix-proposals exist behind a chip — but an ordinary chat turn cannot create,
rename, or wire nodes on the live system. The owner's model: the chat on the left is a
first-class editor of the one canvas — "you go, you chat, and you create systems."

## Decision

Any chat turn may produce a **graph patch** applied to the live draft, under hard rails:

1. **Same rails as hands.** A chat-made node/edge is built exactly like a hand-made one:
   `origin:'design'`, pre-validated by `checkPlacement`, `validateGraph` stays clean, applied
   atomically via `applyGraphPatch` as a **ghost** on the draft.
2. **Inline accept/reject.** The Accept/Reject decision renders **inside the chat turn**
   (Cursor-style), not as a canvas pop-up (per ADR-004). Accept keeps; Reject removes cleanly;
   the scanned `graph` is never mutated.
3. **Key-gated, honest.** Free-form NL→patch requires a model; with no key it refuses plainly
   *before any fetch*. Deterministic local commands (fragility, data-access) stay key-free.
4. **Malformed model output never throws** — graceful refusal (reuse `extractFirstJsonObject`
   idiom).

## Consequences

- One apply path for all mutations (hands, ink, chat) — no parallel edit machinery to drift.
- The `/api/ask` (or a sibling endpoint) response format gains an optional structured patch;
  the digest includes the current *draft* state so patches land on what the user sees.
- Locking tests: patch validation rejects illegal placements; reject removes all ghost ids;
  the scanned graph is byte-identical before/after a rejected patch; no-key refusal precedes
  any network call.

## Alternatives considered

- **Auto-apply chat edits without accept** — rejected: destructive-by-surprise; propose→act
  means one *click*, not zero consent.
- **A separate "AI edit mode"** — rejected: violates the one-canvas mesh; chat is always live.
