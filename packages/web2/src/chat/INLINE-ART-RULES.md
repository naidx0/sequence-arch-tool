# Inline art follows the app

Rules for an inline ```svg block (and the drawing blocks of the visual kit) in the chat. They are
given to the model in the canvas craft section (`packages/analyzer/src/server/askPipeline.ts`,
`CANVAS_BLOCK_CRAFT_SECTION`) and enforced as a net by `svgTheme.ts` when the block is drawn. A
drawing must look like part of the app, not a picture from somewhere else.

1. **Font.** Labels use the app font, `var(--font-sans)`; code-like labels `var(--font-mono)`. Never
   name a font family. Unless the user's own project asks for its own fonts (a mockup of their
   product); then put `class="own-fonts"` on the root `<svg>` and say why in the prose.
2. **Colour.** Use the tokens, never a hex: ink `var(--ink-1)` / `var(--ink-2)` / muted
   `var(--ink-3)`; surfaces `var(--surface-1)` / `var(--surface-2)`; lines `var(--edge-strong)`;
   accent `var(--accent)`; status `var(--fits)` (good), `var(--spills)` (warning), `var(--wont)`
   (bad), `var(--info)`. The theme words `accent`, `ink`, `muted`, `surface`, `border`, `success`,
   `warning`, `danger`, `info` are also accepted as `fill` / `stroke` values. One accent at most; the
   rest is ink, surface and edge.
3. **Unset means themed.** A shape with no fill is drawn as a surface with an edge, text with no
   fill as ink, an arrowhead in ink. `black` and `currentColor` become ink; `white` on a shape
   becomes the surface.
4. **Buttons.** If a drawing shows a button, draw a `<rect class="btn">` (soft: surface with an
   edge) or `<rect class="btn primary">` (solid accent, label on the solid). No other button shapes,
   no gradients, no shadows.
5. **Shape.** Corners `rx="8"` for boxes and buttons, `rx="14"` for cards. Strokes 1 to 1.5.
   Text 11 to 14 in a 420-wide viewBox. Nothing below 11.
6. **Not our job.** Do not set a background for the whole drawing; the card supplies it.
7. **Workflow loops.** A loop is not an svg: write a ```workflow fence of JSON,
   `{"name": "...", "steps": [{"id": "plan", "label": "Plan"}], "loop": {"from": "test", "to": "edit", "until": "tests pass"}}`.
   2 to 12 steps; `loop` goes back to the same or an earlier step and `until` is optional. The chat draws the
   steps and the loop-back edge inline, with Run and Open in Workflows. Invalid JSON is shown as the raw block.
