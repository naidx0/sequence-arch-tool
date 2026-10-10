# AI Canvas — native tool contract

**Status:** locked (owner round 5, 2026-08-26). Preview ledger: [`workspace-structure-ledger.html`](workspace-structure-ledger.html).

AI Canvas is **not** freeform stickies or Miro clutter. Every block the model places must go through one of five native writers so rendering stays consistent. Humans pan/zoom and point-to-ask; they do not hand-edit layout.

## Five native writers (closed set)

| Tool | Block type | Typical use | Renderer |
|------|------------|-------------|----------|
| `canvas.write_markdown` | Markdown (`.md`) | Planning, prose, MADR body, fenced code | Typeset MD viewer |
| `canvas.write_mermaid` | Mermaid (`.mmd` or fenced) | Flowcharts, sequences, dependency graphs | Same mermaid pipeline as chat |
| `canvas.write_html` | HTML (`.html`) | Static layouts, comparison grids, annotated screenshots | Sandboxed HTML frame (Graphite tokens) |
| `canvas.write_react` | React (`.tsx`) | Animated charts, step-through demos, bounded widgets | Mounted component preview |
| `canvas.write_svg` | SVG (`.svg`) | Precise vector diagrams when Mermaid is too coarse | Inline SVG viewer (no script) |

Each tool **appends** a typed block to the canvas document. Blocks carry stable ids so the model can reference them in follow-up turns (`update_block` / `replace_block` are operational tools, not format types).

## Explicitly not native block types

| Thing | Where it belongs |
|-------|------------------|
| `.seqd` / architecture graph IR | **Architecture** board (grounded scan) |
| Whiteboard strokes / ink | **Whiteboard** surface |
| Raw JSON, YAML, CSV | Markdown code fence or HTML table — not standalone writers |
| Binary images | Embed in MD/HTML (data URL or repo-relative path) |
| PDF | Export/download path only — not a canvas block |
| LaTeX / math | Markdown renderer extension — not a sixth writer |
| Generic `.ts` / `.py` snippets | Markdown fenced code — not a separate format |

## Why five is enough

- **Markdown** covers prose + code snippets + tables.
- **Mermaid** covers declarative diagrams the model generates often.
- **SVG** covers precise vector art Mermaid cannot express (custom paths, icon layouts).
- **HTML** covers static multi-column layouts and rich static visuals without React overhead.
- **React** covers animation and interactive charts where HTML is insufficient.

Adding a sixth format (e.g. standalone JSON or a “code block” writer) duplicates Markdown without improving render quality. Adding image/PDF writers pushes binary handling into the canvas instead of embed paths.

## Surface boundaries (do not blur)

| Surface | Bond |
|---------|------|
| Architecture | Scan-grounded topology (`.seqd`, ELK layout, import edges) |
| Whiteboard | Human draw / ink |
| AI Canvas | Typed artifact blocks via the five writers above |
| Chat | Streaming text + inline mermaid/diagram artifacts |

Opening `plan.md` or a MADR in the workspace binds AI Canvas to that file's thread; the model writes through the same five tools.

## Implementation checklist (when building)

1. Register the five tools in the analyzer tool schema with strict `content` + optional `title` args.
2. Canvas document model: ordered list of `{ id, type, payload, createdAt }`.
3. One viewer component per type in `packages/web2` — no generic “blob” renderer.
4. Reject unknown block types at ingest (honest error, no silent fallback).
5. Locking tests: each writer produces the expected DOM root (`data-canvas-block="markdown"` etc.).
