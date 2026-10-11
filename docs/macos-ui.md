# Sequence UI — the macOS design system (canonical, verbatim from the mock)

> ### ⚠ RETIRED — DO NOT BUILD FROM THIS FILE (v2 pivot, 2026-08-20)
>
> **Brand SoT is the frozen Graphite book, `docs/brand/graphite/`**, with the owner rulings in
> `docs/brand/GRAPHITE-DECISIONS.md`. One copy — cite `graphite/`.
>
> This file is the **legacy macOS mock**. Its earlier header named the Console Brand Book v3.1 as
> SoT; Console was retired on 2026-08-19, Ledger v2 before it on 2026-08-18, and both books were
> **deleted from the tree** on 2026-08-20 (they are in git history). **None of the three is canon —
> the only brand book is `docs/brand/graphite/`.**
>
> `packages/web` (and the call sites this header used to name) was **deleted 2026-08-20
> (`20d1424`)**. The file remains only because `packages/export` still cites these token literals
> for SVG rendering. **Never write a new UI surface from this file** — new surfaces use
> `packages/web2` + Graphite.

For the **legacy macOS canvas CSS** that once lived in v1: those tokens explain export/ADR
history. **A new surface never uses them.** New surfaces are built in
`packages/web2` from `docs/brand/graphite/_core.html`.

The mock's CSS is the literal spec. Where a component here lists values, they are copied
from the mock and must match exactly (color, border, radius, padding, font, shadow,
backdrop-filter).

**Layout note (owner override) — RETIRED (v2 pivot).** This describes the v1 `packages/web` shell.
ADR-002 ratified it and asserted "all docs state it this way"; they did not, and the v2 shell is
specified by the Graphite canvas sheets (`docs/brand/graphite/pages/05-the-canvas.html`,
`08-board-density-and-overflow.html`, `11-the-functions-rail.html`) plus §1 of
`docs/research/v2-architecture-and-gaps.md`. Kept because the sides below are load-bearing for the
v1 CSS still in the tree:

the workspace is now mirrored vs. the mock — the
**Assistant is on the LEFT** (with its composer), the canvas is the wide **MIDDLE**, and
the **Files rail + its settings gear are on the RIGHT**. Component *styling* is unchanged;
only the sides are flipped (rail `border-left`, chevron/resize-direction inverted). Where
text below says "left rail" / "right assistant," read it as the mirrored sides.

## Canonical tokens (exact values from the mock `:root`)

```
--win:#1b1b1d;            /* window / solid panel ground        */
--chrome:#232326;         /* titlebar                            */
--rail:#201f22;           /* left rail + right assistant ground  */
--canvas:#191919;         /* board / canvas ground               */
--panel:rgba(255,255,255,.04);   /* frosted panel fill           */
--panel-solid:#2a2a2d;
--elev:#2c2c2f;           /* raised control / active seg         */
--hover:rgba(255,255,255,.06);
--border:#37373a;
--border-soft:#2e2e31;
--text:#f5f5f7;
--muted:#98989d;
--muted-2:#6e6e73;
--accent:#0a84ff;         --accent-soft:rgba(10,132,255,.16);   --accent-ink:#fff;
--svc:#5aa9ff;  --data:#30d158;  --queue:#ffd426;  --grpc:#a78bfa;
--tl-r:#ff5f57; --tl-y:#febc2e;  --tl-g:#28c840;
--note:#f5d67b;
--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","Segoe UI",sans-serif;
--mono:ui-monospace,"SF Mono","JetBrains Mono","Menlo",monospace;
--r-lg:13px; --r-md:9px; --r-sm:7px;   /* + pills use 999px */
```

Edge-line colors (from the mock SVG): HTTP `#4b6e9e`, database `#3f7d5a`, pub/sub
`#9a8330` (dashed), arrowhead `#6a6a70`. Ink-annotation stroke `rgba(255,120,110,.62)`.

## Component specs (match the mock exactly)

- **Titlebar** `.titlebar`: 44px, `linear-gradient(180deg,#262629,var(--chrome))`, bottom
  `1px var(--border-soft)`, grid `1fr auto 1fr`. Left: `.lights` three 12px dots
  (`--tl-r/-y/-g`, gap 8, decorative/aria-hidden). Center: `.title` 13px/590, repo in
  `.dim` muted/510. Right: `.tb-btn` 28×26, radius `--r-sm`, muted, hover `--hover`.
- **Left rail** `.rail`: 208px, `--rail`, right `1px --border-soft`. `.seg` (Files/Graph):
  `rgba(0,0,0,.25)` + `1px --border-soft`, radius 8, pad 2; buttons 12px/560; `.on` =
  `--elev` + `0 1px 2px rgba(0,0,0,.35)`. `.row` 12.5px, pad 5/6, radius 6, hover `--hover`;
  `.active` = `--accent-soft`. File rows `--text`, folders muted.
- **Canvas** `.canvas`: dot grid = `radial-gradient(circle at 1px 1px,
  rgba(255,255,255,.045) 1px, transparent 0) 0 0 / 22px 22px` over `--canvas`.
- **Depth control** `.depth`: frosted `rgba(255,255,255,.05)` + `blur(12px)` +
  `1px --border-soft`, radius 9, pad 3; steps 12.5px/560 pad 5/14 radius 6; `.on` = `--elev`
  + `0 1px 2px rgba(0,0,0,.4)`.
