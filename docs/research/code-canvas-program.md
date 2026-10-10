# The Code Canvas — the tldraw equivalent, and the programs around it

**Opened 2026-09-14 on the owner's instruction: "MAKE THE TL DRAW EQUIVALANT NOW AND ADD THAT CANVAS
IN OUR PLATFORM … MAKE A MASSIVE PLAN ON WHAT TO DO AND BUILD AND THEN USE YOUR SUBAGENTS."**

---

## 0. The finding that shrinks this from a rewrite to a wiring job

**We already have the canvas.** `packages/web2/src/whiteboard/` is a spatial surface with everything
a tldraw-class board needs as a substrate:

| it has | where |
|---|---|
| an infinite pan/zoom camera | `whiteboardCamera.ts` — reuses `canvas/camera.ts`'s zoom stops rather than inventing a second set |
| a document of items | `whiteboardModel.ts` — `WbStroke`, `WbShape`, `WbText`, **`WbNodeRef`** |
| an edit vocabulary | `wb/add`, `wb/move`, `wb/text`, `wb/delete`, `wb/clear` |
| undo, 50 deep | `WB_UNDO_DEPTH`, matched to `docSession` on purpose |
| freehand ink | `strokeFrom`, the `ink` package behind it |

And `WbNodeRef` — *"a reference to a real node of the scanned graph"* — **has existed since the model
was written and nothing produces one.** The seam for "a shape that stands for real code" is already
cut and has never been used.

**What is missing is not the canvas. It is the same thing that was missing on the AI Canvas until
this week: the agent cannot see it, and the agent cannot draw on it.** Measured — `grep` for any
whiteboard reference in `packages/analyzer/` returns two comment mentions and no code.

So this is not a fourth surface. It is the Whiteboard finished.

### Why not a fourth surface, stated so nobody rebuilds it

`docs/CANON.md` and the pivot both say the workspace is ONE canvas. Three spatial surfaces already
exist and each has a job:

- **Architecture** — the *grounded scan*. Its nodes are what the walker found; you may not put a
  free shape on it, and that refusal is the product's first law made visible.
- **AI Canvas** — a *document* of typed blocks, top to bottom. Not spatial, and not meant to be.
- **Whiteboard** — a *spatial, free* surface. This one.

A fourth would have to steal its job from one of those three.

---

## 1. What "tldraw equivalent" actually means here

From the owner's own reference session: draw natively and at once, the person selects a drawn part
and asks about it, and the agent can revise rather than redraw. Three capabilities:

1. **The agent DRAWS** — a closed, validated set of board writers.
2. **The agent SEES** — the board serialised into the prompt, so a turn can revise.
3. **The person POINTS** — select a shape, and it becomes the subject of the next question.

Two and three are already solved *on the AI Canvas*, this week, and the shapes of those solutions
port directly: `AskSurfaceCanvas` (blurry + focused) for the read half, `blockId` for revision, and
`onSelectPart` + a `chart-part` chip for pointing.

**The fourth capability, which is this surface's own:** a shape that carries REAL CODE.
`WbNodeRef` is a label and a node id. A code card shows the actual file, the actual symbol, the
actual lines — grounded, refusing anything the scan does not have.

---

## 2. The waves

Each item names the files it owns. Nothing in a wave touches another item's files, which is what
lets them run at once.

### Wave 1 — the canvas becomes the code canvas

| # | what | owns |
|---|---|---|
| 1.1 | **Board writer tools** — `board.add_note`, `board.add_card`, `board.connect`, `board.frame`. Validated; a card naming a node the scan does not have is refused whole. | `packages/analyzer/src/server/boardTools.ts` (new) + its test |
| 1.2 | **The code card** — a shape that shows a real file/symbol with its source excerpt, its path, and its line range. The thing `WbNodeRef` was cut for. | `packages/web2/src/whiteboard/CodeCard.tsx` (new), `codeCard.css`, test |
| 1.3 | **The read half** — `surface.board` on the wire, blurry + focused, so a turn can revise instead of appending. | `askSurface.ts`, `api-types/src/ask.ts` |
| 1.4 | **Wiring** — tool registration, the `board:item` stream event, the store reducer, the belt hint. | `askTools.ts`, `askPipeline.ts`, `state/store.ts`, `Whiteboard.tsx` |
| 1.5 | **Point and ask** — select a shape → a `board-item` chip, the `chart-part` pattern one surface over. | `Whiteboard.tsx`, `connect.tsx` |

### Wave 2 — the IDE panel

| # | what | owns |
|---|---|---|
| 2.1 | **Files panel** — a Cursor-style side panel: tree, open file, diff view, multiple editing options. | `packages/web2/src/files/` (new dir) |
| 2.2 | **Diff plumbing** — the engine already has `git_diff` and `GitDiffResult`; the panel reads them. | `files/` + existing endpoints |

### Wave 3 — the session lock

| # | what | owns |
|---|---|---|
| 3.1 | **A locked chat drives the tabs.** The chat's answers steer which surface is showing and what it shows; every OTHER chat stays hand-usable. One lock at a time, and it is visible. | `state/types.ts`, `state/store.ts`, `App.tsx` |

---

## 3. The laws this program does not get to bend

- **Grounded, not guessed.** A code card cites a real path and real lines or it is refused. The
  board is a *sketch* surface, so a note may say anything — but a card that claims to be code must
  be code, and the two must never look alike.
- **The refusal is whole.** One invented id voids the whole call, as `propose_topology` and
  `walk_example` already do. A half-applied board edit is a board the reader cannot trust.
- **The read half is prompt parts, not a tool.** Settled on the AI Canvas: the client holds the
  document, so a `read` tool would round-trip to the browser for state the request could carry.
- **Hue budget 0.** A card is a shape, not a verdict.
