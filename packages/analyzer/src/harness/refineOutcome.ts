/**
 * Did the note help? Recurrence tracking per accepted note. NO LLM.
 *
 * A note is worth keeping only if the failure it came from stops coming back.
 * On Accept the store writes `.sequence/refinements/<id>/outcome.json` with the
 * moment of acceptance and the failure rate on matching asks BEFORE it. Later
 * the same rate is read for matching asks AFTER it, from the refine log (every
 * provider), and compared:
 *
 *   helped      the failure rate on matching asks fell to half or less
 *   no_change   it did not fall that far (flagged: the note costs tokens and does nothing)
 *   worse       it went up by 0.1 or more, with at least 2 failures after (flagged)
 *   too_early   fewer than {@link MIN_AFTER} matching asks since: no verdict yet
 *
 * A note also gets `worse` when the failure rate across ALL turns rose by 0.2 or
 * more (at least {@link MIN_GLOBAL} turns on each side): a note that fixes its
 * own topic but makes the agent worse elsewhere should not stay. With several
 * notes accepted close together this cannot say which one did it, so the flag
 * means "look at this", not "this is guilty".
 *
 * "Matching ask" is `appliesTo(note.topic, ask)`: the same rule retrieval uses.
 * "Failed" is: any signal names that turn as its target. Edit from here, a stop
 * and a not-done report all count the same; a count that treats them
 * differently needs a labelled set this repo does not have yet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { appliesTo } from './refineNotes.js';
import { readRefineLog, signalsOf, turnsOf, type SignalKind } from './refineLog.js';
import { refinementDir, type RefineProposal } from './refineProposal.js';

export const OUTCOME_FILE = 'outcome.json';
export const MIN_AFTER = 3;
export const MIN_GLOBAL = 10;

export type Verdict = 'helped' | 'no_change' | 'worse' | 'too_early';

export interface Window {
  /** Matching asks in the window. */
  asks: number;
  /** Of those, asks some signal names as failed. */
  failed: number;
  /** failed / asks, or null with no asks. */
  rate: number | null;
}

export interface OutcomeStore {
  acceptedAt: number;
  by: 'person' | 'auto';
  topic: string[];
  kinds: string[];
  before: Window;
  globalBefore: Window;
  /** The person looked at a flag (or an automatic accept) and chose to keep the note: stop showing it. */
  kept?: boolean;
  /** Last verdict computed, kept so it survives the log being trimmed. */
  last?: { verdict: Verdict; at: number; after: Window; globalAfter: Window };
}

export interface Outcome extends OutcomeStore {
  verdict: Verdict;
  after: Window;
  globalAfter: Window;
  /** True for `no_change` and `worse`: the note is a candidate for removal. */
  flagged: boolean;
  /** Plain words for the card. */
  summary: string;
}

const win = (asks: number, failed: number): Window => ({ asks, failed, rate: asks ? failed / asks : null });

interface Stats {
  match: Window;
  all: Window;
}

/** Failure rate on matching asks, and on all asks, among turns with `at` in [from, to). */
export function windowStats(root: string, topic: readonly string[], from: number, to: number, excludeKinds: ReadonlySet<SignalKind> = new Set()): Stats {
  const log = readRefineLog(root);
  const failed = new Set(signalsOf(log).filter((s) => !excludeKinds.has(s.kind)).map((s) => s.turn));
  let a = 0, f = 0, ga = 0, gf = 0;
  for (const t of turnsOf(log)) {
    if (t.at < from || t.at >= to) continue;
    ga += 1;
    const bad = failed.has(t.id);
    if (bad) gf += 1;
    if (appliesTo(topic, t.text)) {
      a += 1;
      if (bad) f += 1;
    }
  }
  return { match: win(a, f), all: win(ga, gf) };
}

function storePath(root: string, id: string): string {
  return path.join(refinementDir(root, id), OUTCOME_FILE);
}

