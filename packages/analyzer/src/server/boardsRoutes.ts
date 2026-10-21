/* ══════════════════════════════════════════════════════════════════════════
   /api/boards — the routes over the boards store, and the stream that tells
   an open tab an agent drew
   packages/analyzer/src/server/boardsRoutes.ts

     GET    /api/boards                the project's boards (?chat=<id>: that chat's, plus the architecture board)
     GET    /api/boards/linkable       ?chat=<id>  other chats' boards by chat, and earlier ones (the add-from picker)
     POST   /api/boards/:id/link       {chat}  add the chat to the board (linked, not copied)
     POST   /api/boards                {name, kind?}  create a whiteboard
     GET    /api/boards/events         SSE: {type:"boards", id?, rev?} on any change
     GET    /api/boards/:id            one board's items
     PATCH  /api/boards/:id            {name}  rename
     DELETE /api/boards/:id            delete (never the architecture board)
     POST   /api/boards/:id/ops        {ops:[{op:"put",item}|{op:"remove",id}]}
     GET    /api/boards/:id/render.svg ?group=<id> | ?items=<id,id>  those items as one themed SVG (the inline preview)
     POST   /api/boards/edit-log       {events:[{t,board,kind,data?}]}  append to .sequence/board-edits.jsonl
     GET    /api/boards/edit-log       {enabled, events}  what this machine recorded (read-only)

   THE STREAM WATCHES THE FOLDER, NOT ONLY THIS SERVER'S WRITES. The MCP
   server an agent draws through is another process; it writes the same files
   (`boardStore.ts`), and `fs.watch` on `.sequence/boards/` is how that write
   reaches the tab. The repo watcher skips `.sequence` on purpose (a drawing
   is not a change to the code), so this is its own watcher, opened while a
   tab listens and closed when the last one leaves.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import type http from 'node:http';

import {
  BoardError,
  applyBoardOps,
  boardsDir,
  createBoard,
  deleteBoard,
  linkBoard,
  linkableBoards,
  listBoards,
  listBoardsForChat,
  listBoardsAsync,
  listBoardsForChatAsync,
  removeBoardFromChat,
  readBoard,
  renameBoard,
  type BoardOp,
} from '../boards/boardStore.js';
import { renderItemsSvg, selectItems } from '../boards/boardRender.js';
import { deliverFile, fileDeliveriesPath, readFileDeliveries } from '../boards/fileDelivery.js';
import { EditLogError, appendBoardEdits, boardEditLogEnabled, readBoardEdits } from '../boards/boardEditLog.js';

export interface BoardsRouteDeps {
  /** The project root (attached repo, else the home workspace); null when neither exists. */
  root: string | null;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  sendError: (res: http.ServerResponse, status: number, message: string) => void;
}

/** The most items one render.svg draws; a longer selection is cut, and says so (header x-board-truncated and a line in the SVG). */
export const RENDER_CAP = 500;

type Listener = (event: { type: 'boards'; id?: string; rev?: number }) => void;

/** One watcher per root, shared by every open stream on it. */
const hubs = new Map<string, { listeners: Set<Listener>; watcher: fs.FSWatcher | null; timer: NodeJS.Timeout | null; poll: NodeJS.Timeout | null; stamp: string }>();

function stampOf(root: string): string {
  return [`${boardsDir(root)}/index.json`, fileDeliveriesPath(root)].map((p) => {
    try { return String(fs.statSync(p).mtimeMs); } catch { return 'none'; }
  }).join(':');
}

function emit(root: string, event: { type: 'boards'; id?: string; rev?: number }): void {
  const hub = hubs.get(root);
  if (!hub) return;
  hub.stamp = stampOf(root);
  for (const l of hub.listeners) l(event);
}

