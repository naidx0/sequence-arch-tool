/* ══════════════════════════════════════════════════════════════════════════
   PULL REQUEST ROUTES (prFlow.ts does the work)
   packages/analyzer/src/server/prRoutes.ts

     GET  /api/sessions/:id/pr          the linked pull request, or { pr: null }
     POST /api/sessions/:id/pr/preview  the generated messages and what would happen
     POST /api/sessions/:id/pr          { title?, body?, commitMessage? } commit,
                                        push, open the pull request, link it
   ══════════════════════════════════════════════════════════════════════════ */

import type http from 'node:http';

import type { Refusal } from './chatWorktree.js';
import { openPullRequest, previewPullRequest } from './prFlow.js';
import { readSessionIndex, readSessionWorktree } from './sessionsStore.js';

export const PR_ROUTE = /^\/api\/sessions\/([^/]+)\/pr(?:\/(preview))?$/;

interface Io {
  res: http.ServerResponse;
  method: string;
  readBody: () => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  root: string;
  threadId: string;
  part: string | undefined;
  /** The chat has a live agent turn. */
  isBusy: (chatId: string) => boolean;
}

export async function handlePrRoute(io: Io): Promise<void> {
  const { root, threadId, part, method } = io;
  const entry = readSessionIndex(root)?.sessions.find((s) => s.id === threadId);
  if (!entry) return io.sendJson(io.res, 404, { error: 'session not found' });
  if (part === undefined && method === 'GET') return io.sendJson(io.res, 200, { pr: entry.pr ?? null });
  if (method !== 'POST') return io.sendJson(io.res, 405, { error: 'method not allowed' });
  const wt = readSessionWorktree(root, threadId);
  if (!wt) return io.sendJson(io.res, 404, { error: 'This chat has no worktree, so there is no branch to open a pull request from.' });
  const fail = (r: Refusal): void => {
    const { status, ok: _ok, ...rest } = r;
    io.sendJson(io.res, status, rest);
  };
  let body: Record<string, unknown> = {};
  try {
    const text = await io.readBody();
    if (text.trim() !== '') {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      body = v as Record<string, unknown>;
    }
  } catch {
    return io.sendJson(io.res, 400, { error: 'Body must be a JSON object.' });
  }
  const list = (k: string): string[] => (Array.isArray(body[k]) ? (body[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  if (part === 'preview') {
    const r = await previewPullRequest(root, threadId, wt, list('includeFlagged'));
    return r.ok ? io.sendJson(io.res, 200, r.preview) : fail(r);
  }
  const str = (k: string): string | undefined => (typeof body[k] === 'string' ? (body[k] as string) : undefined);
  const r = await openPullRequest(root, threadId, wt, { title: str('title'), body: str('body'), commitMessage: str('commitMessage'), includeFlagged: list('includeFlagged'), busy: io.isBusy(threadId) });
  return r.ok ? io.sendJson(io.res, 200, r) : fail(r);
}
