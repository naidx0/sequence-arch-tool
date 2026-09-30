/**
 * Refine planner — Phase 4 (Prime pattern), thin seam. NO LLM.
 *
 * `planRefineFromTrajectories` reads the persisted ask trajectories and, when
 * it finds a repeated failure pattern, proposes the SMALLEST evidence-backed
 * edit to a supplemental harness artifact. Two triggers are recognised today,
 * both grounded to real trajectory evidence (never invented):
 *
 *  1. `repeated-failed-asks:<intent>` — ≥2 FAILED ask trajectories
 *     (`askTerminal.type === 'error'`) sharing a first intent id.
 *  2. `repeated-file-reads:<path>` — ≥2 FAILED ask trajectories that both read
 *     the same file path (a repeated `file:read` across failed runs).
 *
 * The smallest edit is one of:
 *  - APPEND a `## Pitfalls` section to an existing `SKILL.md` whose slug matches
 *    the intent key (so a skill the distill already wrote learns from failure).
 *  - Otherwise APPEND a one-line tip to `.sequence/memory/NOTES.md` (creating it
 *    if absent) — a repo-scoped, inspectable, reversible memory file.
 *
 * The proposal's `before` is the target's current content (empty when creating);
 * `after` is the proposed full content. The board's Accept/Deny gate decides
 * whether the edit lands — the planner NEVER writes the target itself.
 *
 * HONESTY: returns `null` when there is no repeated failure pattern, when the
 * evidence is empty, or when building the proposal would claim a path the
 * trajectory did not really touch. No fabricated topology.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SEQUENCE_DIR } from '../server/store.js';
import { listTrajectories } from './skillDistill.js';
import { SKILLS_DIR, SKILL_FILE, skillSlug } from './skillDistill.js';
import {
  refineProposalId,
  type RefineEvidence,
  type RefineProposal,
} from './refineProposal.js';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';

/** The memory sub-directory of `.sequence/` for free-form repo tips. */
export const MEMORY_DIR = 'memory';
/** The notes file a refine writes a tip to when no skill matches. */
export const NOTES_FILE = 'NOTES.md';

/** Minimum number of failed asks sharing a pattern to trigger a refine. */
export const MIN_FAILED_FOR_REFINE = 2;

export interface PlanRefineOptions {
  /** Override the minimum failed-ask count (default {@link MIN_FAILED_FOR_REFINE}). */
  minFailed?: number;
  /**
   * Optional LLM enhancer for the proposed `after` content. When absent or when
   * it returns undefined, the template pitfalls/tip is used (no-key graceful).
   */
  enhanceAfter?: (input: {
    trigger: string;
    evidence: RefineEvidence;
    before: string;
    templateAfter: string;
    isSkill: boolean;
    skillName?: string;
  }) => Promise<string | undefined>;
}

/**
 * Plan a refine proposal from the trajectories under `repoRoot`. Returns `null`
 * when no repeated failure pattern is found. Pure aside from optional
 * `enhanceAfter` (the caller persists the returned proposal via
 * {@link writeRefineProposal}).
 */