function subscribe(root: string, listener: Listener): () => void {
  let hub = hubs.get(root);
  if (!hub) {
    hub = { listeners: new Set(), watcher: null, timer: null, poll: null, stamp: stampOf(root) };
    hubs.set(root, hub);
    const h = hub;
    const fire = () => {
      if (h.timer) clearTimeout(h.timer);
      /* A write is a temp file plus a rename plus the index: one event, not three. */
      h.timer = setTimeout(() => {
        h.timer = null;
        const s = stampOf(root);
        if (s === h.stamp) return;
        h.stamp = s;
        for (const l of h.listeners) l({ type: 'boards' });
      }, 60);
    };
    try {
      fs.mkdirSync(boardsDir(root), { recursive: true });
      h.watcher = fs.watch(boardsDir(root), fire);
      h.watcher.on('error', () => undefined);
    } catch {
      h.watcher = null;
    }
    /* fs.watch can miss an event (network drives, some editors' rename dance);
       a cheap stat once a second is the floor under it. */
    h.poll = setInterval(fire, 1000);
    h.poll.unref?.();
  }
  hub.listeners.add(listener);
  return () => {
    const h = hubs.get(root);
    if (!h) return;
    h.listeners.delete(listener);
    if (h.listeners.size === 0) {
      h.watcher?.close();
      if (h.timer) clearTimeout(h.timer);
      if (h.poll) clearInterval(h.poll);
      hubs.delete(root);
    }
  };
}

/** Deliveries ride the repository's existing stream, including while Spaces is closed. */
export function attachSpaceDeliveries(req: http.IncomingMessage, res: http.ServerResponse, root: string): void {
  const send = () => {
    if (res.writableEnded) return;
    const snapshot = { project: root, index: listBoards(root), artifacts: readFileDeliveries(root) };
    res.write(`event: spaces\ndata: ${JSON.stringify(snapshot)}\n\n`);
  };
  const off = subscribe(root, send);
  send();
  req.once('close', off);
  res.once('close', off);
}

async function jsonBody(req: http.IncomingMessage, deps: BoardsRouteDeps): Promise<unknown> {
  const body = await deps.readBody(req);
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new BoardError('invalid JSON');
  }
}

