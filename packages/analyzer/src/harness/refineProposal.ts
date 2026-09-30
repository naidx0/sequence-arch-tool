/**
 * Refine proposal persistence — Phase 4 (Prime pattern), thin seam.
 *
 * A refine proposal is the smallest evidence-backed edit to a supplemental
 * harness artifact (a `SKILL.md` pitfalls section, or a `.sequence/memory/NOTES.md`
 * tip) — NEVER the base system prompt, NEVER the model. It is created by
 * {@link planRefineFromTrajectories} (no LLM: it reads trajectory evidence), and
 * the board shows an Accept/Deny gate that reuses the topology-proposal visual
 * language. Accept writes `after` to `targetPath` and snapshots `before` under
 * `.sequence/refinements/<id>/`; Deny records the discard.
 *
 * HONESTY, binding (same posture as `harnessSkill.ts` / `policy.ts`):
 *  - `targetPath` MUST stay inside `.sequence/` (a refine edits supplemental
 *    state only — it can never rewrite a source file or escape the repo memory
 *    dir). `applyRefineProposal` refuses a path that resolves outside it.
 *  - `evidenceRefs` MUST be non-empty: a refine with no evidence is a guess.
 *  - Persistence is best-effort and never throws: a missing/unreadable
 *    refinements dir yields an empty list (same law as `readPolicies`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SEQUENCE_DIR } from '../server/store.js';

/** The refinements sub-directory of `.sequence/`. */
export const REFINEMENTS_DIR = 'refinements';

/** The proposal metadata file inside each refinement directory. */
export const PROPOSAL_FILE = 'proposal.json';

/** The before-snapshot file inside each refinement directory. */
export const BEFORE_FILE = 'before';

/** Evidence a refine cites — grounded to real trajectory run ids + file paths. */
export interface RefineEvidence {
  /** Trajectory run ids that triggered the refine. Non-empty. */
  runIds: string[];
  /** Distinct file paths the failed asks touched (verbatim from `file:read`). */
  filePaths: string[];
}

/**
 * A refine proposal. `targetPath` is RELATIVE to `repoRoot` and confined to
 * `.sequence/` (a supplemental edit only). `before` is the target's current
 * content (empty when the target does not yet exist); `after` is the proposed
 * full content to write on Accept.
 */
export interface RefineProposal {
  /** Stable id derived from trigger + targetPath (filesystem-safe). */
  id: string;
  /** Short machine-readable trigger, e.g. `repeated-failed-asks:impact`. */
  trigger: string;
  /** Grounded evidence the refine is backed by. Non-empty runIds. */
  evidenceRefs: RefineEvidence;
  /** Path relative to repoRoot, must resolve under `.sequence/`. */
  targetPath: string;
  /** Current content of the target (empty string when creating a new file). */
  before: string;
  /** Proposed full content to write on Accept. */
  after: string;
  status: 'pending' | 'accepted' | 'denied' | 'rolled_back';
}

/** A stable, filesystem-safe id for a proposal from its trigger + target. */
export function refineProposalId(trigger: string, targetPath: string): string {
  const raw = `${trigger}|${targetPath}`;
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
  const safe = trigger.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const stem = safe.length > 0 ? safe : 'refine';
  return `${stem}-${hash}`;
}

/** True when `p` is a structurally valid refine proposal (never throws). */
export function isRefineProposal(p: unknown): p is RefineProposal {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.trigger !== 'string' || v.trigger.length === 0) return false;
  if (typeof v.targetPath !== 'string' || v.targetPath.length === 0) return false;
  if (typeof v.before !== 'string') return false;
  if (typeof v.after !== 'string') return false;
  if (v.status !== 'pending' && v.status !== 'accepted' && v.status !== 'denied' && v.status !== 'rolled_back') return false;
  const ev = v.evidenceRefs;
  if (!ev || typeof ev !== 'object') return false;
  const e = ev as Record<string, unknown>;
  if (!Array.isArray(e.runIds) || e.runIds.length === 0) return false;
  if (!e.runIds.every((x) => typeof x === 'string')) return false;
  if (!Array.isArray(e.filePaths) || !e.filePaths.every((x) => typeof x === 'string')) return false;
  return true;
}

