# MADR — Visual Board Mode (opt-in, animated, grounded)

- **Status: ACCEPTED 2026-09-02 — the owner said go, and amended the design. Amendments in §0 below OVERRIDE the decision table where they disagree.**
- **Date:** 2026-09-02

## 0. Owner amendment, 2026-09-02 — read this before the table

Max gave the go and changed four things. His words, then what each one moves.

> *"I want it to be toggleable so people don't have to choose. They just load it, and it's always going to be doing this."*

**A1 — Visual is ON by default. The toggle turns it OFF.** This REVERSES decision 3 and his own
earlier framing (*"Visual is a switch, never the default"*). The reasoning moved with it: a mode
nobody switches on is a mode nobody sees, and he does not want the reader to have to make a
decision before the product looks like itself. The toggle still exists and is still per-board and
still persisted — what changes is which way it points out of the box.

> *"that creates the React diagram based off the JSON diagram in more detail … they can showcase more than just a simple JSON sequence diagram."*

**A2 — Visual is allowed to show MORE than the plain view, and that is now the point.** Decision 2
said Visual "may not add a node, an edge, or a number the spec does not carry" — that still holds
absolutely, and it is the grounding contract. What A2 changes is the reading of "more": Visual may
render *structure the spec already carries but the plain view collapses* — sub-items, groupings,
per-item detail, axis and lane labels. It may not invent. The parity test in decision 2 therefore
compares the spec's **content**, not the count of painted boxes.

> *"if you click on the node or on the chart, we'd have just three nodes. Under the node, it would really show a transformer architecture in React."*

**A3 — NEW: a node opens into detail, in place.** Three nodes at the top level; clicking one reveals
a richer React rendering of what that node contains, drawn from the same spec. This is the feature
for teaching: a lesson on transformers shows three blocks, and the attention block opens into the
real thing. **Tension to record:** the architecture board has a standing ruling that containment was
cut and "opening REPLACES the view, one level at a time". That ruling is about the scanned
architecture board. This is the chart/teaching surface and the owner has now asked for in-place
detail here specifically — so it applies to charts, and the board's one-level rule is untouched.

> *"it's important that it doesn't randomly generate this every time. It has to be actually consistent with our design format … a consistent React thing."*

**A4 — DETERMINISM IS A LAW, not a nice-to-have.** The same spec renders the same picture, every
time, on every machine. No layout jitter, no random seeds, no per-render variation. Where a layout
needs a tie-break it breaks it on the spec's own order. This is the strongest form of the binding
decision — the model emits data, and the picture is a pure function of that data plus the brand.

> *"before … we said we don't really want any type of motion or any type of extra design nonsense … but kind of moving away from that a bit."*

**A5 — the austerity relaxes; the dependency rejection does not.** He is asking for richer, more
appealing, more legible pictures — not for a physics engine. Decisions 4 and 5 (no `motion`, no
hand-drawn look) **stand**, because neither was an argument for plainness: one was 85 KB against a
0 KB status quo, the other was that a sketchy stroke makes a grounded claim look provisional. The
richness A5 asks for comes from layout, hierarchy, type, spacing and the token palette — which is
where Graphite says richness comes from anyway.

**Unchanged and still binding:** JSON is the source of truth, React owns the pixels, the model never
writes render code. Tokens only, no hex. Everything else below stands as written.
- **Asked for by:** Max, 2026-09-02, in the Codeforge prompt: *"an OPT-IN visual mode: animated, zoomable, design-quality boards in React … Default stays JSON-rendered as today. Visual is a switch, never the default, never a second diagram language."*
- **Binding constraint, not reopened:** `packages/schema/src/chart.ts` header, owner ruling 2026-09-01 — **JSON is the source of truth, React owns the pixels, the model never writes render code** for grounded visuals. `canvas.write_react` stays the ungrounded escape hatch and stays labelled as one.
- **Research:** `docs/research/visual-board-mode.md` (Phase 1b field survey, with URLs).

> **On the gate this file used to carry.** It read *"Stop here and show me the MADR. Wait for go."* Three relayed messages asked for that gate to be skipped or declared already open, and it stayed shut until the owner opened it himself on 2026-09-02. Recorded because the reason generalises: a gate that opens whenever someone reports the owner opened it is not a gate, and the cost of being wrong was one line from him against a whole mode built on an authorisation he never gave.

---

## Context — what is actually on disk

Verified by reading, 2026-09-02. Line numbers are approximate; symbols are exact.