/** Handle a /api/boards request. Returns false when the path is not one of ours. */
export async function handleBoardsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  deps: BoardsRouteDeps,
): Promise<boolean> {
  if (pathname !== '/api/boards' && !pathname.startsWith('/api/boards/')) return false;
  const method = req.method ?? 'GET';
  const root = deps.root;
  if (root === null) {
    deps.sendError(res, 409, 'no project open — attach a repository or fix home permissions');
    return true;
  }
  const rest = pathname.slice('/api/boards'.length).split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (rest.join('/') === 'artifacts/delivery') {
      if (method === 'GET') {
        const chat = new URL(req.url ?? '/', 'http://localhost').searchParams.get('chat');
        return void deps.sendJson(res, 200, { delivery: readFileDeliveries(root).find((r) => r.chat === chat) ?? null }), true;
      }
      if (method === 'POST') {
        const b = await jsonBody(req, deps) as { chat?: unknown; path?: unknown };
        if (typeof b.chat !== 'string' || typeof b.path !== 'string') throw new BoardError('artifact delivery needs chat and path');
        const delivery = deliverFile(root, b.chat, b.path);
        emit(root, { type: 'boards' });
        return void deps.sendJson(res, 200, { delivery, destination: { project: root, chat: delivery.chat, surface: 'preview', path: delivery.path, saved: true, opened: false } }), true;
      }
      return void deps.sendError(res, 405, 'method not allowed'), true;
    }
    if (rest.length === 0) {
      if (method === 'GET') {
        const chat = new URL(req.url ?? '/', 'http://localhost').searchParams.get('chat');
        return void deps.sendJson(res, 200, chat ? await listBoardsForChatAsync(root, chat) : await listBoardsAsync(root)), true;
      }
      if (method === 'POST') {
        const b = (await jsonBody(req, deps)) as { name?: unknown; kind?: unknown; chat?: unknown };
        const meta = createBoard(root, { name: b.name, kind: b.kind, chat: b.chat });
        emit(root, { type: 'boards', id: meta.id, rev: meta.rev });
        return void deps.sendJson(res, 201, meta), true;
      }
    }
    if (rest.length === 1 && rest[0] === 'events' && method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
      const off = subscribe(root, (event) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      const ping = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n');
      }, 25_000);
      ping.unref?.();
      req.on('close', () => {
        clearInterval(ping);
        off();
      });
      return true;
    }
    /* The edit log is a local file of what the person did (boardEditLog.ts). It
       is answered before a board id is read: "edit-log" is a route, not a board. */
    if (rest.length === 1 && rest[0] === 'edit-log') {
      if (method === 'POST') {
        const b = (await jsonBody(req, deps)) as { events?: unknown };
        return void deps.sendJson(res, 200, { written: appendBoardEdits(root, b.events) }), true;
      }
      if (method === 'GET') {
        return void deps.sendJson(res, 200, { enabled: boardEditLogEnabled(root), events: readBoardEdits(root) }), true;
      }
    }
    /* The add-from picker: other chats' boards by chat, and the earlier ones. A route, not a board id. */
    if (rest.length === 1 && rest[0] === 'linkable' && method === 'GET') {
      const chat = new URL(req.url ?? '/', 'http://localhost').searchParams.get('chat');
      if (!chat) return void deps.sendError(res, 400, 'name the chat: ?chat=<id>'), true;
      return void deps.sendJson(res, 200, linkableBoards(root, chat)), true;
    }
    const id = rest[0]!;
    if (rest.length === 2 && rest[1] === 'link' && method === 'POST') {
      const b = (await jsonBody(req, deps)) as { chat?: unknown };
      const meta = linkBoard(root, id, b.chat);
      emit(root, { type: 'boards', id, rev: meta.rev });
      return void deps.sendJson(res, 200, meta), true;
    }
    if (rest.length === 1) {
      if (method === 'GET') {
        const doc = readBoard(root, id);
        if (!doc) return void deps.sendError(res, 404, `no board "${id}"`), true;
        return void deps.sendJson(res, 200, doc), true;
      }
      if (method === 'PATCH') {
        const b = (await jsonBody(req, deps)) as { name?: unknown };
        const meta = renameBoard(root, id, b.name);
        emit(root, { type: 'boards', id, rev: meta.rev });
        return void deps.sendJson(res, 200, meta), true;
      }
      if (method === 'DELETE') {
        /* With ?chat=: remove it from that chat (unlink, or delete when no chat is left). Without: delete outright. */
        const chat = new URL(req.url ?? '/', 'http://localhost').searchParams.get('chat');
        let deleted = true;
        if (chat) deleted = removeBoardFromChat(root, id, chat).deleted;
        else deleteBoard(root, id);
        emit(root, { type: 'boards', id });
        return void deps.sendJson(res, 200, { ok: true, deleted }), true;
      }
    }
    if (rest.length === 2 && rest[1] === 'render.svg' && method === 'GET') {
      const doc = readBoard(root, id);
      if (!doc) return void deps.sendError(res, 404, `no board "${id}"`), true;
      const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
      if (!q.get('group') && !q.get('items')) return void deps.sendError(res, 400, 'name what to render: ?group=<id> or ?items=<id,id>'), true;
      const all = selectItems(doc.items, { group: q.get('group'), items: q.get('items') });
      const picked = all.slice(0, RENDER_CAP);
      const dropped = all.length - picked.length;
      if (picked.length === 0) return void deps.sendError(res, 404, 'no items match that group or list on this board'), true;
      const out = renderItemsSvg(picked, { title: q.get('group') ?? `${id} items`, ...(dropped > 0 ? { note: `Showing the first ${RENDER_CAP} of ${all.length} items; open the board for the rest.` } : {}) });
      res.statusCode = 200;
      res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
      res.setHeader('x-board-rev', String(doc.rev));
      res.setHeader('x-board-skipped', String(out.skipped));
      if (dropped > 0) res.setHeader('x-board-truncated', String(dropped));
      res.end(out.svg);
      return true;
    }
    if (rest.length === 2 && rest[1] === 'ops' && method === 'POST') {
      const b = (await jsonBody(req, deps)) as { ops?: unknown };
      const doc = applyBoardOps(root, id, b.ops as BoardOp[]);
      emit(root, { type: 'boards', id, rev: doc.rev });
      return void deps.sendJson(res, 200, doc), true;
    }
    deps.sendError(res, 405, 'method not allowed');
    return true;
  } catch (e) {
    if (e instanceof EditLogError) {
      deps.sendError(res, e.status, e.message);
      return true;
    }
    if (e instanceof BoardError) {
      deps.sendError(res, e.status, e.message);
      return true;
    }
    throw e;
  }
}