export function readOutcomeStore(root: string, id: string): OutcomeStore | undefined {
  try {
    const o = JSON.parse(fs.readFileSync(storePath(root, id), 'utf8')) as OutcomeStore;
    return typeof o.acceptedAt === 'number' && Array.isArray(o.topic) ? o : undefined;
  } catch {
    return undefined;
  }
}

function writeOutcomeStore(root: string, id: string, o: OutcomeStore): void {
  try {
    fs.mkdirSync(refinementDir(root, id), { recursive: true });
    fs.writeFileSync(storePath(root, id), JSON.stringify(o, null, 2));
  } catch {
    /* best effort: a note without an outcome file is "too early" forever, not a broken note */
  }
}

/** Call right after a proposal is accepted: write the baseline the later turns are compared with. */
export function beginOutcome(root: string, p: RefineProposal, by: 'person' | 'auto', now = Date.now()): OutcomeStore {
  const topic = p.topic ?? [];
  const s = windowStats(root, topic, 0, now);
  const store: OutcomeStore = { acceptedAt: now, by, topic, kinds: p.kinds ?? [], before: s.match, globalBefore: s.all };
  writeOutcomeStore(root, p.id, store);
  return store;
}

/** The pure comparison. */
export function judge(before: Window, after: Window, globalBefore: Window, globalAfter: Window): Verdict {
  if (globalBefore.asks >= MIN_GLOBAL && globalAfter.asks >= MIN_GLOBAL && (globalAfter.rate ?? 0) - (globalBefore.rate ?? 0) >= 0.2) return 'worse';
  if (after.asks < MIN_AFTER) return 'too_early';
  const rb = before.rate ?? 0;
  const ra = after.rate ?? 0;
  if (ra - rb >= 0.1 && after.failed >= 2) return 'worse';
  if (ra === 0 || ra <= rb * 0.5) return 'helped';
  return 'no_change';
}

const pct = (r: number | null): string => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);

/** Evaluate an accepted note now; persists the verdict. Undefined when no baseline was written. */
export function evaluateOutcome(root: string, id: string, now = Date.now()): Outcome | undefined {
  const st = readOutcomeStore(root, id);
  if (!st) return undefined;
  const s = windowStats(root, st.topic, st.acceptedAt, now + 1);
  const verdict = judge(st.before, s.match, st.globalBefore, s.all);
  writeOutcomeStore(root, id, { ...st, last: { verdict, at: now, after: s.match, globalAfter: s.all } });
  const summary =
    verdict === 'too_early'
      ? `Too early to tell: ${s.match.asks} matching ask${s.match.asks === 1 ? '' : 's'} since (needs ${MIN_AFTER}).`
      : verdict === 'helped'
        ? `Helped: matching asks failed ${pct(st.before.rate)} of the time before, ${pct(s.match.rate)} since.`
        : verdict === 'worse'
          ? `Not helping: failures went from ${pct(st.before.rate)} to ${pct(s.match.rate)} on matching asks${s.all.rate !== null && st.globalBefore.rate !== null ? ` (all asks ${pct(st.globalBefore.rate)} to ${pct(s.all.rate)})` : ''}.`
          : `No change: matching asks failed ${pct(st.before.rate)} before and ${pct(s.match.rate)} since.`;
  return { ...st, verdict, after: s.match, globalAfter: s.all, flagged: verdict === 'no_change' || verdict === 'worse', summary };
}

/** Ids of accepted notes the tracker says make things worse (kept out of the prompt while the person decides). */
export function worseNoteIds(root: string, proposals: readonly RefineProposal[]): Set<string> {
  const out = new Set<string>();
  for (const p of proposals) {
    if (p.status !== 'accepted' || !p.note) continue;
    const st = readOutcomeStore(root, p.id);
    if (st?.last?.verdict === 'worse') out.add(p.id);
  }
  return out;
}

/** The person keeps a note that was auto-added or flagged: the card stops asking. The note and its verdict stay. */
export function markKept(root: string, id: string): boolean {
  const st = readOutcomeStore(root, id);
  if (!st) return false;
  writeOutcomeStore(root, id, { ...st, kept: true });
  return true;
}
