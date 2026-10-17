# Visual Board Mode — field research (Phase 1b)

Measured 2026-09-02 for `docs/decisions/visual-board-mode-madr.md`. Read-only: no code changed.
Every finding carries its source. Recommendations are proposals for the MADR, not rulings.

Three of the six answers are **recommendations to reject** something the brief floated. That is the
useful half — the cheapest wave is the one that does not add a dependency.

## Q1 — `@xyflow/react` 12.11.x: motion, MiniMap, licensing

- **The journey dot is a documented first-class pattern, not a hack.** React Flow's own example
  animates a circle along an edge path with SVG `<animateMotion>` inside a custom edge built from
  `getBezierPath` / `getSmoothStepPath`, and there is a published **Animated SVG Edge** component
  whose shape is a React component taking one `animateMotionProps`.
  https://reactflow.dev/examples/edges/animating-edges · https://reactflow.dev/ui/components/animated-svg-edge
- A DOM alternative exists (CSS `offset-path` + animating `offsetDistance`), which survives edge-path
  recalculation if the path and the animation are set up in separate effects.
  https://reactflow.dev/learn/customization/custom-edges
- **Cost caveat worth carrying into the wave:** edge-animation cost scales with edge count — animate
  the lit path, never every edge. https://liambx.com/blog/tuning-edge-animations-reactflow-optimal-performance
- **Licensing: already answered in this repo, no new obligation.** `docs/THIRD-PARTY-NOTICES.md:14-57`
  records React Flow as MIT, quotes the LICENSE verbatim, and states that xyflow's request to
  subscribe when hiding the attribution is *their ask, not a licence condition*. The upstream
  position agrees: "React Flow can't legally require you to keep the attribution — React Flow is
  MIT-licensed." https://reactflow.dev/remove-attribution · https://github.com/xyflow/xyflow/discussions/2961
  **MiniMap ships inside the same already-pinned MIT package**, so adopting it adds no dependency
  and changes no notice.

**Recommendation:** journey dot via `<animateMotion>` on a custom edge; MiniMap adopted as-is.

## Q2 — motion library vs hand CSS / WAAPI

| Option | Bundle | Reduced motion | Fit for a step clock |
|---|---|---|---|
| `motion` (framer-motion v12, `motion/react`) | ~85 KB gz full; ~46 KB core; ~4.6 KB only via `LazyMotion` + `m` | native `reducedMotion` | poor fit — its value is layout animation and gesture springs |
| CSS keyframes + WAAPI | **0 KB** | one media query | exact fit — this is what the repo already does |
| SVG `<animateMotion>` | 0 KB | gate the element | exact fit for a dot on a path |

Sources: https://www.pkgpulse.com/compare/framer-motion-vs-react-spring ·
https://motion.dev/docs/react-reduce-bundle-size · https://motion.dev/docs/feature-comparison ·
https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

The tree ships **zero** animation dependencies today; all motion is CSS keyframes in `board.css`
driven by one `setTimeout` clock in `canvasChannel.tsx` (`readHopMs`, `--seq-dur-hop` 400ms).

**Recommendation: reject the dependency.** 85 KB against 0 KB, to replace a working clock, for a
feature whose motion is *step-advanced* rather than physics- or layout-driven. Revisit only if a
later wave needs something WAAPI genuinely cannot express.

## Q3 — ELK options that read as designed rather than packed

Supported in `elkjs` 0.11.x: `elk.algorithm: layered`, `elk.direction`, `elk.spacing.nodeNode`,
`elk.layered.spacing.nodeNodeBetweenLayers`, `elk.spacing.edgeNode`,
`elk.edgeRouting: ORTHOGONAL | POLYLINE | SPLINES`, `elk.alignment`,
`elk.layered.nodePlacement.favorStraightEdges`, `elk.layered.considerModelOrder: NODES_AND_EDGES`,
`elk.layered.crossingMinimization.semiInteractive`.
https://github.com/eclipse-elk/elk/issues/839 · https://github.com/clientIO/joint/discussions/3296

**Recommendation:** treat Visual as one more `layoutProfile` (the seam already exists in
`ConnectedBoard.tsx`) — more spacing, `considerModelOrder` so the drawing follows the spec's order.
**Keep ORTHOGONAL**: Graphite's elbow law (orthogonal, ≤2 bends, 8px clearance) is a sheet rule, so
SPLINES would be a brand change needing a numbered `GRAPHITE-DECISIONS.md` entry — not a side effect
of a rendering mode.

