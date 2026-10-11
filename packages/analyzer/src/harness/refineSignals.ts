/**
 * Failure signals for the refine loop, from every provider. NO LLM.
 *
 * The first loop learned from one thing: a local ask whose pipeline ended in an
 * `error` terminal. The failures people feel are others, and they happen on
 * Claude and Codex turns too:
 *
 *   ask_not_done      the agent's own closing line said a request is not done
 *   repeated_ask      the person typed the same request again
 *   edit_from_here    the person went back to an earlier message and rewrote it
 *   fanout_discarded  a best-of-N answer the person did not pick, then discarded
 *   stopped           the person stopped the turn midway
 *
 * Each signal names the TURN IDS it rests on. A signal with no turn behind it is
 * a guess, and the proposal store already refuses a refine with no evidence.
 *
 * HONESTY. These are signals, not verdicts. A legitimate re-run ("run the tests
 * again") looks like a repeat; a stop can be a change of mind. That is why a
 * signal alone never edits anything: it is grouped, it becomes a candidate that
 * the person sees and accepts, and the outcome tracker (refineOutcome.ts) checks
 * afterwards whether the failure stopped coming back.
 */

import type { AskLedgerResult } from '@sequence/schema';
import { COMPLAINT_CUES, REPEAT_CUES, clip, containment, contentTokens, jaccard } from './refineText.js';
import {
  TEXT_CLIP,
  appendRefineRecords,
  readRefineLog,
  removeRefineRecords,
  signalsOf,
  turnsOf,
  type SignalRecord,
  type TurnRecord,
} from './refineLog.js';

/** Overlap a restatement needs when nothing in it says "again". */
export const REPEAT_OVERLAP = 0.6;
/** Overlap needed when the wording itself says the person is repeating ("still", "I already asked"). */
export const REPEAT_OVERLAP_CUED = 0.34;
/** A repeat is only judged between asks with at least this many content words on both sides. */
export const REPEAT_MIN_TOKENS = 3;

export interface TurnInput {
  id: string;
  chat: string;
  agent: string;
  at: number;
  /** What the person typed (never the private context sent with it). */
  text: string;
  status: 'done' | 'failed' | 'stopped';
  /** The agent's own report from the closing `<asks>` line, when the ledger was on. */
  ledger?: Pick<AskLedgerResult, 'closures'> | null;
  /** A local ask whose pipeline ended in an error terminal. */
  pipelineError?: string | null;
}

/** The overlap score the repeat rule uses: the larger of Jaccard and a discounted containment. */
export function repeatScore(a: readonly string[], b: readonly string[]): number {
  return Math.max(jaccard(a, b), 0.8 * containment(a, b));
}

/**
 * Whether `cur` restates an earlier ask of the same chat. Returns the earlier
 * turn and the score, or null. Earlier turns that themselves failed or were
 * stopped are skipped: asking again after a failure is a retry, and that
 * failure is already its own signal.
 *
 * SIMILAR IS NOT ENOUGH. Text overlap alone flagged legitimate re-runs ("run the
 * telemetry tests", "now add the toggle to the profile page") and held the kind
 * at precision 0.56 on the sealed set. A repeat now needs one more fact that the
 * earlier answer fell short: the person's own complaint in the new message
 * ({@link COMPLAINT_CUES}: "still", "you didn't", "is not"), or the earlier
 * turn already carrying a not-done report or an Edit from here (`fellShort`).
 */
export function findRepeat(
  cur: Pick<TurnRecord, 'text'>,
  prior: readonly TurnRecord[],
  fellShort: ReadonlySet<string> = new Set(),
): { turn: TurnRecord; score: number } | null {
  const ct = contentTokens(cur.text);
  if (ct.length < REPEAT_MIN_TOKENS) return null;
  const need = REPEAT_CUES.test(cur.text) ? REPEAT_OVERLAP_CUED : REPEAT_OVERLAP;
  const complained = COMPLAINT_CUES.test(cur.text);
  let best: { turn: TurnRecord; score: number } | null = null;
  for (const p of prior) {
    if (p.status !== 'done') continue;
    if (!complained && !fellShort.has(p.id)) continue;
    const pt = contentTokens(p.text);
    if (pt.length < REPEAT_MIN_TOKENS) continue;
    const score = repeatScore(ct, pt);
    if (score >= need && (!best || score > best.score)) best = { turn: p, score };
  }
  return best;
}

/** Kinds that say a turn's answer fell short, so a later restatement of it is a repeat. */
const FELL_SHORT: ReadonlySet<SignalRecord['kind']> = new Set(['ask_not_done', 'edit_from_here']);

