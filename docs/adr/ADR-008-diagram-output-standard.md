# ADR-008 — Rendered diagram artifacts are a first-class, grounded output format

- **Status:** Accepted (2026-07-24, owner-directed: "these photos should be our proper output
  standard formats")
- **Drives:** `v20-plan.md` Phase 5; enables ADR-009

## Context

Sequence already computes everything needed to emit publication-quality diagrams, and has since
v6/v16 — three **pure, deterministic, browser-safe projections** over the real graph:

- `mermaidSequence(graph)` and `mermaidFlow(graph)` (`packages/export/src/mermaid.ts`), both
  built on the shared `projectEdges`/`orderParticipants` projection so service-level edges are
  never re-derived;
- `programToMermaid(program)` (`packages/schema/src/programMermaid.ts`) for agent workflows.

But the product never *renders* them. `ExportMenu.tsx` says so in its own header comment: *"No
Mermaid renderer is bundled: this is export-to-text; the user pastes the result into their own
Mermaid tool."* The user gets a textarea of source code and a homework assignment.

The owner closed the loop empirically: they took this repo's own diagrams — the same projection
style — rendered them, and identified that rendered artifact as the standard Sequence's outputs
should meet. Meanwhile the product's stated anti-goal is "a chat box that spits out files nobody
wants to read," and the usability standard scores **Legibility** as make-or-break. A grounded,
labeled, rendered diagram is the direct answer to both.

## Decision

**Rendered diagrams are a first-class output format of Sequence, on the same footing as prose.**

1. **Two canonical formats** (matching the reference frames):
   - **Architecture / flow diagram** (`flowchart`) — components grouped in subgraph containers,
     typed and colored edges. Answers *"what is this system, or this scope of it."*
   - **Sequence diagram** (`sequenceDiagram`) — participants as lifelines, ordered messages,
     notes. Answers *"how does this flow move, and in what order."* This is the natural
     rendering of Phase 2's `functionFlowPath` — the product's namesake view.
2. **Source rule — the honesty spine (non-negotiable).** A rendered diagram's source is
   **always a pure projection over the real graph** (or the validated draft). The model may
   choose the diagram *type* and the *scope* (which real node ids); it may **never author
   diagram text**. Model-written diagram source is fabricated architecture wearing an
   authoritative costume — the most dangerous possible violation of "grounded, never guessed" —
   and is banned outright. Scope ids are validated against the real-node allow-set (the
   `sanitizeNode` pattern) before anything renders.
3. **Rendering:** bundle `mermaid`, loaded via **lazy `import()`** so it costs nothing until a
   diagram is shown, themed through `themeVariables` to the `macos-ui.md` tokens. It renders
   **fully offline** — the local-first invariant holds. If rendering fails, the surface degrades
   to the existing text + copy/download, never to a blank pane.
4. **Text remains the interchange format.** Copy/download of `.mmd`/`.md` is unchanged; the
   renderer is strictly additive.
5. **A diagram is never a dead-end picture.** Every rendered artifact carries its scope caption
   and a **"show on canvas"** action that focuses those real nodes (propose→act; reuses ADR-003
   playback), so the artifact and the living system stay one thing.

## Consequences

- `ExportMenu` gains a rendered preview beside the source text; chat answers may return a
  diagram artifact; Phase 2's function flow gains a second representation from the same data.
- Bundle cost is real and must be reported honestly (principle 8): mermaid is lazy-chunked, and
  the measured chunk size goes in the round note rather than an estimate.
- New pure `scopeGraph(graph, nodeIds)` so "diagram of this flow/selection" goes through the
  *same* projections rather than a parallel code path.
- Locking tests: rendered source is byte-identical to the export text (parity, no second
  dialect); AI-supplied diagram text is never rendered; out-of-allow-set scope ids are dropped;
  render failure falls back to text; no network during render.

## Alternatives considered

- **A native SVG renderer in our own tokens** — rejected for v1: it re-implements lifeline and
  flow layout we get free, for a look mermaid can be themed into. Revisit if theming fights the
  design system.
- **Keep text-only export** — rejected: it is the owner's explicit directive to change, and
  unrendered source fails the Legibility floor.
- **Let the model emit mermaid directly (the industry-normal shortcut)** — rejected: it is
  fabrication with a diagram's authority. The projection rule exists precisely to make this
  impossible.
