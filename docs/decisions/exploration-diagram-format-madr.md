# MADR — SeqDiagram format (exploration → build)

- **Status:** Proposed (2026-08-04)
- **Exploration:** [`docs/research/sequence-diagram-format-exploration.md`](../research/sequence-diagram-format-exploration.md)
- **Plan:** [`docs/research/sequence-diagram-format-plan.md`](../research/sequence-diagram-format-plan.md)
- **Related:** `docs/adr-diagram-output-plan.md` · `docs/madr-breakout-plan.md` · `docs/brand/README.md` (Structural Engineering)

## Context

Chat should be synonymous with a grounded diagram format — foldable, token-efficient, brand-styled on export. Today: Mermaid fences (partial), macOS SVG (off-brand), three non-unified dialects (export Mermaid, arch markdown, program Mermaid). Owner settled Structural Engineering brand (steel + signal orange `#F25C05`) for all design deliverables.

## Decision drivers

- Grounded ids must trace to `ArchGraph` — never LLM-invented topology in UI
- Mermaid stays as interoperability; not primary renderer or source of truth
- MADR pop-up shape (`whatItIs` / `whatItDoes` / interior diagram) needs structured slots
- Token cost + foldability favor JSON IR with optional markdown envelope

## Considered options

1. **Mermaid + comment extensions** — low build cost; poor ids, foldability, brand fidelity
2. **JSON IR (SeqDiagram v1) → Structural SVG + Mermaid projection** — recommended
3. **Custom DSL** — deferred; parser cost without clear win over JSON

## Decision

**Adopt SeqDiagram v1** — JSON intermediate representation with:

- `kind` enum for flow-type detection (`service-sequence`, `breakout-interior`, …)
- `grounded` block linking to `ArchGraph` scope
- `detail` slots for MADR breakout content
- `projections.mermaid` as derived, non-authoritative view
- `theme: structural` for brand SVG export

File convention (pending owner sign-off): `.sequence/diagrams/<slug>.seqd.json`

## Consequences

### Positive

- Single projector pipeline from `ArchGraph` (extends `diagramModel.ts`)
- Chat chip can render Structural SVG with honest caps
- Breakout pop-up data model unified with export

### Negative

- New schema maintenance; LLM emit requires strict validation
- Two render paths (SVG + Mermaid fallback) until Mermaid path optionally demoted

## Compliance

- Edge hues remain meaning-locked (never signal orange)
- Restraint rule: no Structural metaphor in product nouns
- UI cold-start work stays on `mxcr/cold-start-simplify-4b6c`

## Owner sign-off required before

- Diagram-first chat default for architecture scope
- Canonical file extension / `.sequence/diagrams/` auto-commit hook
- Export menu default tab switch to Structural SVG
