/* ══════════════════════════════════════════════════════════════════════════
   S7 ROUTES — a chat's worktree over HTTP (chatWorktree.ts does the git)
   packages/analyzer/src/server/chatWorktreeRoutes.ts

     GET    /api/sessions/:id/worktree            the binding, or { worktree: null }
     POST   /api/sessions/:id/worktree            cut one from HEAD and bind it
     GET    /api/sessions/:id/worktree/changes    files changed against the base
     GET    /api/sessions/:id/worktree/diff[?path=]  unified diff against the base
     POST   /api/sessions/:id/worktree/dry-run    the merge, computed, nothing changed
     POST   /api/sessions/:id/worktree/merge      { mode: 'merge'|'squash' } — the user's click
     DELETE /api/sessions/:id/worktree            remove; body { confirmUnmerged: [sha…] }
     GET|PUT /api/worktree-settings               { cap, setupCommand } (+ suggestion on GET)

   Every route answers with the worktree's state as the server sees it; none
   runs a setup command, an install or an agent.
   ══════════════════════════════════════════════════════════════════════════ */

import type http from 'node:http';

import { markChosen, setHasMerge, withFanoutLock } from './fanout.js';
import {
  chatChanges,
  chatDiff,
  createChatWorktree,
  dryRunMerge,
  mergeChatWorktree,
  readWorktreeSettings,
  removeChatWorktree,
  suggestSetupCommand,
  writeWorktreeSettings,
  type ChatWorktreeRef,
  type MergeMode,
  type Refusal,
} from './chatWorktree.js';
import { readSessionIndex, readSessionWorktree, readSessionWorktreeRecord, writeSessionWorktree } from './sessionsStore.js';

export const CHAT_WORKTREE_ROUTE = /^\/api\/sessions\/([^/]+)\/worktree(?:\/(changes|diff|dry-run|merge))?$/;

interface Io {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  url: URL;
  readBody: () => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
}

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

/** A refusal on the wire: its status as the HTTP status, everything else as the body. */
const fail = (io: Io, r: Refusal): void => {
  const { status, ok: _ok, ...rest } = r;
  io.sendJson(io.res, status, rest);
};

/** Handle one `/api/sessions/:id/worktree…` request. `root` is the repo the chat lives in. */
export async function handleChatWorktreeRoute(
  io: Io & { root: string; threadId: string; part: string | undefined; dataDir: string; isBusy: (chatId: string) => boolean },
): Promise<void> {
  const { root, threadId, part, dataDir, method } = io;
  const entry = readSessionIndex(root)?.sessions.find((s) => s.id === threadId);
  if (!entry) return io.sendJson(io.res, 404, { error: 'session not found' });
  const bound: ChatWorktreeRef | null = readSessionWorktree(root, threadId);

  /* The record, a removed worktree included: the chat and Rewind say so. */
  if (part === undefined && method === 'GET') return io.sendJson(io.res, 200, { worktree: readSessionWorktreeRecord(root, threadId) });

  if (part === undefined && method === 'POST') {
    if (bound) return io.sendJson(io.res, 409, { error: 'This chat already has a worktree.', worktree: bound });
    const made = await createChatWorktree(root, { dataDir, title: entry.title, cap: readWorktreeSettings(dataDir, root).cap });
    if (!made.ok) return fail(io, made);
    writeSessionWorktree(root, threadId, made.ref);
    const { setupCommand } = readWorktreeSettings(dataDir, root);
    return io.sendJson(io.res, 200, { worktree: made.ref, setupCommand });
  }

  if (!bound) return io.sendJson(io.res, 404, { error: 'This chat has no worktree.' });

  if (part === 'changes' && method === 'GET') {
    const c = await chatChanges(bound);
    return c.ok ? io.sendJson(io.res, 200, { worktree: bound, files: c.files, dirty: c.dirty }) : fail(io, c);
  }
  if (part === 'diff' && method === 'GET') {
    const p = io.url.searchParams.get('path');
    const d = await chatDiff(bound, p ?? undefined);
    return d.ok ? io.sendJson(io.res, 200, { diff: d.diff }) : fail(io, d);
  }
  if (part === 'dry-run' && method === 'POST') {
    const d = await dryRunMerge(root, bound);
    return d.ok ? io.sendJson(io.res, 200, d) : fail(io, d);
  }
  if (part === 'merge' && method === 'POST') {
    const body = await jsonBody(io);
    if (!body) return io.sendJson(io.res, 400, { error: 'Body must be a JSON object.' });
    const mode: MergeMode | null = body.mode === 'merge' || body.mode === 'squash' ? body.mode : null;
    if (!mode) return io.sendJson(io.res, 400, { error: '"mode" must be "merge" or "squash".' });
    /* A merge is a commit of whatever the agent has written so far: not while it is still writing. */
    if (io.isBusy(threadId)) return io.sendJson(io.res, 409, { error: 'The agent is still working in this chat. Wait for it, or stop it, then merge.' });
    /* One merge per best-of-N set, whichever button made it, and the check and the merge are one step. */
    const doMerge = async (): Promise<void> => {
      if (entry.fanout && setHasMerge(root, entry.fanout.id)) return io.sendJson(io.res, 409, { error: 'One of the chats sent together was already merged. Only one can be.' });
      const r = await mergeChatWorktree(root, bound, { mode, message: entry.title });
      if (!r.ok) return fail(io, r);
      writeSessionWorktree(root, threadId, { ...bound, merged: { at: new Date().toISOString(), mode, into: r.into, commit: r.commit } });
      markChosen(root, threadId);
      return io.sendJson(io.res, 200, r);
    };
    return entry.fanout ? withFanoutLock(entry.fanout.id, doMerge) : doMerge();
  }
  if (part === undefined && method === 'DELETE') {
    const body = await jsonBody(io);
    if (!body) return io.sendJson(io.res, 400, { error: 'Body must be a JSON object.' });
    const confirm = Array.isArray(body.confirmUnmerged) ? body.confirmUnmerged.filter((s): s is string => typeof s === 'string') : [];
    const r = await removeChatWorktree(root, dataDir, bound, { confirmUnmerged: confirm });
    if (!r.ok) return fail(io, r);
    /* Kept as a record, unbound: the transcript stays and Rewind says why. */
    writeSessionWorktree(root, threadId, { ...bound, removedAt: new Date().toISOString() });
    return io.sendJson(io.res, 200, r);
  }
  return io.sendJson(io.res, 405, { error: 'method not allowed' });
}

/** GET|PUT /api/worktree-settings. */
export async function handleWorktreeSettingsRoute(io: Io & { dataDir: string; repoRoot: string | null }): Promise<void> {
  if (io.method === 'GET') {
    return io.sendJson(io.res, 200, {
      ...readWorktreeSettings(io.dataDir, io.repoRoot),
      suggestion: io.repoRoot ? suggestSetupCommand(io.repoRoot) : null,
    });
  }
  if (io.method === 'PUT') {
    const body = await jsonBody(io);
    const r = writeWorktreeSettings(io.dataDir, io.repoRoot, body);
    return r.ok ? io.sendJson(io.res, 200, r.settings) : fail(io, r);
  }
  return io.sendJson(io.res, 405, { error: 'method not allowed' });
}
