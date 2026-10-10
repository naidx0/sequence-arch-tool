# MADR — Visual harness moat (board-visible self-improving harness)

**Status:** Accepted · Phase 1 disk persistence + Phase 2 graphing chrome shipped · phases 3–5 thin seams shipped · **Date:** 2026-08-11 · **Program:** harness moat / trajectory (`mxcr/harness-trajectory-229d`)

## Context

The owner's north star (see [`self-improving-harness-spike.md`](../research/self-improving-harness-spike.md)): a coding tool where chat talks to the **whole repo as one**, grounded in the repo's assets, with a visual architecture board — and the harness **gets better at this repo's workflows the longer it runs**. Today the ask path is single-shot (prompt → answer); the user "sits in the dark" with no thinking trace and no token spend.

Two open-source harnesses the owner invited us to learn from:

- **Prime Agent (Prime Intellect, MIT, 2026-08-05)** — immutable base system prompt; `/refine` applies the smallest evidence-backed edit to supplemental prompts/memory/skills/sub-agent specs at a turn boundary; verification gate completes a task only after passing a designated test. Skill/state-level, not weight-level.
- **Hermes (Nous Research, MIT)** — observe → distill → reuse → refine; after 3+ successful completions of a similar pattern it distills a `SKILL.md` with progressive disclosure (lightweight description always loaded; full body only when an ask matches); persistent memory + sub-agent delegation.

Sequence already has the substrate (Program scheduler, ACP agents, `/api/ask/stream` event pipe, `.sequence/` per-repo state, three-gate release) but it is **not one loop**, and crucially the harness is **not visible on the board**. The differentiator is not a hidden REPL — it is that the architecture board + `.seqd` + grounded evidence + Accept/Deny make the harness **inspectable UI**, the same way topology proposals are.

## Decision

