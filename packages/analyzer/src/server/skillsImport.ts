/**
 * Round 13 (N6): import skills into `.sequence/skills/<slug>/`.
 *
 * Pure validation plus one jailed write. The Files route cannot write under
 * `.sequence` (reserved), and skills are the one reserved place a person is
 * meant to add files to, so this is its own narrow door: only
 * `<slug>/<file>` paths below the skills directory, plain names, bounded
 * counts and sizes, and nothing is overwritten unless asked.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { canonicalRoot, realpathContained } from './jail.js';

export const MAX_SKILL_FILES = 40;
export const MAX_SKILL_FILE_BYTES = 256 * 1024;
export const MAX_SKILL_TOTAL_BYTES = 800 * 1024;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface SkillFileIn {
  path: string;
  content: string;
}

export type SkillImportPlan =
  | { ok: true; files: { rel: string; content: string }[]; slugs: string[] }
  | { ok: false; error: string };

/** Check the files a client sent. Every path is `<slug>/<more>`, every slug carries a SKILL.md. */
export function planSkillImport(input: unknown): SkillImportPlan {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'files must be a non-empty array' };
  if (input.length > MAX_SKILL_FILES) return { ok: false, error: `at most ${MAX_SKILL_FILES} files at once` };
  const files: { rel: string; content: string }[] = [];
  const slugs = new Set<string>();
  const withSkillMd = new Set<string>();
  let total = 0;
  for (const f of input as Partial<SkillFileIn>[]) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') return { ok: false, error: 'each file needs a string path and content' };
    const parts = f.path.replace(/\\/g, '/').split('/');
    if (parts.length < 2 || parts.length > 5 || !parts.every((p) => SEGMENT.test(p) && p !== '.' && p !== '..')) {
      return { ok: false, error: `not a skill file path: ${f.path.slice(0, 80)}` };
    }
    const bytes = Buffer.byteLength(f.content, 'utf8');
    if (bytes > MAX_SKILL_FILE_BYTES) return { ok: false, error: `${f.path} is larger than ${MAX_SKILL_FILE_BYTES / 1024} KB` };
    total += bytes;
    if (total > MAX_SKILL_TOTAL_BYTES) return { ok: false, error: 'too much at once' };
    if (parts.some((p) => RESERVED.test(p))) return { ok: false, error: `${f.path.slice(0, 80)} uses a name Windows reserves` };
    slugs.add(parts[0]!);
    if (parts.length === 2 && parts[1] === 'SKILL.md') withSkillMd.add(parts[0]!);
    files.push({ rel: parts.join('/'), content: f.content });
  }
  const seen = new Map<string, string>();
  for (const f of files) {
    const k = f.rel.toLowerCase();
    const other = seen.get(k);
    if (other && other !== f.rel) return { ok: false, error: `${other} and ${f.rel} differ only by capital letters` };
    seen.set(k, f.rel);
  }
  const lower = new Map<string, string>();
  for (const s of slugs) {
    const other = lower.get(s.toLowerCase());
    if (other) return { ok: false, error: `${other} and ${s} differ only by capital letters` };
    lower.set(s.toLowerCase(), s);
  }
  for (const s of slugs) if (!withSkillMd.has(s)) return { ok: false, error: `${s} has no SKILL.md` };
  return { ok: true, files, slugs: [...slugs] };
}

/** The loader needs evidence on every skill and has no marker for user-written ones, so imports carry this one. */
export const IMPORTED_EVIDENCE = 'imported';

