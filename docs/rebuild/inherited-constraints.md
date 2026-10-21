# Inherited constraints

> **`packages/web` was DELETED on 2026-08-20.** This document did its job: it carried the hard-won
> "why" out of v1 so that v1 could be removed without losing it. Every headline constraint below
> now names **where it lives in v2**, with the v1 path kept only as the origin of the quote.
> `tools/ci/inherited-constraints.test.mjs` resolves the v2 citation against real source, so a
> green run means the constraint SURVIVED THE REBUILD — not merely that a file still exists.

**Wave 0, item 0.2.** [`PIVOT-V2.md`](../PIVOT-V2.md) deletes the v1 surface outright and forbids
citing it as precedent. [The plan](../research/v2-architecture-and-gaps.md) §7-R8 names the cost of
doing that naively:

> **Hard-won knowledge lives in comments a rewrite is licensed to delete.** … A v2 PR "cleans up" a
> constant with no comment.

`packages/web/src/product/` carries **1,406 comment lines across 24,788 non-test lines**. Most
restate the code. The ones below do not: each records a **constraint**, a **measurement**, an
**incident**, or a **decision with a reason**. They are transcribed here verbatim, each with its
original `file:line`, so that when the file is deleted the reason survives it.

**Read this as evidence, not precedent.** Nothing here licenses a v2 file to copy a layout, a class
name, a colour or an output format from v1 — that is exactly what the pivot forbids. What carries
forward is *why a number is that number* and *what breaks if you change it*. A constraint is a fact
about the renderer, the scan or a measurement; it is **not a design**. Where an entry names a v1
class or stylesheet, it names it as the place a defect lived, not as a thing to reproduce.

**The six the plan names by hand** — §4.5's two "must not be cleaned up" plus its one "decision to
carry", and §7-R8's list — are marked ★ and are locked by
`tools/ci/inherited-constraints.test.mjs`.

Sources walked: `packages/web/src/product/arch/`, `packages/web/src/graph/`,
`packages/web/src/canvas/fit.ts`, `packages/web/src/canvas/edgeStyle.ts`,
`packages/web/src/main.tsx`, plus `packages/analyzer/src/explain/explain.ts` for R8's sixth item.

---

## 1. The renderer's own rules — @xyflow/react 12.11.2

### ★ 1.1 The eight inert `<Handle>` elements cannot be deleted

**Carried to `packages/web2/src/canvas/NodeCard.tsx:274-286`.**

> v2 says it in its own words: "before the custom edge ever mounts when there is no handle to
> measure. Delete these eight and every edge on the board disappears." (v1 origin, now deleted:
`packages/web/src/product/arch/ArchNodeCard.tsx:115-164`) (the elements themselves are at `:179-182`
and `:240-243`):

> ── CONNECTION HANDLES — sheet 02 §02.6, and why they are still in the DOM ──
> The book's rule is absolute: "When the graph is not connectable, the card renders zero connection
> handles — not transparent ones, not zero-opacity ones, not ones behind a hover rule. None in the
> markup at all."
>
> Sequence cannot obey the letter of it, and this is the evidence rather than a preference.
> @xyflow/react 12.11.2 derives every edge endpoint from handle bounds that are MEASURED OFF THE
> DOM, and drops any edge it cannot place:
>
> ```
>   @xyflow/system getHandleBounds  (dist/esm/index.js:884)
>     nodeElement.querySelectorAll('.source' | '.target') → null when empty
>   @xyflow/system getEdgePosition  (dist/esm/index.js:1392)
>     !sourceHandle || !targetHandle → onError('008') → return null
>   @xyflow/react  EdgeWrapper      (dist/esm/index.js:2957)
>     sourceX === null → return null    ← the edge is never rendered
> ```
>
> Delete the eight elements and EVERY EDGE ON THE BOARD DISAPPEARS. That is not a routing wobble to
> be tuned around: ArchElbowEdge computes its own polyline from node boxes and never reads
> sourceX/sourceY, but it is never reached, because EdgeWrapper bails before it mounts the
> component. So the handles stay and are made inert instead … which is the whole of what a card can
> do without moving handle geometry onto the node model (`node.handles`, parsed by parseHandles at
> @xyflow/system:1584 without touching the DOM — that is archNodeModel's call to make, not this
> component's).
>
> Inert, in two layers that do not depend on each other:
> **PAINT** — `.arch-rf-handle { visibility: hidden }`: "every pixel gone, layout box PRESERVED.
> `display:none` would zero all eight rects and collapse every edge to the node's top-left corner,
> which is the same defect by another route."
> **BEHAVIOUR** — `isConnectable` / `isConnectableStart` / `isConnectableEnd`: "`<Handle>` defaults
> ALL THREE to `true` and never reads the store's `nodesConnectable` (HandleComponent, react
> dist/esm/index.js:1846), so with ArchCanvasBoard's `nodesConnectable={false}` the eight nubs were
> still live connection starters — onPointerDown gates on isConnectableStart alone (index.js:1874)
> — and were inert only because a `visibility: hidden` element takes no pointer events. One
> `visibility` regression away from a board that drags connection lines it will never accept."

**The escape route, if v2 wants clean markup:** move handle geometry onto `node.handles` so
`parseHandles` reads it without the DOM. §4.5 records that as unstarted.

### 1.2 An edge's class list must reach the `<path>`, not the wrapping `<g>`

`packages/web/src/product/arch/archNodeModel.ts:34-43`:

> This MUST be handed to the `<path>` itself (BaseEdge `className`), not only to the edge model:
> @xyflow's EdgeWrapper puts `edge.className` on the wrapping `<g>` and never forwards it to the
> custom edge, while `.arch-rf-edge` declares an explicit `stroke` on the path. An inherited stroke
> from an ancestor `<g>` can never beat an explicit declaration on the descendant, so a proof state
> that only reaches the `<g>` is a silent no-op (flow playback shipped that way). One pure function,
> two call sites, so the two can never drift again.

Same fact restated at the render site, `packages/web/src/product/arch/ArchCanvasBoard.tsx:121-124`,
and carried on `data` rather than `className` at `archNodeModel.ts:217-218`: "Carried on data
because RF hands data (not className) to the custom edge."

### 1.3 Only a render test could have caught it

`packages/web/src/product/arch/ArchCanvasBoard.tsx:89-93`:

> Exported ONLY so a test can render the real component. The bug this guards was invisible to every
> source- and CSS-level check: the class list has to reach the `<path>`, and the only honest way to
> know is to render it.

This is §4.6's Tier-2 argument written in the tree three days before the plan made it a rule.

### 1.4 The card hit region is hardcoded and wrong

`packages/web/src/product/arch/archNodeModel.ts:228`:

> RF card rects for Architecture draw hit-testing (160×96, not SeqDiagram layout).

§3.7 measures the cost: read off `measured.height` instead — the fixed 96 is over-tall by up to
58px on a one-line card.

### 1.5 React Flow's `colorMode` stays theme-derived — a dark literal is the r93/r96 defect

`packages/web/src/product/arch/ArchCanvasBoard.tsx:604-618`:

> STAYS theme-derived. The W1 brief asked for a hardcoded dark literal here on the grounds that
> React Flow was shipping its light chrome; the rendered board says otherwise, twice over. Measured
> in Chrome at 1280x800 on the real board: with the shell's default theme the root already carries
> data-theme="dark" and this element already computes `class="react-flow dark"`, so a literal buys
> nothing. Flip the shell to light and the whole board follows the token layer honestly — root
> rgb(246,246,247), card rgb(255,255,255), zoom cluster rgb(251,251,252), button ink rgb(76,77,83)
> — and React Flow's own un-overridden defaults follow with it
> (--xy-edge-stroke-selected-default #555). Pinning the library to dark under that is exactly the
> r93/r96 "cream theme, black board" defect this hook was written to end: the selected-edge stroke
> would jump to #f8f8f8 on a #f6f6f7 ground.

### 1.6 A dead store subscription re-renders the whole board on every rename keystroke

`packages/web/src/product/arch/ArchCanvasBoard.tsx:252` subscribes `activeNameDraftId` and never
reads it. §3.4 makes dropping it an item; recording it here so v2 does not re-introduce the pattern.

---

## 2. Off-thread layout — elkjs in a Worker

### ★ 2.1 `self.document` must be stubbed *before* elkjs loads

**Carried to `packages/web2/src/canvas/elkWorkerStub.test.ts:10-22`.** (v1 origin, now
deleted: `packages/web/src/graph/elk.worker.ts:1-11`):

> elkjs's bundled build embeds its own algorithm "worker" module, which self-detects a Worker-like
> environment via `typeof document === 'undefined' && typeof self !== 'undefined'` and hijacks
> `self.onmessage` to turn itself into a standalone worker entrypoint. Since this file already *is*
> a Worker, that self-check misfires and elkjs fails to construct (`_Worker is not a constructor`).
> Stubbing `document` makes elkjs take its normal same-thread code path instead, which is what we
> want since layout already runs off the main thread inside this worker. Static `import`
> declarations are hoisted and evaluate before any of this module's own statements, so the stub has
> to be set before elkjs is loaded via a dynamic `import()`.

Two constraints in one, and the second is the easy one to lose: the stub is line 11, and elkjs is a
**dynamic** `import()` on line 13 *precisely because* a static import would hoist above the stub.
Converting that line to a static import re-breaks the worker.

### 2.2 An ELK failure must not blank the app

`packages/web/src/graph/layout.ts:402`:

> ELK failure must not blank the app — fall back to a simple grid

Same rule stated on the arch surface at `packages/web/src/product/arch/archLayout.ts:130`: "Lay out
diagram nodes. Falls back to a readable grid on ELK failure."

### 2.3 Lane wrapping is `sqrt(count)` folded with the card's pitch ratio, not raw `sqrt`

`packages/web/src/graph/layout.ts:260-277`:

> A big lane (the "No calls detected" bucket on a library-shaped monorepo can hold most of the
> board) would otherwise grow in ONE direction without bound — tall enough to run off the bottom on
> a real repo while every other lane sits mostly empty and the board's width goes unused.
>
> Card-count sqrt alone is not enough here: a card is much WIDER than it is tall (a ~354px column
> pitch against a ~130-170px row pitch), so wrapping by raw `sqrt(count)` columns produces a block
> many times wider than it is tall — trading the "too tall" problem for a "too wide, still short"
> one. Folding the pitch ratio in (plus a mild landscape bias — boards generally read in a wide
> window) aims the wrapped block at roughly SQUARE pixels instead.

### 2.4 A lane header and the columns it labels must compute the same geometry

`packages/web/src/graph/layout.ts:295-301`:

> Pure function of `laneOf` (card → tier depth) and `dims` (card sizes), so both `layoutFlowLanes`
> (card placement) and the board's lane-header nodes can compute the SAME geometry independently; a
> header can never drift from the columns it labels.

And at `:325-341`, why ELK's own Y is kept even though the lane assignment overrides X: "ELK's own
per-card Y position is kept only as a stable sort key (so cards that were already near each other
stay near each other, keeping edge crossings low)."

---

## 3. Zoom, fit and the legibility floor

### 3.1 The auto-fit cap is an AUTO-fit cap only

`packages/web/src/canvas/fit.ts:1-12`:

> The owner's first-use feedback: opening the architecture board auto-zoomed in far too close (a
> small graph hit the per-surface interactive `maxZoom` cap of 2.5). … IMPORTANT: this caps the
> AUTO-fit only. Each surface keeps its own interactive `minZoom`/`maxZoom` props, so the user can
> still manually zoom in freely.

### 3.2 The design canvas fitted 727 nodes at 2.7% — hence a floor

`packages/web/src/canvas/fit.ts:23-43`:

> `FIT_MAX_ZOOM` stops a small graph filling the screen at 400%. Nothing stopped the opposite, and
> on the real Sequence monorepo the design canvas fitted a 727-node draft at **2.7%** — a band of
> 5–15px slivers where no label, no kind and no shape was readable, reported off
> `design-canvas.png`. "Fit everything" stops being a fit the moment the result cannot be read;
> below the floor the honest answer is to frame what IS readable and let the user pan, which a
> canvas can do and a fixed layout cannot.
>
> 0.45 is this canvas's own existing legibility line, not a new guess … so 0.45 is the lowest zoom
> at which a card still carries its name.

### 3.3 `ARCH_FIT_MIN_ZOOM = 0.6` is derived from the board's SMALLEST text

`packages/web/src/canvas/fit.ts:49-70`:

> The note above says a floor was deliberately kept off `FIT_OPTS` on the grounds that
> "Architecture groups a repo into ~10 cards". That assumption is now false by design: the owner
> asked the board to take up more space and show more detail, so `DEFAULT_MAX_CARDS` went 12 → 24 …
> More and taller cards means a bigger bounding box, and an unbounded `fitView` answers a bigger box
> by zooming further out — a screenshot review at only EIGHT services already showed every card
> title ellipsized. Raising density without a floor would have made the board hold more and say
> less.
>
> 0.6, not the design canvas's 0.45, because these two canvases carry different type at their
> smallest: a design leaf's own name is its largest text, while an Architecture card's SMALLEST text
> is the 11px sub-row … 11px × 0.6 ≈ 6.6px is the point at which a row is still a distinguishable
> word rather than a dash; below that the card title (12.5px → 7.5px) goes too.

**Carry the derivation, not the number.** §3.8 drops the floor to 0.25 with a new LOD ladder — the
constraint that survives is *the floor is a function of the smallest type on the card*, so re-derive
it against Graphite's `--t-12`, do not copy 0.6.

### 3.4 React Flow 12.11's `fitView` does not honour per-side pixel padding

`packages/web/src/canvas/fit.ts:99-112`:

> React Flow's own `fitView` padding is uniform-ish and, in 12.11, does not honour per-side pixel
> padding the way the type suggests — a proposal fit asking for a 164px foot reserve still parked
> the board's bottom edge 710px down a 777px pane, i.e. squarely under the Accept-plan bar. Rather
> than negotiate with it, this computes the viewport directly … the bands are a fact about the
> chrome, and the camera has to respect them exactly.
>
> PURE + TOTAL: numbers in, a viewport out. A degenerate viewport or empty bounds returns `null`
> rather than a NaN camera that strands the user.

And at `:124-125`: "A pane too small for its own chrome keeps a usable sliver rather than a negative
one — the camera must stay finite whatever the layout does."

### 3.5 The on-edge label threshold is 0.38 because default fit lands at 0.42–0.55

`packages/web/src/canvas/edgeStyle.ts:88-91`:

> Below this React Flow zoom, on-edge labels bunch/overlap — hide them by default. 0.38 (r126):
> default fitView on real repos lands ~0.42–0.55 — 0.5 hid every pill on first viewport
> (coding-canvas shows labeled flows immediately).

Plus `:93-98` — the reason a selected/hovered edge is exempt: "otherwise the label only shows once
the graph is zoomed in enough that pills can't collide into unreadable garbage ('I, db write, db')."

---

## 4. Board density — every cap is arithmetic

### ★ 4.1 `DEFAULT_MAX_CARDS = 24` is derived, not round

**Carried to `packages/web2/src/canvas/canvasReduce.ts:149-152`**, where the constant became a
derivation — v1 wrote 24 down for a 1400x900 canvas; the three-pane shell gives ~614, so it is
computed. (v1 origin, now deleted: `packages/web/src/graph/groupedArchModel.ts:170-181`)

> v2 says: the constant "was right for a frame that no longer exists, which is why it is
> computed rather than written down.":

> Cards drawn before the tail collapses into one "+N more services" card.
>
> Same owner directive as above; 12 was the old bulked-up-and-condensed number. 24 is what the board
> can hold at its own legibility floor: `ARCH_FIT_MIN_ZOOM` (canvas/fit.ts) is 0.6, a 1400×900
> canvas at 0.6 is 2333×1500 flow px, and a card is 280px wide on a ~300px pitch — 8 across × 3 flow
> lanes = 24 cards that are all still readable. More than that and the fit would have to choose
> between clipping cards and shrinking them below the floor, so 24 is the honest ceiling rather than
> a round number.

**This is R9 in the risk register.** The derivation assumes a 1400×900 canvas; the v2 three-pane
shell gives ~614px at 1280 wide, and Graphite sheet 08 says the opposite — *"The budget is the
frame, not a node count."* The inheritance is **the arithmetic**, not `24`: derive at runtime from
the actual canvas box and the actual floor.

### 4.2 `DEFAULT_VISIBLE_SUB_COMPONENTS = 14` supersedes owner r102, and is measured

`packages/web/src/graph/groupedArchModel.ts:151-167`:

> r184 — SUPERSEDES owner r102 ("6: glanceable without scroll"), on the owner's own instruction
> (2026-08-01 …): "you can see every micro feature, service, and function throughout the entire
> board... This one, not so much. It's very bulked up and just condensed." The board is to take up
> MORE space and show MORE detail. Recorded as a reversal in `docs/owner-feedback-log.md` — r102 was
> a real decision, not a bug.
>
> 14 is measured, not picked: `.board-filelist` … caps the list at 210px and a `.grouped-subitem`
> row is 11px text at line-height 1.3 plus 2px padding either side plus the 1px flex gap ≈ 19.3px,
> so ~10.9 rows fill the box. 14 is therefore the smallest number that BOTH shows roughly twice what
> r102 showed and provably overflows the scroll box, which is what makes the already-scrollable list
> actually scroll instead of being starved of rows.

### 4.3 The overflow card must not be a dead end

`packages/web/src/graph/groupedArchModel.ts:822-826`:

> r184 — THE TAIL CARD STOPS BEING A DEAD END. It used to carry no rows at all: a box saying "+13
> more services" and listing them in a one-line summary that ellipsized, with nothing to click. The
> hidden cards are real graph nodes, so each becomes a real sub-row that opens THAT component — the
> same drill-in every other row has.

And `:834-836` — the tail card names its own grain: "On a promoted single-service board the hidden
cards are modules, and calling them 'services' would be the one fabricated word on the board."

### 4.4 The interior list caps the DOM, not the data

`packages/web/src/graph/interiorList.ts:26-33`:

> Data still lists every part (search + section counts stay honest). Opening How it works on a 200+
> part service must not freeze the tab: relations are lazy (computed only for visible rows when a
> section opens) and the DOM is capped at `INTERIOR_LIST_MAX` with a reachable "+N more".

### 4.5 Hidden cards keep their edges in the ANALYSIS even though the board drops them

`packages/web/src/graph/groupedImpact.ts:20-24`:

> NO SILENT DROPS — the ids hidden behind the overflow card keep their edges: they are lifted onto
> the overflow card rather than discarded. (`buildGroupedArchModel` drops those edges for DRAWING,
> because there is no visible endpoint to draw between; dropping them from the ANALYSIS would
> understate a blast radius, which is exactly the fabrication we must not do.)

---

## 5. Theming and the token layer

### ★ 5.1 The dead-stylesheet note — six legacy sheets, and exactly why none is loaded

**Superseded by `packages/web2/src/v3/V3App.tsx:3-10`.**

> Decision 22 product chrome: "STYLESHEET ORDER IS LOAD-BEARING" and "A sheet whose
> position cannot be argued does not go in." Tokens → base → panes → overlays →
> `v3.css` last. (v1 origin, now deleted: `packages/web/src/main.tsx:35-61`; prior
> v2 cite was `packages/web2/src/app/App.tsx:1-32` before App re-exported V3App.)

> NOT loaded on the product path, deliberately (Graphite W1 audit).
> `styles/board.css` is the LEGACY board's per-surface sheet. Every app rule in it is scoped to a
> class the product tree never renders (`.grouped-canvas-wrap`, `.arch-kind-chip`, `.board-flow-lane`,
> `.try-chip`, `.pending-risk-*`, `.resilience-advisor-*`), and its two `:root[data-mode='light']`
> blocks are inert here because the product shell stamps `data-theme` (ledgerTheme.ts), not
> `data-mode`. What WOULD reach the product board is its six unscoped `.react-flow__*` rules — and
> each one is either already done better by product.css §board or an active regression:
> · `.react-flow__background { transparent !important }` — product.css both zeroes
> `--xy-background-color` on `.react-flow` and `display:none`s the element, so this is redundant.
> · `.react-flow__controls` / `-button` theming — out-specified by
> `.arch-rf-viewport .react-flow__controls*` (0,2,0 > 0,1,0), except its `width:28px; height:26px`,
> which nothing in product.css contests: it would silently resize a cluster measured against the
> library's 26x26 box. Its `transition` names `var(--skin-dur)` with no fallback and product.css
> never defines that token, so the shorthand drops to invalid and the cluster loses its transition
> outright.
> · `:focus-visible { box-shadow: inset 0 0 0 2px var(--accent) }` would apply and override nothing,
> planting a focus treatment that is not `--focus-ring`.
> The zoom-cluster collision fix (r184) cannot be delivered by an import at all: its positioning
> half lives under `.grouped-canvas-wrap`. The product board has the same collision —
> `<Controls position="bottom-left">` lands at ~15px/15px, 26x78, over
> `.product-app .arch-rf-bottom-chrome` at left:14px/bottom:12px …

**What v2 inherits:** four separate, still-live facts — (a) React Flow's own controls box is
**26×26** and any rule that resizes it silently breaks a cluster measured against it; (b) a
`transition` shorthand naming an undefined token drops to invalid and kills the transition outright;
(c) the `<Controls position="bottom-left">` cluster geometrically collides with bottom-left board
chrome — §3.6 replaces `<Controls>` for other reasons, and this is the measurement that says where
the new `.zoomcluster` must not sit; (d) a theme attribute mismatch (`data-mode` vs `data-theme`)
makes a whole light-mode block silently inert.

### 5.2 The pop-out window loads the same sheets as the main window, in that order

`packages/web/src/main.tsx:10-13`:

> The legacy sheet tree. PopoutShell no longer renders legacy components, so nothing here paints the
> pop-out any more; the imports stay because the r166/r179/r180 sheet-order locks read this file,
> and they retire with the legacy tree, not with this window. Console loads AFTER them and wins.

And `:25-27`: "Console v3 — the SAME sheets ProductApp loads, so a detached board is the same design
language as the window it was torn off. Last import wins."

### 5.3 A CSS `var()` cannot be read by an SVG `stroke` on `<Background>` — hence a probe

`packages/web/src/product/arch/useProductCanvasColorMode.ts:41-46`:

> Console sheet 24 — the board field is a 26px grid of `--line` hairlines, ≈4% ink over the ground.
> React Flow paints `<Background>` into an SVG stroke, which cannot take a `var()`, so the token is
> resolved to a concrete `rgb()` through a probe.

And `:49-52` — where the probe must hang: "The probe must hang INSIDE `.product-app` — that is where
the Console token block is declared, and custom properties only inherit downwards."

Plus `:4-6`: "Product shell tracks theme on `html[data-theme]` (ledgerTheme.ts), not `data-mode`."

### 5.4 Edge colours are handed out as `var(--token)`, never hex — a contrast audit found out why

`packages/web/src/canvas/edgeStyle.ts:1-28`:

> KIND_COLOR hands out CSS custom-property references (`var(--http)` etc.), not hex — a contrast
> audit found the hex table was read directly by every edge renderer and applied via inline
> `style`/SVG attributes, which bypassed the theme entirely: the `--http`/`--db`/`--grpc`/`--queue`/
> `--import` light-mode overrides in styles.css existed but were dead code as far as edges were
> concerned, so lines and arrowheads went unreadably faint on the light themes (grpc/queue/import/
> pair all measured under the WCAG 3:1 non-text floor against porcelain's canvas). … confirmed
> empirically (see edgeStyle.test.ts) that `var()` resolves correctly both as an inline `style` value
> AND as a raw SVG presentation attribute (`stroke="var(--http)"`, `fill="var(--http)"`) on a
> `<marker>` in a per-edge `<defs>` … CSS custom-property inheritance follows the DOM tree, and that
> marker is a normal DOM descendant of `:root`, not a detached/portalled node, so it inherits the
> token like any other element. … The legend derives its swatches from this same map, so key == line,
> always.

**Graphite makes edges greyscale, so the hue table itself does not carry forward — the mechanism
does:** a `var()` survives a theme flip through an inline style and an SVG presentation attribute; a
resolved literal does not.

### 5.5 Some values must live in JS because React Flow paints them inline

`packages/web/src/canvas/edgeStyle.ts:179-185`:

> They live here, not in a stylesheet, because React Flow paints `strokeDasharray` as an inline style
> and an inline style beats a class rule.

Same at `:157-176` for stroke widths, with the parity lock named: `REST_STROKE_WIDTH` /
`ACTIVE_STROKE_WIDTH` are mirrored as `--edge-w-rest` / `--edge-w-active`, and
"`theme/designLanguage.r179.test.ts` fails if the numbers here and the numbers there ever disagree."

---

## 6. Type must never be clipped — the measured estimator

### 6.1 The LAW, and the incident that produced it

`packages/web/src/graph/componentInterior.ts:749-759`:

> ── NEVER CLIP A PART'S NAME (docs/macos-ui.md LAW) ──
> "Graph text is always bold and legible… a long label STEPS THE FONT DOWN (e.g. 10.5px → 9.5px)
> rather than touching the edge." r73 shipped the interior chips with the board's
> `text-overflow: ellipsis`, and the real app showed "Edge serv…" / "default.co…" — a truncated
> service name tells the user nothing. So the width every chip actually has for its NAME is computed
> here, the font steps down the documented ladder until the name fits, and a name that still cannot
> fit at the floor wraps to a second line (the box grows for it). Nothing is ever ellipsized, and the
> full text is additionally reachable in the chip's `title`.

`:761-762` — "The step-down ladder, largest first. 9.5px is the documented floor."
(`INTERIOR_FONT_STEPS = [12, 11, 10, 9.5]`.)

### 6.2 The character-advance estimator is calibrated against a real `scrollWidth`

`packages/web/src/graph/componentInterior.ts:767-773`:

> Average advance width per character as a FRACTION of the font size, for the UI face at weight 600.
> Calibrated against measured `scrollWidth`s from the real app (e.g. "Gateway service" = 109px at
> 12px ⇒ 0.605/char). Deliberately pessimistic: over-estimating steps the font down one notch too
> early, which is legible; under-estimating clips, which the LAW forbids.

`:777` — "Safety margin — the estimate must never come in UNDER the real advance."
(`WIDTH_SAFETY = 1.05`.)

**Note for v2:** this is calibrated for the *current* UI face. Instrument Sans (§W0.1) has different
metrics; the constraint that carries is *bias the estimate pessimistic and calibrate against a real
measured `scrollWidth`*, not `0.605`.

### 6.3 Capping the line count did not keep text in its box — it lied to the box

`packages/web/src/graph/componentInterior.ts:799-808`:

> `lines` is the REAL count, not a 1-or-2 flag. The CSS already wraps freely
> (`white-space: normal; overflow-wrap: anywhere`), so a name needing three lines rendered three
> lines — but the row was only ever given height for two, and the third spilled over the chip below
> it. Capping the count did not keep the name inside its box; it just stopped the box from being told
> the truth.

---

## 7. Routing geometry — arrows must not cross cards

### 7.1 A label rides the longest RUN, never a bend

`packages/web/src/product/arch/orthogonalElbow.ts:308-316`:

> Where an edge label sits — Console sheet 23: "label sits ON the segment, knocked out of the line —
> never over a node".
>
> The midpoint of the LONGEST segment, not the middle point of the polyline. The middle point of an
> elbow is a BEND, and a bend is by construction the part of the route closest to a card, so
> anchoring there is what pushed labels on top of node cards. The longest run is the open channel
> between two columns.

Restated at the call site, `ArchCanvasBoard.tsx:118`: "the label rides the longest RUN, never a bend
(a bend hugs a card)." And the shape lock at `orthogonalElbow.ts:307`: "Owner lock: no
cubic/quadratic, no diagonal segments."

### 7.2 An edge is a ROUTE, not two endpoints

`packages/web/src/graph/componentInterior.ts:904-914`:

> r183 — the ROUTE, not just the two ends.
>
> A straight line between two chip centres is only safe when the two chips are adjacent. On the
> owner's real component (11 files, real names, real edges) it crossed every row in between: arrows
> ran straight THROUGH the cards, which is the "it's breaking out of its boxes" in the report. Every
> point after the first is an orthogonal step, and every segment is constrained to a gutter between
> rows or to a side lane outside all the columns — so a connector can never pass over a chip.

### 7.3 The layout box must be bigger than the content box, or a line has nowhere to go

`packages/web/src/graph/componentInterior.ts:921-931`:

> `LANE` is the clear column on each side that non-adjacent connectors run down; `MARGIN_Y` is the
> clear band above the first row and below the last, so a same-row or last-row connector always has a
> gutter to travel in. Before this, the layout box was exactly the chips' bounding box, which is why
> a line had nowhere to go except across them.

And `:1053-1059` — gutter centres are computed from the placed rows, never assumed: "rows have
different heights because a wrapped name grows its row, so a gutter centre is computed, never
assumed."

### 7.4 Fit-to-fill shrinks without limit but grows only a little

`packages/web/src/graph/componentInterior.ts:1160-1172`:

> Owner: "the MADR view... the arrows... it's not fit to fill." The breakout rendered the layout at
> its natural pixel size inside a flexible panel: on a real component it was wider than the panel and
> got clipped, and on a small one it sat in the top-left corner of a mostly-empty box. Neither is a
> diagram "fitted" to anything.
>
> Returns the scale to apply. It shrinks without limit (a clipped diagram is strictly worse than a
> small one) and grows only to `maxUp`, because a two-chip interior blown up to fill a 900px panel
> reads as a mistake.

### 7.5 A ghost card must avoid the cards already on the board

`packages/web/src/graph/archProposal.ts:461-482`:

> r182 — IT NOW AVOIDS THE CARDS THAT ARE ALREADY THERE. The old version added `dx`/`dy` to the
> anchor and stopped, and `dx`/`dy` come from the MODEL … a number chosen with no knowledge of where
> anything is laid out. On the real Sequence monorepo that put the PROPOSED "Redis Cache" ghost
> squarely on top of the Acp service card and clipped its subtitle to "clie · exe · inde": the user
> was asked to accept a change they could not read, over a card they could no longer read either.
>
> … if the board is so dense that nothing clears, it takes the candidate that covers the least —
> "least bad, deterministically" rather than "wherever the model said".

### 7.6 Bezier curvature must drop when the target sits behind the source

`packages/web/src/canvas/edgeStyle.ts:359-367`:

> When the target sits BEHIND the source relative to its declared exit side (e.g. a `right` source
> handle whose target is actually to its left), that curvature makes the path overshoot past the
> source card before turning back — reading as the edge "leaving the node backwards" and cutting back
> across its own card.

And `:389-396` — why the label anchor is pulled back on short edges: "on a SHORT edge (adjacent
cards) that midpoint can sit close enough to the target that the label pill lands on top of the
arrowhead it's explaining."

