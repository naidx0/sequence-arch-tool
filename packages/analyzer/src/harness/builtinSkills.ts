/**
 * Built-in skills: skills the app always has, with no file in the person's repo.
 *
 * They live in `packages/analyzer/builtin-skills/<slug>/SKILL.md` (shipped with the app, found the
 * same way as the bundled components catalog). Frontmatter here is the plain `name` + `description`
 * the outside skill ecosystem uses, NOT the distilled-skill shape of skillLoader.ts (which demands
 * `evidenceRunIds`): a built-in was not distilled from a run. A repo skill with the same slug wins.
 *
 * Built-ins are listed (Settings, the `/` palette) and run when named (`/be-ambitious`, a workflow
 * node, the composer action). They are NOT added to every ask prompt and their description words
 * never trigger a body match: a built-in must not hijack questions that merely say "task".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const BUILTIN_SKILLS_DIR = 'builtin-skills';
const SKILL_FILE = 'SKILL.md';
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface BuiltinSkill {
  slug: string;
  name: string;
  description: string;
  body: string;
}

export interface LoadedBuiltinSkills {
  skills: BuiltinSkill[];
  warnings: string[];
}

/** Where the built-in skills are: `SEQUENCE_BUILTIN_SKILLS_ROOT`, else the nearest `builtin-skills` above this file. */
export function builtinSkillsRoot(env: NodeJS.ProcessEnv = process.env, from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  const named = env.SEQUENCE_BUILTIN_SKILLS_ROOT?.trim();
  if (named) return path.resolve(named);
  let dir = from;
  for (let i = 0; i < 8; i++) {
    for (const rel of [BUILTIN_SKILLS_DIR, path.join('analyzer', BUILTIN_SKILLS_DIR), path.join('packages', 'analyzer', BUILTIN_SKILLS_DIR)]) {
      const cand = path.join(dir, rel);
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) return cand;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Parse `name` and `description` from a SKILL.md, or a named error. */
export function parseBuiltinSkill(raw: string): { name: string; description: string; body: string } | { error: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { error: 'no YAML frontmatter fence' };
  let fm: unknown;
  try {
    fm = parse(m[1]);
  } catch (e) {
    return { error: `frontmatter not parseable YAML (${(e as Error).message})` };
  }
  if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) return { error: 'frontmatter is not a mapping' };
  const { name, description } = fm as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') return { error: 'name must be a non-empty string' };
  if (typeof description !== 'string' || description.trim() === '') return { error: 'description must be a non-empty string' };
  return { name: name.trim(), description: description.replace(/\s+/g, ' ').trim(), body: m[2] };
}

/** Every built-in skill, sorted by slug. A missing root is none; a bad file is a warning by slug. */
export function loadBuiltinSkills(root: string | null = builtinSkillsRoot()): LoadedBuiltinSkills {
  if (!root) return { skills: [], warnings: [] };
  let slugs: string[];
  try {
    slugs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return { skills: [], warnings: [] };
  }
  const skills: BuiltinSkill[] = [];
  const warnings: string[] = [];
  for (const slug of slugs) {
    if (!SLUG.test(slug)) {
      warnings.push(`${slug}: not a valid skill slug`);
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(root, slug, SKILL_FILE), 'utf8');
    } catch (e) {
      warnings.push(`${slug}: not readable (${(e as Error).message})`);
      continue;
    }
    const parsed = parseBuiltinSkill(raw);
    if ('error' in parsed) {
      warnings.push(`${slug}: ${parsed.error}`);
      continue;
    }
    skills.push({ slug, ...parsed });
  }
  return { skills, warnings };
}

/** One built-in by slug, or undefined. */
export function getBuiltinSkill(slug: string, root: string | null = builtinSkillsRoot()): BuiltinSkill | undefined {
  return loadBuiltinSkills(root).skills.find((s) => s.slug === slug);
}
