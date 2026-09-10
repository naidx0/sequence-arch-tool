# ADR-002 — Canonical layout: chat left · canvas center · rail right

- **Status:** Accepted (2026-07-24, owner-directed; ratifies the shipped `macos-ui.md` override)
- **Superseded by the v2 pivot (2026-08-20):** `docs/PIVOT-V2.md`. The decision below is kept as
  the **why** record and is not archived — it ratifies the v1 `macos-ui.md` shell (chat left · canvas centre · rail right) and asserts "all docs state it this way", which was not true then and is not true now; it also cites a `design-direction.md` that does not exist. The visual and
  layout authority is now the frozen Graphite book `docs/brand/graphite/` plus
  `docs/brand/GRAPHITE-DECISIONS.md`; the v2 surface plan is
  `docs/research/v2-architecture-and-gaps.md`. Build in `packages/web2`.
- **Drives:** every shell/surface decision; `v20-plan.md` all phases

## Context

`design-direction.md` specified an "Obsidian-style **left** rail"; the shipped app (and the
`macos-ui.md` owner override) placed the Assistant on the LEFT, the canvas in the wide MIDDLE,
and the Files rail + settings on the RIGHT. Docs and product disagreed, which corrupts the eval
bar (judges scored against the wrong layout).

## Decision

The canonical workspace layout is **chat on the left · one live canvas in the center · the
Obsidian-style file/functions/graph rail on the right**. All docs state it this way; new
surfaces and mocks are designed to it; the mirrored reading note in `macos-ui.md` stands.

## Consequences

- `vision.md` §6 and `design-direction.md` are corrected (done in the vision-v2 docs pass).
- The rail is the *drill-in* side (files → functions → file-at-line), chat is the *drive* side;
  the canvas is the shared artifact both act on. Features should respect this grammar —
  navigation affordances belong on the right, conversational/agent affordances on the left.
- Any future mock or screenshot judged against the bar uses this orientation.

## Alternatives considered

- **Move the rail back to the left to match older docs** — rejected: the shipped layout is the
  owner's explicit override; docs follow the product truth, not the reverse.
- **Make sides user-configurable** — rejected for now: configuration surface without a driving
  need ("don't over-build").
