# AI Canvas moat audit — 2026-09-18

Read-only pass over the AI Canvas at `6225090f`. Every claim below names the file
that proves it. Where a number is stated it was counted, not estimated.

## (a) What of the READER'S OWN drawing reaches the model today

The AI Canvas is a `Whiteboard` (`app/AiCanvas.tsx:405`) keyed by `seqDrawKey(activeId)`,
with the agent's charts and blocks appended as `artifact` frames
(`app/materializeCanvasArtifacts.ts:32`). The reader draws on that same plane.

| What the reader made | Reaches the model? | Proof |
| --- | --- | --- |
| Artifact frames (agent blocks/charts) | Yes — id, type, title, chars, and an excerpt for the newest only | `state/store.ts:1279` `withCanvasState` → `explain/askSurface.ts:548` |
| Text notes on the AI Canvas plane | **No** | `ConnectedAiCanvas` passes no `onDocChange` (`app/AiCanvas.tsx:405-410`); the doc lives in `Whiteboard`'s own `useState` (`whiteboard/Whiteboard.tsx:176`) |
| Noderefs on the AI Canvas plane | **No** | same |
| Freehand strokes | **No**, on either surface | same |
| Whiteboard-tab items | Only the AGENT's — `withBoardState` is fed `state.session.boardAgentItems` (`state/connect.tsx:610`), never the human document |

So the wire has a board channel (`AskSurfaceBoard`, positions included, 40-item cap,
`explain/askSurface.ts:199`) and the freeform plane never fills it. The one human path
is the Whiteboard toolbar's Ask button → `askFromWhiteboard` (`whiteboard/whiteboardAsk.ts:95`),
which drafts composer text carrying notes verbatim, noderefs as `label (nodeId)`, and
strokes as a bare count — "N marks with no words on them, which I cannot read"
(`whiteboardAsk.ts:128`). `ConnectedAiCanvas` does not pass `onAsk`, so the AI Canvas
does not even have that button.

`packages/ink` classifies a stroke as `box` (with its rect), `line` (with endpoints) or
`scribble`, scale-invariantly (`ink/src/index.ts:194`). Two callers use it —
`canvas/ConnectedBoard.tsx:92` and `whiteboard/Whiteboard.test.tsx:4` — and **nothing
turns a recognised shape into anything the model sees.**

## (b) What the agent can draw, and where it is told to

