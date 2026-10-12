# MADR — Tier completion overall outlook (P0–P6)

- **Status:** Active orchestrator outlook
- **Program:** ADR-010 · `docs/tier-completion-execution-plan.md`
- **Updated:** 2026-08-04 (r210 P6 verify)
- **Branch:** `mxcr/p3-mermaid-complete-42b9` (PR #11)

## Purpose

Single MADR-style outlook on what remains across P0–P6, with per-phase builder/searcher
slots, locking-test policy, and owner gates. Complements phase-specific MADRs
(`tier-p2-ux.md`, `tier-p3-draw-to-logic.md`, `tier-p5-patterns.md`).

---

## Verdict snapshot

| Phase | Status | Blocking gaps |
|-------|--------|----------------|
| P0 | ✅ Closed | — |
| P1 | ✅ Closed | Known analyzer pre-existing failures documented in AGENTS.md |
| P2 | ✅ Verify docs | Owner aesthetic sign-offs deferred to P6 |
| P3 L1 | ✅ Closed | Draw→logic + ink wire + 3B scratch seed (`editSeeding.test.ts`) |
| P4 L2 | ✅ Closed | `impact-investigate.mjs` two-phase; monorepo stem ≥2 hops (no SKIP) |
| P5 L3 | ✅ Closed | `ResilienceAdvisorPanel` + toggle; `patternAdvisor` in `@sequence/schema` |
| P6 | ✅ Foundation | Matrix GREEN, retrospective filled, gates green; owner checklist remains |

---

## Locking-test retention policy (answered)

**Keep all locking tests permanently.** They live in `packages/*/src/moat/` and
`packages/web/e2e/bindings/` and are wired into `pnpm test` / `test:e2e:bindings`.
Do **not** delete tests after a green run — they are the moat ratchet per
the Tier-3 test spec (deleted 2026-08-20) and ADR-010. When a phase closes, update docs/matrix;
tests stay as permanent proof. Optional screenshot artifacts under `tmp-shots/` may
be pruned; binding scripts and vitest locks are not disposable.

---

## Per-phase builder / searcher matrix

### P3 — Draw → logic (L1)

| Slot | Role | Deliverables | Searcher checks |
|------|------|--------------|-----------------|
| 3A | moat vitest | `drawToLogic`, `talkToDraw`, ink moat | tier-3 spec L1 rows |
| 3B | store seed | scratch→design draft seed, `editSeeding.test.ts` | ADR-011 slice |
| 3C | mermaid | `programToMermaid` classDef, Assistant inline | `programMermaid.test.ts` |
| 3D | e2e | `draw-to-logic.mjs` | bindings chain |
| 3E | ink wire | `BoardInkOverlay` → task card | `boardInkRecognize.test.ts` |

### P4 — Impact / fragility (L2)

| Slot | Role | Deliverables | Searcher checks |
|------|------|--------------|-----------------|
| 4A | web moat | `fragilitySurfacing`, `boundaryCrossings` | Assistant cites `computeRisks` only |
| 4B | analyzer | `evidenceChains.test.ts` | file:line golden |
| 4C | e2e stem | `impact-investigate.mjs` full stem | ≥2 hops on monorepo, Process+ESC |

### P5 — Patterns / advisor (L3)

| Slot | Role | Deliverables | Searcher checks |
|------|------|--------------|-----------------|
| 5A | schema catalog | `RESILIENCE_PATTERNS`, starters | validators green |
| 5B | patternAdvisor | single source in `@sequence/schema` | no web/analyzer drift |
| 5C | panel UI | `ResilienceAdvisorPanel`, toggle testid | Chrome e2e uses panel |
| 5D | integration | `moatIntegration`, `resilience-advisor.mjs` | no store fallback |

### P6 — Program close

| Slot | Role | Deliverables | Searcher checks |
|------|------|--------------|-----------------|
| 6A | matrix | `holistic-audit-matrix.md` GREEN rows | concept × surface |
| 6B | retrospective | `tier-completion-retrospective.md` | honest owner gates |
| 6C | gate | `pnpm qa:full` + legibility + bindings | release-gate.md |

---

## Owner-only (not coded in tier completion)

- Gateway deploy, signing, funding
- Mermaid aesthetic sign-off (functional cap documented in T2-e)
- Hosted multi-tenant workspaces

---

## Follow-on after P6

1. ADR-011 remainder — full Scratch retirement into one canvas
2. v20 plan Phases 2–6 — the v20 plan and the OF8 follow-on round plans were deleted 2026-08-20; git history has them
3. H10 comparability harness expansion

---

## Related

- [`creator-master-plan.md`](../creator-master-plan.md) — scratch→one-canvas + doc drift
- [`tier-completion-execution-plan.md`](../tier-completion-execution-plan.md) — wave schedule
- `tier-3-test-spec.md` — locking inventory; **deleted 2026-08-20**, recover from git history if needed