export async function planRefineFromTrajectories(
  repoRoot: string,
  opts: PlanRefineOptions = {},
): Promise<RefineProposal | null> {
  const minFailed = opts.minFailed ?? MIN_FAILED_FOR_REFINE;
  const docs = listTrajectories(repoRoot);
  const failed = docs.filter((d) => d.kind === 'ask' && d.askTerminal?.type === 'error');
  if (failed.length < minFailed) return null;

  const byIntent = groupFailedByIntent(failed);
  const byFile = groupFailedByFilePath(failed);

  // Prefer an intent-keyed trigger (it maps to a skill by slug); fall back to a
  // file-read trigger. Both are grounded to real evidence.
  let trigger: string | null = null;
  let evidence: RefineEvidence | null = null;
  let intentKey: string | null = null;

  for (const [key, group] of byIntent.entries()) {
    if (group.length >= minFailed) {
      trigger = `repeated-failed-asks:${key}`;
      evidence = evidenceFromGroup(group);
      intentKey = key;
      break;
    }
  }
  if (trigger === null) {
    for (const [filePath, group] of byFile.entries()) {
      if (group.length >= minFailed) {
        trigger = `repeated-file-reads:${filePath}`;
        evidence = evidenceFromGroup(group);
        break;
      }
    }
  }
  if (trigger === null || evidence === null || evidence.runIds.length === 0) return null;

  const target = chooseTarget(repoRoot, intentKey);
  if (!target) return null;

  const before = readTargetBefore(target.absolute);
  const templateAfter = renderTargetAfter(target, trigger, evidence!, before);
  const after =
    (opts.enhanceAfter
      ? await opts.enhanceAfter({
          trigger: trigger!,
          evidence: evidence!,
          before,
          templateAfter,
          isSkill: target.isSkill,
          skillName: target.skillName,
        })
      : undefined) ?? templateAfter;
  const id = refineProposalId(trigger!, target.relative);
  return {
    id,
    trigger: trigger!,
    evidenceRefs: evidence!,
    targetPath: target.relative,
    before,
    after,
    status: 'pending',
  };
}

/** Group failed ask trajectories by their first intent id (skipping keyless). */
function groupFailedByIntent(docs: readonly TrajectoryDoc[]): Map<string, TrajectoryDoc[]> {
  const out = new Map<string, TrajectoryDoc[]>();
  for (const d of docs) {
    const key = firstIntentId(d);
    if (key === undefined) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(d);
    else out.set(key, [d]);
  }
  return out;
}

/** Group failed ask trajectories by each `file:read` path they touched. */
function groupFailedByFilePath(docs: readonly TrajectoryDoc[]): Map<string, TrajectoryDoc[]> {
  const out = new Map<string, TrajectoryDoc[]>();
  for (const d of docs) {
    for (const p of filePathsFromTrace(d)) {
      const bucket = out.get(p);
      if (bucket) {
        if (!bucket.includes(d)) bucket.push(d);
      } else {
        out.set(p, [d]);
      }
    }
  }
  return out;
}

/** Build the evidence (run ids + distinct file paths) from a group of docs. */
function evidenceFromGroup(group: readonly TrajectoryDoc[]): RefineEvidence {
  const runIds = group.map((d) => d.runId);
  const filePaths: string[] = [];
  const seen = new Set<string>();
  for (const d of group) {
    for (const p of filePathsFromTrace(d)) {
      if (!seen.has(p)) {
        seen.add(p);
        filePaths.push(p);
      }
    }
  }
  return { runIds, filePaths };
}

interface TargetChoice {
  /**
   * Path relative to repoRoot, POSIX, always under `.sequence/`.
   *
   * Built with `path.posix.join`, not `path.join`: this string is DATA — it goes
   * into a proposal a client reads and a caller matches on `.sequence/` — so a
   * native separator would make the same proposal read differently on Windows.
   * The `absolute` sibling below is the one handed to `fs`, and stays native.
   */
  relative: string;
  /** Absolute path on disk. */
  absolute: string;
  /** True when the target is an existing SKILL.md (append a pitfalls section). */
  isSkill: boolean;
  /** The skill name when isSkill, for the pitfalls header. */
  skillName?: string;
}

/**
 * Choose the smallest edit target: an existing SKILL.md whose slug matches the
 * intent key (append pitfalls), else `.sequence/memory/NOTES.md` (append a tip).
 * Returns null only when the intent key is empty AND no file-read trigger fired
 * — in practice the caller has already established a trigger.
 */
