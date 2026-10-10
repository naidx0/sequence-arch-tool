# Bastion site audit, against Sequence's tokens

Report only: nothing in Sequence was changed for it. 2026-10-05.

**Sources.**

- Live pages: `https://usebastion.io/` (redirects to `www.usebastion.io`) and `/design`. Each was read with playwright-core (headless Chromium), light and dark through `prefers-color-scheme`, at 1440x900 and 390x844. Each page was loaded once and nothing on it was clicked or submitted. The screenshots are in [`bastion/`](bastion/).
- Computed styles of the live elements were read on the same visit. They match the source values below; for example, the live `.lab-btn` measured 42 px tall, radius 10, `blur(12px) saturate(1.2)`.
- Bastion source: `C:/Users/<user>/Projects/premai` (naidx0/premai), read only. Paths below are relative to that repo.
- Sequence source: `packages/web2/src/tokens/graphite.css`, `docs/brand/graphite/_core.html`, and the CSS that applies them.

**Which Bastion styles the live pages use.**

- The home page is the "lab" shell: `app/(lab)/layout.tsx` and `app/(lab)/lab.css`.
- `/design` is the Ramp Kit: one generated HTML document. `app/(legacy)/design/html.ts` holds it as a one-line string. In the tables, `design.html:N` means line N of that string once it is decoded.
- `app/globals.css` (shadcn tokens, Inter/Syne) serves only the older pages. It is cited only where the lab inherits from it.

**Which Sequence styles ship.**

- Sequence ships dark with the blue accent by default: `packages/web2/index.html:103-118` sets `data-accent="blue"`.
- The blue block (`graphite.css:1245-1351`) overrides the dark base, and the comparison below uses it.
- The blue block is dark-only (`:not([data-theme="light"])`). In light mode Sequence's accent is still the gold one at `graphite.css:114`.

Screenshots:

| page | light | dark |
|---|---|---|
| home 1440x900 | [home-light-1440x900.png](bastion/home-light-1440x900.png) | [home-dark-1440x900.png](bastion/home-dark-1440x900.png) |
| home 390x844 | [home-light-390x844.png](bastion/home-light-390x844.png) | [home-dark-390x844.png](bastion/home-dark-390x844.png) |
| /design 1440x900 | [design-light-1440x900.png](bastion/design-light-1440x900.png) | [design-dark-1440x900.png](bastion/design-dark-1440x900.png) |
| /design 390x844 | [design-light-390x844.png](bastion/design-light-390x844.png) | [design-dark-390x844.png](bastion/design-dark-390x844.png) |

## Mismatch table

"Bastion" is the lab shell (home) unless the row says /design. A row is listed only where the two differ, or where they agree in a way worth knowing.

### Type

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| UI / display face | Archivo (variable, `wdth` axis), weights 350 and 450 | Inter (`--font-sans`, `--font-ui`, `--font-display`) | `app/layout.tsx:24-29`, `app/(lab)/lab.css:5` | `graphite.css:214, 216, 232` |
| UI face, /design | Instrument Sans | brand book says Instrument Sans; the app token says Inter (internal mismatch in Sequence) | `design.html:38` | `docs/brand/graphite/_core.html:239`; `graphite.css:214` |
| mono face | JetBrains Mono | JetBrains Mono (same) | `app/(lab)/lab.css:6` | `graphite.css:215` |
| body size | 17px / 1.55 (home); 14px / 1.5 (/design) | `--t-13` 13px / `--lh-13` 18px | `app/(lab)/lab.css:19-20`; `design.html:62` | `styles/base.css:34-35`, `graphite.css:245` |
| h1 | `clamp(2.5rem, 5.2vw, 4.6rem)`, weight 350, tracking -0.04em, line-height 1.04 (73.6px live at 1440) | largest rung `--t-26` 26px / 30px, no display rung | `app/(lab)/lab.css:47-56` | `graphite.css:250` |
| h2 | `clamp(1.75rem, 3vw, 2.6rem)`, weight 350, tracking -0.03em | `--t-20` 20px / 26px | `app/(lab)/lab.css:57` | `graphite.css:249` |
| h3 | `clamp(1.1rem, 1.5vw, 1.3rem)`, weight 450, tracking -0.015em, line-height 1.2 | `--t-17` 17px / 22px | `app/(lab)/lab.css:58` | `graphite.css:248` |
| lede | `clamp(1rem, 1.25vw, 1.15rem)`, weight 350, line-height 1.6, `max-width: 46ch`, ink at 60% | `--t-15` 15px / 23px, `--ink-2` | `app/(lab)/lab.css:59` | `graphite.css:247` |
| eyebrow | mono 11px, tracking 0.16em, uppercase, 6px accent dot before | `--t-11` 11px / 15px, mono only for numbers | `app/(lab)/lab.css:61-71` | `graphite.css:243` |
| button label | 14.5px, weight 450, tracking -0.005em | `--t-11` (composer rail) or `--t-12`, weight `--fw-label` 500 | `app/(lab)/lab.css:89-91` | `chat/chat.css:1170-1171`, `graphite.css:274` |
| weights in use | 350 / 400 / 450 | 400 / 500 / 600 / 700 | `app/(lab)/lab.css:51, 58, 89` | `graphite.css:274` |
| letter-spacing on headings | negative, -0.015 to -0.04em | none set | `app/(lab)/lab.css:52, 56, 58` | `graphite.css:242-250` (no tracking token) |