/** Signals found in (or about) one finished turn. Pure: `prior` is the same chat's earlier turns, oldest first. */
export function detectTurnSignals(turn: TurnInput, prior: readonly TurnRecord[], fellShort: ReadonlySet<string> = new Set()): SignalRecord[] {
  const out: SignalRecord[] = [];
  const base = { chat: turn.chat, agent: turn.agent, at: turn.at };
  for (const c of turn.ledger?.closures ?? []) {
    if (c.done) continue;
    out.push({
      t: 'signal',
      kind: 'ask_not_done',
      turn: turn.id,
      evidence: [turn.id],
      ...base,
      text: clip(c.text.trim() !== '' ? c.text : turn.text, TEXT_CLIP),
      ...(c.reason ? { detail: clip(c.reason, 160) } : {}),
    });
  }
  if (turn.status === 'stopped') {
    out.push({ t: 'signal', kind: 'stopped', turn: turn.id, evidence: [turn.id], ...base, text: clip(turn.text, TEXT_CLIP) });
  }
  if (turn.pipelineError) {
    out.push({ t: 'signal', kind: 'pipeline_error', turn: turn.id, evidence: [turn.id], ...base, text: clip(turn.text, TEXT_CLIP), detail: clip(turn.pipelineError, 160) });
  }
  const rep = findRepeat({ text: turn.text }, prior, fellShort);
  if (rep) {
    out.push({
      t: 'signal',
      kind: 'repeated_ask',
      turn: rep.turn.id,
      evidence: [rep.turn.id, turn.id],
      ...base,
      text: rep.turn.text,
      detail: `typed again, overlap ${rep.score.toFixed(2)}`,
    });
  }
  return out;
}

/** Log a finished turn and the signals it carries. Idempotent per turn id. Never throws. Returns the new signals. */
export function recordTurn(root: string, turn: TurnInput): SignalRecord[] {
  try {
    const log = readRefineLog(root);
    const turns = turnsOf(log);
    if (turns.some((t) => t.id === turn.id)) return [];
    const prior = turns.filter((t) => t.chat === turn.chat && t.at <= turn.at);
    const rec: TurnRecord = { t: 'turn', id: turn.id, chat: turn.chat, agent: turn.agent, at: turn.at, text: clip(turn.text, TEXT_CLIP), status: turn.status };
    const fellShort = new Set(signalsOf(log).filter((s) => FELL_SHORT.has(s.kind)).map((s) => s.turn));
    const signals = detectTurnSignals({ ...turn, text: rec.text }, prior, fellShort);
    appendRefineRecords(root, [rec, ...signals]);
    return signals;
  } catch {
    return [];
  }
}

export interface DroppedTurn {
  id: string;
  agent: string;
  text: string;
  at: number;
}

/**
 * Edit from here: the person went back to an earlier message. The turns it cut
 * are gone from the chat afterwards, so the signal is written now. It is about
 * the first cut turn (the message that was rewritten); the rest are context.
 */
export function recordEditFromHere(root: string, chat: string, dropped: readonly DroppedTurn[], now = Date.now()): SignalRecord[] {
  try {
    if (dropped.length === 0) return [];
    const first = dropped[0]!;
    const sig: SignalRecord = {
      t: 'signal',
      kind: 'edit_from_here',
      turn: first.id,
      evidence: dropped.slice(0, 6).map((d) => d.id),
      chat,
      agent: first.agent,
      at: now,
      text: clip(first.text, TEXT_CLIP),
      detail: `${dropped.length} turn${dropped.length === 1 ? '' : 's'} cut`,
    };
    appendRefineRecords(root, [sig]);
    return [sig];
  } catch {
    return [];
  }
}

/** The person undid the edit: the turns are back, so going back is not a failure signal. */
export function retractEditFromHere(root: string, restoredIds: readonly string[]): number {
  const ids = new Set(restoredIds);
  return removeRefineRecords(root, (r) => r.t === 'signal' && r.kind === 'edit_from_here' && r.evidence.some((e) => ids.has(e)));
}

export interface DiscardedSibling {
  chat: string;
  agent: string;
  prompt: string;
  /** The sibling's own turn ids (its agent-runs), at least one. */
  turnIds: string[];
}

/** Best-of-N: a sibling the person did not pick and then discarded. One signal each. */
export function recordFanoutDiscard(root: string, siblings: readonly DiscardedSibling[], now = Date.now()): SignalRecord[] {
  try {
    const out: SignalRecord[] = [];
    for (const s of siblings) {
      if (s.turnIds.length === 0) continue;
      out.push({
        t: 'signal',
        kind: 'fanout_discarded',
        turn: s.turnIds[0]!,
        evidence: s.turnIds.slice(0, 6),
        chat: s.chat,
        agent: s.agent,
        at: now,
        text: clip(s.prompt, TEXT_CLIP),
        detail: `${s.agent} was not picked in best-of-N`,
      });
    }
    appendRefineRecords(root, out);
    return out;
  } catch {
    return [];
  }
}

/** Every signal on disk (newest last). */
export function readSignals(root: string): SignalRecord[] {
  return signalsOf(readRefineLog(root));
}
