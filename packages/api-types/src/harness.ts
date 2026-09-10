/**
 * Harness — skill distill and the refine Accept/Deny/Rollback loop.
 * The `/api/harness/*` routes in `server/repoServer.ts`.
 *
 * All of it is local-first: no LLM is required, no network, no key. A configured
 * provider only ENHANCES the proposal text; without one the deterministic
 * template path still runs.
 */

import type { HarnessSkillFrontmatter } from '@sequence/schema';

/* ------------------- POST /api/harness/distill-skills — :3213 ------------- */

export type PostDistillSkillsRequest = void;

/** One written `SKILL.md`, reported as the flat trio the route projects. */
export interface DistilledSkillSummary {
  slug: string;
  /** `frontmatter.name` — the route does NOT send the whole frontmatter back. */
  name: string;
  /** ABSOLUTE path to the written file, not repo-relative. */
  filePath: string;
}

/**
 * `errors` names every cluster that was eligible but could not be written (for
 * example a skill naming a service the scan did not find). Never thrown away.
 */
export interface PostDistillSkillsResponse {
  written: DistilledSkillSummary[];
  errors: string[];
}

/**
 * Re-exported so a client that wants the full frontmatter of a distilled skill —
 * read back off disk, not off this route — has the type to hand.
 */
export type { HarnessSkillFrontmatter };

/* --------------------- POST /api/harness/refine/plan — :3254 -------------- */

/** Grounded evidence a refine is backed by. `runIds` is non-empty. */
export interface RefineEvidence {
  /** Trajectory run ids that triggered the refine. */
  runIds: string[];
  /** Distinct file paths the failed asks touched (verbatim from `file:read`). */
  filePaths: string[];
}

/**
 * `RefineProposal` (`refineProposal.ts:49`). `targetPath` is repo-relative and
 * confined to `.sequence/` — a refine is a supplemental edit only, never a source
 * change. `before` is the target's current content (empty when creating it).
 */
export interface RefineProposal {
  id: string;
  /** Short machine-readable trigger, e.g. `repeated-failed-asks:impact`. */
  trigger: string;
  evidenceRefs: RefineEvidence;
  targetPath: string;
  before: string;
  /** The full content to write on Accept. Not a patch. */
  after: string;
  status: 'pending' | 'accepted' | 'denied' | 'rolled_back';
}

export type PostRefinePlanRequest = void;

/** `proposal: null` at 200 means "nothing worth proposing" — an answer, not a failure. */
export interface PostRefinePlanResponse {
  proposal: RefineProposal | null;
}

/* ---------------------- GET /api/harness/refine — :3285 ------------------- */

export type GetRefineRequest = void;

/** Newest-first (the store's order, reversed by the route). */
export interface GetRefineResponse {
  proposals: RefineProposal[];
}

/* -------- POST /api/harness/refine/:id/{accept,deny,rollback} — :3297 ----- */

export type PostRefineAcceptRequest = void;

export interface PostRefineAcceptResponse {
  proposal: RefineProposal;
}

export type VerifyStatus = 'passed' | 'failed' | 'skipped';

/** `VerifyResult` (`verifyGate.ts:58`). */
export interface VerifyResult {
  status: VerifyStatus;
  /** Human-readable reason for `skipped` or `failed`; absent for `passed`. */
  reason?: string;
  /** Validator error strings when a `schema-validate` gate failed. */
  errors?: string[];
  /** Exit code when a `command` gate failed. */
  exitCode?: number | null;
}

/**
 * **409** — the verify gate refused the accept and the edit did NOT land. This is
 * the only route on the whole surface whose failure body is not `{ error }`, so a
 * client must special-case it rather than reading `.error`.
 *
 * Two gates run for a `SKILL.md` target, in order: schema-validate on the proposed
 * frontmatter, then `pnpm --filter @sequence/schema test`. Either one failing
 * produces this shape.
 */
export interface PostRefineVerifyFailedResponse {
  verify: VerifyResult;
}

export type PostRefineDenyRequest = void;

export interface PostRefineDenyResponse {
  proposal: RefineProposal;
}

export type PostRefineRollbackRequest = void;

export interface PostRefineRollbackResponse {
  proposal: RefineProposal;
}
