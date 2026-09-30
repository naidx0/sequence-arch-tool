/**
 * Skill distill — Phase 3 (Hermes pattern), thin seam.
 *
 * After N successful completions of a similar ask pattern on this repo, distill
 * a `SKILL.md` into `.sequence/skills/<slug>/SKILL.md` with YAML frontmatter
 * (the always-loaded summary) + a markdown body (loaded only on a matching
 * ask). Repo-scoped, inspectable, reversible (delete the directory).
 *
 * NO LLM REQUIRED. This is a template distill: it clusters successful ask
 * trajectories by their first intent id (the only per-ask signal the
 * trajectory doc carries today), and for each cluster of size ≥ `minCount`
 * it writes a skill whose body lists the evidence run ids and the real file
 * paths the asks in the cluster touched (taken verbatim from `askTrace`
 * `file:read` events — never invented).
 *
 * GROUNDING, binding (same law as topology proposals):
 *  - only `kind === 'ask'` trajectories with `askTerminal.type === 'result'`
 *    are eligible (a failed ask is not evidence).
 *  - when `knownServiceIds` is supplied and a cluster's optional
 *    `groundedServiceIds` names a service not in that set, the distill REFUSES
 *    that skill (a skill referencing a service the scan did not find is a
 *    guess, not a distill).
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { SEQUENCE_DIR } from '../server/store.js';
import {
  TRAJECTORY_DIR,
  isTrajectoryDoc,
  type TrajectoryDoc,
} from '../server/trajectoryStore.js';
import { validateHarnessSkill, type HarnessSkillFrontmatter } from '@sequence/schema';

/** The skills sub-directory of `.sequence/`. */
export const SKILLS_DIR = 'skills';
/** The filename inside each skill directory. */
export const SKILL_FILE = 'SKILL.md';

/** A cluster of successful ask trajectories sharing a key (first intent id). */
export interface SkillCluster {
  /** Cluster key — the first intent id seen across the cluster's traces. */
  key: string;
  /** The successful ask trajectories in the cluster. */
  docs: TrajectoryDoc[];
  /** Run ids (one per doc) — the evidence the skill cites. */
  runIds: string[];
  /** Distinct file paths read across the cluster's askTrace `file:read` events. */
  filePaths: string[];
}

export interface ClusterOptions {
  /** Minimum cluster size to be eligible for distill. Default 3. */
  minCount?: number;
}

export interface DistillOptions extends ClusterOptions {
  /**
   * Optional set of known service ids (from the scanned graph). When supplied,
   * a cluster's `groundedServiceIds` (if any are inferred) must all be members
   * or the distill refuses that skill. When omitted, no service grounding is
   * claimed and nothing is refused on those grounds.
   */
  knownServiceIds?: ReadonlySet<string>;
  /**
   * Optional LLM body summariser. When absent or when it returns undefined, the
   * template body is used (no-key / graceful fallback).
   */
  summarizeBody?: (input: {
    cluster: SkillCluster;
    name: string;
    description: string;
  }) => Promise<string | undefined>;
}

/** A written skill: its directory slug + the frontmatter that was persisted. */
export interface DistilledSkill {
  slug: string;
  frontmatter: HarnessSkillFrontmatter;
  /** Absolute path to the written `SKILL.md`. */
  filePath: string;
}

/**
 * List every trajectory doc under `.sequence/trajectory/`. Returns only docs
 * that pass {@link isTrajectoryDoc}; a missing/unreadable directory yields an
 * empty list (never throws). Deterministic: files are read in sorted filename
 * order.
 */
export function listTrajectories(repoRoot: string): TrajectoryDoc[] {
  const dir = path.join(repoRoot, SEQUENCE_DIR, TRAJECTORY_DIR);
  let names: string[];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const out: TrajectoryDoc[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (isTrajectoryDoc(parsed)) out.push(parsed as TrajectoryDoc);
    } catch {
      /* unreadable / unparseable — skip, never throw */
    }
  }
  return out;
}

/** The first intent id from a trajectory's askTrace, or undefined. */
export function firstIntentId(doc: TrajectoryDoc): string | undefined {
  for (const ev of doc.askTrace) {
    if (ev.type === 'intent:start' && typeof ev.id === 'string' && ev.id.length > 0) {
      return ev.id;
    }
  }
  return undefined;
}

/**
 * Normalise a question into a short stem for clustering (lowercase, alnum words,
 * first six tokens). Returns empty when nothing remains.
 */
export function questionStem(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return words.slice(0, 6).join(' ');
}

