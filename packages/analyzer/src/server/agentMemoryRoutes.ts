/**
 * One memory for all your agents (agentMemory.ts):
 *
 *   GET  /api/memory/shared                 -> { text, targets }
 *   PUT  /api/memory/shared { text }        -> { text, targets }   save the shared memory
 *   POST /api/memory/shared/gather          -> { text, sources }   propose it from the agents' own files
 *   POST /api/memory/shared/sync { ids, remove? } -> { results, targets }
 *
 * These read and write files in the person's home, so they answer only a local caller and never in
 * hosted mode, and everything that writes is a JSON request (a page on another origin cannot send one
 * without a preflight the server never answers).
 */

import type http from 'node:http';
import os from 'node:os';
import { isOriginAllowed } from './terminal.js';
import { gatherMemory, readShared, syncMemory, targetStates, writeShared, type Where } from './agentMemory.js';
import { MAX_BODY_BYTES, isJsonRequest, readBody, sendError, sendJson } from './routeHttp.js';

export function isAgentMemoryPath(pathname: string): boolean {
  return pathname === '/api/memory/shared' || pathname.startsWith('/api/memory/shared/');
}

export interface AgentMemoryContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  method: string;
  authOn: boolean;
  userConfigDir: string;
  /** Test seam: whose home the agents' files live in. */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export async function handleAgentMemoryRoute(ctx: AgentMemoryContext): Promise<boolean> {
  const { req, res, pathname, method, userConfigDir } = ctx;
  if (!isAgentMemoryPath(pathname)) return false;
  if (ctx.authOn || !isOriginAllowed(req)) {
    sendError(res, 403, 'shared memory is local-only');
    return true;
  }
  const w: Where = { home: ctx.home ?? os.homedir(), ...(ctx.env ? { env: ctx.env } : {}) };
  const view = (): { text: string; targets: ReturnType<typeof targetStates> } => {
    const text = readShared(userConfigDir);
    return { text, targets: targetStates(w, text, userConfigDir) };
  };
  if (pathname === '/api/memory/shared' && method === 'GET') {
    sendJson(res, 200, view());
    return true;
  }
  if (method !== 'PUT' && method !== 'POST') {
    sendError(res, 405, `${method} is not supported on ${pathname}`);
    return true;
  }
  if (!isJsonRequest(req)) {
    sendError(res, 415, 'expected content-type application/json');
    return true;
  }
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req, MAX_BODY_BYTES);
    body = raw.trim() === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
  } catch (e) {
    sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
    return true;
  }
  if (pathname === '/api/memory/shared' && method === 'PUT') {
    if (typeof body.text !== 'string') {
      sendError(res, 400, 'text must be a string');
      return true;
    }
    try {
      writeShared(userConfigDir, body.text);
    } catch (e) {
      sendError(res, 400, (e as Error).message);
      return true;
    }
    sendJson(res, 200, view());
    return true;
  }
  if (pathname === '/api/memory/shared/gather' && method === 'POST') {
    sendJson(res, 200, gatherMemory(w));
    return true;
  }
  if (pathname === '/api/memory/shared/sync' && method === 'POST') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) {
      sendError(res, 400, 'name the agents to share with (ids)');
      return true;
    }
    const results = syncMemory(w, ids, readShared(userConfigDir), { remove: body.remove === true, storeDir: userConfigDir });
    sendJson(res, 200, { results, ...view() });
    return true;
  }
  sendError(res, 405, `${method} is not supported on ${pathname}`);
  return true;
}
