# ADR-001 — One canvas: understanding + editing are the same graph page

- **Status:** Accepted (2026-07-24, owner-directed)
- **Superseded by the v2 pivot (2026-08-20):** `docs/PIVOT-V2.md`. The decision below is kept as
  the **why** record and is not archived — its reasoning (one page for understanding + editing) survives, but the surfaces it names — the Draw toggle, `ScratchCanvas`, `ViewCanvas`, `DesignCanvas` — are `packages/web` components deleted at Wave 7, and the Draw toggle is on the v2 CUT list. The visual and
  layout authority is now the frozen Graphite book `docs/brand/graphite/` plus
  `docs/brand/GRAPHITE-DECISIONS.md`; the v2 surface plan is
  `docs/research/v2-architecture-and-gaps.md`. Build in `packages/web2`.
- **Drives:** `v20-plan.md` Phase 1

## Context

The app accumulated parallel design surfaces: the view canvas (`ViewCanvas`), the edit canvas
(`DesignCanvas`, seeded from the real scan), a standalone from-scratch board
(`ScratchCanvas`/`ScratchPanel`, `mode:'scratch'`, entered from Home), and a dormant `plain`
mode. The vision (owner-resolved) is ONE continuous graph page: you read the system and shape
it on the same surface. Multiple surfaces split the mental model ("board vs view" was already
fought once in v18) and split capabilities (double-click-create and NL starters live only on
Scratch; real-graph seeding lives only on Edit).

## Decision

There is one graph page. `view` and `design` are two states of the SAME page, switched by the
**Draw toggle** — never separate tabs or boards. "Design a new project" seeds that page with an
**empty draft** instead of entering a scratch mode. The standalone Scratch surface is retired;
its unique capabilities (double-click create-and-name, describe-your-app NL starter, box/nest
ink) migrate to the one canvas. The dormant `plain` mode is removed or explicitly documented as
dead in the same pass.

## Consequences

- `AppMode` drops `'scratch'`; the two scratch entry points in `store.ts` seed
  `mode:'design'` + empty draft; `exitScratch` generalizes to the leave-design path.
- The Edit-seeding guard must distinguish *empty-by-intent* (new project — never auto-seed
  from a later scan) from *pristine-awaiting-seed* (scanned repo). `editSeeding.test.ts` is
  extended, never weakened.
- The `test:e2e:scratch` binding e2e migrates to assert double-click-create on the one canvas
  (see ADR-007); `vision.md` §7 is updated in the same commit.
- Usability rubric scores "the one canvas (view)" and "the one canvas (Draw toggle)" as the
  surfaces, replacing "draw / scratch".

## Alternatives considered

- **Keep Scratch as a lightweight standalone board** — rejected: duplicates the edit canvas,
  violates "one mental model per surface", and forks every future canvas feature.
- **Make Edit a separate tab from View** — rejected: the owner's model is a mesh, not depth
  silos; the flip must be instant and in-place.