| # | Question | Choice |
|---|----------|--------|
| 1 | **Unit of work** | One **board-visible harness run** (an ask or a Program), captured as a trajectory on the board — **not** a hidden IPython/REPL kernel. |
| 2 | **Write authority** | Explore ≠ write. File writes only via the existing visible-approve Program agent step (W1). `/refine` edits supplemental state only; the base system prompt is immutable. |
| 3 | **Differentiator vs Pi / Prime / Hermes / Claude Code** | Pi = lean loop/context; Prime = immutable base prompt + `/refine` + verify gate; Hermes = tools/skills/memory + progressive disclosure; Claude Code = instruction/loop quality > raw token min. **Sequence = architecture board + `.seqd` + grounded evidence + Accept/Deny = inspectable harness UI.** |
| 4 | **Phasing (locked)** | (1) trajectory capture + board-visible run graph → (2) graphing-loop chrome → (3) skill distill → (4) `/refine` + board Accept/Deny → (5) verify gate auto-invoke. |
| 5 | **This program** | Phases **1–2 shipped** (#48 chrome + trajectory disk on ask/stream + program finalize). Phases **3–5 thin seams shipped** (2026-08-11, `mxcr/harness-phases-3-5-229d`). |
| 6 | **Explanatory surface** | Decision TD + downward English tree live in **this MADR** (clarity only). The graphing loop renders on the **Programs / ask harness chrome** — no new popup system (per [`mermaid-explanatory-surface.md`](../research/mermaid-explanatory-surface.md): reject new overlay chrome; host explainers in existing MADR breakout). |
| 7 | **Aesthetic** | Ledger navy + one signal-orange only. No Cloudflare-clone palette. Brand book is SoT. |

## Thin seam (phases 1–2) — SHIPPED

- **Phase 1 — trajectory capture (disk).** `/api/ask/stream` buffers real SSE events and writes `.sequence/trajectory/<runId>.json` on `result`/`error` (`trajectoryStore.ts`). Program runs finalize via `POST /api/trajectory` from the client with folded `HarnessRunGraph` + `RunEvent`s. Persist **only** what the pipes emit — no fabricated tool/branch/correction events. Local-first: no key required. `GET /api/trajectory/:runId` for read-back.
- **Phase 2 — graphing-loop chrome.** Programs product surface shows **Harness** steps + TD run graph (`HarnessRunGraphView`), statuses folded from scheduler events (#48).

### Owner-problem style — Done when (phases 1–2)

- **Owner quote:** "watch steps" / "gets better at this repo the longer it runs" — without sitting in the dark.
- **Direct problem:** live Harness UI alone left no durable evidence under `.sequence/`.
- **User-seat Done when (phase 1):** after an ask or Program run, `.sequence/trajectory/<runId>.json` exists and lists only real streamed events / program node ids.
- **User-seat Done when (phase 2):** on the Programs harness chrome, the user sees the run as a TD graph (decision vs action, labeled edges, execution order).
- **Inverted-fix ban:** do not invent tool-call SSE; do not stuff trajectory into a composer chip as the product.
- **Locking test shape:** `trajectory-capture.test.ts` (ask stream → file; event set ⊆ streamed); `trajectoryClient.test.ts` (program doc node ids ⊆ graph).

## Thin seams shipped (phases 3–5) — deepened 2026-08-11 (full-product Wave 3)

- **Phase 3 — skill distill:** template distill + **question-stem clustering** when `TrajectoryDoc.question` is set; optional `summarizeBody` LLM hook (no-key → template). Locking: `skillDistill.test.ts`.
- **Phase 4 — `/refine`:** template planner + optional `enhanceAfter` LLM hook; Accept/Deny + **Rollback** (`rolled_back` status, BEFORE_FILE restore). Bar: `HarnessRefineBar` pending + accepted.
- **Phase 5 — verify gate:** `schema-validate` + **allowlisted `command`** (`pnpm test` / `pnpm build` / `pnpm -r build` / schema filter test); `skip` ≠ `pass`.

Ask stream: honest `step:*` wrappers around real work; `tool:*` only when provider returns structured `toolRequests` (never fabricated).

## Not done yet (later rounds, UNFINISHED)

- Full multi-turn model tool-call loop when the provider returns tool requests mid-turn (today: honest `step:*` / `tool:*` only when provider returns structured `toolRequests`, plus step wrappers around real intent/file/provider work).
- Full three-gate release auto-invoke in the agent autonomous loop beyond refine accept + craft command nodes.

## Prior phase notes (phases 1–2 reference)

## Non-goals (explicit)

- **No persistent IPython kernel.** Wave 9's event stream is the stepping stone, not a REPL. If a kernel ever lands, it runs with user OS permissions and an owner gate — documented risk, isolated environment.
- **No model weight changes.** Both reference harnesses are skill/state-level; so is this.
- **No Cloudflare aesthetic clone.** Ledger navy + one signal-orange only; brand book is SoT.
- **No new popup chrome.** Explanatory TD lives in this MADR; the graphing loop lives on the existing Programs / ask harness chrome.

**Cross-program (shipped elsewhere):** Plan Tasks → Task Board cards (#51) — not a harness deliverable; do not relist as harness UNFINISHED.

## Consequences

- Honest: the harness is an **opt-in, board-visible workflow** — not a hidden REPL, not silent self-rewrite.
- Explore (this MADR) and Run stay distinct — no inverted "trajectory chip means write files."
- Local-first holds: capture + distill run with no key; only `/refine`'s planning LLM call needs a key, and without one it simply doesn't run (graceful).
- Grounded: skills and refinements trace to real trajectory evidence; a skill referencing a service not in the scan is refused (same law as topology proposals).
- Moat (per [`product-final-plan.md`](../product-final-plan.md) §5.5): "Agent workflows on the graph — monitorable, local, model-agnostic" now has a concrete, inspectable shape — the board is the UI for the harness's self-improvement.
- Locks: phase 1–2 carry tests asserting trajectory grounding + board-visible TD render; later phases carry their own locking tests when built.
