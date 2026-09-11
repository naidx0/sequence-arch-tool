/**
 * Learning loop — the one CALLER of the refine planner. NO LLM.
 *
 * WHY THIS FILE EXISTS. `planRefineFromTrajectories` (refinePlanner.ts) reads the
 * persisted ask trajectories, finds a repeated failure pattern and proposes the
 * smallest evidence-backed edit; `writeRefineProposal` (refineProposal.ts)
 * persists it under `.sequence/refinements/<id>/` behind an accept / deny /
 * rollback gate. Both were built, tested and reachable from
 * `POST /api/harness/refine/plan` — and NOTHING requested that route: no web2
 * caller, no CLI verb, no CI job (audit G4, 2026-09). A learning loop with no
 * caller learns nothing. This module is the caller: the ask stream route runs
 * it after every ERROR terminal, and `sequence harness refine` runs it by hand.
 *
 * WHAT IT MUST NOT DO. It proposes; it never applies. The target (`SKILL.md` or
 * `.sequence/memory/NOTES.md`) is written only by `applyRefineProposal`, which
 * the route verify-gates. Nothing in here calls it.
 *
 * WHY IT DEDUPES BY RULING, NOT JUST BY BYTES. `refineProposalId` is stable for
 * trigger + target, and `writeRefineProposal` OVERWRITES a proposal with the
 * same id. On the by-hand route that is idempotent re-planning. On a loop that
 * fires after EVERY failed ask it would be something else: the owner denies a
 * proposal, the next failed ask re-plans the same trigger, and the denial is
 * silently overwritten back to `pending`. So an id the owner has already ruled
 * on (`accepted` / `denied` / `rolled_back`) is never rewritten here, and a
 * `pending` one is rewritten only when the planned content differs (more
 * evidence since last time) — a byte-identical re-plan is reported as
 * `unchanged` and touches nothing.
 *
 * NEVER THROWS. The server hook is fire-and-forget on the request path and the
 * CLI prints whatever comes back, so a failure is an `error` string on the
 * outcome, not an exception.
 */

import { planRefineFromTrajectories, type PlanRefineOptions } from './refinePlanner.js';
import {
  readRefineProposal,
  writeRefineProposal,
  type RefineProposal,
} from './refineProposal.js';

/**
 * What the loop did with what it found. One value per run so a caller (or a
 * log line) can say exactly which of the five things happened:
 *  - `no-pattern`     the planner found no repeated failure; nothing on disk.
 *  - `written`        a new or updated `pending` proposal is on disk.
 *  - `unchanged`      a byte-identical `pending` proposal was already on disk.
 *  - `already-ruled`  the owner accepted / denied / rolled back this id; left alone.
 *  - `write-failed`   the store could not persist (its boolean said so).
 *  - `error`          planning or reading the store threw; see `error`.
 */
export type LearningLoopDisposition =
  | 'no-pattern'
  | 'written'
  | 'unchanged'
  | 'already-ruled'
  | 'write-failed'
  | 'error';

export interface LearningLoopOutcome {
  /** The planned proposal, or null when there is no repeated failure pattern. */
  proposal: RefineProposal | null;
  /** The id the proposal is persisted under — present only when it IS on disk. */
  persistedId?: string;
  disposition: LearningLoopDisposition;
  /** The failure message when `disposition` is `error` or `write-failed`. */
  error?: string;
}

export type LearningLoopOptions = Pick<PlanRefineOptions, 'minFailed'>;

/**
 * Plan a refine from the trajectories under `repoRoot` and persist it as a
 * PENDING proposal, subject to the dedupe rules in the file header. Never
 * throws; never writes the proposal's target.
 */
export async function runLearningLoop(
  repoRoot: string,
  opts: LearningLoopOptions = {},
): Promise<LearningLoopOutcome> {
  let proposal: RefineProposal | null;
  try {
    proposal = await planRefineFromTrajectories(repoRoot, opts);
  } catch (e) {
    return { proposal: null, disposition: 'error', error: `plan failed: ${(e as Error).message}` };
  }
  if (!proposal) return { proposal: null, disposition: 'no-pattern' };

  let existing: RefineProposal | undefined;
  try {
    existing = readRefineProposal(repoRoot, proposal.id);
  } catch (e) {
    return { proposal, disposition: 'error', error: `store read failed: ${(e as Error).message}` };
  }
  if (existing) {
    // What is ON DISK is the answer for both: the ruled-on proposal carries the
    // owner's status (denied / accepted / rolled_back), and a reader shown the
    // fresh plan's `pending` next to "already ruled on" would have to guess
    // which one is true. The fresh plan was only ever a re-derivation of it.
    if (existing.status !== 'pending') {
      return { proposal: existing, persistedId: existing.id, disposition: 'already-ruled' };
    }
    if (sameProposal(existing, proposal)) {
      return { proposal: existing, persistedId: existing.id, disposition: 'unchanged' };
    }
  }

  const ok = writeRefineProposal(repoRoot, proposal);
  if (!ok) {
    return {
      proposal,
      disposition: 'write-failed',
      error: `could not persist proposal ${proposal.id} under .sequence/refinements/`,
    };
  }
  return { proposal, persistedId: proposal.id, disposition: 'written' };
}

/**
 * Field-by-field equality on everything the store persists. Deliberately not
 * `JSON.stringify` equality: that would also compare key ORDER, and a proposal
 * read back through `JSON.parse` is only guaranteed to carry the same fields,
 * not the same order the planner built them in.
 */
function sameProposal(a: RefineProposal, b: RefineProposal): boolean {
  return (
    a.id === b.id &&
    a.trigger === b.trigger &&
    a.targetPath === b.targetPath &&
    a.before === b.before &&
    a.after === b.after &&
    a.status === b.status &&
    sameStringList(a.evidenceRefs.runIds, b.evidenceRefs.runIds) &&
    sameStringList(a.evidenceRefs.filePaths, b.evidenceRefs.filePaths)
  );
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
