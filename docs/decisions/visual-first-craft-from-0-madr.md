# MADR — Visual-first craft-from-0 (macro → micro → verify)

**Status:** Accepted for thin seam · **Date:** 2026-08-09 · **Program:** visual-first mega (`mxcr/visual-first-program-229d`)

## Context

Design/chat arch diagrams are the user’s **#1 plan** and **workflow source of truth**. The owner wants: click a macro → explore how to build → orchestrate subagents per micro → work/verify/test/compile loop → report to a head orchestrator → eventually a **real program arch board** (not only a planning breakdown).

Today the runtime pieces exist separately (Program scheduler, ACP agents, checker loops, `/api/generate`, Task Board executor, `microDocFromParts` UI) but are **not** one loop.

## Decision

| # | Question | Choice |
|---|----------|--------|
| 1 | **Trigger** | Explicit **Craft from 0…** on Index (selected macro). Card expand / “How it works” stays **explore-only** (MADR / parts). Not auto-craft on select. |
| 2 | **Unit of work** | Prefer `detail.parts` micros when present; else one craft step for the macro node. |
| 3 | **Write authority** | Graph-first / approval-gated agent steps (existing Program agent + approval). No silent auto-write of a whole repo from chat. Craft prompts prefer scoped `/api/generate` when the human approves. |
| 4 | **Verify loop** | Craft graph includes allowlisted `pnpm build` / `pnpm test` **command** nodes after craft agents. |
| 5 | **Orchestrator** | **Pre-authored Program graph generated from the selected seqd node** (deterministic). Dynamic LLM re-delegation is out of this wave. |
| 6 | **End state** | After craft runs, keep design seqd as SoT until the user **explicitly** Promote to scan + rescan; do not pretend scan topology until files exist. |

## Thin seam (shipped) + Wave 2 depth

`boardCraftStarterProgram` builds Start → Orchestrator agent → **Generate (scoped)** + craft agent per micro (or single pair for macro) → **Verify: pnpm build** → **Verify: pnpm test** → Done, opened via Index **Craft from 0…** (`data-testid="product-board-craft-from-0"`).

Each **Generate (scoped)** step is approval-gated (`requiresReview`) and instructs scoped `/api/generate` per micro — never silent whole-repo writes. **Promote to scan…** (`data-testid="product-board-promote-to-scan"`) is an explicit Index control via `promoteCraftToScan` — never auto after craft.

## Explanatory graphing surface (planning adaptation)

Mermaid-style **readability** (TD, decision vs action, labeled edges, execution order) is instructed in design prompts and rendered as **seqd board + MADR TD + chat ## Execution order**. Placement options and the Index-vs-board choice live in [`docs/research/mermaid-explanatory-surface.md`](../research/mermaid-explanatory-surface.md) — Index may grow for CTAs/order strip; the board remains the primary graph.

## Not done yet (later waves)

- Dynamic head orchestrator re-delegation (LLM)
- Deeper generate executor wiring in `webExecutors` (today: approval-gated agent prompts + shared `/api/generate` UI)

**Shipped elsewhere (do not relist as craft UNFINISHED):** Plan Tasks chip → Task Board cards (#51).

## Consequences

- Honest: craft is an **opt-in workflow**, not silent codegen.
- Explore (MADR) and Craft stay distinct — no inverted “expand means write files.”
- Promote is **explicit** — design seqd stays SoT until the user rescans.
- Locks: `productProgramModel.test.ts` + `craftPromote.test.ts` validate craft starter + promote separation; Index rail exposes Craft + Promote CTAs.