### Spacing and size

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| spacing scale | Tailwind 4px steps, used large: section `py-32` / `sm:py-48` (128 / 192px), columns `gap-16` / `lg:gap-28` (64 / 112px), heading to lede `mt-6` (24px), lede to buttons `mt-10` (40px) | `--sp-2` … `--sp-56`, largest step 56px | `app/(lab)/page.tsx:72, 81-82, 85-86` | `graphite.css:299-300` |
| page gutter | `.lab-wrap` max 1240px, 20px gutter, 40px from 768px | panes fill the window; content column `--col-max` 960 | `app/(lab)/lab.css:117-118` | `graphite.css:351` |
| header | 64px (`h-16`), no rule; the page fades under a 10px blur | shell top bar and tab strip; board toolbar 36px (`--control-h-door`) | `components/lab/nav.tsx:44-59` | `graphite.css:392` |
| main button height | 42px, padding 0 18px, gap 10px | `--control-h` 28px, `--control-h-lg` 32px, `--control-h-door` 36px | `app/(lab)/lab.css:79-81` | `graphite.css:373, 381, 392` |
| small button (nav Contact) | 36px (`h-9`), padding 0 16px | `--control-h-door` 36px (same height) | `components/lab/nav.tsx:80` | `graphite.css:392` |

### Radii

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| button | 10px | `--r-10`, which the blue variant cuts to 8px | `app/(lab)/lab.css:82` | `graphite.css:318, 1333` |
| glass panel | 22px | `--r-18`, cut to 12px by the blue variant; the largest radius in use | `app/(lab)/lab.css:143` | `graphite.css:318, 1333` |
| base radius (old pages) | `--radius` 8px | `--r-8` 8px, 6px under blue | `app/globals.css:42` | `graphite.css:318, 1333` |
| pills | `rounded-full` (Latest chip, /design toggles 999px) | `--r-full` 999px (same) | `app/(lab)/page.tsx:61`; `design.html` toggles | `graphite.css:319` |

