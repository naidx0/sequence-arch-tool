/**
 * What the Accept / Dismiss / Undo card shows. NO LLM.
 *
 * The card is quiet by rule: nothing is drawn unless a person has a decision to
 * make, and the decisions are few.
 *
 *   pending   a proposed note: Accept or Dismiss
 *   auto      a note added by the opt-in Auto setting: Undo, or OK to keep it
 *   flagged   an accepted note the tracker says does not help or makes things
 *             worse: Remove (Undo) or Keep
 *
 * Everything the card says comes from the stores, not from a model: the note's
 * own sentence, the person's own words from the turns it rests on, and the
 * tracker's numbers.
 */

import { listRefineProposals } from './refineProposal.js';
import { evaluateOutcome, readOutcomeStore, type Verdict } from './refineOutcome.js';
import { readRefineLog, turnsOf } from './refineLog.js';
import { parseNotes } from './refineNotes.js';
import { clip } from './refineText.js';

export interface NoteCard {
  id: string;
  state: 'pending' | 'auto' | 'flagged';
  /** The sentence the prompt will carry. */
  tip: string;
  why: {
    /** What went wrong, as signal kinds (`repeated_ask`, ...). */
    kinds: string[];
    /** Turn ids the proposal rests on. */
    turns: string[];
    /** The person's own words from up to three of those turns. */
    asks: string[];
  };
  verdict?: Verdict;
  /** The tracker's sentence, for a flagged note. */
  summary?: string;
}

export function refineCards(root: string): NoteCard[] {
  const out: NoteCard[] = [];
  const turns = new Map(turnsOf(readRefineLog(root)).map((t) => [t.id, t.text]));
  for (const p of listRefineProposals(root)) {
    if (!p.note) continue;
    const tip = parseNotes(p.note)[0]?.tip;
    if (!tip) continue;
    const why = {
      kinds: p.kinds ?? [],
      turns: p.evidenceRefs.runIds,
      asks: [...new Set(p.evidenceRefs.runIds.map((id) => turns.get(id)).filter((t): t is string => !!t).map((t) => clip(t, 140)))].slice(0, 3),
    };
    if (p.status === 'pending') {
      out.push({ id: p.id, state: 'pending', tip, why });
    } else if (p.status === 'accepted') {
      const st = readOutcomeStore(root, p.id);
      if (!st || st.kept) continue;
      const o = evaluateOutcome(root, p.id);
      if (o?.flagged) out.push({ id: p.id, state: 'flagged', tip, why, verdict: o.verdict, summary: o.summary });
      else if (st.by === 'auto') out.push({ id: p.id, state: 'auto', tip, why });
    }
  }
  return out;
}