/** Cluster key: question stem when present, else first intent id. */
export function clusterKeyForDoc(doc: TrajectoryDoc): string | undefined {
  if (typeof doc.question === 'string' && doc.question.trim().length > 0) {
    const stem = questionStem(doc.question);
    if (stem.length > 0) return `q:${stem}`;
  }
  const intent = firstIntentId(doc);
  return intent !== undefined ? `intent:${intent}` : undefined;
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

/**
 * Cluster successful ask trajectories by question stem (when `question` is
 * present on the doc) or by first intent id. Only `kind === 'ask'` docs with
 * `askTerminal.type === 'result'` are eligible.
 */
export function clusterSuccessfulAsks(
  docs: readonly TrajectoryDoc[],
  opts: ClusterOptions = {},
): SkillCluster[] {
  const minCount = opts.minCount ?? 3;
  const buckets = new Map<string, TrajectoryDoc[]>();
  for (const doc of docs) {
    if (doc.kind !== 'ask') continue;
    if (!doc.askTerminal || doc.askTerminal.type !== 'result') continue;
    const key = clusterKeyForDoc(doc);
    if (key === undefined) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(doc);
    else buckets.set(key, [doc]);
  }
  const clusters: SkillCluster[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length < minCount) continue;
    const runIds = bucket.map((d) => d.runId);
    const filePathSet = new Set<string>();
    const filePaths: string[] = [];
    for (const d of bucket) {
      for (const p of filePathsFromTrace(d)) {
        if (!filePathSet.has(p)) {
          filePathSet.add(p);
          filePaths.push(p);
        }
      }
    }
    clusters.push({ key, docs: bucket, runIds, filePaths });
  }
  return clusters;
}

