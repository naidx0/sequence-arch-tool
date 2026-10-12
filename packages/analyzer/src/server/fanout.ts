/* ══════════════════════════════════════════════════════════════════════════
   BEST OF N: ONE MESSAGE, SEVERAL AGENTS, ONE WORKTREE EACH
   packages/analyzer/src/server/fanout.ts

   T3 Code lets you Shift-click several models and sends the one message to all
   of them, each in its own thread and worktree. Here:

     createFanout   makes one chat and one git worktree per agent, all-or-none:
                    a refusal part-way (the worktree cap, a git error) removes
                    what was made, so a failed send leaves nothing behind. The
                    page then starts the agents (the ordinary run-node call
                    per chat); nothing here runs an agent.
     compareFanout  for each sibling: what it changed and what merging it
                    would do, computed without touching anything.
     chooseFanout   merges the picked sibling (the user's click) and marks it.
     discardOthers  removes the other siblings' worktrees and branches.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

import { readAgentRuns } from './agentChatStore.js';
import { recordFanoutDiscard, type DiscardedSibling } from '../harness/refineSignals.js';

import {
  chatChanges,
  createChatWorktree,
  dryRunMerge,
  liveChatWorktrees,
  mergeChatWorktree,
  removeChatWorktree,
  unmergedCommits,
  clampCap,
  type ChangedFile,
  type ChatWorktreeRef,
  type MergeMode,
  type Refusal,
} from './chatWorktree.js';
import {
  createSession,
  deleteSession,
  readSessionIndex,
  updateSession,
  writeSessionFanout,
  writeSessionWorktree,
  type ChatFanout,
  type SessionIndexEntry,
} from './sessionsStore.js';

export const FANOUT_MIN = 2;
export const FANOUT_MAX = 8;

export interface FanoutChat {
  chatId: string;
  agentRef: string;
  title: string;
  worktree: ChatWorktreeRef;
}

const oneLine = (s: string, n = 48): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface CreateFanoutInput {
  prompt: string;
  agents: readonly string[];
  dataDir: string;
  /** The worktree cap setting. */
  cap?: number;
  /** Test seam: runs after each chat is made; a throw proves the cleanup. */
  afterChat?: (index: number) => void;
}

export async function createFanout(root: string, input: CreateFanoutInput): Promise<{ ok: true; fanoutId: string; chats: FanoutChat[] } | Refusal> {
  const agents = [...new Set(input.agents.filter((a) => typeof a === 'string' && a.trim() !== ''))];
  if (input.prompt.trim() === '') return { ok: false, status: 400, error: 'There is nothing to send: the message is empty.' };
  if (agents.length < FANOUT_MIN || agents.length > FANOUT_MAX) {
    return { ok: false, status: 400, error: `Pick between ${FANOUT_MIN} and ${FANOUT_MAX} different agents.` };
  }
  /* Refuse before making anything when the cap cannot hold them all. */
  const cap = clampCap(input.cap);
  const live = await liveChatWorktrees(root, input.dataDir);
  if (live.length + agents.length > cap) {
    return {
      ok: false,
      status: 409,
      error: `Sending to ${agents.length} agents needs ${agents.length} worktrees, and this repository already has ${live.length} of the ${cap} Settings allows. Merge or remove some first.`,
    };
  }
  const fanoutId = crypto.randomBytes(4).toString('hex');
  const made: FanoutChat[] = [];
  const sessions: string[] = [];
  const undo = async (): Promise<void> => {
    for (const c of made) await removeChatWorktree(root, input.dataDir, c.worktree, { confirmUnmerged: [], discardUncommitted: true }).catch(() => {});
    for (const id of sessions) {
      try {
        deleteSession(root, id, { keepOneLiveThread: false });
      } catch {
        /* best effort: the chat may not have been written */
      }
    }
  };
  let done = false;
  try {
    for (const agentRef of agents) {
      const title = `${oneLine(input.prompt)} · ${cap1(agentRef)}`;
      const session = createSession(root, {});
      sessions.push(session.id);
      const wt = await createChatWorktree(root, { dataDir: input.dataDir, title, cap });
      if (!wt.ok) return wt;
      made.push({ chatId: session.id, agentRef, title, worktree: wt.ref });
      updateSession(root, session.id, { title });
      writeSessionWorktree(root, session.id, wt.ref);
      writeSessionFanout(root, session.id, { id: fanoutId, agentRef, prompt: input.prompt });
      input.afterChat?.(made.length - 1);
    }
    done = true;
    return { ok: true, fanoutId, chats: made };
  } catch (e) {
    return { ok: false, status: 500, error: `Could not make the chats: ${e instanceof Error ? e.message : String(e)}. Nothing was left behind.` };
  } finally {
    if (!done) await undo();
  }
}