> **Correction, 2026-09-18 (same day, later).** Until this date a `mermaid` block rendered
> as its own source: `AiCanvasBlockBody.tsx` printed the definition in a `<pre>` and
> `packages/web2` had no mermaid dependency at all, so the agent's best drawing tool printed
> text where it had promised a diagram (the walk's "explain how a language model turns a
> prompt into the next token" turn is the specimen). Fixed in `packages/web2/src/app/MermaidBlock.tsx`:
> mermaid 11 loaded on first use as its own chunk, themed from the Graphite tokens (one ink,
> one surface, one edge, the accent), fitted to a 960px cap with a 0.7 legibility floor, and
> a unicode-arrow repair (`—»` to `-->>`) tried only after the source as written fails to
> parse. Under jsdom the block keeps the source, so the tests below it still read the box.

Five writers, closed set: `canvas.write_markdown | _mermaid | _html | _react | _svg`
(`server/canvasTools.ts:16`), each `{title?, content, blockId?}`; `blockId` must be an id
the client listed or the write is refused (`canvasTools.ts:242`). 120,000-byte payload cap
(`canvasTools.ts:208`). Plus `canvas.set_story_route` (`canvasTools.ts:142`).
Charts: `propose_chart` over `CHART_KINDS` (`askTools.ts:renderChartToolHintSection`).
Whiteboard writes: `board.add_note | add_card | connect | frame` (`boardTools.ts:80`)
and the structured `diagram.*` set.

Where it is told: `renderCanvasToolHintSection` (`askTools.ts:4559`, 13 lines — fence
syntax, the closed set, "INTERACTIVE IS ALLOWED", revise-don't-pile-up);
`renderChartToolHintSection` (`askTools.ts:4600`); `HOME_WORKSPACE_CANVAS_SECTION`
(`askPipeline.ts:1322`). Assembled in `renderAskInstructionBelt` (`askPipeline.ts:1337`).
**Nothing in any of them teaches block CRAFT** — which kind fits which ask, one idea per
block, node budgets, edge labels, or motion. `write_svg`'s whole schema description is
"SVG markup (no script)" (`canvasTools.ts:110`).

Gating (`canvasToolsEnabled`, `askPipeline.ts:2279`): teach turn, or surface `ai-canvas`,
or home workspace (design + no repo), or `isDrawishAskQuestion`. All five writers share
that one gate at the door (`askTools.ts:1506`) — there is no per-writer mode gate, so
`write_html` / `write_react` are never on when the others are off. One inversion: on a
plot/math ask **every** canvas writer is refused outright in favour of `propose_chart`
(`askTools.ts:1495`).

## (c) Can a block animate today

Yes, both ways, and nothing strips them — but nothing tells the model so.

- **HTML block** → `<iframe sandbox="allow-scripts">` with a `srcDoc` carrying
  `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`
  (`app/aiCanvasViewers.ts:55`, rendered `app/AiCanvasBlockBody.tsx:165`). `style-src
  'unsafe-inline'` permits an inline `<style>` with `@keyframes`; `script-src
  'unsafe-inline'` permits `requestAnimationFrame` loops. Script stripping runs only on the
  non-interactive path (`aiCanvasViewers.ts:44`, `scripts:false`), which is React preview.
- **SVG block** → inlined into the host DOM via `dangerouslySetInnerHTML`
  (`AiCanvasBlockBody.tsx:151`), outside any iframe, so SMIL `<animate>` /
  `<animateTransform>` and CSS animation run under the host page's rules.
- **What the CSP blocks**: every network fetch — `fetch`, XHR, WebSocket, form posts,
  remote fonts, remote scripts, remote images (only `data:` images survive). A remote
  three.js or a Google font does not error visibly; it renders an empty box.

## (d) The tldraw gap

| Capability | State | Proof |
| --- | --- | --- |
| Selection | **partial** — single item, click-to-select; no marquee, no multi-select | `whiteboard/Whiteboard.tsx:203` (`selected: string \| null`) |
| Move / drag | have — applied once on pointer release | `Whiteboard.tsx:204-205`, `whiteboardModel.ts:148` (`wb/move`) |
| Resize | **partial** — `wb/resize` exists but is driven only by a `ResizeObserver` content-fit on artifact frames; no handles | `whiteboardModel.ts:150`, `Whiteboard.tsx:347`, `Whiteboard.tsx:1121` |
| Rotate | **none** — no edit, no state, no handle | `whiteboardModel.ts:147-153` (whole edit vocabulary is add/move/resize/text/delete/clear) |
| Connectors (bound, re-routing) | **none** for the human — `arrow` is a free shape with fixed endpoints; the agent's `board.connect` is grounded but static | `whiteboardModel.ts:70`, `boardTools.ts:116` |
| Grouping / frames | **none** for the human (`WbArtifact` frames are agent-created only) | `whiteboardModel.ts:87`, `materializeCanvasArtifacts.ts:32` |
| Undo | have, 50 frames; **no redo** | `whiteboardModel.ts:145`, `Whiteboard.tsx:352` |
| Export (PNG/SVG/file) | **none wired** — `app/canvasExportHtml.ts` has zero production callers and the button was removed | `app/AiCanvas.tsx:170` |
| Multiplayer / presence | **none** — the document is `localStorage` under a session key | `Whiteboard.tsx:172`, `whiteboardModel.ts:401` |

## (e) The three highest-leverage changes

1. **The agent reads the drawing.** The board channel already exists on the wire and the
   renderer already prints it (`askSurface.ts:511`); the freeform plane simply never fills
   it, and strokes arrive unnamed even when it does. Feeding notes, noderefs and
   ink-recognised shapes into `AskSurfaceBoard` is the difference between "the reader is on
   the AI Canvas" and "the reader drew three boxes and an arrow next to this note".
2. **Teach block craft, and say that motion is legal.** The belt names the tools and never
   says which one fits the ask, how big a diagram may get, or that `@keyframes` and
   `<animate>` already work inside the sandbox. This is prompt-only and touches no renderer.
3. **"Explain this file" must land a picture.** With a repo attached `canvasToolsEnabled`
   reduces to `isDrawishAskQuestion` (`askPipeline.ts:2296`), and "explain src/foo.ts",
   "what does foo.ts do" match nothing in `DRAW_PATTERN` (`askIntent.ts:25`) and nothing in
   the teach tiers. So the single commonest ask in a code-reading tool is prose-only by
   construction — the canvas writers are refused at the door for that turn
   (`askTools.ts:1506`).
