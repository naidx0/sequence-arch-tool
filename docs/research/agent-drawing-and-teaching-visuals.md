# Why the drawings are bad, and what a tldraw-class agent canvas would actually take

**Research task, opened 2026-09-13 on the owner's instruction: "please be careful, don't rush
anything, do research. This is kind of like a research task, an innovation task. Create our own
harness AI consistent assistant tldraw version."**

He asked for this after a teach turn about how an LLM works drew three boxes — *Composer → Ask
pipeline → Provider* — and said, correctly: "is that how an LLM works? … the drawings are horrible,
and we need to rework it all from that."

He supplied six reference images: a force-directed network map, an attention-mechanism diagram
(Q/K/V → dot product → scaling·mask → softmax·dropout, with colour-mapped matrices), two frames of
[bbycroft.net/llm](https://bbycroft.net/llm) (scrollytelling text on the left, an interactive 3D
nano-gpt on the right), and [tldraw](https://tldraw.dev) driven by an agent.

Everything below is measured in this tree or read from source, and every number says where it came
from.

---

## 1. What is actually wrong, in three separable layers

The failure is not the model and it is not the prompt. It is three different ceilings stacked on top
of each other, and they need three different answers.

### Layer 1 — the floor asks for the weakest picture it knows how to ask for

`packages/schema/src/chart.ts` declares **40 chart kinds across 8 families**:

| family | kinds |
|---|---|
| node-link | system-architecture, network-map, ecosystem-map, concept-map, mind-map, relationship-map, dependency-map, stakeholder-map, cause-and-effect |
| flow | data-flow, information-flow, user-flow, code-to-outcome, how-it-works, incident-reconstruction, swimlane, sankey |
| hierarchy | hierarchy, organization, pyramid, layer, maturity-model, progression |
| timeline | roadmap, milestone, gantt, journey-map |
| quantitative | bar, line, donut, scatter, heat-map |
| comparison | comparison-table, comparison-matrix, quadrant, venn, pros-and-cons, spectrum, before-and-after |
| cards | statistic-cards, scorecard |
| loop | flywheel, feedback-loop |
| annotated | annotated-interface, exploded-interface |

Each family has a real renderer in `packages/web2/src/charts/`.

**And the teach drawer asks for exactly one of them, every time.**
`drawFromGeneralKnowledge` (`askPipeline.ts:1239`) hard-codes its prompt:

```
'{"kind":"data-flow","title":"<short title>","items":[{"id":"a","label":"<part>"}],
 "links":[{"from":"a","to":"b"}]}'
'Rules: 3 to 6 items; …'
```

`conceptChart.ts:155` does the same. **`kind: 'data-flow'`, three to six items.** That is the whole
explanation for three boxes: the product asked for three boxes. A transformer cannot be drawn in a
six-item flow chart, and nothing in the pipeline was ever going to try.

This is a defect with a one-file fix and it is the cheapest real improvement available.

### Layer 2 — box-and-arrow is the wrong grammar for most of what he showed

Even with the right `kind`, every one of the 8 families is nodes, edges, bars or cards. None of
the reference images is any of those:

| reference | what it needs | closest family today |
|---|---|---|
| attention (Q/K/V → softmax) | a **matrix with a colour scale**, plus flows in and out | heat-map, but it has no flow channel |
| token → index table | a **strip of labelled cells** in reading order | none |
| the transformer stack | a **layered stack with a tensor moving through it** | layer, but it cannot show a moving value |
| the network map | node-link with ~40 nodes and labelled curved edges | node-link, and this one genuinely fits |

So one of his six references is already expressible and five are not. Adding chart kinds does not
fix this; the *primitive* is wrong. What these have in common is that the picture carries **data** —
a matrix of numbers, a sequence of tokens, a value flowing — where our chart carries only labels.

### Layer 3 — the canvas deliberately runs no scripts, and his references are all interactive

`packages/web2/src/app/AiCanvasBlockBody.tsx` renders five block types, and this is the most
important fact in this document:

```tsx
<iframe className="ai-canvas-html-frame" sandbox="" srcDoc={doc} />
```

`sandbox=""` is the **most restrictive possible value** — no scripts, no forms, no same-origin.
And `canvas.write_react` does not execute React either: `extractStaticPreviewFromReact`
(`aiCanvasViewers.ts:27`) pulls static JSX out by regex and **returns null when the component is too
complex**, i.e. the moment it contains `{` or `useState`.

So today the AI Canvas can draw **markdown, mermaid, static SVG, static HTML, and a static extract of
React**. Every single thing the owner pointed at — the play buttons, the sliders, "Press Space to
continue", the 3D camera, the live `dot(…) = -0.14` tooltip — **requires script execution.**

That is not a missing feature. It is a security boundary someone chose on purpose, and moving it is
a decision for the owner, not a detail for a builder.

---

## 2. The good news nobody has used: the canvas already accepts SVG and HTML

`canvas.write_markdown`, `canvas.write_mermaid`, `canvas.write_html`, `canvas.write_react`,
`canvas.write_svg` are a shipped, closed set of writer tools (`askTools.ts:3828`). And
`canvasToolsEnabled` (`askPipeline.ts:1813`) opens with:

```ts
// Teaching IS drawing: every concept ships a visual, so the canvas belt is
// always offered in teach mode regardless of surface.
if (isTeachTurn(input)) return true;
```

**Every writer was available to the model during his session. It called none of them.** That is not
new either — this tree has already measured it and written it down:

> "The model does not call the tool: 5 calls in 296 teach turns on the bench, 0 in 12 runs of this
> question. … If the product wants a picture it has to draw one."
> — `teach-draws-general-knowledge.test.ts`

The conclusion that file reached is right and is already law here. What it did not do is apply the
same standard to the *quality* of the picture: the product draws one, and the one it draws is the
six-box flow chart. **A static SVG the product generates can be as good as the attention diagram he
showed.** Nothing about `sandbox=""` prevents that — SVG is inert markup.

---

## 3. tldraw: what it is, what it costs, and what is worth taking

### The licence is a real constraint, not a footnote

- The SDK is free in development; **production requires a licence key** (SDK 4.0, Sept 2025).
- Free/hobby use must keep the **"Made with tldraw" watermark on the canvas**.
- Removing the watermark requires a **paid business licence**.

Shipping tldraw inside Sequence therefore means either a competitor's watermark on our core surface
or a recurring bill. That has to be the owner's call and it should be made before any code.

### Its agent design is not MCP, and that half is free to copy

[`tldraw/agent-template`](https://github.com/tldraw/agent-template) — the owner is right that this is
the interesting part, and right that it is not MCP. Its architecture:

- **Prompt parts** — what the agent *sees*. The canvas is serialised three ways at once: **"blurry"**
  (a viewport overview), **"focused"** (full properties for what matters), **"peripheral"**
  (clusters outside the viewport), alongside a screenshot, the selection, the chat history, and
  "lints" flagging problems.
- **Agent actions** — what the agent *does*. A closed set of operations defined as **Zod schemas**;
  the model emits structured JSON, which is **sanitised and validated before it is applied**.
- **Streaming** — actions arrive incrementally and are applied **only when complete**, so a
  half-parsed shape never lands on the canvas.
- **Modes** — which parts and actions exist changes with the stage of the work.

Read against this repo, that design is *familiar*: `propose_chart` already validates against the
scanned graph and refuses invented `nodeId`s; `canvas.write_*` is already a closed writer set. What
Sequence does not have is the **read** half — the agent cannot see what is on the canvas, in any
resolution, ever.

### The recommendation

**Port the protocol, not the package.** Reasons, in order:

1. The licence above.
2. tldraw brings its own UI, and `docs/brand/GRAPHITE-DECISIONS.md` governs every surface here. Two
   design systems on one canvas is the fight this repo already had once with v1.
3. **Sequence already has two canvases** — `packages/web2/src/canvas/` (the architecture board:
   `Board.tsx`, `ElbowEdge.tsx`, `NodeCard.tsx`, camera, zoom clusters, 1,793 lines of `board.css`)
   and `packages/web2/src/whiteboard/`. The missing piece was never the canvas. It is the read/write
   protocol between the agent and it.
4. CLAUDE.md's own rule: *prefer porting a proven approach over inventing one here.* The proven thing
   is the protocol.

---

## STATUS, 2026-09-14 — SeqDraw (own TLDraw) lands

Owner: recreate our own TLDraw on AI Canvas; study tldraw agent/MCP/offline
patterns (skills, create/update/delete, campus-map demos); **do not vendor tldraw**.

| piece | state |
|---|---|
| Spatial canvas on AI Canvas (SeqDraw) | **done** — `ConnectedAiCanvas` mounts Whiteboard under `seqDrawKey` |
| `board:item` wire → client | **done** — `api-types` + store `boardAgentItems` + append-by-id |
| ConnectedWhiteboard | **done** — Whiteboard tab gets agent marks |
| Agent tools `board.add_*` | **already on server**; now reach the UI |
| Skill `.agents/skills/seqdraw` | **done** |
| Campus-map locking test | **done** — `seqDraw.test.ts` + `boardItemStream.test.ts` |
| 3D (bbycroft) | still deferred — SeqDraw is 2D spatial + charts |

Stages 1–4 below remain the research record for chart quality / sandbox.

---

## STATUS, 2026-09-14 — the staging is complete

| stage | state |
|---|---|
| 1 · stop asking for six boxes | **done** — the drawer picks a kind from a named vocabulary, 4–12 items |
| 2 · a visual grammar that carries data | **done** — `token-strip`, `matrix`, `layered-stack`, `annotated-flow` |
| 3 · the agent can SEE the canvas | **done** — `surface.canvas` (blurry + focused), `blockId` revision |
| 4 · interactivity | **done** — `sandbox="allow-scripts"` + a `default-src 'none'` CSP, Decision 15 |
| (owner's own add) select a drawn part and ask about it | **done** — `onSelectPart`, one delegated handler over all eight families |

§4's recommendation for stage 4 was *"a closed set of product-authored interactive widgets"* over
`allow-scripts`, on the grounds that the second was "almost certainly right". **The owner chose
`allow-scripts` (2026-09-14) and it shipped that way** — with the two guards Decision 15 records,
which is what makes the choice defensible rather than merely faster. The recommendation is left below
as written, because a prediction that was overruled is evidence about this document, not an error to
erase.

3D (`bbycroft/llm-viz`) remains the one thing not attempted, for the reason §4 gives: it is a bespoke
application, not a library, and stage 2 gets most of the teaching value at a fraction of the cost.

---

## 4. Proposed staging

Each stage is independently shippable and independently verifiable. None depends on the next.

### Stage 1 — stop asking for six boxes *(small, no decisions needed)*

Let the derived drawer choose a `kind` from the real vocabulary for the subject, and raise the item
cap. A transformer explanation becomes a `layer` or `progression` chart with the parts that actually
exist rather than a three-box flow. **This is a defect fix, not a feature**, and it is the only thing
in this document that should land without a conversation first.

### Stage 2 — a visual grammar that can carry data *(medium; the real quality win)*

Product-authored **SVG generators**, one per explanatory shape, called from the teach floor the same
way `buildConceptChart` is called today — because the product drawing it is already this tree's
settled answer to "the model will not call the tool":

- `token-strip` — a sequence of labelled cells with indices (his image 4, left pane)
- `matrix` — a grid with a colour scale and a legend (his image 3)
- `layered-stack` — repeated blocks with a value threaded through (his images 4 and 5)
- `annotated-flow` — a flow whose edges carry values, not just labels

These are static SVG. They need **no** sandbox change, no licence, and no new dependency, and they
would move the LLM lesson from three boxes to something a person could actually learn from.

### Stage 3 — the agent can SEE the canvas *(the tldraw protocol, ported)*

A `canvas.read` belt tool returning the blurry / focused / peripheral serialisation, so a turn can
revise a drawing instead of only ever replacing it. This is the half that makes a canvas
*conversational*, and it is the single most valuable idea in the tldraw template.

### Stage 4 — interactivity, which is a security decision first

His references are interactive. Interactivity means scripts, and `sandbox=""` says no scripts today.
The options, honestly stated:

- **`sandbox="allow-scripts"` in the canvas iframe.** Model-authored JS then runs in the user's app.
  The frame is cross-origin-ish by `srcDoc`, but this is still a genuine widening and it should be
  written down as a decision with its threat model, not slipped in.
- **A closed set of product-authored interactive widgets** parameterised by model-supplied data. The
  model chooses `matrix-walkthrough` and supplies the numbers; *our* code runs. No arbitrary script
  executes, and this fits every rule this repo already has.

**The second is almost certainly right**, and it is also how the references work in practice:
bbycroft's is one bespoke renderer driven by data, not a general script host.

### On 3D, plainly

[bbycroft/llm-viz](https://github.com/bbycroft/llm-viz) is **MIT** (excluding his personal homepage
and third-party assets), TypeScript, with a renderer flexible enough for arbitrary network sizes.
The licence permits reuse. It is also a bespoke application, not a library, and it is a very large
amount of work — the owner said as much himself: "it's a whole website, it took a lot of work."
Stage 2 gets most of the teaching value at a fraction of the cost. 3D should not be attempted until
stages 1–3 exist.

---

## 5. What this document does not claim

It does not claim stage 2 will make the local model's *prose* better. The lesson text in his session
("Input Request Pipeline → Model Inference Engine → Response Generator") was shallow independently of
the picture, and `minicpm5-hermes` is a small model. Better pictures and better words are different
problems and this file is only about pictures.

## Sources

- [tldraw/agent-template](https://github.com/tldraw/agent-template)
- [tldraw licence](https://tldraw.dev/community/license)
- [tldraw SDK 4.0 — starter kits and licensing changes](https://alternativeto.net/news/2025/9/tldraw-sdk-4-0-adds-five-new-starter-kits-cli-tool-and-enforces-licensing-changes/)
- [bbycroft/llm-viz](https://github.com/bbycroft/llm-viz) · [LLM Visualization](https://bbycroft.net/llm)
