# ADR-004 — Design intelligence is a background engine the chat cites, not pop-ups

- **Status:** Accepted (2026-07-24, owner-directed)
- **Drives:** `v20-plan.md` Phase 3; reframes `vision.md` §2 layer 2

## Context

Moat v1 shipped grounded proposals as proactive UI: suggestion chips ("suggest a fix I can
build") and ghost pop-ups on the canvas. The engine beneath them — `computeRisks`,
`computeImpact`, `computeCycles`, fragility — is pure, local, key-free, and honest. The owner's
direction: keep (and deepen) the logic, remove the pushiness. "I want a good logic default
background, but that logic is what the AI is going to talk to, not just pop-ups on the screen."

## Decision

The grounded logic engine runs as a **quiet default in the background**. Its facts are:

1. **Folded into the chat's context** — the `/api/ask` digest carries top risks, cycles, and
   blast-radius standouts so the assistant *cites real computed facts* when the user asks
   design questions (and in NL→edit grounding, ADR-005).
2. **Revealed on demand** — overlays (impact/risks) stay reachable when the user asks, in chat
   or via their existing entry points.
3. **Never pushed** — no proactive chips, ghosts, or advisory pop-ups fire without the user
   asking. At most one quiet entry point remains.

## Consequences

- `BoardChat` suggestion chips are trimmed; the proposal mechanics (`design/proposals.ts`,
  ghost + accept/reject rails) survive as the *apply* machinery behind conversation-triggered
  changes, not as autonomous UI.
- The key-free local answers ("what's fragile here?", "what talks to the database?") remain —
  they are the engine speaking *when asked*.
- Layer-3 knowledge (industry patterns, resilience advice) also enters through conversation,
  not badges.

## Alternatives considered

- **Keep proactive suggestion chips** — rejected: the owner explicitly wants fewer
  suggestions; pushy advice erodes trust and violates minimal-noise (principles §3).
- **Remove the proposal machinery entirely** — rejected: it is the validated, ghost-safe apply
  path; only its *trigger* changes.