### Colour

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| ground, light | `--lab-bg` #f3f4f6, `--lab-bg-2` #e8eaee | `--bg-base` #F6F6F7, `--bg-ground` #EFEFF0 | `app/(lab)/lab.css:7-8` | `graphite.css:96` |
| ground, dark | `--lab-bg` #0b0d12 (blue-black), `--lab-bg-2` #151923 | blue variant `--bg-base` #1D1D1C (warm grey); base dark #181A20 | `app/(lab)/lab.css:25-26` | `graphite.css:1247, 777` |
| top ink | light #0b0c0e, dark #eef1f6 | light `--ink-1` #131315, dark (blue) #FFFFFF | `app/(lab)/lab.css:9, 27` | `graphite.css:102, 1251` |
| second ink | ink at 60% alpha (light), `rgba(226,232,245,.66)` (dark) | solid steps: `--ink-2` #4C4D53 light, #E1E1E0 dark; four steps, not alpha | `app/(lab)/lab.css:10, 28` | `graphite.css:102, 1251` |
| line | ink at 13% (light), `rgba(200,212,240,.13)` (dark) | `--edge` `rgba(19,19,21,.11)` light, `rgba(255,255,255,.10)` dark | `app/(lab)/lab.css:11, 29` | `graphite.css:99, 1250` |
| accent, light | #1f4fe0 (blue) | gold #C9A227 (blue applies in dark only) | `app/(lab)/lab.css:12` | `graphite.css:114` |
| accent, dark | #6b91ff | #4C7DFF, solid #1F55F1 | `app/(lab)/lab.css:30` | `graphite.css:1255-1256` |
| accent, /design (Graphite theme) | #4F45C9 light, #8E8AF2 dark (indigo) | as above | `design.html:37` | `graphite.css:114, 1255` |
| good / bad | #15803d / #c2362b light; #5ee08f / #ef6b61 dark | `--fits` #0C7B53 / `--wont` #C2352F light; #74D6A4 / #F47C7C dark | `app/(lab)/lab.css:13-14, 31-32` | `graphite.css:144, 903` |
| verdict colours, /design | `--fits` #0C7B53, `--spills` #8F5A00, `--wont` #C2352F (identical to Sequence light) | same | `design.html:37` | `graphite.css:144` |
| selection | accent fill, white text | `--selection-bg` `rgba(31,85,241,.38)` | `app/(lab)/lab.css:44` | `graphite.css:1269` |

### Glass and transparent buttons

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| button fill | ink at 4% (`color-mix(in oklab, var(--lab-ink) 4%, transparent)`), in both themes | `--glass-ctl` `rgba(255,255,255,.10)` (blue dark): white at a fixed alpha, not the ink | `app/(lab)/lab.css:84` | `graphite.css:1290`; used at `chat/chat.css:1164` |
| button rim | 1px, ink at 16% | 1px (`--w-hair`), `--glass-ctl-edge` `rgba(255,255,255,.10)` | `app/(lab)/lab.css:83` | `graphite.css:1295, 1360` |
| button inset highlight | none | `--glass-ctl-hi` `rgba(255,255,255,0)`: none under blue | none | `graphite.css:1292` |
| button blur / saturate | `blur(12px) saturate(1.2)` | `blur(var(--glass-ctl-blur))` 22px, `saturate(var(--glass-ctl-sat))` 1.8 | `app/(lab)/lab.css:85-86` | `graphite.css:1306, 961`; `chat/chat.css:1165-1166` |
| button hover | fill to 10%, rim to 28%, 0.2s ease, arrow nudges 2px right; a 90px radial light follows the pointer (ink at 14%) | lift 1px (`translateY(-1px)`), `--glass-ctl-hover` .14, 110ms | `app/(lab)/lab.css:96-100, 159-173`; `components/lab/pointer-light.tsx:7-31` | `graphite.css:2014-2023, 1291, 418` |
| button press | none beyond hover | `translateY(0) scale(.97)` | none | `graphite.css:2027-2037` |
| focus ring | 2px accent ring (`box-shadow`) | `outline`/ring in `--accent` | `app/(lab)/lab.css:98` | various (`--accent`) |
| glass panel fill | ink at 3.5% (light); dark is a vertical gradient, ink 6% to 2.5% | board card: kind tone at 34% (`color-mix`), pane `--glass-pane-fill` `rgba(255,255,255,.036)` | `app/(lab)/lab.css:141, 152` | `canvas/board.css:298`; `graphite.css:1288` |
| glass panel rim | ink at 8% (light), 11% (dark) | `--edge` / `--glass-rim` `rgba(255,255,255,.10)` | `app/(lab)/lab.css:142, 153` | `graphite.css:1250, 1294` |
| glass panel inset highlight | dark only: `inset 0 1px 0` ink at 8% | `--glass-inset` `inset 0 0 0 .5px rgba(255,255,255,.06)` (an all-round half-pixel line, not a top highlight) | `app/(lab)/lab.css:154` | `graphite.css:1296` |
| glass panel blur / saturate | `blur(14px) saturate(1.2)` | `--glass-blur-pane` 28px, saturate 1.8 | `app/(lab)/lab.css:144-145` | `graphite.css:1303`; `canvas/board.css:302-303` |
| shadow on glass | none | `--e2` `0 2px 8px rgba(0,0,0,.28)` on floating panels | none | `graphite.css:1281` |

