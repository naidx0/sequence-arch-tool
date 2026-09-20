# ADR-006 — Surface roster: Domain stays separate; Programs and Task Board kept but deferred

- **Status:** Accepted (2026-07-24, owner-directed); Programs/Task Board elaboration OPEN
- **Superseded by the v2 pivot (2026-08-20):** `docs/PIVOT-V2.md`. The decision below is kept as
  the **why** record and is not archived — it keeps Programs and Task Board "as shipped"; both are on the v2 CUT list (`docs/research/v2-architecture-and-gaps.md` §1.2), so this roster no longer describes what will exist. The visual and
  layout authority is now the frozen Graphite book `docs/brand/graphite/` plus
  `docs/brand/GRAPHITE-DECISIONS.md`; the v2 surface plan is
  `docs/research/v2-architecture-and-gaps.md`. Build in `packages/web2`.
- **Drives:** `v20-plan.md` Phase 4 (decisions log)

## Context

With everything converging on one canvas (ADR-001), the fate of the other surfaces needed an
explicit call so nothing is silently promised or silently dropped.

## Decision

- **Domain model** — stays **its own design surface**, deliberately separate from the one
  canvas ("it's going to be its own thing"). Whether it later adopts the Draw-toggle + chat
  editing grammar is an open owner call.
- **Programs ("graphs and loops")** — **kept as shipped** (compose agent graphs + drive local
  Claude Code/Codex over ACP). Its relationship to the one canvas is deferred pending owner
  elaboration; the surface must keep working and must not mislead meanwhile.
- **Task Board** — **kept as shipped**; owner explicitly unsure ("not sure, to be honest…
  elaborated on later"). No investment, no removal, until elaborated.
- **Home** — remains the entry (attach repo / new project) but both routes land on the one
  canvas.

## Consequences

- No build effort flows to Programs/Task Board evolution during v20 phases 1–3 (bug fixes and
  gate health excepted).
- `vision.md` §4 marks both as *kept; elaboration deferred* — an honest bar, not a promise.
- Phase 4 of `v20-plan.md` is a standing decisions log; each open item needs an owner answer
  before it becomes a phase.

## Alternatives considered

- **Fold Task Board / Programs into the canvas now** — rejected: undirected scope; the owner
  parked them explicitly.
- **Remove them** — rejected: they work today; removal is churn without a directive.