function chooseTarget(repoRoot: string, intentKey: string | null): TargetChoice | null {
  if (intentKey !== null && intentKey.length > 0) {
    const slug = skillSlug(intentKey);
    const skillPath = path.join(repoRoot, SEQUENCE_DIR, SKILLS_DIR, slug, SKILL_FILE);
    if (fs.existsSync(skillPath)) {
      return {
        relative: path.posix.join(SEQUENCE_DIR, SKILLS_DIR, slug, SKILL_FILE),
        absolute: skillPath,
        isSkill: true,
        skillName: intentKey.charAt(0).toUpperCase() + intentKey.slice(1),
      };
    }
  }
  const notesAbs = path.join(repoRoot, SEQUENCE_DIR, MEMORY_DIR, NOTES_FILE);
  return {
    relative: path.posix.join(SEQUENCE_DIR, MEMORY_DIR, NOTES_FILE),
    absolute: notesAbs,
    isSkill: false,
  };
}

/** Read the target's current content (empty string when it does not exist). */
function readTargetBefore(absolute: string): string {
  try {
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Render the proposed `after` content: the existing content plus a pitfalls
 * section (skill) or a one-line tip (notes). Idempotent — if the section/tip
 * already names the trigger, it is not appended twice.
 */
function renderTargetAfter(
  target: TargetChoice,
  trigger: string,
  evidence: RefineEvidence,
  before: string,
): string {
  if (target.isSkill) {
    return appendPitfallsSection(before, target.skillName ?? 'Skill', trigger, evidence);
  }
  return appendNotesTip(before, trigger, evidence);
}

/** Append a `## Pitfalls` section to a SKILL.md body, idempotent on the trigger. */
function appendPitfallsSection(
  before: string,
  skillName: string,
  trigger: string,
  evidence: RefineEvidence,
): string {
  const header = '## Pitfalls';
  const triggerLine = `_Trigger: ${trigger}_`;
  if (before.includes(triggerLine)) return before; // already refined for this trigger
  const lines: string[] = [];
  lines.push('');
  lines.push(header);
  lines.push('');
  lines.push(`Observed failure pattern across ${evidence.runIds.length} failed ask run${evidence.runIds.length === 1 ? '' : 's'} on this repo.`);
  lines.push('');
  lines.push(triggerLine);
  lines.push('');
  lines.push('### Evidence run ids');
  for (const id of evidence.runIds) lines.push(`- ${id}`);
  if (evidence.filePaths.length > 0) {
    lines.push('');
    lines.push('### Files touched in the failed runs');
    for (const p of evidence.filePaths) lines.push(`- ${p}`);
  }
  lines.push('');
  const base = before.endsWith('\n') ? before : `${before}\n`;
  return `${base}${lines.join('\n')}`;
}

/** Append a one-line tip to NOTES.md, idempotent on the trigger. */
function appendNotesTip(before: string, trigger: string, evidence: RefineEvidence): string {
  const tip = `- [${trigger}] failed ask runs: ${evidence.runIds.join(', ')}${evidence.filePaths.length > 0 ? ` — files: ${evidence.filePaths.join(', ')}` : ''}`;
  if (before.includes(tip)) return before;
  if (before.length === 0) {
    return `# Repo memory\n\nTips distilled from failed harness runs (no LLM; reversible — delete this file to clear).\n\n${tip}\n`;
  }
  const base = before.endsWith('\n') ? before : `${before}\n`;
  return `${base}${tip}\n`;
}

/** The first intent id from a trajectory's askTrace, or undefined. */
function firstIntentId(doc: TrajectoryDoc): string | undefined {
  for (const ev of doc.askTrace) {
    if (ev.type === 'intent:start' && typeof ev.id === 'string' && ev.id.length > 0) {
      return ev.id;
    }
  }
  return undefined;
}

/** Distinct file paths from a trajectory's `file:read` events, in encounter order. */
function filePathsFromTrace(doc: TrajectoryDoc): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ev of doc.askTrace) {
    if (ev.type === 'file:read' && typeof ev.path === 'string' && ev.path.length > 0) {
      if (!seen.has(ev.path)) {
        seen.add(ev.path);
        out.push(ev.path);
      }
    }
  }
  return out;
}
