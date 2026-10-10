# Round 8: Boards (one concept, tagged tabs, agents can draw)

**End state.** The Architecture and Whiteboard surfaces are two views of one "Boards" store per
project: the Architecture board (the scanned graph with a drawing layer on top) plus any number of
drawing boards, shown as tag pills in a strip on both surfaces, and an agent can list, create and
draw on them through the MCP server while the open surface updates without a reload.

## What exists (read before building)

- `whiteboard/Whiteboard.tsx` + `whiteboardModel.ts`: an SVG drawing surface (stroke, rect,
  ellipse, line, arrow, text, node reference, AI-canvas artifact) with camera, undo and select.
  Persisted in **localStorage per chat session** (`sequence.whiteboard.<session>`). Agent items
  arrive from the chat stream (`session.boardAgentItems`, analyzer `boardTools.ts`).
- `canvas/Board.tsx` Draw mode: `StrokeLayer` captures ink, `inkToEdit` turns a box into a node and
  a line into an edge (a structural edit of the board document). No annotation layer.
- `/api/canvas-doc` is the per-session AI-canvas document; `/api/board` is the Task Board doc. There
  is no server store for drawings and no general event stream (SSE exists per feature: ask, scan,
  program runs, ACP).
- `packages/mcp`: `TOOLS` table; `CORE_TOOLS` (4 tools, 1,197 tokens, test ceiling 1,500) for a
  session Sequence starts; `SEQUENCE_MCP_TOOLS=all` (the "more tools" setting) gives every tool.

## Design

1. **Store** (`analyzer/src/boards/boardStore.ts`, pure fs, shared by the server and the MCP):
   `<root>/.sequence/boards/index.json` (id, name, kind, rev, times) and `<id>.json` (items, rev).
   Root is the attached repo, else the home workspace (`fileJailRoot`); the MCP resolves a linked
   worktree to its base, the same rule its graph uses. The `architecture` board always exists and
   cannot be deleted or renamed away from its kind; a default `Whiteboard` exists until deleted.
   Writes are **ops** (`put` item, `remove` id), applied to the latest file and written atomically
   (temp + rename), so a person's stroke and an agent's shape never clobber each other's document.
   Caps: 50 boards, 2,000 items, 500 chars of text, 2,000 points a stroke, coordinates within 1e6.
2. **Items** are the whiteboard's `WbItem`s plus `sticky` and three optional fields: `label` (a
   shape's caption), `fromId`/`toId` (an arrow bound to items or graph node ids) and `anchor` (a
   node id: the item's coordinates are offsets from that node's top-left, so it follows the node
   when the layout or a drag moves it). A drawing is never a node and carries no evidence; agent
   items carry `by: "agent"` and render with an agent tint.
3. **Routes** (`analyzer/src/server/boardsRoutes.ts`, one dispatch line in `repoServer.ts`):
   `GET/POST /api/boards`, `PATCH/DELETE /api/boards/:id`, `GET /api/boards/:id`,
   `POST /api/boards/:id/ops`, and `GET /api/boards/events` (SSE). The stream fires on the server's
   own writes and on `fs.watch` of the boards folder, which is how a write from the MCP process
   (another process) reaches the open tab.
4. **UI.** `canvas/boards/`: `BoardTabs` (tag pills: graph icon for the architecture board, pen for
   whiteboards, `+` to create, double-click to rename, x with B's ConfirmDialog to delete), the
   boards client (fetch + EventSource), the architecture board's annotation layer (rendered in flow
   space through `ViewportPortal`, loaded lazily), and the Draw palette (glass, floating): Sketch
   (the existing box-to-node gesture), Pen, Rect, Ellipse, Arrow, Text, Sticky, Erase. Space-pan
   and Esc keep their meaning. The whiteboard reads and writes the same store (one-time import of
   the session's localStorage sketch) and gains Sticky, labels and bound arrows. The top bar's
   Architecture and Whiteboard keep working: each opens its kind; a pill of the other kind switches
   surface through `requestHostCommand`.
5. **MCP.** `list_boards`, `create_board`, `draw` (ops: add/update/remove of rect, ellipse, arrow,
   line, text, sticky; positions, labels, `from`/`to` ids, `anchor` node id validated against the
   scanned graph). Descriptions say: the architecture board when the drawing explains the real
   system, a whiteboard for a free sketch. The drawing tools sit behind "more tools"; `draw` joins
   the core set only if the token test allows (measured and reported).

## Slices and gates

1. Store + routes + SSE: analyzer tests (ops, caps, refusal, events). **First slice.**
2. MCP tools: create board, add shapes, anchored shape, invalid input refused; token cost.
3. UI: tag strip, whiteboard on the store, annotation layer + palette; web2 tests (agent shape
   appears without reload, persistence across remount, tag strip create/rename/switch/delete).
4. Shots (1440x900, dark and light), full gate, log entry.

**Edge (out).** Multi-user presence and conflict UI; moving or resizing annotations on the
architecture board by drag (erase and redraw instead); the AI Canvas SeqDraw layer stays on
localStorage; no Excalidraw dependency (SVG by hand).