function describe(body: string): string {
  const heading = /^#{1,6}\s+(.+?)\s*$/m.exec(body);
  if (heading) return heading[1]!.replace(/[`*_]/g, '').slice(0, 160);
  const first = body.split(/\n\s*\n/).map((b) => b.replace(/\s+/g, ' ').trim()).find((b) => b.length > 0) ?? '';
  const sentence = /^(.+?[.!?])(\s|$)/.exec(first)?.[1] ?? first;
  return sentence.slice(0, 160);
}

const q = (v: string) => JSON.stringify(v);

/**
 * Fill the front matter the loader needs (version, name, description, evidenceRunIds) so an
 * imported skill loads. Fields the file already has are never touched; a front matter that does
 * not parse is left exactly as written (the Skills pane then names it under "Not loaded").
 */
export function withSkillFrontMatter(slug: string, raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const title = slug.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (!m) {
    return ['---', 'version: 1', `name: ${q(title)}`, `description: ${q(describe(text) || title)}`, 'evidenceRunIds:', `  - ${IMPORTED_EVIDENCE}`, '---', '', text].join('\n');
  }
  let fm: unknown;
  try {
    fm = parse(m[1]!);
  } catch {
    return text;
  }
  const have = fm && typeof fm === 'object' && !Array.isArray(fm) ? (fm as Record<string, unknown>) : {};
  const add: string[] = [];
  if (have.version === undefined) add.push('version: 1');
  if (have.name === undefined) add.push(`name: ${q(title)}`);
  if (have.description === undefined) add.push(`description: ${q(describe(m[2]!) || title)}`);
  if (have.evidenceRunIds === undefined) add.push('evidenceRunIds:', `  - ${IMPORTED_EVIDENCE}`);
  if (add.length === 0) return text;
  return `---\n${m[1]}\n${add.join('\n')}\n---\n${m[2]}`;
}

function lstat(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** Walk `rel` below `from`: every part that exists must be a real directory (never a link); make the rest. */
function ensureRealDirs(from: string, rel: string[], make: boolean): string | null {
  let cur = from;
  for (const part of rel) {
    cur = path.join(cur, part);
    const st = lstat(cur);
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) return `${path.relative(from, cur) || part} is a link or not a folder`;
    } else if (make) {
      fs.mkdirSync(cur);
      const again = lstat(cur);
      if (!again || again.isSymbolicLink() || !again.isDirectory()) return `${part} could not be made safely`;
    }
  }
  return null;
}

/**
 * Write a plan under `<root>/.sequence/skills`. Returns the slugs that already exist when not overwriting,
 * or `refused` when anything on the way is a symlink or leads outside the workspace (nothing is written then).
 */
export function writeSkillImport(root: string, plan: Extract<SkillImportPlan, { ok: true }>, overwrite: boolean): { conflicts: string[] } | { written: string[] } | { refused: string } {
  const rootReal = canonicalRoot(root);
  const base = path.join(rootReal, '.sequence', 'skills');
  /* Preflight: no link on .sequence, skills, any slug folder, or any existing file. */
  const bad = ensureRealDirs(rootReal, ['.sequence', 'skills'], false);
  if (bad) return { refused: `.sequence/skills: ${bad}` };
  const baseReal = lstat(base) ? realpathContained(base) : base;
  if (baseReal !== base) return { refused: '.sequence/skills leads outside the workspace' };
  for (const f of plan.files) {
    const parts = f.rel.split('/');
    const why = ensureRealDirs(base, parts.slice(0, -1), false);
    if (why) return { refused: `${f.rel}: ${why}` };
    const st = lstat(path.join(base, f.rel));
    if (st && (st.isSymbolicLink() || !st.isFile())) return { refused: `${f.rel} is a link or not a file` };
  }
  const conflicts = plan.slugs.filter((s) => lstat(path.join(base, s)) !== null);
  if (conflicts.length > 0 && !overwrite) return { conflicts };
  ensureRealDirs(rootReal, ['.sequence', 'skills'], true);
  for (const f of plan.files) {
    const parts = f.rel.split('/');
    const why = ensureRealDirs(base, parts.slice(0, -1), true);
    if (why) return { refused: `${f.rel}: ${why}` };
    const abs = path.join(base, f.rel);
    if (!realpathContained(path.dirname(abs)).startsWith(base + path.sep)) return { refused: `${f.rel} leads outside the skills folder` };
    const st = lstat(abs);
    if (st && (st.isSymbolicLink() || !st.isFile())) return { refused: `${f.rel} is a link or not a file` };
    /* Temp file in the same folder, then rename: a hard link at the old name is replaced, never written through. */
    const tmp = path.join(path.dirname(abs), `.import-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      fs.writeFileSync(tmp, parts.length === 2 && parts[1] === 'SKILL.md' ? withSkillFrontMatter(parts[0]!, f.content) : f.content, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(tmp, abs);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return { written: plan.slugs };
}
