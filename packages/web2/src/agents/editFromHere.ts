/* ══════════════════════════════════════════════════════════════════════════
   EDIT FROM HERE
   packages/web2/src/agents/editFromHere.ts

   Rewrite an earlier message and go on from there. Three things move
   together, in this order, and a failure in an earlier one stops the rest:

     1. the agent's thread (POST /api/sessions/:id/rewind { fromTurnId }): the
        server cuts the saved turns from the turn it NAMED (its own id, learned
        through acp:turn-id, never a position in the page's list) and marks the
        provider thread to roll back (codex) or to start again from the kept
        chat (the Claude bridge has no rollback). The cut stays restorable
        until the next send (POST /rewind/undo);
     2. optionally the files, through the existing rewind model (turn
        snapshots, /api/snapshots/revert), back to how they were before the
        message;
     3. the page: the message and everything after it leave the chat, and
        the message text goes back to the composer to be edited.
   ══════════════════════════════════════════════════════════════════════════ */

import { createTurnsClient, type SnapshotTurn, type TurnsClient } from '../review/turnsClient';
import type { AgentRun, AgentRunStore } from './agentRuns';
import { editUndo, type EditUndo } from './editUndo';
import type { Fetch } from './runNodeStream';

/** Allow for the clock gap between the page and the snapshot (older snapshots carry no turn id). */
const SKEW_MS = 5_000;

/**
 * The server's id of the turn an edit at `run` goes back to: the run's own, or
 * the next later one the server knows when `run` failed before it reached it.
 * Null: no run from here on was ever saved, so there is nothing to cut.
 */
export function cutTurnId(runs: readonly AgentRun[], run: Pick<AgentRun, 'id' | 'sessionId'>): string | null {
  const mine = runs.filter((r) => r.sessionId === run.sessionId);
  const at = mine.findIndex((r) => r.id === run.id);
  if (at < 0) return null;
  return mine.slice(at).find((r) => r.turnId)?.turnId ?? null;
}

/**
 * The snapshot taken for the turn the edit cuts at. By turn id when snapshots
 * carry one; by start time only for snapshots written before ids were kept.
 * Null when none was taken or no undo point could be written for it.
 */
export function snapshotForRun(turns: readonly SnapshotTurn[], run: Pick<AgentRun, 'startedAt'>, turnId?: string | null): SnapshotTurn | null {
  const sorted = [...turns].sort((a, b) => a.seq - b.seq);
  let t: SnapshotTurn | undefined;
  if (turnId && sorted.some((x) => x.chatTurnId)) t = sorted.find((x) => x.chatTurnId === turnId);
  else t = sorted.find((x) => x.at >= run.startedAt - SKEW_MS);
  return t && !t.noUndo ? t : null;
}

/** The files written from that snapshot on: what putting the files back would touch. */
export function filesFromSnapshot(turns: readonly SnapshotTurn[], from: SnapshotTurn): string[] {
  const set = new Set<string>();
  for (const t of turns) if (t.seq >= from.seq) for (const f of t.files) set.add(f);
  return [...set].sort();
}

export interface FilesOffer {
  seq: number;
  files: string[];
}

/** What the confirm row offers for the files, or null when there is nothing to put back. */
export async function filesOffer(run: AgentRun, turnId: string | null = null, client: TurnsClient = createTurnsClient()): Promise<FilesOffer | null> {
  if (!run.sessionId) return null;
  const r = await client.turns(run.sessionId);
  if (r.outcome !== 'ok') return null;
  const live = r.body.revert ? r.body.turns.filter((t) => t.seq < r.body.revert!.seq) : r.body.turns;
  const from = snapshotForRun(live, run, turnId);
  if (!from) return null;
  const files = filesFromSnapshot(live, from);
  return files.length > 0 ? { seq: from.seq, files } : null;
}

export type EditResult = { ok: true; prompt: string; filesReverted: number; removed: AgentRun[] } | { ok: false; error: string };

export interface EditOptions {
  store: AgentRunStore;
  run: AgentRun;
  /** Put the files back too (the seq from {@link filesOffer}). */
  revertFilesTo?: number;
  fetch?: Fetch;
  turns?: TurnsClient;
}

async function whyNot(res: Response): Promise<string> {
  let why = `The server refused (${res.status}).`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) why = j.error;
  } catch {
    /* the status says it */
  }
  return why;
}

export async function editFromHere(o: EditOptions): Promise<EditResult> {
  const { store, run } = o;
  const f: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  if (!run.sessionId) return { ok: false, error: 'This message is not in a saved chat.' };
  const all = store.get().runs;
  const mine = all.filter((r) => r.sessionId === run.sessionId);
  const at = mine.findIndex((r) => r.id === run.id);
  if (at < 0 || mine.slice(at).some((r) => r.status === 'running')) return { ok: false, error: 'Wait for the agent to finish, or stop it, first.' };
  const fromTurnId = cutTurnId(all, run);
  let res;
  try {
    res = await f(`/api/sessions/${encodeURIComponent(run.sessionId)}/rewind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromTurnId }) });
  } catch (e) {
    return { ok: false, error: `Could not reach the server: ${(e as Error).message}` };
  }
  if (!res.ok) return { ok: false, error: await whyNot(res) };
  let filesReverted = 0;
  let failedFiles = false;
  if (o.revertFilesTo !== undefined) {
    const r = await (o.turns ?? createTurnsClient()).revert(run.sessionId, o.revertFilesTo);
    if (r.outcome === 'ok') filesReverted = r.body.files.length;
    else failedFiles = true;
  }
  const cut = store.truncateFrom(run.id);
  if (failedFiles) {
    /* The thread is already cut; say the files were not, so nothing is hidden. */
    return { ok: false, error: 'The conversation went back, but the files could not be put back. Use Rewind to try again.' };
  }
  return { ok: true, prompt: run.prompt, filesReverted, removed: cut?.removed ?? [] };
}

/** Put the last edit back while nothing has been sent since. The composer gets its old text back if it still holds the edited message. */
export async function undoEdit(o: { store: AgentRunStore; undo: EditUndo; fetch?: Fetch }): Promise<{ ok: true } | { ok: false; error: string }> {
  const f: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  let res;
  try {
    res = await f(`/api/sessions/${encodeURIComponent(o.undo.sessionId)}/rewind/undo`, { method: 'POST' });
  } catch (e) {
    return { ok: false, error: `Could not reach the server: ${(e as Error).message}` };
  }
  if (!res.ok) {
    editUndo.set(null);
    return { ok: false, error: await whyNot(res) };
  }
  o.store.restore(o.undo.removed);
  editUndo.set(null);
  return { ok: true };
}