Separately: `engine: 'sequence'` falls through to layered ELK while true lane geometry lives in
`packages/export/src/seqDiagramLayout.ts`. That is a real gap and its own wave.

## Q4 — export

- The official recipe is `html-to-image`'s `toPng` over `.react-flow__viewport`, framed with
  `getNodesBounds` + `getViewportForBounds`. https://reactflow.dev/examples/misc/download-image ·
  https://reactflow.dev/api-reference/utils/get-viewport-for-bounds
- **Pin `html-to-image` at 1.11.11** — later versions are widely reported to break this use.
  https://medium.com/@roman_fedyskyi/react-flow-tips-that-actually-matter-in-production-db7c093932f6
- Known trap: content outside `.react-flow__viewport` is missing from the capture.
  https://github.com/wbkd/react-flow/issues/2118

**Recommendation:** static PNG/SVG in W4 with the pin and a notices entry. For *animated* export,
reuse `packages/export/src/renderSeqDiagramSvg.ts` and `app/canvasExportHtml.ts` — an animated SVG
from the grounded spec is cheaper, smaller and more honest than recording the DOM. No GIF encoder.

## Q5 — the teaching pedagogy, and which of our families can carry it

`ml-visualized.com` (Gavin Hung; Jupyter Book; notebooks downloadable as `.ipynb`; source at
https://github.com/gavinkhung/machine-learning-visualized). Four chapters, and in every one the
animation shows **change over steps**:

1. **Optimization** — gradient descent (parameters moving toward the optimum), optimizer comparison
   (convergence paths raced side by side), interactive linear regression.
2. **Clustering / reduction** — PCA (variance discovered), k-means (**centroids moving until stable**).
3. **Linear models** — perceptron (**decision boundary evolving**), logistic regression
   (**probability surface refining over iterations**).
4. **Neural networks** — loss-landscape navigation, per-layer transformations, autoencoder
   (reconstruction quality and latent space organising during training).

Page shape: **one concept per page, explanatory text beside one animation.** Lineage for the format —
Ciechanowski, Distill, Nicky Case — is the same spine: one concept, one moving figure.
https://ml-visualized.com/ · https://enjalot.github.io/moonshine/ ·
https://notes.andymatuschak.org/zRXEyTA5YxgqiBP3UE3C6si

**The transferable rule: the animation must show change over steps, or it is decoration.** Mapped
onto our eight families:

| Family | Natural step index? | What a step animates |
|---|---|---|
| flow | yes | the cursor advancing one hop |
| comparison | yes | before → after |
| timeline | yes | reveal to step *k* |
| quantitative | yes | an ordered series to index *k* |
| loop | yes | one lap per step |
| node-link | no | `focusItemId` only |
| hierarchy | no | `focusItemId` only |
| cards | no | `focusItemId` only |

That split is what W3 measures against `tools/bench/teach-eval.mjs` and its 13.8% visual-present rate.

## Q6 — hand-drawn / "designed" looks

`rough.js` is **<9 KB gzipped**, works on Canvas *and* SVG, and can re-draw an existing SVG path
sketchily; `svg2roughjs` converts a whole document.
https://roughjs.com/ · https://github.com/rough-stuff/rough · https://www.npmjs.com/package/svg2roughjs

**Recommendation: reject — on design grounds, not cost.** Graphite's laws are hairline structure,
compact density, kind-without-hue, measurements-as-tokens. A sketchy stroke reads as *provisional*,
and this product's claim is that the board is a grounded, checkable statement about a real
repository. A true architecture claim drawn as a napkin sketch undercuts the thesis. If the owner
wants it, it belongs in a themed export, not on the live board.

## Seams verified while answering

- `packages/web2/package.json`: `@xyflow/react` 12.11.2, `elkjs` 0.11.1; **no** `motion`,
  `framer-motion`, `rough`, or `html-to-image`.
- `Board.tsx:315` `PRO_OPTIONS`, used at `:976`; the licence reasoning is at
  `docs/THIRD-PARTY-NOTICES.md:14-57`.
- `SeqChartView` has zero callers outside `packages/web2/src/charts/`; `AiCanvas.tsx` has zero chart
  references; `session.canvasDoc.charts` is typed `unknown[]` at `state/types.ts:1157` and read by
  nothing but `store.ts`'s own write and count.
- The motion vocabulary already exists in `canvas/canvasReduce.ts`: `canvas/flow`,
  `canvas/flow-cursor`, `canvas/flow-focus`, `canvas/dim`, `canvas/fit`, `canvas/annotate`.
