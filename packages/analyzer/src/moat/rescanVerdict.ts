/**
 * WHAT THE EDIT ACTUALLY DID TO THE ARCHITECTURE.
 *
 * `PUT /api/file` clears the graph cache without re-scanning, so the moment an
 * edit lands the board is knowingly stale — a state the app can now enter and
 * say (`repo/stale`). This is the other half: rescan, and answer the question
 * the staleness raises. Not "the graph moved" but "you added a synchronous call
 * from checkout into payments", which is a sentence a reviewer can act on.
 *
 * IT IS AFFORDABLE, which is why it belongs in the loop rather than in a
 * nightly job: `graphCache`'s warm rescan measured 0.38s against 3.96s cold, so
 * the verdict costs about as much as a lint pass on the file that changed.
 *
 * IT COMPARES AT THE SERVICE LEVEL, using `projectToServiceLevel` — the same
 * projection `sequence diff` and `score` already use, and deliberately not a
 * second one. A file-level diff of a rescan is mostly noise: every import that
 * moved a line shows up, and the one edge that crossed a service boundary is
 * lost in it. The reader is being told whether the SHAPE of the system changed.
 *
 * A VERDICT WITH NOTHING IN IT IS A REAL ANSWER, and the most common one: most
 * edits do not change the architecture, and saying so plainly is what makes the
 * times it DOES change worth reading.
 */

import type { ArchGraph } from '@sequence/schema';

import { projectToServiceLevel } from '../score.js';

export interface RescanVerdict {
  /** Service-level edges the change introduced, as `src -> dst [family]`. */
  added: string[];
  /** Service-level edges the change removed. */
  removed: string[];
  /** Services, datastores and topics that appeared. */
  addedNodes: string[];
  /** …and that went. */
  removedNodes: string[];
  /** True when nothing about the system's shape moved. */
  unchanged: boolean;
  /** One sentence, in the harness's own voice. */
  summary: string;
}

const SYSTEM_KINDS = new Set(['service', 'datastore', 'topic']);

function systemLabels(g: ArchGraph): Set<string> {
  const out = new Set<string>();
  for (const n of g.nodes) if (SYSTEM_KINDS.has(n.kind)) out.add(`${n.kind} ${n.label}`);
  return out;
}

function list(items: string[], max = 5): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

export function rescanVerdict(before: ArchGraph, after: ArchGraph): RescanVerdict {
  const beforeEdges = projectToServiceLevel(before);
  const afterEdges = projectToServiceLevel(after);

  const added = [...afterEdges].filter((e) => !beforeEdges.has(e)).sort();
  const removed = [...beforeEdges].filter((e) => !afterEdges.has(e)).sort();

  const beforeNodes = systemLabels(before);
  const afterNodes = systemLabels(after);
  const addedNodes = [...afterNodes].filter((n) => !beforeNodes.has(n)).sort();
  const removedNodes = [...beforeNodes].filter((n) => !afterNodes.has(n)).sort();

  const unchanged =
    added.length === 0 && removed.length === 0 && addedNodes.length === 0 && removedNodes.length === 0;

  const parts: string[] = [];
  if (addedNodes.length > 0) parts.push(`added ${list(addedNodes)}`);
  if (removedNodes.length > 0) parts.push(`removed ${list(removedNodes)}`);
  if (added.length > 0) parts.push(`new connections: ${list(added)}`);
  if (removed.length > 0) parts.push(`connections gone: ${list(removed)}`);

  const summary = unchanged
    ? /* The common case, said plainly. A verdict that hedged here would make the
         times something DID change indistinguishable from the times it did not. */
      'The architecture is unchanged: no service-level connection was added or removed by this change.'
    : `The architecture changed — ${parts.join('; ')}.`;

  return { added, removed, addedNodes, removedNodes, unchanged, summary };
}