---

## 8. Kind vocabulary — the greyscale rules and what a kind may not be

### 8.1 Kind carries no hue, in the model layer, by construction

`packages/web/src/product/arch/archKinds.ts:1-11`:

> GRAPHITE — kind carries NO hue (owner Decision 2; sheet 03 §03.2). A kind is icon + silhouette +
> border treatment + neutral tone, and nothing else. This file returns identifiers only: no colour
> token is named here, and none may be added.

Same at the card, `packages/web/src/product/arch/ArchNodeCard.tsx:12-33`: the six glyphs are "lifted
VERBATIM from the book's own sprite — docs/brand/graphite/_core.html lines 1529 and 1559-1563
(ic-entry, ic-service, ic-module, ic-database, ic-topic, ic-agent)" — *the v1 comment cited the
**live** `docs/brand/graphite/_core.html`; the citable path is the frozen
`docs/brand/graphite/_core.html`, and the quote is left unedited because it is evidence* — drawn `stroke: currentColor`
with no fill: "A coloured kind glyph would put kind back on the channel Decision 2 forbids." That
block also records the defect it fixed: "all six kinds rendered the same 6px grey dot, so six kinds
carried zero icon information: service and module separated on a dashed border alone, and service and
storage on the cylinder rise plus a border weight that snaps to 1px on a 1× display."

### 8.2 `entry` is last in the legend because it is a position, not a kind

`packages/web/src/product/arch/archKinds.ts:25-46`:

> `module` sits next to `service`, because those are the two the reader now has to tell apart and
> adjacency is what makes the dashed border and the folder tab readable as a difference. Second,
> `entry` is LAST, because it is a *position* and not a kind: §03.7 — "a legend that lists entry among
> the kinds teaches the reader that entry is a thing you can build, which it is not."
>
> `storage` keeps its identifier and its label says Datastore. … the schema declares 'datastore'
> (packages/schema/src/seqdiagram.ts:57) … "no sheet may print Storage for a node kind" — the *label*
> is the defect. … So the id stays 'storage'.

### 8.3 `file` and `function` must degrade to Module, never Service

`packages/web/src/product/arch/archKinds.ts:67-94`:

> MODULE IS FIRST CLASS. It was being flattened onto `service` before it ever reached the picture, so
> `microDocFromParts` … drew a board of mislabelled Services, and the legend could contain no Module
> while the board was full of them.
>
> `module` and `package` both present as Module. They "never stand on the ground — they only ever
> appear inside something". … Collapsing either to Service is named as an error there: a package is
> not a deployed thing.
>
> `file` and `function` are interior detail, not board kinds. … This function is total, so it must
> still answer for them, and Module is the only honest answer left … Service is the one answer that
> is wrong — it asserts a deployed thing about a source file.

### 8.4 `module` belongs at L1, and it is load-bearing

`packages/web/src/product/arch/archLevels.ts:132-148`:

> It is also load-bearing rather than cosmetic. A chat/design "process" board is made of modules
> (microDocFromParts and seqdNodeBreakoutDoc both emit `kind: 'module'`), so without this entry
> `availableArchLevels` finds zero L1 nodes and the Overview level disappears from exactly the boards
> whose steps ARE the overview — caught by the `agent-local-llm` golden in ioConsistency100.test.ts.

---

## 9. ★ The `L2` pin is a standing owner ruling

**Superseded by `packages/web2/src/canvas/lod.ts:6-15`.**

> v2 implements sheet 05.8 and cites it by number in the file. v1 pinned a level; v2 implements sheet
05.8's ladder, and the 05.8-vs-08.2 contradiction went to GRAPHITE-DECISIONS.md rather than
being resolved by invention. (v1 origin, now deleted:
`packages/web/src/product/arch/ArchCanvasBoard.tsx:258-288`) — the comment, and `const level:
ArchLevel = 'L2'` on line 288:

> Always Systems — L1/L3 chips are gone (owner walk).
>
> W1 revisited this pin and DELIBERATELY LEFT IT. `archLevels.ts` does expose an available-levels
> guard … so un-pinning is mechanically possible — but:
>
> 1. It reverses a standing owner decision, not a retired brand token. Four suites lock it
>    independently and by name: `archWiring.test.ts` requires this exact line AND asserts this file
>    never names that guard — so the comment cannot spell it either; `ownerWalkChatIo.test.ts`
>    ("hides L1/L2/L3 chips; Architecture stays L2 Systems"), `ownerWalkR3Wave8.test.ts` ("ArchToolbar
>    has no L chips — Systems is always on") and `ownerWalkR2WaveE.test.ts` cover the toolbar side.
>    Re-pointing brand values is one act; deleting a product decision to reach a view is another.
> 2. L3 is not a different set of nodes. `nodeVisibleAtLevel` only branches on L1, so
>    `filterDocForLevel` returns the SAME nodes and edges for L2 and L3. All L3 changes is
>    `showEdgeLabels` and the card SUBTITLE SOURCE …
> 3. Those internal parts are already reachable without a level: the MADR breakout renders
>    what-it-is -> parts -> diagram -> files on node select …
>
> So the pin costs a subtitle re-ordering that another surface already serves, and un-pinning would
> cost an owner decision plus four locks. If the owner wants Contracts back, the honest change is the
> chips returning to ArchToolbar behind that guard — a toolbar + test change, not a silent
> auto-promote here that would relabel every card on every board that happens to carry parts.

**What v2 inherits, per §4.5:** the *ruling* — one level, no L-chips — not the pin. The plan CUTs the
L1/L2/L3 vocabulary (205 lines serving a constant) and delivers depth through `scopedSeqdModel`'s
repo/service/ask scoping instead. Do not resurrect the chips as a "restoration".

---

## 10. ★ The digest cap — what `slice(0, 300)` cost, measured

`packages/analyzer/src/explain/explain.ts:764-766` (the cap) and
`packages/analyzer/src/explain/explain.ts:768-788` (what taking it by array position cost):

> Cap the digest so a huge repo can't blow the prompt / token budget.
> `const MAX_FILES_PER_SERVICE = 50; const MAX_EDGES = 300;`
>
> Choose WHICH edges reach the digest once the graph exceeds `MAX_EDGES`.
>
> This used to be `graph.edges.slice(0, MAX_EDGES)` — the first 300 edges in whatever order the
> scanner appended them. Measured on this repository, that meant the assistant saw `analyzer` 296 and
> `acp` 4, while `packages/web` — 1545 edges, 67% of the graph and the entire product surface —
> contributed NOTHING. The cap is necessary; taking it by array position was not.
>
> `pageRank` was already being computed on every scan (scan.ts) and written to every file node as
> `meta.pageRank`, and nothing read it. An edge is weighted by the sum of its endpoints' rank, so an
> edge between two central files outranks one between two leaves.
>
> Two properties the callers depend on:
> - a graph that FITS the cap is returned untouched, in graph order, so the small-repo case (most of
>   them) is byte-identical to before;
> - the selection is stable — ties break on original position, and the chosen edges are re-sorted back
>   into graph order, so the digest still reads as a walk through the repo rather than a ranking
>   table.

**This is the coverage differentiator's foundation (R4, W1.1).** The cap is real and stays; what the
UI must show is the *denominator*. §7-R4: `explain.ts:1140-1143` computes omissions against the
already-capped digest, so it can never report the ~2,026 edges the cap removed.

---

## 11. Naming and merging — every rule here is an incident report

### 11.1 Tier words are not names — four products collapsed into one card

`packages/web/src/graph/groupedArchModel.ts:330-347`:

> Merging is meant to unite the halves of one component — `brain` and `backend-brain` are one system,
> and the owner asked for exactly that. But the token test treated `frontend` as a name, so on a real
> product monorepo `frontend-marketing`, `frontend-ace`, `frontend-forms` and `frontend-brain` all
> shared a "name" and collapsed into ONE card: four separate products — a marketing site, a learning
> platform, a forms system — shown as one box, and three of them unreachable from the board, the
> picker and the rail.
>
> Dropping tier words makes the SAME rule do both jobs … `frontend-brain` and `backend-brain` both
> reduce to `brain` and still merge, while `frontend-marketing` reduces to `marketing` and stands
> alone. A card named only for a tier (`api`, `frontend`) keeps no significant token at all, so it
> merges on nothing — which is right: `api` is not evidence of kinship with anything.

### 11.2 A conjunction is not evidence — the card titled "And"

`packages/web/src/graph/groupedArchModel.ts:354-359`:

> r184 — GRAMMAR, not names. Caught on the large-board legibility stop: two unrelated services,
> "Identity And Accounts" and "Session And Cache Reader", merged into ONE card because they shared the
> word "and", and the merged card was then titled — accurately, from the shared word — "And". A
> conjunction is not evidence that two systems are the same system.

### 11.3 A merged lead must keep its own name, or the breakout lies

`packages/web/src/graph/groupedArchModel.ts:98-114`:

> Only the lead loses its name in a merge … Without this field the lead has no display name left
> anywhere, and anything that resolves a node id to "what the board calls this" — `modelLabels` in
> componentInterior.ts — hands the WHOLE GROUP's name back for the lead half. That is how the pairing
> breakout came to list "Brain" and "Frontend Brain Service" side by side inside a pop-up itself
> titled "Brain": the backend half was wearing the component's name, so nothing on screen said which
> half was the backend.

### 11.4 A shared title is grounded in the lead's own words, never invented

`packages/web/src/graph/groupedArchModel.ts:438-449`:

> The shared name is not invented: it is the words of the LEAD CARD'S OWN TITLE, in its own casing,
> kept only when every merged card carries that same word. "Schwai Ace Frontend" + "Schwai Ace
> Backend" → "Schwai Ace"; two cards sharing nothing but a tier word keep the lead's full title,
> because a name we cannot ground is worse than a long one.

And `:452-455`: shortening two identical titles "would DROP the one thing both of them say."

### 11.5 Dedupe on the NAME the user reads, not the id

`packages/web/src/graph/componentInterior.ts:1225-1233`:

> Deduped on the LABEL, not on `neighbourId`. Boundary edges carry raw graph ids, but the labels come
> from the BOARD, where `mergeRelatedGroupedCards` folds related services into one card — so
> `svc:brain` and `svc:backend-brain` are two distinct ids wearing one label. Keying on the id printed
> "Talks to brain · brain": the same name twice, reading like a bug in the repo rather than in us. The
> user reads names, so names are what must be distinct.

### 11.6 An AI label is already English — do not re-humanize it

`packages/web/src/graph/groupedArchModel.ts:610-615`:

> r184 — WIRE THE AI NAMING PASS THROUGH TO THE CARD. `scan.ts` already replaces `node.label` with
> `llmLabels()`'s product name (and only ever a RENAME — the fabrication guard in llm/label.ts drops
> any id it was not asked about). Everything downstream then re-humanized and re-suffixed it, so a key
> bought "Learning Program service" instead of "Learning Program".