- **Chip** `.chip` (Risks): frosted pill, height 30, radius 999, `1px --border-soft`,
  12.5px/560; 7px status dot; count `.num` muted tabular-nums. **rounded-plus** 30×30 circle,
  frosted, `1px --border-soft`, muted, hover.
- **Node card** `.node`: width 150, radius 11, `linear-gradient(180deg,#2e2e31,#29292c)`,
  `1px --border`, `0 6px 18px -8px rgba(0,0,0,.6)`, pad 10/12. `.nm` 13px/600/ls .1px; `.kd`
  8px dot (svc/data/queue); `.sub` mono 10.5px `--muted-2`. Selected `.sel` = `--accent` ring
  + 4 white `.hnd` corner handles + floating `.ctxbar` (frosted, radius 9, 26×24 cells).
- **Edges**: 1.6px stroke, colored per kind; labels `.elabel` mono 9.5px in near-`--text`
  ink at weight **600** (per the graph-text LAW below — never `--muted`) on a `.epill`
  rounded rect of the canvas color; arrowhead marker `#6a6a70`.
- **Legend** `.legend`: frosted `rgba(30,30,32,.72)` + `blur(14px)` + `1px --border-soft`,
  radius 10, bottom-right; 9px swatches / 14×2 line samples.
- **Assistant** `.assist`: 340px, `--rail`, left `1px --border-soft`. `.a-head` 48px; title
  13px/600 + 22px `--accent-soft` glyph. `.model` pill height 28 pad 0/9 frosted radius 8
  12px/540. `.a-plus` 28×28 radius 8. User bubble `.msg-user` = `--accent`/white, radius
  `15 15 4 15`. Findings `.finding` divided by `1px --border-soft`; label pill `.fic`
  (CRITICAL red `rgba(255,95,87,.14)`/`--tl-r`, FIX blue `--accent-soft`/`--accent`); `.ftitle`
  13px, `.fdetail` 12px muted. `.action` frosted chips radius 8, hover border `--accent`.
- **Composer** `.composer-box`: frosted `rgba(255,255,255,.05)` + `blur(14px)` +
  `1px --border`, radius 22, pad 6/6/6/15; `.send` 30×30 circle `--accent`/white.
- **Sticky note** `.note`: `--note` gradient, radius `4 10 6 8`, slight rotate, `--mono`-free.
- **Icons**: thin single-stroke line icons (feather/lucide style, `stroke-width` 1.7–1.9,
  no fill), currentColor. Match the mock's SVG paths for shared glyphs (share, panel,
  plus, send-arrow, caret, file, wrench, alert-triangle, network/diamond, trash, link).

## Laws (non-negotiable, apply everywhere)

- **Graph text is always bold and legible.** Every piece of text ON the architecture
  graph — node names, edge-label pills, sticky/board notes, legend entries — renders at
  weight **600+** (labels 600–700), in near-`--text` ink. Never thin, never gray-on-gray.
  Edge-label pills are `--mono`, size to their content (`width:fit-content`, `white-space:
  nowrap`, ~3px 8px padding, text centred on both axes), and NEVER clip: a long combined
  label steps the font down (e.g. 10.5px → 9.5px) rather than touching the pill edge.
- **Icons over words for severity/status.** Assistant findings and similar status markers
  lead with a small rounded icon square (24×24, radius 7), NOT a word pill. Critical = red
  alert-triangle (`--tl-r` on `rgba(255,95,87,.14)`), fix = blue wrench (`--accent` on
  `--accent-soft`), data = green network glyph (`--data`). The WORD ("Critical", "Suggested
  fix", "Data access") lives in the icon's `title`/`aria-label` tooltip — never rendered as
  a text label.

## Owner-referenced patterns (same tokens — structure adopted, palette NOT)

These two references define STRUCTURE for existing surfaces. Both render in the canonical
dark tokens above — never the references' own palettes.

- **Task Board agent cards** (ref: tldraw agent board, `scratchpad/REF-tldraw-board.jpeg`).
  Card anatomy on the tldraw Task Board: rounded card (radius 11, node-card gradient +
  border), task title 13px/600 top-left, a small circular AGENT BADGE (22-24px ring,
  agent-initial glyph, kind-colored ring), and ONE honest status affordance — ✓ done
  (muted check, top-right) · "Running" (quiet label + subtle live tint) · a "Run" /
  "View PR" mini-button (frosted chip, radius 7) — states map 1:1 to the real task
  lifecycle, never decorative. Arrows between cards: 1.6px, `#6a6a70` heads, no clutter.
  Card size presets S/M/L (if offered) are structural, not new styles.
- **Sunken sectioned rail** (ref: Local Studio sidebar, `scratchpad/REF-sidebar-localstudio.jpeg`).
  The left rail reads sunken and quiet: `--rail` ground, SECTION groups with 11px/600
  uppercase-free muted headers (e.g. Files / Graph areas, future: Tasks, Projects), rows
  12.5px with tiny muted 15-16px line icons, exactly one active row highlighted
  (`--accent-soft` pill), generous 8-10px section gaps, and a pinned FOOTER row
  (account/avatar + settings gear, hairline top border). Nothing loud; icons never
  brighter than their labels.

## Rule for all future work
New tab, new panel, new setting → compose from the tokens + component patterns above.
Never add a color, radius, font, shadow, or icon style that isn't in this document.
