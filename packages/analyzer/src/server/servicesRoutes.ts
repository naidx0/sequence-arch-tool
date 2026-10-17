/* ══════════════════════════════════════════════════════════════════════════
   /api/services — acts on one service node of the scanned graph
   packages/analyzer/src/server/servicesRoutes.ts

     POST /api/services/:id/flows   {audience?: "auto"|"admin"|"customer", board?: id|name}
          "Generate workflow" for a service node: a page-to-page flow built from the scan
          (routes, redirects, links, graph edges; no model), drawn on a Space as a group.
          200 {board, group, steps, links, grounded:{routes, edgesFromCode}, notes, audience, service}
          board and group are null (and steps empty) when the scan has nothing to ground a flow on.

   :id is the node id (`svc:orders`, URL-encoded) or the service's name.
   ══════════════════════════════════════════════════════════════════════════ */

import type http from 'node:http';
import type { ArchGraph } from '@sequence/schema';

import { BoardError } from '../boards/boardStore.js';
import { writeServiceFlow, type FlowAudience } from '../boards/serviceFlow.js';

export interface ServicesRouteDeps {
  root: string | null;
  graph: () => ArchGraph | null;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  sendError: (res: http.ServerResponse, status: number, message: string) => void;
}

export async function handleServicesRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, deps: ServicesRouteDeps): Promise<boolean> {
  if (pathname !== '/api/services' && !pathname.startsWith('/api/services/')) return false;
  const root = deps.root;
  const graph = deps.graph();
  if (root === null || graph === null) {
    deps.sendError(res, 409, 'no project scanned — attach a repository first');
    return true;
  }
  let rest: string[];
  try {
    rest = pathname.slice('/api/services'.length).split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    deps.sendError(res, 400, 'the address is not valid');
    return true;
  }
  if (rest.length === 2 && rest[1] === 'flows' && (req.method ?? 'GET') === 'POST') {
    try {
      const text = await deps.readBody(req);
      let b: { audience?: unknown; board?: unknown };
      try {
        b = text ? (JSON.parse(text) as typeof b) : {};
      } catch {
        throw new BoardError('invalid JSON');
      }
      const audience = b.audience ?? 'auto';
      if (audience !== 'auto' && audience !== 'admin' && audience !== 'customer') throw new BoardError('audience must be "auto", "admin" or "customer"');
      if (b.board !== undefined && typeof b.board !== 'string') throw new BoardError('board must be a board id or name');
      deps.sendJson(res, 200, writeServiceFlow(root, graph, rest[0]!, audience as FlowAudience, b.board as string | undefined));
    } catch (e) {
      if (e instanceof BoardError) deps.sendError(res, e.status, e.message);
      else throw e;
    }
    return true;
  }
  deps.sendError(res, 405, 'method not allowed');
  return true;
}
