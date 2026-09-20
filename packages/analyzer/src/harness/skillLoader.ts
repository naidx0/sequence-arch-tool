/**
 * Skill loader — Phase 3 progressive disclosure (Hermes pattern).
 *
 * The progressive-disclosure seam: a LIGHTWEIGHT summary of every skill under
 * `.sequence/skills/` is always injected into the ask prompt (name + one-line
 * description), and the FULL markdown body of a skill is injected ONLY when the
 * user's question matches that skill (name token or a description keyword).
 * This keeps the prompt short by default and only spends body tokens where
 * they are likely to apply.
 *
 * Parsing is defensive: a malformed `SKILL.md` (no frontmatter, bad YAML, or a
 * frontmatter that fails `validateHarnessSkill`) is SKIPPED BY SLUG — never
 * thrown, never silently dropped without a trace (the caller can ask for the
 * warnings). Same posture as `readPolicies`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { SEQUENCE_DIR } from '../server/store.js';
import { SKILLS_DIR, SKILL_FILE } from './skillDistill.js';
import {
  validateHarnessSkill,
  type HarnessSkill,
  type HarnessSkillFrontmatter,
} from '@sequence/schema';

/** A lightweight summary, always loaded for every skill on disk. */
export interface SkillSummary {
  slug: string;
  name: string;
  description: string;
}

export interface LoadedSkills {
  summaries: SkillSummary[];
  /** One line per skill file that did NOT parse, naming the slug + what was wrong. */
  warnings: string[];
}

/** Cap the body injected into the prompt, so a huge skill can't blow the budget. */
export const MAX_SKILL_BODY_CHARS = 2000;

/**
 * Read every `.sequence/skills/<slug>/SKILL.md` and return its lightweight
 * summary. A missing/unreadable skills directory yields an empty list (never
 * throws). Deterministic: slugs are read in sorted order.
 */
export function loadSkillSummaries(repoRoot: string): LoadedSkills {
  const dir = path.join(repoRoot, SEQUENCE_DIR, SKILLS_DIR);
  let slugs: string[];
  try {
    slugs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return { summaries: [], warnings: [] };
  }
  const summaries: SkillSummary[] = [];
  const warnings: string[] = [];
  for (const slug of slugs) {
    const parsed = readSkillFile(path.join(dir, slug, SKILL_FILE));
    if ('error' in parsed) {
      warnings.push(`${slug}: ${parsed.error}`);
      continue;
    }
    summaries.push({ slug, name: parsed.frontmatter.name, description: parsed.frontmatter.description });
  }
  return { summaries, warnings };
}

/** Parse a `SKILL.md` into frontmatter + body, or return a named error. */
function readSkillFile(filePath: string): { error: string } | HarnessSkill {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { error: `not readable (${(e as Error).message})` };
  }
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { error: 'no YAML frontmatter fence' };
  let fm: unknown;
  try {
    fm = parse(m[1]);
  } catch (e) {
    return { error: `frontmatter not parseable YAML (${(e as Error).message})` };
  }
  const errors = validateHarnessSkill(fm);
  if (errors.length > 0) return { error: errors.join('; ') };
  return { frontmatter: fm as HarnessSkillFrontmatter, body: m[2] };
}

/**
 * Render the always-loaded summary block for the ask prompt. One bullet per
 * skill. Returns an empty array when there are no skills (so the prompt is
 * byte-identical to the pre-skill seam when none exist).
 */
export function renderSkillSummaryLines(summaries: readonly SkillSummary[]): string[] {
  if (summaries.length === 0) return [];
  const lines = ['--- REPO SKILLS (progressive disclosure: summaries always loaded; full body on match) ---'];
  for (const s of summaries) {
    lines.push(`- ${s.name}: ${s.description}`);
  }
  return lines;
}

/**
 * Render the full body of a single matched skill as a prompt block, capped to
 * {@link MAX_SKILL_BODY_CHARS}. Returns an empty array when `body` is empty.
 */
export function renderSkillBodyLines(name: string, body: string): string[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) return [];
  const capped =
    trimmed.length > MAX_SKILL_BODY_CHARS ? `${trimmed.slice(0, MAX_SKILL_BODY_CHARS)}…` : trimmed;
  return [`--- MATCHED SKILL: ${name} (full body) ---`, capped];
}

/**
 * Find the first skill whose name token or a description keyword appears in
 * `question`, and return its full markdown body (capped). Matching is
 * case-insensitive and word-boundary on the name; description keywords are the
 * description's own words ≥ 4 chars. Returns undefined when no skill matches.
 */
export function matchSkillBody(repoRoot: string, question: string): { name: string; body: string } | undefined {
  const q = question.toLowerCase();
  const dir = path.join(repoRoot, SEQUENCE_DIR, SKILLS_DIR);
  let slugs: string[];
  try {
    slugs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return undefined;
  }
  for (const slug of slugs) {
    const parsed = readSkillFile(path.join(dir, slug, SKILL_FILE));
    if ('error' in parsed) continue;
    const fm = parsed.frontmatter;
    if (matchesSkill(question, q, fm)) {
      return { name: fm.name, body: parsed.body };
    }
  }
  return undefined;
}

/** True when the question names the skill or one of its description keywords. */
function matchesSkill(question: string, qLower: string, fm: HarnessSkillFrontmatter): boolean {
  const nameLower = fm.name.toLowerCase();
  if (nameLower.length > 0) {
    const nameRe = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, 'i');
    if (nameRe.test(question)) return true;
  }
  const descWords = fm.description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w: string) => w.length >= 4);
  for (const w of descWords) {
    if (qLower.includes(w)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
