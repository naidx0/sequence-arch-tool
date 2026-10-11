# Tier-3 Layer 1 — Draw → logic (P3)

- **Status:** Accepted path (code partially shipped; P3 fills locking tests)
- **Phase:** `tier-completion-orchestration-plan.md` Phase 3 · Tier-3 test spec Layer 1 (spec deleted 2026-08-20; in git history)
- **Related:** ADR-011 (v20 sequencing) · product-final §4.3

## Context

Moat layer 1 (`vision.md` §2.1) is: the user draws / names what they want on the live
Architecture canvas, and Sequence turns that into grounded graph + code proposals — never
freeform invent. The flagship path already exists in product code; P3 locks it with moat tests
and the `draw-to-logic` e2e binding.

## Decision — Architecture Draw → Create → checker → Accept

**Canonical flow (shipped):**

```
Architecture Draw toggle (arch-draw-toggle)
  → ArchDrawOverlay (recognizeStroke; box only)
  → openCreateFromDraw / CreateNodePopover
  → name (+ optional intent) → Create with AI
  → proposeCreateBeforeWrite (graph propose FIRST)
  → checkPlacement / checkGraphMutation (checker BEFORE any file write)
  → setArchProposal + setPendingCreateWrite (ghost cards)
  → User Accept → acceptArchProposalFlow → applyPendingCreateWrite
     (code + Task Board cards when scoped)
```

| Step | Module | Contract |
|------|--------|----------|
| Draw | `ArchDrawOverlay.tsx` | Freehand box → popover anchor; does **not** mutate draft graph |
| Name / AI | `CreateNodePopover.tsx` | Primary action = Create with AI; File-only is quiet secondary (local-first) |
| Placement | `checkPlacement` / `inferPlacement` (`@sequence/schema`) | Analyzer chooses language/path from repo conventions |
| Propose | `createWithAi.ts` · `proposeCreateBeforeWrite` | Cards/edges proposed before write |
| Accept | `acceptArchProposalFlow.ts` · `acceptWorkLogModel.ts` | `checkGraphMutation` (+ policy) then deferred write |
| Research mode | `researchBlocksWrites` | Create-with-AI disabled with honest reason |

**No Design-mode trap (r117):** Create path never routes `setMode('design')` or
`create-node-design`. Edit/Design depth toggles are removed from the final product surface.

## Existing locks (reference — do not weaken)

| Test | Asserts |
|------|---------|
| `productFinalWiring.test.ts` F3 | Draw → CreateNodePopover → Accept deferred write; Research blocks; no Design trap |
| `CreateNodePopover.test.ts` | Name → Create with AI primary; disabled reasons |
| `archChrome.test.ts` | Draw chrome + try strip placement |
| `moat/moat.scaffold.test.ts` | P3 `drawToLogic` suite scaffold (skipped until filled) |
| `tier-3-test-spec.md` Layer 1 | Target files: `drawToLogic.test.ts`, `talkToDraw.test.ts`, `draw-to-logic.mjs`, ink recognize |

## Still in P3 scope (not claimed 100% here)

- Native Task Board ink → card (`boardInkRecognize`) — NativeBoard is the surface (tldraw removed
  r185); ink recognize path or honest "stroke → card" overlay per phase checklist.
- Talk-to-draw NL starter chips → grounded proposal only (`talkToDraw.test.ts`).
- Scratch → one-canvas seed migration (ADR-011 incremental path); full Scratch retirement = P3b.

## Consequences

- Builders filling P3 must extend the **existing** Architecture Draw path — not invent a second
  create surface.
- Any claim "draw → logic 100%" requires Layer 1 tests in `tier-3-test-spec.md` green, including
  `draw-to-logic.mjs` on a real monorepo.
- Fabricated Redis/cache proposals without scan evidence remain forbidden (U21 / grounded sketches).

## Alternatives considered

- **Form-first create (language/path fields up front)** — rejected by owner C5; AI proposes, user
  reviews ghosts.
- **Mutate draft graph on stroke** — rejected for Architecture Draw; Design/scratch ink may still
  create design-origin nodes through `checkPlacement` (separate path, same checker discipline).
- **Full v20 Scratch fold in P3** — deferred per ADR-011.
