/**
 * From failure signals to a proposed note. NO LLM.
 *
 * Signals (refineSignals.ts) about similar asks are grouped; a group that has
 * enough evidence becomes ONE candidate, and a candidate becomes a pending
 * proposal for the Accept / Dismiss card. This module only proposes.
 *
 * WHEN A GROUP IS ENOUGH (stricter than "a signal happened", on purpose, since
 * every proposal costs the person a look):
 *   - two or more distinct turns, with at least one strong signal (the agent
 *     said not done, or the person typed it again) or two weak ones (a stop, an
 *     Edit from here, a discarded best-of-N sibling), or
 *   - ONE turn the agent itself reported as not done WITH a reason: its own
 *     stated blocker ("no test runner in this package") is a fact worth a line.
 *
 * THE TIP IS A TEMPLATE, NOT A GUESS. It states what happened to this ask, in
 * the person's words, and what the agent said was in the way. It never invents
 * advice the evidence does not contain. A local model may reword it later
 * (`enhanceAfter`); the template is the fallback and is what the tests pin.
 */

import { clip, contentTokens, jaccard, plainNoteText } from './refineText.js';
import { STRONG_KINDS, type SignalKind, type SignalRecord } from './refineLog.js';
import { NOTES_REL, addNoteLine } from './refineNotes.js';
import { refineProposalId, type RefineProposal } from './refineProposal.js';

/** Overlap two asks need to be the same topic (Jaccard of content words). */
export const CLUSTER_OVERLAP = 0.5;
/** Pending proposals at once: the card is quiet, so the queue is short. */
export const MAX_PENDING = 3;

export interface Candidate {
  /** Stable key from the first (seed) ask's words. */
  key: string;
  topic: string[];
  /** The seed ask in the person's words. */
  ask: string;
  kinds: SignalKind[];
  /** Every turn id the signals rest on, in order, deduped. */
  turnIds: string[];
  signals: SignalRecord[];
  /** The agent's stated reason, from a not-done report. */
  reason: string | null;
  strong: boolean;
  /**
   * The note's words come from the AGENT (its restated request or its not-done
   * reason), not from the person. An agent's words can carry what it read in the
   * repo or in a tool's output, so such a note is never added by Auto: the person
   * reads it on the card first.
   */
  agentWorded: boolean;
}

/** Group signals by topic (single link, Jaccard >= {@link CLUSTER_OVERLAP}). Local pipeline errors are left to the trajectory planner. */
export function clusterSignals(signals: readonly SignalRecord[]): Candidate[] {
  type Group = { seed: string[]; members: string[][]; sigs: SignalRecord[] };
  const groups: Group[] = [];
  for (const s of [...signals].sort((a, b) => a.at - b.at)) {
    if (s.kind === 'pipeline_error') continue;
    const toks = contentTokens(s.text);
    if (toks.length < 2) continue;
    const g = groups.find((x) => x.members.some((m) => jaccard(m, toks) >= CLUSTER_OVERLAP));
    if (g) {
      g.members.push(toks);
      g.sigs.push(s);
    } else groups.push({ seed: toks, members: [toks], sigs: [s] });
  }
  return groups.map((g) => {
    const topic = g.seed.slice(0, 6);
    const turnIds: string[] = [];
    for (const s of g.sigs) for (const e of s.evidence) if (!turnIds.includes(e)) turnIds.push(e);
    const kinds = [...new Set(g.sigs.map((s) => s.kind))];
    const withReason = g.sigs.find((s) => s.kind === 'ask_not_done' && s.detail);
    return {
      key: `signal:${[...g.seed].sort().slice(0, 4).join('-')}`,
      topic,
      ask: g.sigs[0]!.text,
      kinds,
      turnIds,
      signals: g.sigs,
      reason: withReason?.detail ?? null,
      strong: g.sigs.some((s) => STRONG_KINDS.has(s.kind)),
      agentWorded: withReason !== undefined || g.sigs[0]!.kind === 'ask_not_done',
    };
  });
}

/** Whether a candidate has enough evidence to ask the person about. */
export function qualifies(c: Candidate): boolean {
  if (c.reason !== null) return true;
  if (c.turnIds.length < 2) return false;
  return c.strong || c.signals.length >= 2;
}

const q = (s: string, n: number): string => `"${clip(plainNoteText(s), n).replace(/"/g, "'")}"`;

/** The one sentence a note carries. States what happened; adds no advice the evidence does not hold. */
export function tipFor(c: Candidate): string {
  const ask = q(c.ask, 90);
  if (c.reason) return `${ask} was reported not done before: ${clip(plainNoteText(c.reason), 120).replace(/[.\s]+$/, '')}. Check that first.`;
  const k = new Set(c.kinds);
  if (k.has('repeated_ask')) return `${ask} had to be asked twice. Finish all of it the first time and say what changed.`;
  if (k.has('ask_not_done')) return `${ask} was left not done in earlier turns. Say up front what you cannot do.`;
  if (k.has('stopped')) return `${ask} was stopped by the person midway. State the plan in a line before a long run.`;
  if (k.has('edit_from_here')) return `The person went back and rewrote ${ask} after a first try. Confirm the approach before building.`;
  return `Several agents tried ${ask} and the person discarded this one's answer.`;
}

/** The NOTES.md line: sentence for the prompt, evidence for the person in braces, the marker last. */
export function noteLineFor(c: Candidate, id: string): string {
  const ev = `{turns: ${c.turnIds.slice(0, 6).join(', ')}; ${c.kinds.join(', ')}}`;
  return `- [${c.key}] ${tipFor(c)} ${ev} <!--n:${id}-->`;
}

/** The pending proposal for a candidate. `before` is the notes file as it is now. */
export function proposalFor(c: Candidate, before: string): RefineProposal {
  const id = refineProposalId(c.key, NOTES_REL);
  const note = noteLineFor(c, id);
  return {
    id,
    trigger: c.key,
    evidenceRefs: { runIds: c.turnIds.slice(0, 12), filePaths: [] },
    targetPath: NOTES_REL,
    before,
    after: addNoteLine(before, note, id),
    status: 'pending',
    source: 'signals',
    note,
    topic: c.topic,
    kinds: c.kinds,
  };
}