And `:649-651` / `:658-662` — two grounded sentences the scan already writes that never reached a
card: the AI pass's one-line responsibility, and the module node's counted sentence ("17 py files in
src/flask, defining _AppCtxGlobals, …") — "it states files it counted and symbols it read, and
invents nothing."

### 11.7 A file's board summary is its path — never print a path as prose

`packages/web/src/graph/componentInterior.ts:715` and `:688-694`.

---

## 12. Depth, ordering and cycles

### 12.1 The relaxation fuse produced "Depth 281" — real numbers, from real repos

`packages/web/src/graph/boardFlowOrder.ts:190-208`:

> READING ORDER, NOT THE RAW RELAXATION NUMBER.
>
> The longest-path pass above assigns a depth per node; on a graph with a CYCLE it runs to its guard
> bound instead of converging, so the numbers come out huge and sparse — real measurements: django's
> board produced tiers `0, 281, 283, 284, 285, 286`, express's `0, 15, 16, 17`. Six lanes were labelled
> "Depth 281" and friends, which is not a fact about the system, it is an artefact of the fuse.
>
> Collapsing the distinct depths to consecutive ranks keeps the ORDER … measured across every real
> repo in the QA cache, not one multi-service board is sparse (Sequence, robot-shop, online-boutique,
> microrealestate, sock-shop, spring-petclinic, opentelemetry-demo, n8n, vite, strapi, excalidraw,
> rails, example-voting-app all came out consecutive), so no multi-service board changes by a byte.

### 12.2 Longest-path wins, the loop is fused, and an unwired node is never given a fake depth

`packages/web/src/graph/boardFlowOrder.ts:22-35` (and the same rule at the interior grain,
`packages/web/src/graph/interiorFlow.ts:22-34`):

> DEPTH is a longest-path assignment: … when two routes disagree the LONGEST wins — a node is never
> drawn "called" before every one of its callers has appeared. The relaxation is bounded by the number
> of connected nodes, so a real cycle terminates instead of looping forever, and every node still ends
> with exactly one final depth instead of being duplicated.
>
> A node with NO edge to another top-level node at all is not part of any chain, so it is never given
> a fabricated depth — it lands in the trailing orphan tier instead, still on the board exactly once.
> The title states the narrow fact: the scan found no service-to-service CALL (http/grpc/queue/db)
> between these nodes — exactly what a mobile app or library monorepo looks like, and not a tool
> failure.

Fuse restated at `boardFlowOrder.ts:161-165`.

### 12.3 A partly-parsed module keeps its row — a silently deleted module is a lie

`packages/web/src/graph/componentInterior.ts:501-515`:

> The rule used to be "any function attributed to this host deletes the host", which is right for a
> FILE (its functions are the whole of it) and wrong for a MODULE: `containerOf` walks up to the first
> part, so when a module was the part and one of its files had a parsed function, the entire module row
> was removed — taking every sibling file with it. Nothing said so: those files were never in `parts`,
> so `hiddenCount` (which only counts the display cap) stayed 0 and the pop-up read as a complete
> breakdown of the component.
>
> So supersede only on FULL coverage … A partly-parsed module keeps its row and shows its functions
> alongside — two granularities is a cosmetic cost; a silently deleted module is a lie about the repo.

### 12.4 A guarantee that rests on a caller's incidental ordering is not one

`packages/web/src/graph/componentInterior.ts:942-951`:

> "Roots first" is ENFORCED here, not assumed. `componentInterior` happens to emit them first today, so
> a plain `slice` looked correct — but the guarantee is what the pop-up depends on (dropping a root
> means the component you clicked is missing from its own breakdown), and a guarantee that rests on a
> caller's incidental ordering is not one.

---

## 13. The single-service board — the common case was the worst case

`packages/web/src/graph/singleServiceBoard.ts:1-57`:

> A cold-start audit opened two real, well-known repos with no key:
> `flask` → one card reading "Flask service", ~75% empty canvas, no edges.
> `express` → one card reading "Express service", the same.
> The lane header read "No cross-service calls detected"; "Show main flow" and "Walk me through it"
> both dead-ended … A newcomer could not tell what either system was.
>
> The analyzer was NOT the cause. flask scans to 1 service, **8 modules**, 83 files and **171 real
> import edges**, with zero fallback titles. The structure was there and correctly named — the BOARD
> threw it away, because `buildGroupedArchModel` draws one card per service/datastore/topic … With one
> service there is exactly one card, and a card cannot have an edge to itself.
>
> Most repos in the world are single-package repos. Of the 21 real repos in the QA cache measured while
> writing this, ELEVEN scan to exactly one service (flask, express, django, fastapi, gin, gorm, nest,
> node-express-realworld, prometheus, spring-petclinic-monolith, sqlfluff). The common case was the
> worst case.
>
> Three conditions, all necessary: 1. exactly one `service` node; 2. at least `MIN_BOARD_UNITS`
> `module` children — promoting to a single card would just move the problem; 3. nothing else. In
> particular the presence or absence of EDGES is not a condition: a repo whose modules genuinely never
> import each other (gin, gorm) still shows its four/seven real parts by name, which is strictly more
> than one opaque box, and the empty lane keeps telling the truth.
>
> Import edges stay IMPORTS: family `import`, drawn dashed and dimmer …, labelled "imports" — the board
> never dresses a file import up as an HTTP call or a queue hop.

---

## 14. Honesty rules the engine and the board share

### 14.1 An authored edge must not read like a detected one — and the number cannot move

`packages/web/src/graph/archProposal.ts:260-290`:

> An applied proposal edge is written with `confidence: 1` and `evidence: []`: maximum confidence for a
> relationship nobody detected. …
>
> 1. THE NUMBER CANNOT MOVE. `validateGraph` (packages/schema) requires every edge in a `mode:'design'`
>    graph to have `origin:'design'` AND `confidence` exactly 1 — "a spec must not smuggle in fake
>    findings" — and Accept runs that validator through `checkGraphMutation` before it merges. A
>    designed edge written at 0.5 does not become humbler; it becomes unacceptable, and Accept fails. In
>    a design graph `confidence` is a schema CONSTANT, not a measurement …
> 2. WHICH IS PRECISELY THE PROBLEM. … a draft edge that came from a real `db_read` in the user's code
>    and a draft edge the assistant drew a minute ago were byte-identical … The honesty gap is not the
>    number, it is that the canvas could not tell the user which relationships are theirs to trust.
>
> So the fact is recorded where it is legal and legible: `detail.authored` … `isAuthoredArchEdge` is the
> single predicate both sides use, so the data and the picture cannot disagree.

### 14.2 The projected model cannot tell a scan from a guess — so the interface reads raw edges

`packages/web/src/graph/componentInterior.ts:1256-1267`:

> `GroupedEdge` comes from `projectEdges` (@sequence/export), which is PARITY-LOCKED with the analyzer's
> scorer and deliberately emits only src/dst/family/labels — `confidence`, `origin` and `evidence` are
> dropped, and `GroupedEdge.underlying` is literally `[]`. So a grouped surface reading the model CANNOT
> tell a scanned, certain call from an LLM-inferred guess, and would have drawn both the same way. That
> is exactly the fabrication this repo does not do, so the summary walks the RAW edges and keeps the two
> numbers the drawn board already uses for its dashes — `isAggEdgeUncertain`, the same
> `confidence < 0.75 || origin === 'llm'` rule `AggEdgeComp` and the edge legend share.

Same fact recorded on the model type at `packages/web/src/graph/groupedArchModel.ts:116-122`.

### 14.3 A dashed edge never marches

`packages/web/src/canvas/edgeStyle.ts:258-261`:

> A dashed edge never marches: motion means confirmed traffic, and animating a guess would read as
> observed live traffic.

And `:262-267` — the reduced-motion input exists "so the DECISION is unit-testable without a DOM"; the
real enforcement is a `@media (prefers-reduced-motion: no-preference)` wrapper.

### 14.4 Entry-style detection: never pick a style just to have one

`packages/web/src/graph/walkthrough.ts:19-37`:

> Every service is NOT an HTTP service. `detectEntryStyle` reads the entry style off real edges and real
> scan metadata … When none of those is present it says **"entry style not determined"** and names what
> it did find. It never picks a style to have one.
>
> WHAT IS DELIBERATELY NOT INFERRED. `main.py` / `main.go` / `main.ts` are NOT treated as command-line
> entries …: they are just as likely to boot an HTTP server, and calling one a CLI would be the exact
> "assume every service is an HTTP service" mistake with the sign flipped.

### 14.5 "Show main flow" failed silently at three gates

`packages/web/src/graph/stemFlow.ts:6-34`:

> r184 — owner: "The show main flow also doesn't work." It was not dead code; it failed silently at
> three gates:
> 1. DETECTION WAS A FILENAME ALLOW-LIST. … A repo whose entry is `cli.ts`, `run.py`, `manage.py` or a
>    bin script produced ZERO candidates, so the control never rendered and nothing said why.
> 2. `primaryStem` RETURNED UNDEFINED ON A TIE. Two or more candidates with no "preferred" one meant no
>    stem at all — the UI it deferred the choice to was never built, so more evidence produced LESS
>    product.
> 3. NO HONEST FAILURE. Even with a stem, `buildStemFlowPath` can be empty; the button looked identical
>    either way and clicking did nothing.
>
> The new fallbacks are not guesses about filenames — they are facts read off the real FunctionGraph: a
> CALL-GRAPH ROOT … That is the definition of an entry, stated in evidence rather than in naming
> convention.

### 14.6 Boundary crossings cannot be attributed to one inner part

`packages/web/src/graph/functionUnit.ts:27-35`:

> `ComponentInterior` aggregates a boundary crossing by (direction, neighbour, family) at the
> WHOLE-COMPONENT level … and does not retain which inner part originated it, so there is no honest way
> to say "this crossing belongs to this one function" without guessing. Rather than inventing that
> attribution — or silently hiding real boundary evidence because it cannot be pinned to one row — every
> boundary crossing is surfaced here as the component's own external reach, kept in its own bucket.

### 14.7 A leaf with no dependents produces zero risk rows, not a filler "low"

`packages/web/src/graph/pendingRisk.ts:1-49`:

> HISTORY: a "Risks" panel used to sit on the default Architecture surface, permanently ranking single
> points of failure whether or not anyone was touching the graph. It was removed in v21 Phase 5 — a
> standing list of risks about code nobody is changing is noise …
>
> Transitive (multi-hop) fallout is exactly what the existing blast-radius engine already reports … but
> is not re-flattened into individual rows here, because a two-hop-away node has no direct edge to T to
> cite as evidence, and inventing one would violate "grounded, never fabricate".
>
> A touched node with NO dependents (a leaf) produces ZERO rows — not a filler "low" row. …
> Every dependent row of the SAME touched node shares that node's severity — severity describes how
> risky touching T is, not a property of the row.

Severity thresholds, stated as arithmetic on `blastRadius / rankableNodeCount`: `high ≥ 0.3`,
`medium ≥ 0.15`, `low` otherwise (`:43-45`).

---

## 15. Interior reading views — why a list beat a diagram

`packages/web/src/graph/interiorList.ts:4-29`:

> The breakout shipped as a grid of large cards with drawn arrows between them. On a real repo that
> fails in three ways at once, and the owner hit all three: "they are too difficult to see and get lost
> because of their size and limited scrolling and manipulation"
>
> 1. SIZE. Each part was a ~180x60 card, so six parts filled the pop-up. A component with 36 parts
>    showed six and a "+30 more inside" line.
> 2. LOST. A free-laid graph has no reading order — the eye has nowhere to start, and two parts with
>    similar names are indistinguishable at a glance.
> 3. NO SCROLL. The grid was sized to its content and capped instead of scrolled, so the other thirty
>    parts were unreachable without promoting the whole panel — and still capped after that.
>
> A list fixes all three for free: rows are one line, so everything fits; kind sections give a reading
> order; and a list scrolls. The diagram is still available behind a toggle, because the pair arrow it
> draws is real information — it is just not how you read thirty-six things.

`packages/web/src/graph/interiorFlow.ts:13-20` records the same finding from the owner's side:

> The `map` view free-lays boxes and draws lines between them — a diagram, and the owner's complaint is
> precisely that a diagram does not read as a chain of calls. This module produces something closer to a
> document: parts grouped into COLUMNS by their depth in the call chain … and every row states its own
> connection in words — `→ Name (how)` / `← Name (how)` — because an arrow drawn between two boxes is
> exactly the thing that gets lost when there are more than a handful of them.

**This is a live tension with §3 of the plan, not a settled answer.** Two independent v1 findings say
that past ~30 items a node-link picture stops being readable and a document wins. Wave 6 (containment)
should read both before assuming nesting solves it.

### 15.1 A generic breakout is a reported defect

`packages/web/src/graph/componentInterior.ts:827-832`:

> Reported from real use: a breakout of fifteen cards each reading `MOD <Name>` and nothing more —
> "function desc too general overall". The scan does know what a module holds (how many files, in which
> directory, defining what), it simply had nowhere to put it.

---

## 16. Duplication that must stay in sync

`packages/web/src/graph/directoryHeat.ts:1-6`:

> Mirrors `packages/analyzer/src/lore/directoryHeat.ts`. The web bundle cannot depend on
> `@sequence/analyzer`; keep both copies in sync.

`packages/web/src/graph/singleServiceBoard.ts:90-94`:

> Short human label for ONE raw edge — mirrors `@sequence/export`'s `edgeLabel` (which that package does
> not re-export). Locked against it in `singleServiceBoard.test.ts` over every edge kind, so a change
> there fails here rather than drifting silently.

