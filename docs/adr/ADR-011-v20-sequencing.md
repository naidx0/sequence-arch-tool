# ADR-011 — v20 one-canvas sequencing inside tier completion

- **Status:** Accepted (2026-08-04)
- **Drives:** `tier-completion-orchestration-plan.md` Phase 3
- **Related:** ADR-001 (one canvas), ADR-010 (program)

## Context

ADR-001 commits to folding Scratch into the one Architecture canvas (v20 Phase 1). The tier
completion program must not silently skip this while claiming tier-3 layer 1 at 100%. Full v20
Phases 1–6 is too large for a single phase.

## Decision

**Incremental path (chosen):**

1. **P3 minimum (required for layer 1):** Double-click create + NL starter on the unified
   Architecture design path; `test:e2e:scratch` binding migrates to one-canvas target (ADR-007).
2. **P3 defer (logged, not hidden):** Retire `ScratchPanel` routing — separate round **P3b**
   (r202+) only after P3 draw→logic tests green.
3. **P6+:** v20 Phases 2–6 (functions-first rail refresh, chat drives canvas, diagram artifacts,
   ADR output) become a **follow-on program** after tier 1–2 are 100%.

## Consequences

- Tier-3 layer 1 can reach 100% without full Scratch deletion.
- `vision.md` §4 scratch mention updates in P0; full ADR-001 completion tracked as P3b.
- Subagent wave 3B owns `store.ts` scratch seeds only — not full Scratch file deletion.

## Alternatives considered

- **Full v20 Phase 1 in P3** — rejected: collides with ink/create waves; too many files.
- **Skip v20 entirely** — rejected: contradicts ADR-001 and moat layer 1 bar.
