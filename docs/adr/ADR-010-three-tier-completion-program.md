# ADR-010 — Three-tier completion program (0 → 100%)

- **Status:** Accepted (2026-08-04, owner-directed)
- **Drives:** `docs/tier-completion-orchestration-plan.md` · the Tier-3 test spec (deleted 2026-08-20 with the v1-UI docs; in git history)
- **Supersedes:** scattered per-round gap notes as the *execution* bar; `vision.md` remains the *eval* bar

## Context

Sequence has reached a **stable ratchet** on core surfaces (r189): Agents/Trellis, native Task Board,
27-repo QA, fabrication honesty, Codex workflow parity 100%. Remaining work is uneven across
`vision.md` §3 tiers (~90% tier-1, ~85% tier-2, ~40% tier-3). Prior rounds used ad-hoc waves
without a single orchestration doc, causing subagent collisions, doc drift (`vision.md` still says
tldraw), and incomplete gate chains.

The owner requested a **from-zero orchestration program**: phases, MADR/ADR decisions, tier-3
locking tests, and parallel subagent slots with disjoint file ownership.

## Decision

1. **One program doc** (`tier-completion-orchestration-plan.md`) is the binding build order.
   Phases 0–6 run sequentially; waves *within* a phase may parallelize only per the file-ownership
   matrix in that doc.
2. **100% per tier** is defined by checklists in the orchestration plan, not vibes. Each checklist
   item maps to a locking test (tier-1/2) or a tier-3 test in `tier-3-test-spec.md`.
3. **MADR outputs** — each phase that changes product behavior emits a grounded
   `.sequence/decisions/*.md` artifact (ADR-009 pattern) plus updates `docs/loop-log.md`.
4. **Subagent discipline** — analysis and planning are parent-direct; subagents are build-only,
   one wave at a time, with explicit may-touch / must-not-touch lists. No autonomous-loop fan-out
   for this program.
5. **Deploy/funding blockers** (hosted gateway, Apple/Windows signing, multi-user isolation) are
   tracked as **Phase 6 owner gates**, not coded as if live.

## Consequences

- `loop(r190+)` entries reference phase IDs (P0–P6) and wave slots (A/B/C/D).
- `holistic-audit-matrix.md` is refreshed at P6 with tier-3 rows.
- `vision.md` §4 Task Board canon updates in P0 (tldraw → NativeBoard).
- Regression at any tier re-opens that tier's phase before later phases proceed.

## Alternatives considered

- **Continue ad-hoc autonomous-loop rounds** — rejected: caused subagent abort loops and doc drift.
- **Ship v20 one-canvas before tier-1/2 closure** — rejected per vision §3 top-down rule.
- **Tier-3 without locking tests** — rejected: moat claims must be test-locked per vision §5.
