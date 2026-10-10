# Tier completion retrospective

- **Status:** Complete (P6 foundation)
- **Program:** ADR-010 · phases P0–P6
- **Last updated:** 2026-08-04 (P6 verify / loop r210)
- **Branch:** `mxcr/p3-mermaid-complete-42b9` (PR #11)

## Purpose

Record what the tier-completion program actually shipped vs planned (r190–r209), which MADRs
held, which owner gates remain, process lessons, and follow-on work.

---

## Tier-1 outcome (P1 · r191–r193)

**Verdict: 100% checklist closed.**

| ID | Outcome | Lock |
|----|---------|------|
| T1-a | Portable `diff.test.ts` fixture (`shopfront-mutated` in-repo) | `diff.test.ts` |
| T1-b | ai-server generate paths honest (422 or fix on ticketing spec) | `ai-server.test.ts` |
| T1-c | `arch-proposal` e2e green | `arch-proposal.mjs` |
| T1-d | `breakout-function-flow` e2e green | `breakout-function-flow.mjs` |
| T1-e | Full `test:e2e:bindings` 0 fail with Chromium | `package.json` `:bindings` |
| T1-f | `buildRepoFunctionGraph` parse-cache metric | `repoFunctionGraph.perf.test.ts` |
| T1-g | Doc honesty (NativeBoard, not tldraw) | `productFinalWiring.test.ts` |

**Residual known failures (documented, not tier blockers):** none at P6 gate — `pnpm test` green on
this branch. AGENTS.md still notes analyzer pre-existing failures as a cloud-VM caveat; they do
not reproduce on the current tree.

**Gate (r193):** `pnpm -r build` · `pnpm test` · `test:e2e:bindings` PASS.

---

## Tier-2 outcome (P2 · r194–r197)

**Verdict: 100% verify-docs bar — code shipped; aesthetic owner sign-offs deferred to P6 owner checklist.**

Documented in [`tier-p2-ux.md`](tier-p2-ux.md) + [ADR-012](../adr/ADR-012-try-chip-dedup.md) Option C.

| ID | Shipped | Honesty |
|----|---------|---------|
| T2-a | G3 zoom floor on `GroupedCanvas` | legibility + `groupedCanvas.zoom.test.ts` |
| T2-b | Breakout map evidence path + font measure | breakout e2e |
| T2-c | TALKS TO column + copy | CSS + explain tests |
| T2-d | Try chip ask vs map split (one strip) | `tryChipsModel.test.ts` |
| T2-e | Mermaid export cap `%% 40 of N` | functional; **owner aesthetic sign-off still open** |
| T2-f | BYO English `/api/explain` + `/api/annotate` | wired; live English needs owner key |
| T2-g | Copilot proposal legibility stops | `legibility.mjs` |
| T2-h | Cursor parity gap list | decision pack thinner than Cursor; documented |

**Gate (r197):** docs + matrix tier rows; legibility + `qa:smoke` re-run at P6 — green.

---

## Tier-3 L1 — Draw → logic (P3 · r198–r209)

**Verdict: 100% Layer 1 locking tests green.**

| Artifact | Round | Notes |
|----------|-------|-------|
| `drawToLogic.test.ts`, `talkToDraw.test.ts` | r206 | Architecture Draw → Create-with-AI path |
| `boardInkRecognize.ts` + test, ink moat | r206–r208 | Box stroke → task card on NativeBoard |
| `draw-to-logic.mjs` binding | r206 | Wired into `test:e2e:bindings` |
| Mermaid inline Assistant + `programToMermaid` classDef | r206 | P2/P3 crossover |
| Scratch→design seed (`store.ts`) | r209 | ADR-011 slice; `editSeeding.test.ts` locks |
| MADR | r197+ | [`tier-p3-draw-to-logic.md`](tier-p3-draw-to-logic.md) |

**Not claimed:** full Scratch UI fold into one canvas (3B-b) — store seed only; see
[`creator-master-plan.md`](../creator-master-plan.md).

---

## Tier-3 L2 — Impact / fragility (P4 · r208–r209)

**Verdict: 100% Layer 2 locking tests green.**

| Artifact | Round | Notes |
|----------|-------|-------|
| `fragilitySurfacing.test.ts`, `boundaryCrossings.test.ts` | r208 | Assistant cites `computeRisks` only |
| `evidenceChains.test.ts` (analyzer) | r208 | file:line golden chains |
| `impact-investigate.mjs` | r208–r209 | Two-phase: shopfront Process investigate + ESC; **monorepo stem ≥2 hops (8 hops), no SKIP** |

**Gate (r209):** `impact-investigate.mjs` PASS on pre-attached `/workspace`.

---

## Tier-3 L3 — Patterns / advisor (P5 · r204–r209)

**Verdict: 100% Layer 3 locking tests green.**

| Artifact | Round | Notes |
|----------|-------|-------|
| `RESILIENCE_PATTERNS` ≥3, `INDUSTRY_STARTERS` ≥2 | r204 | `checkerRules[]` required |
| `patternAdvisor` in `@sequence/schema` | r209 | single source; no web/analyzer drift |
| `resilienceAdvisor.test.ts`, `moatIntegration.test.ts` | r208–r209 | draw→checker→apply |
| `ResilienceAdvisorPanel` + `resilience-advisor-toggle` | r209 | Chrome e2e uses panel, no store fallback |
| `resilience-advisor.mjs` | r208–r209 | grounded suggestions on shopfront |

**Gate (r209/r210):** `resilience-advisor.mjs` PASS; web vitest **2599** pass (1 skipped scaffold).

---

## Owner gates left (not coded in tier completion)

These are **honest 🟡** in product docs — local-first core is complete without them:

| Gate | Why owner-only |
|------|----------------|
| Gateway deploy | Hosted multi-tenant; funding + ops |
| Code signing / notarization | Desktop distribution |
| Mermaid aesthetic sign-off | Functional cap shipped (T2-e); visual polish is taste |
| Hosted workspaces / D5 isolation | Architecture decision, not local-first blocker |
| Trellis open questions (LLM routing, MCP tools API) | Deferred in r186; not tier-3 scope |

---

## Process lessons (r190–r210)

1. **Subagent CONTEXT DIET works** — bounded file lists prevented explore loops; foreign-failure
   protocol kept waves from editing each other's files.
2. **Wave ownership tables are binding** — parallel BUILD slots (3E/4A/5B) only succeeded when
   `may touch` / `must not touch` were enforced.
3. **Doc drift is a ship risk** — execution plan lagged r208–r209 (still showed P4 ~40%); P6
   verify wave exists to reconcile matrix + retrospective + outlook in one commit.
4. **Fixture scale ≠ monorepo proof** — stem binding on `/workspace` (≥2 hops) caught SKIP
   shortcuts that shopfront-only fixtures missed.
5. **Locking tests stay forever** — per MADR outlook policy; green run does not delete bindings.
6. **Legibility gate history** — three rounds shipped green tests while UI was broken; P6 re-ran
   `qa:smoke` but full `qa:full` + legibility remain owner-merge checklist items.

---

## Follow-ons (after P6)

| Priority | Work | Doc |
|----------|------|-----|
| 1 | ADR-011 remainder — Scratch UI fold into one canvas (3B-b) | [`creator-master-plan.md`](../creator-master-plan.md) |
| 2 | v20 Phases 2–6 | `v20-plan.md` — **deleted 2026-08-20**, in git history |
| 3 | H10 comparability harness expansion | orchestration risk register |
| 4 | Owner deploy / signing / Mermaid aesthetic | this file § Owner gates |
| 5 | Trellis Wave D (LLM routing, nested subgraphs) | r186 deferred list |

---

## Pointers

| Doc | Role |
|-----|------|
| [`ADR-010`](../adr/ADR-010-three-tier-completion-program.md) | Program |
| [`ADR-011`](../adr/ADR-011-v20-sequencing.md) | v20 sequencing |
| [`ADR-012`](../adr/ADR-012-try-chip-dedup.md) | Try chip Option C |
| [`tier-p2-ux.md`](tier-p2-ux.md) | T2-e/f/h + UX bar |
| [`tier-p3-draw-to-logic.md`](tier-p3-draw-to-logic.md) | Draw → logic path |
| [`tier-p5-patterns.md`](tier-p5-patterns.md) | Patterns v1 scope |
| [`tier-completion-madr-outlook.md`](tier-completion-madr-outlook.md) | P0–P6 outlook |
| [`tier-completion-orchestration-plan.md`](../tier-completion-orchestration-plan.md) | Binding plan |
| [`holistic-audit-matrix.md`](../holistic-audit-matrix.md) | Concept × surface matrix |
