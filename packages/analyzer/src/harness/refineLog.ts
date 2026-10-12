/**
 * The refine log: one append-only file of what happened, for every provider.
 *
 *   .sequence/refine/log.jsonl
 *     {"t":"turn", ...}    one per finished turn (local ask, Claude, Codex)
 *     {"t":"signal", ...}  one per failure signal found in or about a turn
 *
 * WHY A LOG AND NOT THE CHAT STORES. Two of the signals are about turns that are
 * no longer in the chat when they matter: Edit from here cuts the turns out of
 * `agent-runs.json`, and discarding a best-of-N sibling deletes its worktree and
 * chat. The evidence has to be written down at the moment it happens. Turns are
 * logged with the person's words only (clipped), never the agent's reply.
 *
 * Best-effort like every other store here: a write that fails costs the signal,
 * never the turn; a damaged line is skipped, never fatal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SEQUENCE_DIR } from '../server/store.js';

export const REFINE_DIR = 'refine';
export const REFINE_LOG_FILE = 'log.jsonl';
/** The log keeps its newest lines; a cut is rewritten whole. */
export const MAX_LOG_LINES = 4000;
const CUT_TO = 3000;
/** Ask text kept per record. */
export const TEXT_CLIP = 280;

export type SignalKind =
  | 'ask_not_done'
  | 'repeated_ask'
  | 'edit_from_here'
  | 'fanout_discarded'
  | 'stopped'
  | 'pipeline_error';

/** Kinds that mean the person had to do something about the answer (stronger than a stop or an edit). */
export const STRONG_KINDS: ReadonlySet<SignalKind> = new Set<SignalKind>(['ask_not_done', 'repeated_ask', 'pipeline_error']);

export interface TurnRecord {
  t: 'turn';
  id: string;
  chat: string;
  agent: string;
  /** Epoch ms. */
  at: number;
  text: string;
  status: 'done' | 'failed' | 'stopped';
}

export interface SignalRecord {
  t: 'signal';
  kind: SignalKind;
  /** The turn the failure is about (the one whose answer fell short). */
  turn: string;
  /** Every turn id the signal rests on, target first. Non-empty. */
  evidence: string[];
  chat: string;
  agent: string;
  at: number;
  /** The ask in the person's words (clipped), for grouping and for the note. */
  text: string;
  /** What the agent or the detector said (the not-done reason, the overlap). */
  detail?: string;
}

export type RefineRecord = TurnRecord | SignalRecord;

export function refineLogPath(root: string): string {
  return path.join(root, SEQUENCE_DIR, REFINE_DIR, REFINE_LOG_FILE);
}

export function appendRefineRecords(root: string, records: readonly RefineRecord[]): boolean {
  if (records.length === 0) return true;
  const file = refineLogPath(root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    cutIfLong(file);
    return true;
  } catch {
    return false;
  }
}

/** Drop the records `drop` names (rewrites the file). Used when a signal is taken back, e.g. the person undid an Edit from here. */
export function removeRefineRecords(root: string, drop: (r: RefineRecord) => boolean): number {
  try {
    const keep = readRefineLog(root);
    const kept = keep.filter((r) => !drop(r));
    if (kept.length === keep.length) return 0;
    fs.writeFileSync(refineLogPath(root), kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
    return keep.length - kept.length;
  } catch {
    return 0;
  }
}

function cutIfLong(file: string): void {
  try {
    if (fs.statSync(file).size < 200_000) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_LOG_LINES) return;
    fs.writeFileSync(file, lines.slice(-CUT_TO).join('\n') + '\n');
  } catch {
    /* a log that cannot be trimmed is only longer */
  }
}

function isTurn(r: Record<string, unknown>): boolean {
  return r.t === 'turn' && typeof r.id === 'string' && typeof r.chat === 'string' && typeof r.text === 'string' && typeof r.at === 'number';
}
function isSignal(r: Record<string, unknown>): boolean {
  return (
    r.t === 'signal' &&
    typeof r.kind === 'string' &&
    typeof r.turn === 'string' &&
    Array.isArray(r.evidence) &&
    r.evidence.length > 0 &&
    r.evidence.every((e) => typeof e === 'string') &&
    typeof r.text === 'string' &&
    typeof r.at === 'number'
  );
}

/** Every well-formed record, oldest first. A missing file is an empty log; a bad line is skipped. */
export function readRefineLog(root: string): RefineRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(refineLogPath(root), 'utf8');
  } catch {
    return [];
  }
  const out: RefineRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      if (r && typeof r === 'object' && (isTurn(r) || isSignal(r))) out.push(r as unknown as RefineRecord);
    } catch {
      /* skip */
    }
  }
  return out;
}

export const turnsOf = (log: readonly RefineRecord[]): TurnRecord[] => log.filter((r): r is TurnRecord => r.t === 'turn');
export const signalsOf = (log: readonly RefineRecord[]): SignalRecord[] => log.filter((r): r is SignalRecord => r.t === 'signal');