### Icons

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| icon set (site) | hand-drawn inline SVG: a 14x10 arrow and a 10x10 external mark, at 0.7 opacity inside buttons | own 24-grid set (the brand book's `ic-*`), `stroke: currentColor` | `components/lab/primitives.tsx:61-75`; `app/(lab)/lab.css:99` | `canvas/BoardIcon.tsx:7`; `chat/Icon.tsx` |
| stroke width | 1.4 on the site; lucide at 1.6 in the console rail; the /design Graphite theme uses "Lucide, round" (lucide default 2) | 1.5 on the book grid, raised to 1.9 for glyphs drawn at 12px and below | `components/lab/primitives.tsx:64, 72`; `components/lab/console/rail.tsx:35`; `design.html:469` | `canvas/BoardIcon.tsx:7`; `chat/Icon.tsx:396, 450` |
| line caps | lucide round caps; site arrows default (butt) | round (book set) | `design.html:307` | `chat/Icon.tsx` |

### ASCII and loader

| token | Bastion value | Sequence value | Bastion file:line | Sequence file:line |
|---|---|---|---|---|
| ASCII rendering | canvas, JetBrains Mono at 7 to 9.5px, a ten-step ramp `" .,:-=+*#%@"`, three tones (ink at 0.32, ink at 0.9, accent at 1.0), 20 to 24 fps, paused offscreen (IntersectionObserver), drawn once and held still under reduced motion | none: no ASCII surface | `components/lab/ascii3d.tsx:11, 88-89, 96-108, 110-139, 157, 230` | none |
| hero ASCII | photo sampled into 7px cells, the ramp `" .,:;-=+*#%@"`, laid over the photo at 0.55 strength (0.9 dark) | none | `components/lab/ascii-photo.tsx:12, 20-21, 36`; `components/lab/hero-photo.tsx:3-10` | none |
| loader, /design | text loaders: braille (10 frames, 80ms) by default for Graphite; also grid, rise, arc | ring: 12px, `--w-flow` 1.5px in `--edge-strong`, top quarter `--accent`, 1s linear; the braille frames are still declared but unused | `design.html:462, 469` | `chat/chat.css:333-370` |
| motion easing | `cubic-bezier(0.16, 1, 0.3, 1)` over 0.8s for enter; 0.2 to 0.3s ease for hover | `--dur-1` 110ms, `--dur-2` 170ms, `--ease` `cubic-bezier(.2,.7,.3,1)` | `app/(lab)/lab.css:122` | `graphite.css:418` |

## What the owner likes, and how Sequence could adopt it in CSS only

Each change below stays inside `graphite.css` and the surface sheets: token values and rules, no component or markup change. None of them was made; each is an owner decision.

### 1. Glass and transparent buttons

**What makes Bastion's work.**

- The fill is the page's own ink at a few per cent (4%, 10% on hover), not white at a fixed alpha. That is why the same rule reads right on light and on dark.
- The rim is the same ink at 16%, rising to 28% on hover.
- Blur and saturate are mild (12px, 1.2), and there is no inset highlight.
- The 42px button has room around its label.

**Sequence today.**

- `--glass-ctl` is white at .10 with a 22px blur and saturate 1.8.
- In light mode the same token is white on a near-white ground, which is why light controls lean on `--edge`.

**CSS-only adoption.**

- Define the control fill from the ink: `--glass-ctl: color-mix(in oklab, var(--ink-1) 4%, transparent)`, `--glass-ctl-hover: … 10%`, `--glass-ctl-edge: … 16%`, and a hover rim at 28%. Define them once in the base `:root`, so light and dark both follow from `--ink-1`.
- Lower `--glass-ctl-blur` to 12px and `--glass-ctl-sat` to 1.2.
- Keep `--glass-ctl-hi` at 0 (already so under blue).
- The pointer light needs a pointer position, so it is not CSS-only. A hover-only static radial in `::after` gets most of it without JS.

**Risk.** The contrast tests in `src/boot/contrast.test.tsx` and `src/tokens/graphite.test.ts` read these tokens. A lighter fill under `--ink-2` labels needs those tests re-run.

### 2. Spacing

**What makes Bastion's work.** The space is generous: 128 to 192px between sections, 64 to 112px between columns, 24px from heading to lede and 40px from lede to buttons, all inside a 1240px column.

**Sequence's case is different.**

- Sequence is a dense tool: three panes, a 13px body, a 4px-step scale up to 56px.
- The part of Bastion that carries over is the ratio: about three times the line height between groups, and a capped measure (`max-width: 46ch` on ledes).

**CSS-only adoption.**

- Add larger steps to the scale (`--sp-64`, `--sp-96`) for the empty states, onboarding, Settings and the Files reader.
- Cap prose at `46ch` to `60ch` (`.chat-scope` answers already cap at `--col-max`).
- Give the empty and boot surfaces the 24 / 40 rhythm.
- Leave the board, rails and toolbars on the dense scale.

### 3. The clean font

**What makes Bastion's work.**

- The home page uses Archivo at weights 350 and 450, with negative tracking on headings (-0.015 to -0.04em) and no bold.
- /design uses Instrument Sans at 14px, which is the brand book's face.

**Sequence today.** The tokens say Inter. The brand book (`_core.html:239`) and `styles/base.css:18-20` say the body must start with Instrument Sans. That is a mismatch inside Sequence, worth settling first.

**CSS-only adoption.**

- Point `--font-sans` and `--font-ui` at the chosen face: Instrument Sans per the book, or Archivo to match the site. Load it with `@font-face`, which is a stylesheet change.
- Add a tracking token (`--tr-head: -0.02em`) on `--t-17` and above.
- Allow a 450 weight (`--fw-label: 450`) where the face has a variable axis.
- Keep JetBrains Mono, which both already share.

### 4. The restrained ASCII

**What makes Bastion's work.** Three tones only (faint ink, ink, accent), small mono type (7 to 9.5px), 20 to 24 fps, paused offscreen, and still under reduced motion. It sits behind the content and never carries a label.

**Sequence today.** No ASCII surface. Its loader is a ring, and the braille frames are declared but unused (`chat/chat.css:358-369`).

**CSS-only adoption.**

- **Loader:** bring back the braille frames as the loader glyph in `--font-mono` at `--t-11`, coloured `--ink-3` with the accent on the active frame. The keyframes already exist (`@keyframes spin-braille`); the rule needs `content` on `::after` and the ring border removed. Reduced motion holds one frame.
- **Backgrounds:** a static ASCII texture, such as an empty board or the boot surface, can be a CSS `background-image` holding an SVG `<text>` pattern in mono, at `--ink-4` with low alpha. Moving ASCII (the 3D scenes) needs a canvas, which is not CSS-only.

### 5. Clean icons

**What makes Bastion's work.** One thin stroke (1.4 to 1.6) with round caps, at 0.7 opacity inside a button, nudged 2px on hover. Very few icons: an arrow and an external mark on the site.

**Sequence today.** Its own book set at 1.5, raised to 1.9 under 12px.

**CSS-only adoption.**

- Set `stroke-width: 1.5` everywhere above 12px (already the book's weight), and `opacity: .7` on icons inside buttons, rising to 1 on hover.
- Add `transition: transform` and a 2px `translateX` on hover for forward arrows.
- Reduce icons in labelled buttons (an icon beside a word is often redundant), which is a markup decision, not CSS.

## Settle first (owner)

1. **Which face Sequence uses.** Inter (current tokens), Instrument Sans (brand book, /design), or Archivo (site).
2. **The light accent.** Sequence light is gold (`graphite.css:114`), and the blue is dark-only. The site and the /design kit are blue or indigo in both modes.
3. **The dark ground.** Bastion dark is blue-black #0b0d12; Sequence blue is warm grey #1D1D1C.