/** Resolve `targetPath` against `repoRoot` and confine it to `.sequence/`. */
export function resolveRefineTarget(repoRoot: string, targetPath: string): string | null {
  const seqRoot = path.resolve(repoRoot, SEQUENCE_DIR);
  const resolved = path.resolve(repoRoot, targetPath);
  const rel = path.relative(seqRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function refinementDir(repoRoot: string, id: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, REFINEMENTS_DIR, id);
}

function proposalFilePath(repoRoot: string, id: string): string {
  return path.join(refinementDir(repoRoot, id), PROPOSAL_FILE);
}

/**
 * Persist a proposal under `.sequence/refinements/<id>/proposal.json`. The
 * `before` content is also written as a sibling `before` file so an accepted
 * refine can be reverted by hand. Overwrites an existing proposal with the same
 * id (re-planning the same trigger is idempotent). Never throws: a write
 * failure is reported by the returned boolean.
 */
export function writeRefineProposal(repoRoot: string, proposal: RefineProposal): boolean {
  const dir = refinementDir(repoRoot, proposal.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, BEFORE_FILE), proposal.before);
    fs.writeFileSync(proposalFilePath(repoRoot, proposal.id), JSON.stringify(proposal, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Read a single proposal by id; undefined when absent or unparseable. */
export function readRefineProposal(repoRoot: string, id: string): RefineProposal | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(proposalFilePath(repoRoot, id), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isRefineProposal(parsed) ? (parsed as RefineProposal) : undefined;
}

/**
 * List every persisted proposal under `.sequence/refinements/`, sorted by id.
 * A missing/unreadable directory yields an empty list (never throws).
 */
export function listRefineProposals(repoRoot: string): RefineProposal[] {
  const dir = path.join(repoRoot, SEQUENCE_DIR, REFINEMENTS_DIR);
  let names: string[];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const out: RefineProposal[] = [];
  for (const name of names) {
    const p = readRefineProposal(repoRoot, name);
    if (p) out.push(p);
  }
  return out;
}

export interface ApplyResult {
  ok: boolean;
  proposal?: RefineProposal;
  error?: string;
}

/**
 * Accept a proposal: write `after` to `targetPath` (confined to `.sequence/`),
 * then mark the proposal `accepted`. The `before` snapshot already lives next
 * to the proposal file from {@link writeRefineProposal}. Returns `ok:false` with
 * an `error` when the target escapes `.sequence/`, the proposal is missing, or
 * the write fails — never throws.
 */
export function applyRefineProposal(repoRoot: string, id: string): ApplyResult {
  const proposal = readRefineProposal(repoRoot, id);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status === 'accepted') return { ok: false, error: 'proposal already accepted' };
  const target = resolveRefineTarget(repoRoot, proposal.targetPath);
  if (!target) return { ok: false, error: 'target escapes .sequence/' };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, proposal.after);
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` };
  }
  const next: RefineProposal = { ...proposal, status: 'accepted' };
  writeRefineProposal(repoRoot, next);
  return { ok: true, proposal: next };
}

/**
 * Deny a proposal: mark it `denied` and persist. The `before`/`after` stay on
 * disk so the discard is auditable. Returns `ok:false` when the proposal is
 * missing. Never throws.
 */
export function denyRefineProposal(repoRoot: string, id: string): ApplyResult {
  const proposal = readRefineProposal(repoRoot, id);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status === 'denied') return { ok: false, error: 'proposal already denied' };
  const next: RefineProposal = { ...proposal, status: 'denied' };
  writeRefineProposal(repoRoot, next);
  return { ok: true, proposal: next };
}

/**
 * Roll back an accepted refine: restore the target from the `before` snapshot
 * written at proposal time, then mark the proposal `rolled_back`. Returns
 * `ok:false` when the proposal is missing, not accepted, or the snapshot/target
 * write fails — never throws.
 */
export function rollbackRefineProposal(repoRoot: string, id: string): ApplyResult {
  const proposal = readRefineProposal(repoRoot, id);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status !== 'accepted') {
    return { ok: false, error: 'proposal not accepted' };
  }
  const target = resolveRefineTarget(repoRoot, proposal.targetPath);
  if (!target) return { ok: false, error: 'target escapes .sequence/' };
  const beforePath = path.join(refinementDir(repoRoot, id), BEFORE_FILE);
  let beforeContent: string;
  try {
    beforeContent = fs.readFileSync(beforePath, 'utf8');
  } catch {
    return { ok: false, error: 'before snapshot missing' };
  }
  try {
    if (beforeContent.length === 0) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, beforeContent);
    }
  } catch (e) {
    return { ok: false, error: `rollback write failed: ${(e as Error).message}` };
  }
  const next: RefineProposal = { ...proposal, status: 'rolled_back' };
  writeRefineProposal(repoRoot, next);
  return { ok: true, proposal: next };
}
