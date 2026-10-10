/* ══════════════════════════════════════════════════════════════════════════
   BEST-OF-N ROUTES (fanout.ts does the work)
   packages/analyzer/src/server/fanoutRoutes.ts

     POST /api/fanout                         { prompt, agents[] } one chat and one
                                              worktree per agent; the page then
                                              starts each agent in its chat
     GET  /api/fanout/:id                     each sibling's files and merge dry run
     POST /api/fanout/:id/choose              { chatId, mode } merge that one
     POST /api/fanout/:id/discard-others      { keep } remove the rest
   ══════════════════════════════════════════════════════════════════════════ */

import type http from 'node:http';

import { chooseFanout, compareFanout, createFanout, discardOthers } from './fanout.js';
import { readWorktreeSettings, type MergeMode, type Refusal } from './chatWorktree.js';

export const FANOUT_ROUTE = /^\/api\/fanout(?:\/([^/]+)(?:\/(choose|discard-others))?)?$/;

interface Io {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  readBody: () => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  root: string;
  dataDir: string;
  /** Registered agents (their ids), so an unknown agent is refused before anything is made. */
  isAgent: (id: string) => boolean;
  /** A live agent turn is running in this chat. */
  isBusy: (chatId: string) => boolean;
  id: string | undefined;
  part: string | undefined;
}

const fail = (io: Io, r: Refusal): void => {
  const { status, ok: _ok, ...rest } = r;
  io.sendJson(io.res, status, rest);
};

async function jsonBody(io: Io): Promise<Record<string, unknown> | null> {
  try {
    const text = await io.readBody();
    if (text.trim() === '') return {};
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function handleFanoutRoute(io: Io): Promise<void> {
  const { id, part, method } = io;
  if (id === undefined) {
    if (method !== 'POST') return io.sendJson(io.res, 405, { error: 'method not allowed' });
    const body = await jsonBody(io);
    if (!body) return io.sendJson(io.res, 400, { error: 'Body must be a JSON object.' });
    const agents = Array.isArray(body.agents) ? body.agents.filter((a): a is string => typeof a === 'string') : [];
    const unknown = agents.filter((a) => !io.isAgent(a));
    if (unknown.length) return io.sendJson(io.res, 400, { error: `Not a registered agent: ${unknown.join(', ')}.` });
    const r = await createFanout(io.root, {
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      agents,
      dataDir: io.dataDir,
      cap: readWorktreeSettings(io.dataDir, io.root).cap,
    });
    return r.ok ? io.sendJson(io.res, 200, r) : fail(io, r);
  }
  if (part === undefined && method === 'GET') {
    const r = await compareFanout(io.root, id, io.isBusy);
    return r.ok ? io.sendJson(io.res, 200, r) : fail(io, r);
  }
  if (part === 'choose' && method === 'POST') {
    const body = await jsonBody(io);
    if (!body || typeof body.chatId !== 'string') return io.sendJson(io.res, 400, { error: '"chatId" is required.' });
    const mode: MergeMode | null = body.mode === 'merge' || body.mode === 'squash' ? body.mode : null;
    if (!mode) return io.sendJson(io.res, 400, { error: '"mode" must be "merge" or "squash".' });
    const r = await chooseFanout(io.root, id, body.chatId, mode, io.isBusy);
    return r.ok ? io.sendJson(io.res, 200, r) : fail(io, r);
  }
  if (part === 'discard-others' && method === 'POST') {
    const body = await jsonBody(io);
    if (!body || typeof body.keep !== 'string') return io.sendJson(io.res, 400, { error: '"keep" is required.' });
    const r = await discardOthers(io.root, io.dataDir, id, body.keep, { confirmLoss: typeof body.confirmLoss === 'string' ? body.confirmLoss : undefined, isBusy: io.isBusy });
    if (r.ok) return io.sendJson(io.res, 200, r);
    const { status, ok: _ok, ...rest } = r;
    return io.sendJson(io.res, status, rest);
  }
  return io.sendJson(io.res, 405, { error: 'method not allowed' });
}
