# Sequence mark — source of truth

**Monochrome glyph (Decision 26).** Black, white, or `currentColor` only. Never gold on the mark.

| File | Role |
|------|------|
| **`sequence-mark.svg`** | **SoT glyph** — 64 viewBox, `currentColor` (generated) |
| **`sequence-mark-small.svg`** | **SoT small variant** — route 8, node radius 5, same nodes/centres; use at **20px and below** (generated) |
| `sequence-mark-on-light.svg` | Lockup specimen (black on light) |
| `sequence-app-icon.svg` | 1024 app plate — **white squircle + black glyph**, light contact shadow |
| `specimen.html` | Optical sheet |

## For local agents

Copy from **this folder**. Do not invent a new logo.

```bash
# glyph into the marketing site
cp docs/brand/marks/sequence-mark.svg site/public/sequence-mark.svg
# keep BrandMark.tsx path geometry identical to sequence-mark.svg
```

Site chrome: `site/src/components/BrandMark.tsx`  
Desktop: `packages/desktop/build/icon.svg` + `node packages/desktop/scripts/make-icon.mjs`

## Geometry (Decision 28)

- Three nodes = services — 18×18, `rx 3.5`, centred at (14,14) (32,32) (50,50)
- One elbow route = the sequence — 6 wide, rounded ends, right then down
  (the product's own `ElbowEdge` style)
- **Small variant** (Decision 28 addendum, for 20px and below): the SAME
  three 18×18 nodes on the SAME centres, with route **8** and node `rx 5`.
  The node size cannot grow — the centres are 18 apart, so a larger square
  overlaps its neighbour and the mark fuses into one diagonal bar. The
  corner radius is what opens the diagonal gap (0.83·r units of daylight).
- Bounds 5→59 on both axes; 180° rotationally symmetric; one ink
- **Generated**: the numbers live in `packages/desktop/scripts/make-icon.mjs`
  (`VARIANTS`, one table for both variants), which writes the app plate,
  `sequence-mark-small.svg` and every icon frame. Edit the numbers, never
  the SVG by hand.
- Why it changed: the Decision 26 ring read as a gear at taskbar sizes
  (owner, 2026-09-17).

## Sizes (Decision 28 addendum)

| Frame | Drawn how | Variant | Depth |
|-------|-----------|---------|-------|
| 16, 20, 24, 30, 32, 36 | rasterised from the vector at that pixel size | small | none — flat ink on flat white |
| 48 | rasterised from the vector at 48 | full | lit plate + contact shadow |
| 64, 128, 256 | Lanczos from the 1024 master | full | everything |

Below 48px a Lanczos of the shaded master turns a sub-pixel route into a
smear and sub-pixel shadows into a halo. Above it, the shaded master is
exactly right. `tuningFor(size)` in `make-icon.mjs` is the switch.

## Colour law

| Surface | Glyph | Ground |
|---------|-------|--------|
| UI chrome (`BrandMark`) | `--ink` / `currentColor` | — |
| Favicon / app icon plate | `#0B0C0E` glyph | white squircle `#FFFFFF` (Decision 26) |
| Print / light lockup | `#0B0C0E` | light |

Decision 22 gold is for **controls and selection**, not the identity mark.

## Sync

When the SoT changes, copy the path into:

- `site/public/sequence-mark.svg`, `favicon.svg`, `sequence-app-icon.svg`, `logos/sequence.svg`
- `site/public/sequence-mark-small.svg` — **written by the generator**, do not hand-copy
- `site/src/components/BrandMark.tsx` (both `FULL` and `SMALL` rect tables) and the
  title-bar mark in `packages/web2/src/v3/V3Shell.tsx` (the small variant, at 16px)
- `packages/desktop/build/icon.svg` and `build/icon-{16,20,24,30,32,36,48}.png`
- re-run `node packages/desktop/scripts/make-icon.mjs`, then
  `python packages/desktop/scripts/make-ico.py` to repack `build/icon.ico`
