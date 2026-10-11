# ADR-003 — Functions-first navigation with animated architecture flow

- **Status:** Accepted (2026-07-24, owner-directed; Codex-style reference screenshots received
  2026-07-24 and decoded in `v20-plan.md` Phase 2)
- **Superseded by the v2 pivot (2026-08-20):** `docs/PIVOT-V2.md`. The decision below is kept as
  the **why** record and is not archived — functions-first drill-down remains a product law, but the rail path it specifies targets `FunctionsCanvas` and other `packages/web` components; the v2 rail is specified by `docs/brand/graphite/pages/11-the-functions-rail.html`. The visual and
  layout authority is now the frozen Graphite book `docs/brand/graphite/` plus
  `docs/brand/GRAPHITE-DECISIONS.md`; the v2 surface plan is
  `docs/research/v2-architecture-and-gaps.md`. Build in `packages/web2`.
- **Drives:** `v20-plan.md` Phase 2

## Context

The rail's file section is a VS Code-style tree: to find behavior you grep files. The owner's
model: opening a repo should *break it down* — show the **functions** of the system, defaulted
off the file section, and clicking a function should show how the call actually moves through
the architecture, animated service to service. The pieces exist but are disconnected: a full
function call graph lives in a separate Functions tab (`FunctionsCanvas`, with a working
reduced-motion-gated `flowing`-edge animation), the rail only links to that tab, and function
nodes show `file:line` but cannot open the file there.

## Decision

Functions become the **primary drill path**:

1. The rail's file section defaults to a **breakdown of what the system does** — flows first
   (the grounded `plainTree` scenario tree, e.g. "Interactive TUI session → Startup / Turn
   loop"), with file rows expanding to their real analyzer-extracted functions beneath (data
   from `/api/functions`, grouped per file). This grouping is taken directly from the owner's
   Codex-style reference frames.
2. Clicking a function **re-sorts the one canvas and plays the flow**: the call path is mapped
   to arch-level nodes/edges and animated hop by hop (service → service), reusing the
   `flowing`-edge idiom; `prefers-reduced-motion` gets static emphasis.
3. A function always links back to its **file and line** (FileEditor gains open-at-line).
4. The full Functions tab remains as the zoomed-out call-graph view.

## Consequences

- New pure, test-locked `functionFlowPath(functionGraph, archGraph, fnId) → {archNodeIds,
  archEdgeIds, truncated}`: only hops backed by real `ArchGraph` edges are included; if a hop
  has no grounded arch edge the flow **truncates honestly** rather than inventing a step.
- `/api/functions` is fetched once per repo and cached like `plainTree`.
- The rail needs function rows in `buildRailRows` (pure, testable) and a playback pill on the
  canvas (Learn-tour card idiom, Esc to exit).
- Usability rubric gains "Functions navigation" as a scored surface.

## Alternatives considered

- **Keep functions only in the separate tab** — rejected: hides the primary drill path behind a
  button; the owner's model is functions *default off the file section*.
- **Animate on the function graph only (not the arch canvas)** — rejected: the value is seeing
  the flow *on the system you're looking at*, not in a side universe.
- **Synthesize flow steps when the arch edge is missing** — rejected outright: violates the
  grounding invariant; honest truncation instead.