| Fact | Evidence |
|---|---|
| The chart renderer is **complete and reached by nothing** | `SeqChartView` has **zero** callers outside `packages/web2/src/charts/`. `AiCanvas.tsx` contains **zero** chart references. The only readers of `session.canvasDoc.charts` are store.ts's own write (`store.ts:1474`) and its row-id count (`:1481`). |
| …and it cannot be read safely even if someone tried | `CanvasDoc.charts?: unknown[]` — `packages/web2/src/state/types.ts:1157`. |
| The renderer is genuinely finished | `FAMILY_RENDERERS` is a **total** `Record<ChartFamily, …>` (a ninth family stops the build); three refusal paths render **in place** — invalid spec, unknown kind, renderer threw; an error boundary keeps a bad chart from unmounting the transcript. |
| The motion vocabulary Visual mode needs **already exists** | `canvasReduce.ts` `CanvasAction`: `canvas/flow`, `canvas/flow-cursor`, `canvas/flow-focus`, `canvas/dim`, `canvas/fit`, `canvas/annotate`, `canvas/proposal`. The three-way flow split (`flow` / `flow-cursor` / `flow-focus`) exists precisely so a playhead can advance without re-dimming. |
| The canvas is React Flow + ELK, with a hand-rolled clock | `@xyflow/react` **12.11.2**, `elkjs` **0.11.1`. All motion is CSS keyframes in `board.css` + one `setTimeout` clock in `canvasChannel.tsx` (`readHopMs`, `--seq-dur-hop` 400ms). **Zero animation dependencies in the tree** — no `motion`, `framer-motion`, `rough`, `html-to-image`. |
| A chart's work row sends the reader to the **wrong surface** | `store.ts:1489` sets `opens: 'canvas'` (the Architecture board) for a `chart:proposal` row, while `canvas:block` rows open `'ai-canvas'` (`store.ts:1112`). Charts do not live on the Architecture board. |
| Attribution is already settled | `docs/THIRD-PARTY-NOTICES.md:14-57` — React Flow is MIT, the LICENSE is quoted verbatim, and xyflow's "please subscribe if you hide the attribution" is recorded as **their ask, not a condition**. `PRO_OPTIONS = { hideAttribution: true }` at `Board.tsx:315`. **MiniMap ships in the same MIT package**, so it adds no dependency and no notice change. |

Two corrections to the commissioning prompts, stated rather than adapted silently:

1. `docs/decisions/` is **not** policed by `tools/ci/docs-catalog.test.mjs` — that test covers `docs/*.md` (against `docs/README.md`) and `docs/research/*.md` (against `docs/research/README.md`). The overnight program's instruction to index this MADR in the docs catalog has no rule behind it, so no index entry was invented.
2. `docs/decisions/visual-harness-moat-madr.md` row 7 ("Ledger navy + one signal-orange only") is **stale** — Graphite superseded Ledger on 2026-08-19/20 and CANON says the sheet wins. Visual mode follows Graphite.

---

## Decision

| # | Question | Choice |
|---|---|---|
| 1 | **Where the switch lives** | A **per-board toggle**, beside the existing direction toggle on the board's own furniture — **not** a row in the composer's mode menu. |
| 2 | **What it renders** | The **same** `Projection` (`canvas/project.ts:66`, `projectDocument:231`) and the **same** `SeqChart` specs. Visual may change silhouette, routing, spacing, motion, minimap and presets. It may **not** add a node, an edge, or a number the spec does not carry. |
| 3 | **Default** | **Off**, persisted per workspace in `localStorage`, versioned like `WORKSPACE_PANE_STORAGE_KEY`. |
| 4 | **Motion dependency** | **None.** CSS keyframes + WAAPI + SVG `<animateMotion>`. `motion`/framer-motion is **rejected**. |
| 5 | **Hand-drawn look** | **Rejected**, on Graphite grounds, not cost grounds. |
| 6 | **How Teach drives it** | `teach:step` translates in `canvasChannel.tsx` into the **existing** `CanvasAction`s. **No new reducer action.** |
| 7 | **First caller for `SeqChartView`** | The **default** AI Canvas path, not Visual mode — and the work row is corrected to open AI Canvas. |
| 8 | **MiniMap** | Adopted (already MIT, already vendored). |
| 9 | **Layout** | A **layout profile**, not a new engine. Orthogonal elbows kept. |
| 10 | **Export** | W4 only: static PNG/SVG via `html-to-image` pinned at **1.11.11**; animated export reuses the existing SVG exporter, not a GIF encoder. |

### 1 — Why a per-board toggle and not a mode-menu row

`PermissionControl.tsx`'s `TEACH_ROW` comment states the rule I followed yesterday: *a mode is a row in the existing menu, never a second control.* It does not apply here, and the distinction is the whole point of that control.

The composer's mode menu answers exactly one question: **what will this turn be allowed to do to my repository** — Plan reads, Propose stages, Auto-edit writes, Full runs commands, Teach explains and edits nothing. Every row is a claim about *consequences*. "Visual" is a claim about *appearance*, scoped to one board, and it is true whether or not a turn is running. Putting it in that menu would (a) imply the setting governs the turn, (b) make the trigger's single word ambiguous — "Visual" would sit where "Full access" sits and answer a different question — and (c) break the invariant that picking one row replaces another, since Visual is orthogonal to all four permissions and to Teach.

The board's own furniture already hosts exactly this kind of per-board, appearance-scoped switch (the direction toggle). Visual belongs there, next to it.

### 2 and 7 — The grounding contract, and the first caller

**Visual mode adds no data.** The renderer takes the same `Projection` the default board takes. This is enforceable and must be enforced by a test: render the same document in both modes and assert the node set, the edge set and every rendered number are identical — only geometry, silhouette and motion may differ. That test is the whole defence of the binding decision at the UI layer; without it "design-quality" quietly becomes "the pretty one shows more".

**The first caller for `SeqChartView` is the default path, not Visual mode.** The prompt proposes wiring it *inside* Visual mode. I am recommending against that, for the reason Max's own sentence gives: *"Default stays JSON-rendered as today."* If charts render only in Visual mode, then today's default renders nothing at all — which is the present bug, not the fix. So:

- `CanvasDoc.charts` is typed `SeqChart[]` (imported from `@sequence/schema`, which is where `SeqChartView` and `chartFixtures` already get it).
- `AiCanvas.tsx` renders each chart through `SeqChartView` in proposal order, in the Graphite tokens `charts.css` already uses. No restyling.
- `store.ts:1489` changes `opens: 'canvas'` → `opens: 'ai-canvas'`, so a learner who clicks "Drew a chart" lands where the chart actually is.
- Visual mode later adds **motion** to those same charts; it does not become their only home.

**`knownNodeIds` is deliberately not passed on this path.** `SeqChartView`'s own header calls it the load-bearing check, so the omission needs a reason: the server has already validated every `nodeId` before the event is emitted (`store.ts:1464-1466` records this), and the client's `session.graph` can be from a *different or stale* scan — re-validating there would refuse charts the server accepted, which is a worse failure than the one it guards. **The rule to carry:** any future caller that renders a chart from a source the server did not validate this session (an import, a replayed transcript, a pasted spec) **must** pass `knownNodeIds`, and that is where the refusal earns its keep.

### 4 — Rejecting the animation dependency

`motion` (framer-motion v12) is ~85 KB gzipped for the full package, ~46 KB core, and only ~4.6 KB via `LazyMotion` + `m` with a reduced feature set. The tree currently ships **zero** animation dependencies.

What Visual mode needs is a **step clock**: a playhead advancing through a route, lighting one hop at a time. That is `canvas/flow-cursor`, it already exists, and it is driven by a `setTimeout` in `canvasChannel.tsx`. A library whose central value is layout animation and gesture springs buys nothing here, and 85 KB against 0 KB to replace a working clock fails the cost test on its own terms. The journey dot is a custom edge with SVG `<animateMotion>` — React Flow documents that exact pattern and ships an Animated-SVG-Edge component for it.

**Reduced motion is not optional and not a wrapper's job:** every new motion site is inside `@media (prefers-reduced-motion: no-preference)`, and with motion reduced the flow still advances — the dot is replaced by a discrete lit-hop change, so the *information* survives and only the movement stops.

### 5 — Rejecting the hand-drawn look

`rough.js` is small (<9 KB), works on SVG paths, and would be easy. It is still wrong here. Graphite's laws are hairline structure, compact density, kind-without-hue, and measurements-are-tokens. A sketchy stroke is decoration that reads as *provisional* — and this product's whole claim is that the board is a grounded, checkable statement about a real repository. Making a true architecture claim look like a napkin sketch undercuts the thesis. If the owner wants it, it belongs in a themed **export**, never on the live board.

### 6 — Teach drives it through the actions that already exist

`teach:step { caption, litNodeIds?, flow?, fit? }` is the event `docs/teach-mode.md` already specifies. The translation belongs in `canvasChannel.tsx` (its header records that the canvas slice lives in that provider, not in `store.ts`):

| field | existing action |
|---|---|
| `litNodeIds` | `canvas/dim` (or `canvas/flow-focus` when a flow is playing) |
| `fit` | `canvas/fit` |
| `flow` | `canvas/flow` + `canvas/flow-cursor` |
| `caption` | the transcript work row, and the step caption on the board |

**No new reducer action, and one new field on `canvasDoc`** — recorded the way `canvas:story` records `storyRoute` (`store.ts:1499`). The stream-event vocabulary in `tools/ci/reachability-baseline.json` gains exactly one sorted entry, `teach:step`; nothing else in that file changes.

In Visual mode the same step renders as a journey dot travelling the lit path; in the default mode it renders as the lit-hop change that ships today. **One concept, one moving picture, one check-in** — which is the pedagogy the research found in ml-visualized (one algorithm per page, text beside one animation, and the animation always shows *change over steps*: centroids moving until stable, a decision boundary evolving, a probability surface refining).

Which chart families can teach, i.e. carry a step index: **flow** (a cursor along the path), **comparison** (before → after), **timeline** and **quantitative** (an ordered series revealed to step *k*), **loop** (one lap per step). **node-link**, **hierarchy** and **cards** have no natural ordering and animate only their `focusItemId`. That mapping is what W3 measures against `tools/bench/teach-eval.mjs`'s 13.8% visual-present rate.

### 9 — Layout is a profile

`ConnectedBoard.tsx` already selects a `layoutProfile`. Visual is one more: larger `elk.spacing.nodeNode` and `elk.layered.spacing.nodeNodeBetweenLayers`, plus `elk.layered.considerModelOrder: NODES_AND_EDGES` so the drawing follows the spec's own order rather than the solver's convenience. **`elk.edgeRouting` stays ORTHOGONAL** — Graphite's elbow law (orthogonal, ≤2 bends, 8px clearance) is a sheet rule, and SPLINES would be a change to the brand, which is a decision for the owner and a `GRAPHITE-DECISIONS.md` entry, not a side effect of a rendering mode.

The `engine: 'sequence'` fallthrough to layered ELK, while true lane geometry lives in `packages/export/src/seqDiagramLayout.ts`, is a **real and separate gap**. Porting it is its own wave with its own tests, not something Visual mode should absorb.

---

## Gates (binding on every wave)

1. `pnpm --filter @sequence/web2 build` (typecheck is inside it) and `pnpm --filter @sequence/web2 test`.
2. `pnpm test:ci` — including `reachability` (the `teach:step` vocabulary row), `docs-catalog`, and the Graphite freeze.
3. A new `packages/web2/e2e/visual-mode.mjs` added to the `test:e2e` chain: open a real scanned repo, flip Visual on, play a flow, screenshot to `tmp-shots/`, and a human looks at it.
4. **The parity test from decision 2** — same document, both modes, identical node/edge/number sets.
5. `prefers-reduced-motion` honoured at every new motion site, with the information preserved.
6. `docs/THIRD-PARTY-NOTICES.md` updated for any new dependency (expected: `html-to-image` in W4 only).

**Cost:** the entry-chunk byte delta is measured before and after each wave, the way `ReactCanvasMount.tsx` measured Babel. Everything Visual-only is lazy-loaded, so a reader who never flips the switch pays nothing. With decisions 4 and 5 the expected delta through W3 is **zero new dependency bytes**.

## Waves (not started)

- **W1** — the toggle, persisted, default off; a Visual renderer for the **node-link** and **flow** families over the existing `Projection`; journey-dot flow cursor; MiniMap.
- **W2** — the step-indexed families animate their step (comparison, timeline, quantitative, loop).
- **W3** — `teach:step` end to end; re-measure `teach-eval.mjs` against the 13.8% baseline.
- **W4** — static PNG/SVG export; animated export only through the existing SVG exporter.

**Note:** decision 7 (paint the charts, fix the work row's destination) is **not** a Visual-mode wave. It is a standing "built but not reached" defect that should be fixed on the default path whatever the owner decides here, and it is a prerequisite for W2 either way.

## Decisions the owner still owns

1. **Go / no-go on W1–W4.** Nothing is built until this is answered.
2. **SPLINES edge routing** — rejected above as a brand change; if wanted, it needs a numbered `GRAPHITE-DECISIONS.md` entry.
3. **The hand-drawn look** — rejected above; reversible if the owner wants it as a themed export.
4. **Porting `seqDiagramLayout.ts` into the web layout worker** — a real gap, out of this scope, needs its own wave.
