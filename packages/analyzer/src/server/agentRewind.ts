/* ══════════════════════════════════════════════════════════════════════════
   EDIT FROM HERE: REWINDING THE AGENT'S OWN THREAD
   packages/analyzer/src/server/agentRewind.ts

   Sequence keeps the chat; the provider keeps the conversation. Cutting the
   chat back without cutting the provider thread leaves an agent that still
   remembers the turns the person just deleted. T3 Code rewinds the provider
   thread too (ClaudeAdapterV2 resumeSessionAt; CodexThreadRevert.ts).

   Here it happens in two steps so no live process is needed at click time:

     1. `rewindChat` (POST /api/sessions/:id/rewind) truncates the saved
        turns and marks every agent thread of the chat with a PENDING rewind:
        how many provider turns to drop, and the kept transcript as a seed.
     2. The next turn's `openThread` calls `settleRewind`: resume the thread
        and `rollbackTurns` where the agent can (codex); otherwise open a new
        thread and put the seed ahead of the prompt. The ACP bridge to Claude
        offers no rollback, so Claude always takes the seeded path.

   The result is told to the stream (`acp:session.rewound`), never silent.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AcpAgentClient } from '@sequence/acp';

import { recordEditFromHere, retractEditFromHere } from '../harness/refineSignals.js';
import { cutDrawingsSince, uncutDrawingsSince } from '../drawings/drawingStore.js';
import { dropRewindBackup, readAgentRuns, restoreRewound, truncateAgentRunsAt, type StoredAgentRun } from './agentChatStore.js';
import { readSessionIndex, writeAgentThread, type AgentThreadRef, type PendingRewind } from './sessionsStore.js';

/** The most seed text carried into a fresh thread; older turns fall off first. */
export const SEED_MAX_CHARS = 24_000;

/**
 * The kept transcript as one block of text a fresh agent can read. Plain text:
 * tool calls, attachments and images are not carried. Another agent's replies
 * carry that agent's name instead of "Assistant". When one exchange is over the
 * cap its reply is cut from the front; the question is never cut.
 */