/** One merge at a time per set: the check and the merge are one step. */
const locks = new Map<string, Promise<unknown>>();
export function withFanoutLock<T>(fanoutId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(fanoutId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(fanoutId, tail);
  void tail.then(() => {
    if (locks.get(fanoutId) === tail) locks.delete(fanoutId);
  });
  return next;
}

/** Has any chat of the set been merged (the one-merge-per-set rule, for every merge button). */
export function setHasMerge(root: string, fanoutId: string): boolean {
  return siblings(root, fanoutId).some((e) => e.fanout?.chosen || e.worktree?.merged);
}

/** After any merge of a chat in a set: it is the chosen one. */
export function markChosen(root: string, chatId: string): void {
  const e = readSessionIndex(root)?.sessions.find((x) => x.id === chatId);
  if (e?.fanout) writeSessionFanout(root, chatId, { ...e.fanout, chosen: true });
}

function siblings(root: string, fanoutId: string): SessionIndexEntry[] {
  return (readSessionIndex(root)?.sessions ?? []).filter((s) => s.fanout?.id === fanoutId);
}

export interface SiblingView {
  chatId: string;
  agentRef: string;
  title: string;
  branch: string | null;
  chosen: boolean;
  merged: boolean;
  removed: boolean;
  files: ChangedFile[];
  /** What merging would do now; null once merged or removed. */
  dryRun: { target: string; conflicts: string[]; mainUncommitted: string[]; clean: boolean } | null;
  /** A live agent turn is running in this chat (the server's answer). */
  running: boolean;
  error?: string;
}

export async function compareFanout(root: string, fanoutId: string, isBusy: (chatId: string) => boolean = () => false): Promise<{ ok: true; prompt: string; siblings: SiblingView[] } | Refusal> {
  const entries = siblings(root, fanoutId);
  if (entries.length === 0) return { ok: false, status: 404, error: 'No such set of chats.' };
  const out: SiblingView[] = [];
  for (const e of entries) {
    const wt = e.worktree;
    const base: SiblingView = {
      chatId: e.id,
      agentRef: e.fanout!.agentRef,
      title: e.title,
      branch: wt?.branch ?? null,
      chosen: Boolean(e.fanout!.chosen),
      merged: Boolean(wt?.merged),
      removed: !wt || Boolean(wt.removedAt),
      files: [],
      dryRun: null,
      running: isBusy(e.id),
    };
    if (base.removed || base.merged || !wt) {
      out.push(base);
      continue;
    }
    const changes = await chatChanges(wt);
    if (!changes.ok) {
      out.push({ ...base, error: changes.error });
      continue;
    }
    const dry = await dryRunMerge(root, wt);
    if (!dry.ok) {
      out.push({ ...base, files: changes.files, error: dry.error });
      continue;
    }
    out.push({
      ...base,
      files: dry.files,
      dryRun: { target: dry.target, conflicts: dry.conflicts, mainUncommitted: dry.mainUncommitted, clean: dry.conflicts.length === 0 && dry.mainUncommitted.length === 0 },
    });
  }
  return { ok: true, prompt: entries[0]!.fanout!.prompt, siblings: out };
}

/** Merge the picked sibling into the user's branch. Nothing else changes. */
export function chooseFanout(root: string, fanoutId: string, chatId: string, mode: MergeMode, isBusy: (chatId: string) => boolean = () => false) {
  return withFanoutLock(fanoutId, async () => {
    const entry = siblings(root, fanoutId).find((e) => e.id === chatId);
    if (!entry || !entry.worktree || entry.worktree.removedAt) return { ok: false as const, status: 404, error: 'That chat is not in this set, or its worktree is gone.' };
    if (setHasMerge(root, fanoutId)) return { ok: false as const, status: 409, error: 'One of these was already merged.' };
    if (isBusy(chatId)) return { ok: false as const, status: 409, error: 'That agent is still working. Wait for it, or stop it, then merge.' };
    const r = await mergeChatWorktree(root, entry.worktree, { mode, message: entry.title });
    if (!r.ok) return r;
    writeSessionWorktree(root, chatId, { ...entry.worktree, merged: { at: new Date().toISOString(), mode, into: r.into, commit: r.commit } });
    writeSessionFanout(root, chatId, { ...(entry.fanout as ChatFanout), chosen: true });
    return r;
  });
}

export interface AtRisk {
  chatId: string;
  agentRef: string;
  commits: { sha: string; subject: string }[];
  uncommittedFiles: number;
}

export type DiscardResult =
  | { ok: true; removed: string[]; failed: { chatId: string; error: string }[] }
  | { ok: false; status: number; error: string; needsConfirm?: AtRisk[]; confirmToken?: string };

/**
 * Remove every sibling but the merged one. Only after a merge; never while a
 * sibling is running; and a sibling with work that was never merged (commits,
 * or uncommitted files) is removed only on a second, explicit confirm that was
 * shown that list: `confirmLoss` is the token the refusal handed back, a hash of exactly
 * that list, and a list that changed since is refused again with the new one.
 */
export function discardOthers(
  root: string,
  dataDir: string,
  fanoutId: string,
  keepChatId: string,
  opts: { confirmLoss?: string; isBusy?: (chatId: string) => boolean } = {},
): Promise<DiscardResult> {
  return withFanoutLock(fanoutId, async (): Promise<DiscardResult> => {
    const all = siblings(root, fanoutId);
    const keep = all.find((e) => e.id === keepChatId);
    if (!keep) return { ok: false, status: 400, error: 'That chat is not in this set.' };
    if (!keep.fanout?.chosen || !keep.worktree?.merged) return { ok: false, status: 409, error: 'Merge one of them first; only then can the others be discarded.' };
    const others = all.filter((e) => e.id !== keepChatId && e.worktree && !e.worktree.removedAt);
    const running = others.filter((e) => opts.isBusy?.(e.id));
    if (running.length) {
      return { ok: false, status: 409, error: `${running.map((e) => e.fanout?.agentRef ?? e.id).join(', ')} ${running.length === 1 ? 'is' : 'are'} still working. Stop ${running.length === 1 ? 'it' : 'them'} or wait, then discard.` };
    }
    const atRisk: AtRisk[] = [];
    const fileNames: string[] = [];
    for (const e of others) {
      const commits = await unmergedCommits(root, e.worktree!);
      const ch = await chatChanges(e.worktree!);
      const files = ch.ok && ch.dirty ? ch.files.length : 0;
      if (ch.ok && ch.dirty) fileNames.push(...ch.files.map((f) => `${e.id}:${f.path}`));
      if (commits.length || files) atRisk.push({ chatId: e.id, agentRef: e.fanout?.agentRef ?? e.id, commits, uncommittedFiles: files });
    }
    const token = crypto.createHash('sha256').update(JSON.stringify([atRisk.map((a) => [a.chatId, a.commits.map((c) => c.sha), a.uncommittedFiles]), fileNames.sort()])).digest('hex').slice(0, 24);
    if (atRisk.length && !opts.confirmLoss) {
      return { ok: false, status: 409, error: 'Some of these have work that was never merged. Confirm to delete it.', needsConfirm: atRisk, confirmToken: token };
    }
    if (atRisk.length && opts.confirmLoss !== token) {
      return { ok: false, status: 409, error: 'The work in those chats changed since you looked. Review the list again before deleting it.', needsConfirm: atRisk, confirmToken: token };
    }
    const removed: string[] = [];
    const failed: { chatId: string; error: string }[] = [];
    for (const e of others) {
      const risk = atRisk.find((a) => a.chatId === e.id);
      const r = await removeChatWorktree(root, dataDir, e.worktree!, { confirmUnmerged: risk?.commits.map((c) => c.sha) ?? [], discardUncommitted: Boolean(risk?.uncommittedFiles) });
      if (!r.ok) {
        failed.push({ chatId: e.id, error: r.error });
        continue;
      }
      writeSessionWorktree(root, e.id, { ...e.worktree!, removedAt: new Date().toISOString() });
      removed.push(e.id);
    }
    /* Best-of-N siblings the person did not pick, now deleted: each is a refine signal (the loop's evidence outlives the worktree). */
    const gone: DiscardedSibling[] = [];
    for (const e of others) {
      if (!removed.includes(e.id)) continue;
      const turnIds = readAgentRuns(root, e.id).map((r) => r.id);
      gone.push({ chat: e.id, agent: e.fanout?.agentRef ?? e.id, prompt: e.fanout?.prompt ?? '', turnIds });
    }
    recordFanoutDiscard(root, gone);
    return { ok: true, removed, failed };
  });
}