`packages/web/src/graph/groupedArchModel.ts:635-643` — the plain-English tier framing is "lifted verbatim
from `analyzer/src/explain/explain.ts`'s `EMPHASIS` table … so the board and the tree say the same words
about the same thing."

**W0.5 (`packages/api-types`) is the structural answer to this class of duplication.** Where v2 keeps a
mirrored copy, it must keep the parity test with it.

---

## 17. The pipeline contract v2 must not re-break

`packages/web/src/graph/createWithAi.ts:1-8`:

> Flagship contract: draw/name → clarify → propose cards/edges on the graph FIRST → checkGraphMutation
> BEFORE any file write → accept → code + Task Board. Routing/storage is a recommendation on the
> proposal — never a silent overwrite.

`packages/web/src/graph/archProposal.ts:392-404` — the proposal's own summary counts:

> Every number is COUNTED off the proposal itself, never written by hand and never estimated … An edge
> marked `removing` is drawn struck-through on the board and is skipped by
> `applyArchProposalToDraft`, so counting it as an addition would overstate the change … Counting only.
> It does not consult the graph, so it cannot disagree with what the overlay renders, and it is safe to
> call on a proposal whose endpoints do not resolve (that honesty question belongs to the board, which
> simply does not draw an edge it cannot place).

`packages/web/src/graph/aggregate.ts:3-8` — the drill-down invariant the whole surface rests on:

> interaction edges are stored at leaf level; at render time each edge is lifted to the deepest VISIBLE
> ancestor of its endpoints and grouped per (src, dst) pair with counts. Pure function of
> (graph, expanded) — memoize upstream.

---

## Appendix — what was walked, and what was left

**Walked in full:** every non-test `.ts`/`.tsx` in `packages/web/src/product/arch/` (17 files) and
`packages/web/src/graph/` (31 files), plus `packages/web/src/canvas/fit.ts`,
`packages/web/src/canvas/edgeStyle.ts` and `packages/web/src/main.tsx`.

**Deliberately not transcribed:** comments that restate the code (`/** Total order for ties: label, then
id */`, `/** A rectangle in flow coordinates. */`, per-field one-liners on interfaces), and the OF7b/v18
provenance headers that name a wave rather than a reason.

**Named in §4.5 but not a comment, so recorded here as a pointer rather than a quote:** the five files
that must move out of `canvas/` before it is deleted — `fit.ts` (137), `gridColors.ts` (68),
`edgeStyle.ts` (535), `breakoutFraming.ts` (336), `serviceAdrContent.ts` (218), plus `MadrBreakout.tsx`'s
logic.

**Not walked (out of item 0.2's scope, and likely to carry more of the same):**
`packages/web/src/product/` outside `arch/`, `packages/web/src/design/`, `packages/web/src/programs/`,
and the rest of `packages/analyzer/src/explain/`. The 1,406-comment-line figure is for `product/` alone,
so a second salvage pass is warranted before Wave 7 cutover.