/** Human-readable label from a cluster key (`q:…` or `intent:…`). */
export function clusterDisplayName(key: string): string {
  if (key.startsWith('q:')) {
    const stem = key.slice(2);
    return stem.length > 0 ? stem.charAt(0).toUpperCase() + stem.slice(1) : 'Ask pattern';
  }
  if (key.startsWith('intent:')) {
    const intent = key.slice('intent:'.length);
    return intent.length > 0 ? intent.charAt(0).toUpperCase() + intent.slice(1) : 'Skill';
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Slugify a cluster key into a filesystem-safe skill directory name. */
export function skillSlug(key: string): string {
  const raw = key.startsWith('q:') ? key.slice(2) : key.startsWith('intent:') ? key.slice(7) : key;
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'skill';
}

/** Render a skill file: YAML frontmatter fence + markdown body. */
export function renderSkillFile(fm: HarnessSkillFrontmatter, body: string): string {
  const front: string[] = ['---'];
  front.push(`version: ${fm.version}`);
  front.push(`name: ${yamlScalar(fm.name)}`);
  front.push(`description: ${yamlScalar(fm.description)}`);
  front.push(`evidenceRunIds:`);
  for (const id of fm.evidenceRunIds) front.push(`  - ${yamlScalar(id)}`);
  if (fm.groundedServiceIds && fm.groundedServiceIds.length > 0) {
    front.push(`groundedServiceIds:`);
    for (const id of fm.groundedServiceIds) front.push(`  - ${yamlScalar(id)}`);
  }
  front.push('---');
  return `${front.join('\n')}\n\n${body.trim()}\n`;
}

/** Quote a YAML scalar only when it contains a character that would break flow. */
function yamlScalar(s: string): string {
  if (s.length === 0) return '""';
  const needsQuote = /[:#\n]/.test(s) || /^[-?]/.test(s);
  return needsQuote ? JSON.stringify(s) : s;
}

/**
 * Distill skills from the trajectories under `repoRoot`. For each eligible
 * cluster (≥ `minCount` successful asks sharing a first intent id), writes
 * `.sequence/skills/<slug>/SKILL.md` with a validated frontmatter and a body
 * summarizing the evidence run ids + the real file paths the cluster touched.
 *
 * REFUSES a skill when `knownServiceIds` is supplied and the cluster's
 * inferred `groundedServiceIds` names a service not in that set — same law as a
 * topology proposal citing a missing node. (Today no service ids are inferred
 * from the trajectory, so `groundedServiceIds` is left absent and the refusal
 * is a forward-compatible guard for when distill grows to claim services.)
 *
 * Returns the list of skills actually written. Never throws: a write failure
 * is reported per-skill via the returned `errors` (the skill is simply skipped).
 */
export async function distillSkillsFromTrajectories(
  repoRoot: string,
  opts: DistillOptions = {},
): Promise<{ written: DistilledSkill[]; errors: string[] }> {
  const docs = listTrajectories(repoRoot);
  const clusters = clusterSuccessfulAsks(docs, opts);
  const errors: string[] = [];
  const written: DistilledSkill[] = [];
  const known = opts.knownServiceIds;

  for (const cluster of clusters) {
    const slug = skillSlug(cluster.key);
    const name = clusterDisplayName(cluster.key);
    const description = `Distilled from ${cluster.runIds.length} successful asks about "${name}".`;
    const frontmatter: HarnessSkillFrontmatter = {
      version: 1,
      name,
      description,
      evidenceRunIds: cluster.runIds,
    };
    // Forward-compatible grounding guard: when a future round infers services,
    // they must all be in the scan or the skill is refused.
    const grounded = frontmatter.groundedServiceIds;
    if (grounded && grounded.length > 0 && known) {
      const missing = grounded.filter((id: string) => !known.has(id));
      if (missing.length > 0) {
        errors.push(
          `skill "${slug}" refused: groundedServiceIds not in scan: ${missing.join(', ')}`,
        );
        continue;
      }
    }
    const fmErrors = validateHarnessSkill(frontmatter);
    if (fmErrors.length > 0) {
      errors.push(`skill "${slug}" invalid frontmatter: ${fmErrors.join('; ')}`);
      continue;
    }
    const body =
      (opts.summarizeBody
        ? await opts.summarizeBody({ cluster, name, description })
        : undefined) ?? renderSkillBody(cluster, name);
    let filePath: string;
    try {
      filePath = writeDistilledSkill(repoRoot, slug, frontmatter, body);
    } catch (e) {
      errors.push(`skill "${slug}" write failed: ${(e as Error).message}`);
      continue;
    }
    written.push({ slug, frontmatter, filePath });
  }
  return { written, errors };
}

/**
 * The single, visible skill-WRITE hook. Both `distillSkillsFromTrajectories`
 * (Phase 3) and a refine accept that targets a SKILL.md route their write
 * through here, so there is ONE skill-write path under `.sequence/skills/`
 * (not a second system). Creates the skill directory and writes the rendered
 * frontmatter + body. Returns the absolute path to the written `SKILL.md`.
 * Throws on a write failure (the caller reports it as a per-skill error).
 */
export function writeDistilledSkill(
  repoRoot: string,
  slug: string,
  frontmatter: HarnessSkillFrontmatter,
  body: string,
): string {
  const skillDir = path.join(repoRoot, SEQUENCE_DIR, SKILLS_DIR, slug);
  const filePath = path.join(skillDir, SKILL_FILE);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(filePath, renderSkillFile(frontmatter, body));
  return filePath;
}

/**
 * The single, visible skill-READ hook (the read side of the shared path).
 * Reads one `.sequence/skills/<slug>/SKILL.md` and returns its parsed
 * frontmatter + body, or undefined when the skill is absent / unreadable /
 * unparseable / fails frontmatter validation (never throws — mirrors the
 * loader's defensive posture so a missing skill degrades to "no skill").
 */
export function readDistilledSkill(
  repoRoot: string,
  slug: string,
): { frontmatter: HarnessSkillFrontmatter; body: string } | undefined {
  const filePath = path.join(repoRoot, SEQUENCE_DIR, SKILLS_DIR, slug, SKILL_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return undefined;
  let fm: unknown;
  try {
    fm = parseYaml(m[1]);
  } catch {
    return undefined;
  }
  if (validateHarnessSkill(fm).length > 0) return undefined;
  return { frontmatter: fm as HarnessSkillFrontmatter, body: m[2] };
}

/** Render the markdown body: evidence run ids + the real file paths seen. */
function renderSkillBody(cluster: SkillCluster, displayName: string): string {
  const L: string[] = [];
  L.push(`# ${displayName}`);
  L.push('');
  L.push(
    `Distilled from ${cluster.runIds.length} successful ask run${cluster.runIds.length === 1 ? '' : 's'} ` +
      `on this repo that shared the "${displayName}" pattern.`,
  );
  L.push('');
  L.push('## Evidence run ids');
  for (const id of cluster.runIds) L.push(`- ${id}`);
  if (cluster.filePaths.length > 0) {
    L.push('');
    L.push('## Files touched across these runs');
    for (const p of cluster.filePaths) L.push(`- ${p}`);
  }
  L.push('');
  L.push(
    '_This skill was template-distilled from trajectory evidence (no LLM). ' +
      'Edit or delete this file under `.sequence/skills/` to revise or remove it._',
  );
  return L.join('\n');
}
