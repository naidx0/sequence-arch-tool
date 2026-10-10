/* /api/drawings: save, list and read the svg/html blocks shown in the chat (drawings/drawingStore.ts).
     GET  /api/drawings[?chat=]       index rows
     GET  /api/drawings/:id[?v=]      one drawing with its source
     POST /api/drawings               {chat, turn?, kind, source, title?, id?}  new, or a version of `id` */

import type http from 'node:http';

import { DRAWING_MAX_BYTES, DrawingError, listDrawings, readDrawing, saveDrawing, drawingFileName, versionFileName } from '../drawings/drawingStore.js';

export interface DrawingsRouteDeps {
  root: string | null;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  sendError: (res: http.ServerResponse, status: number, message: string) => void;
}

export async function handleDrawingsRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, deps: DrawingsRouteDeps): Promise<boolean> {
  if (pathname !== '/api/drawings' && !pathname.startsWith('/api/drawings/')) return false;
  const root = deps.root;
  if (root === null) return void deps.sendError(res, 409, 'no project open'), true;
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? pathname, 'http://x');
  const id = pathname.slice('/api/drawings/'.length);
  try {
    if (pathname === '/api/drawings' && method === 'GET') {
      const chat = url.searchParams.get('chat') ?? undefined;
      return void deps.sendJson(res, 200, { drawings: listDrawings(root, { chat }).map((d) => ({ ...d, name: drawingFileName(d) })) }), true;
    }
    if (pathname === '/api/drawings' && method === 'POST') {
      /* An oversize body is refused with a 413 up front: the shared body reader would destroy the socket instead. */
      if (Number(req.headers['content-length'] ?? 0) > DRAWING_MAX_BYTES * 2) return void deps.sendError(res, 413, `a drawing is at most ${DRAWING_MAX_BYTES} bytes`), true;
      let b: Record<string, unknown>;
      try {
        b = JSON.parse(await deps.readBody(req)) as Record<string, unknown>;
      } catch (e) {
        const big = e instanceof Error && /too large/.test(e.message);
        return void deps.sendError(res, big ? 413 : 400, big ? 'the drawing is too large' : 'invalid JSON'), true;
      }
      const r = saveDrawing(root, { chat: String(b.chat ?? ''), turn: typeof b.turn === 'string' ? b.turn : undefined, at: typeof b.at === 'number' ? b.at : undefined, referenced: b.referenced === true, kind: b.kind as 'svg' | 'html', source: String(b.source ?? ''), title: typeof b.title === 'string' ? b.title : undefined, id: typeof b.id === 'string' ? b.id : undefined });
      return void deps.sendJson(res, r.created ? 201 : 200, { ...r, name: versionFileName(r.drawing, r.version) }), true;
    }
    if (pathname.startsWith('/api/drawings/') && method === 'GET') {
      const v = url.searchParams.get('v');
      const got = readDrawing(root, decodeURIComponent(id), v ? Number(v) : undefined);
      if (!got) return void deps.sendError(res, 404, `no drawing "${id}"`), true;
      return void deps.sendJson(res, 200, { ...got.drawing, name: versionFileName(got.drawing, got.version.v), version: got.version.v, source: got.source }), true;
    }
  } catch (e) {
    if (e instanceof DrawingError) return void deps.sendError(res, e.status, e.message), true;
    throw e;
  }
  return void deps.sendError(res, 405, 'method not allowed'), true;
}
