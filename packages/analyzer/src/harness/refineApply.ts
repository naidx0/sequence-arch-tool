/**
 * Accept / Dismiss / Undo for refine proposals, in one place.
 *
 * The raw store calls (applyRefineProposal, denyRefineProposal,
 * rollbackRefineProposal) change files. These wrappers add what the loop needs
 * around them: an accepted note gets its outcome baseline written (so the
 * tracker can later say whether it helped), and an Undo of a note keeps its
 * outcome file as the record of what happened. The verify gate for a SKILL.md
 * target stays in the route; it needs the server's gate wiring.
 */

import {
  applyRefineProposal,
  denyRefineProposal,
  readRefineProposal,
  rollbackRefineProposal,
  type ApplyResult,
} from './refineProposal.js';
import { beginOutcome } from './refineOutcome.js';

export function acceptProposal(root: string, id: string, by: 'person' | 'auto' = 'person'): ApplyResult {
  const r = applyRefineProposal(root, id);
  if (r.ok && r.proposal) beginOutcome(root, r.proposal, by);
  return r;
}

export function dismissProposal(root: string, id: string): ApplyResult {
  return denyRefineProposal(root, id);
}

export function undoProposal(root: string, id: string): ApplyResult {
  const p = readRefineProposal(root, id);
  if (p && p.status !== 'accepted') return { ok: false, error: 'proposal not accepted' };
  return rollbackRefineProposal(root, id);
}