export function seedFromRuns(kept: readonly StoredAgentRun[], max = SEED_MAX_CHARS, forAgent?: string): string {
  const blocks: string[] = [];
  let used = 0;
  for (let i = kept.length - 1; i >= 0; i--) {
    const r = kept[i]!;
    if (r.compact) continue;
    const who = forAgent && r.agentRef !== forAgent ? r.agentRef : 'Assistant';
    const head = `User: ${r.prompt.trim()}\n\n${who}: `;
    let reply = r.text.trim() || '(no reply)';
    if (head.length + reply.length > max) reply = '...' + reply.slice(Math.max(0, reply.length - Math.max(0, max - head.length - 3)));
    const block = head + reply;
    if (used + block.length > max && blocks.length > 0) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.reverse().join('\n\n---\n\n');
}

/** The prompt, with the kept transcript ahead of it when a new thread is owed one. */
export function seededPrompt(seed: string, prompt: string): string {
  if (seed.trim() === '') return prompt;
  return `The earlier conversation, kept after the person edited an earlier message and went back to it (nothing after it happened):\n\n${seed}\n\n---\n\nContinue from here. The person now says:\n\n${prompt}`;
}

export interface RewindOutcome {
  kept: number;
  dropped: number;
  /** The agents whose next turn will roll back or reseed. */
  agents: string[];
}

/**
 * Whether a stored turn is a turn in the provider's thread `threadId`. A turn
 * the provider named (`pturn` a string) is; one it never accepted (`pturn`
 * null) is not; older records fall back to what the server knew (`reached`).
 */
function inThread(r: StoredAgentRun, threadId: string): boolean {
  if (r.thread && r.thread !== threadId) return false;
  if (r.pturn === null) return false;
  if (typeof r.pturn === 'string') return true;
  return r.compact === true || r.reached !== false;
}

/**
 * Edit from here at the turn the server named. Null: no such chat, or no such
 * turn (the page's list and the saved one disagree; it must reload, not guess).
 * `fromTurnId` null: the page has nothing the server saved at or after the
 * message (it failed before a turn existed), so nothing is cut.
 */
export function rewindChat(root: string, chatId: string, fromTurnId: string | null): RewindOutcome | null {
  const cut = truncateAgentRunsAt(root, chatId, fromTurnId);
  if (!cut) return null;
  const entry = readSessionIndex(root)?.sessions.find((s) => s.id === chatId);
  const agents: string[] = [];
  /* The drawings the cut turns made go with them (hidden, not deleted): a later @drawing:d3 must not attach a turn that never happened. */
  /* The cut turns leave the chat, so what the person went back from is written down now (the refine loop's Edit-from-here signal). */
  const asked = cut.dropped.filter((r) => !r.compact);
  if (asked.length > 0) recordEditFromHere(root, chatId, asked.map((r) => ({ id: r.id, agent: r.agentRef, text: r.prompt, at: r.startedAt })));
  if (cut.dropped.length > 0) cutDrawingsSince(root, chatId, Math.min(...cut.dropped.map((r) => r.startedAt)));
  if (cut.dropped.length > 0) {
    for (const [agentRef, ref] of Object.entries(entry?.agentThreads ?? {})) {
      /* Only the turns that are in this agent's current thread can be rolled out of it. */
      const theirs = cut.dropped.filter((r) => r.agentRef === agentRef && inThread(r, ref.id)).length;
      if (theirs === 0 && !ref.rewind) continue;
      const earlier = ref.rewind?.dropTurns ?? 0;
      /* Name the provider turn to go back to when every dropped turn in this thread is known by id; else the count stands. */
      const mine = cut.dropped.filter((r) => r.agentRef === agentRef && inThread(r, ref.id));
      const named = mine.every((r) => typeof r.pturn === 'string') ? mine.find((r) => typeof r.pturn === 'string')?.pturn : undefined;
      const beforeTurnId = typeof named === 'string' ? named : mine.length === 0 ? ref.rewind?.beforeTurnId : undefined;
      writeAgentThread(root, chatId, agentRef, { id: ref.id, kind: ref.kind, rewind: { dropTurns: earlier + theirs, seed: seedFromRuns(cut.kept, SEED_MAX_CHARS, agentRef), ...(typeof beforeTurnId === 'string' ? { beforeTurnId } : {}) } }, ref.at);
      agents.push(agentRef);
    }
  }
  return { kept: cut.kept.length, dropped: cut.dropped.length, agents };
}

/**
 * Undo the last edit while no turn has been sent since: the cut turns come
 * back and every agent thread's pending rewind is dropped (its thread was not
 * touched yet). Null when there is nothing to undo.
 */
export function undoRewind(root: string, chatId: string): { restored: number } | null {
  const entry = readSessionIndex(root)?.sessions.find((s) => s.id === chatId);
  if (!entry) return null;
  const threads = Object.entries(entry.agentThreads ?? {});
  const standing = new Set(readAgentRuns(root, chatId, { withCompactions: true }).map((r) => r.id));
  const runs = restoreRewound(root, chatId);
  if (!runs) return null;
  const back = runs.filter((r) => !standing.has(r.id));
  if (back.length > 0) retractEditFromHere(root, back.map((r) => r.id));
  if (back.length > 0) uncutDrawingsSince(root, chatId, Math.min(...back.map((r) => r.startedAt)));
  for (const [agentRef, ref] of threads) if (ref.rewind) writeAgentThread(root, chatId, agentRef, { id: ref.id, kind: ref.kind }, ref.at);
  return { restored: runs.length };
}

/** The next send has settled the rewind: it can no longer be undone. */
export function settledRewind(root: string, chatId: string): void {
  dropRewindBackup(root, chatId);
}

export interface SettledThread {
  threadId: string;
  /** rolled-back: same thread, turns dropped. reseeded: a new thread, `seed` owed to the next prompt. */
  how: 'rolled-back' | 'reseeded';
  seed: string;
  reason?: string;
}

/**
 * Open the thread for a chat that has a pending rewind. Rolls the old thread
 * back where the client can; otherwise a new thread and the seed.
 */
export async function settleRewind(
  client: AcpAgentClient,
  known: AgentThreadRef,
  pending: PendingRewind,
  cwd: string | undefined,
  signal?: AbortSignal,
): Promise<SettledThread> {
  if (pending.dropTurns === 0 && pending.seed !== '' && client.resumeSession) {
    /* The seed is owed to a thread already reseeded once: keep it, and owe it again. */
    try {
      return { threadId: await client.resumeSession(known.id, cwd, signal), how: 'reseeded', seed: pending.seed };
    } catch {
      return { threadId: await client.newSession(cwd, signal), how: 'reseeded', seed: pending.seed };
    }
  }
  if (client.rollbackTurns && client.resumeSession) {
    try {
      const threadId = await client.resumeSession(known.id, cwd, signal);
      if (pending.beforeTurnId && client.rollbackTo) await client.rollbackTo(pending.beforeTurnId);
      else await client.rollbackTurns(pending.dropTurns);
      return { threadId, how: 'rolled-back', seed: '' };
    } catch (e) {
      if (signal?.aborted) throw e;
      const threadId = await client.newSession(cwd, signal);
      return { threadId, how: 'reseeded', seed: pending.seed, reason: `the agent could not roll its thread back: ${(e as Error).message}` };
    }
  }
  const threadId = await client.newSession(cwd, signal);
  return { threadId, how: 'reseeded', seed: pending.seed, reason: 'this agent cannot roll a thread back, so a new thread starts from the kept conversation' };
}
