/**
 * First-run "import my skills": find skill and instruction files on THIS machine from what the
 * person typed, then (only for the ones they confirm) write them through the same writer
 * `POST /api/skills` uses.
 *
 *   POST /api/onboarding/skills/find   { text }                      -> candidates (read-only)
 *   POST /api/onboarding/skills/import { text, selected: string[] }  -> { imported, kept }
 *
 * Deterministic: no model reads the sentence. A segment is a path (`~`, `$HOME`, `%USERPROFILE%`,
 * a drive, a slash, a `.md` name) or words; known words map to known folders. Nothing is uploaded.
 * The boundary is the local-only gate (the same Origin/Host check as the other onboarding routes),
 * not this code: any local caller may type any local folder or .md file, as the person at the
 * keyboard could. `import` re-runs the same discovery and only takes paths it finds again.
 * Device paths (backslash-dot, backslash-question) and UNC shares are refused: a pipe blocks the
 * read and a share connects out over SMB. Only a few environment variables expand. The defaults
 * (no text) stay inside home and the project.
 */

import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

import { isOriginAllowed } from './terminal.js';
import { MAX_SKILL_FILES, MAX_SKILL_FILE_BYTES, MAX_SKILL_TOTAL_BYTES, planSkillImport, writeSkillImport } from './skillsImport.js';

export const MAX_CANDIDATES = 60;
/** The default look (no typed text) is bounded too, but wide enough for a person with many skills. */
export const MAX_DEFAULT_CANDIDATES = 500;
const MAX_VISITED = 3000;
const MAX_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const INSTRUCTION = /^(agents|claude)\.md$/i;
const MARKDOWN = /\.(md|mdc)$/i;

export interface SkillCandidate {
  /** Absolute path of the skill folder (it holds a SKILL.md) or of the single file. */
  path: string;
  /** `~/...` when under home, else the path with forward slashes. */
  shown: string;
  kind: 'skill' | 'instructions';
  /** True when `path` is a skill folder (SKILL.md and its files), false for one file. */
  folder: boolean;
  /** The folder name `.sequence/skills/<slug>` it will get. */
  slug: string;
  bytes: number;
}

export interface FindAnswer {
  /** `words` when something typed was not a path, `paths` when all were, `default` for no text. */
  mode: 'default' | 'paths' | 'words';
  /** Where it looked, as shown to the person. */
  looked: string[];
  /** Typed segments it could not turn into a place. */
  unknown: string[];
  candidates: SkillCandidate[];
  truncated: boolean;
  skipped: string[];
  /** One plain line per typed place that gave nothing, with the reason. */
  notes: string[];
}

export interface DiscoverEnv {
  home: string;
  /** The open project, or null before one is open. */
  root: string | null;
  env?: NodeJS.ProcessEnv;
}

function show(abs: string, home: string): string {
  const a = abs.replace(/\\/g, '/');
  const h = home.replace(/\\/g, '/').replace(/\/$/, '');
  if (a.toLowerCase() === h.toLowerCase()) return '~';
  return a.toLowerCase().startsWith(`${h.toLowerCase()}/`) ? `~${a.slice(h.length)}` : a;
}

const ALLOWED_VARS = new Set(['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']);

/** True for a device path or a network share (two leading slashes of either kind), which are never read. */
export function isDeviceOrShare(s: string): boolean {
  return /^[\\/]{2}/.test(s.trim().replace(/^["']/, ''));
}

/** `~`, `$HOME`, `${X}`, `%X%` expansion; null when a variable is unknown. HOME and USERPROFILE are the given home. */
export function expandTyped(raw: string, d: DiscoverEnv): string | null {
  const env = d.env ?? process.env;
  let bad = false;
  const val = (name: string): string => {
    const up = name.toUpperCase();
    if (up === 'HOME' || up === 'USERPROFILE') return d.home;
    /* Anything else could be read back by naming it (a token, a path): only these expand. */
    const v = ALLOWED_VARS.has(up) ? (env[name] ?? env[up]) : undefined;
    if (v === undefined || v === '') {
      bad = true;
      return '';
    }
    return v;
  };
  let s = raw.trim().replace(/^["']|["']$/g, '');
  s = s
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_m, n: string) => val(n))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a: string | undefined, b: string | undefined) => val((a ?? b) as string));
  if (bad || s === '' || isDeviceOrShare(s)) return null;
  if (s === '~') return path.resolve(d.home);
  if (/^~[\\/]/.test(s)) return path.resolve(d.home, s.slice(2));
  if (path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s)) return path.resolve(s);
  return path.resolve(d.root ?? d.home, s);
}

const looksLikePath = (s: string) => /^(~|\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/]|\$|%)/.test(s) || /[\\/]/.test(s) || MARKDOWN.test(s);

export function defaultPlaces(): string[] {
  return ['~/.claude/skills', '~/.codex/skills', 'AGENTS.md', 'CLAUDE.md'];
}

/** Known words -> places. Order is the order shown. */
function wordPlaces(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/\bclaude\b/.test(t)) out.push('~/.claude/skills', '~/.claude/CLAUDE.md');
  if (/\bcodex\b/.test(t)) out.push('~/.codex/skills', '~/.codex/AGENTS.md');
  if (/\bcursor\b/.test(t)) out.push('~/.cursor/rules');
  if (/\bagents?(\.md)?\b/.test(t)) out.push('AGENTS.md');
  if (/\b(all|everything|anything)\b/.test(t) || (out.length === 0 && /\bskills?\b/.test(t))) out.push(...defaultPlaces());
  return out;
}

interface Resolved {
  mode: FindAnswer['mode'];
  places: string[];
  unknown: string[];
}

export function resolveText(text: string): Resolved {
  const segs = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return { mode: 'default', places: defaultPlaces(), unknown: [] };
  const places: string[] = [];
  const unknown: string[] = [];
  let words = false;
  for (const seg of segs) {
    if (looksLikePath(seg.replace(/^["']|["']$/g, ''))) {
      places.push(seg);
      continue;
    }
    words = true;
    const mapped = wordPlaces(seg);
    if (mapped.length === 0) unknown.push(seg);
    else places.push(...mapped);
  }
  return { mode: words ? 'words' : 'paths', places: [...new Set(places)], unknown };
}

function lst(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function slugOf(name: string): string {
  const s = name
    .replace(MARKDOWN, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 56);
  return s === '' ? 'skill' : s;
}

interface Found {
  path: string;
  shown: string;
  kind: SkillCandidate['kind'];
  isDir: boolean;
  bytes: number;
}

/** Find candidates for the places. Read-only; symlinks are never followed. */
export function discover(text: string, d: DiscoverEnv): FindAnswer {
  const r = resolveText(text);
  const found = new Map<string, Found>();
  const looked: string[] = [];
  const unknown = [...r.unknown];
  const skipped: string[] = [];
  const notes: string[] = [];
  let visited = 0;
  let truncated = false;
  const cap = r.mode === 'default' ? MAX_DEFAULT_CANDIDATES : MAX_CANDIDATES;

  const add = (f: Found) => {
    const key = f.path.toLowerCase();
    if (found.has(key)) return;
    if (found.size >= cap) {
      truncated = true;
      return;
    }
    found.set(key, f);
  };
  const tooBig = (abs: string) => skipped.push(`${show(abs, d.home)} is larger than ${MAX_SKILL_FILE_BYTES / 1024} KB`);
  const addFile = (abs: string, kind: SkillCandidate['kind']) => {
    const st = lst(abs);
    if (!st || !st.isFile()) return;
    if (st.size > MAX_SKILL_FILE_BYTES) return tooBig(abs);
    add({ path: abs, shown: show(abs, d.home), kind, isDir: false, bytes: st.size });
  };
  /** True when `dir` is a skill folder (so it is not searched further). */
  const addSkillDir = (dir: string): boolean => {
    const st = lst(path.join(dir, 'SKILL.md'));
    if (!st || !st.isFile()) return false;
    if (st.size > MAX_SKILL_FILE_BYTES) tooBig(path.join(dir, 'SKILL.md'));
    else add({ path: dir, shown: show(dir, d.home), kind: 'skill', isDir: true, bytes: st.size });
    return true;
  };

  const walk = (dir: string, depth: number, mdAllowed: boolean) => {
    if (visited++ > MAX_VISITED || found.size >= cap) {
      truncated = true;
      return;
    }
    if (addSkillDir(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      visited++;
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isFile()) {
        if (INSTRUCTION.test(e.name)) addFile(full, 'instructions');
        else if (mdAllowed && MARKDOWN.test(e.name) && e.name.toLowerCase() !== 'skill.md') addFile(full, 'skill');
      } else if (e.isDirectory() && depth < MAX_DEPTH && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
        walk(full, depth + 1, mdAllowed);
      }
    }
  };

  for (const place of r.places) {
    const abs = expandTyped(place, d);
    if (!abs) {
      unknown.push(place);
      notes.push(
        isDeviceOrShare(place)
          ? `${place}: device and network paths are not read.`
          : `${place}: a variable in it is unknown or not allowed (only ~, HOME, USERPROFILE, APPDATA, LOCALAPPDATA, XDG_CONFIG_HOME).`,
      );
      continue;
    }
    const shown = show(abs, d.home);
    looked.push(shown);
    const before = found.size;
    const st = lst(abs);
    if (!st) {
      notes.push(`${shown}: not found.`);
      continue;
    }
    if (st.isSymbolicLink()) {
      notes.push(`${shown}: a link, not followed.`);
      continue;
    }
    if (st.isFile()) {
      if (MARKDOWN.test(abs)) addFile(abs, INSTRUCTION.test(path.basename(abs)) ? 'instructions' : 'skill');
      else notes.push(`${shown}: not a markdown file (.md or .mdc).`);
    } else if (st.isDirectory()) {
      const base = path.basename(abs).toLowerCase();
      walk(abs, 0, base === 'skills' || base === 'rules' || base === 'commands');
    }
    if (found.size === before && !notes.some((n) => n.startsWith(`${shown}:`)) && skipped.length === 0) notes.push(`${shown}: no skills or instruction files in it.`);
  }

  const used = new Set<string>();
  const candidates: SkillCandidate[] = [...found.values()].map((c) => {
    const name = path.basename(c.path);
    const parent = path.basename(path.dirname(c.path));
    const own = slugOf(name);
    const where = parent.replace(/^\.+/, '');
    /* An instruction file is named after its folder (agents-myproj); a dot folder that only repeats the name (~/.claude/CLAUDE.md) adds nothing. */
    const stem = !c.isDir && INSTRUCTION.test(name) && where !== '' && slugOf(where) !== own ? slugOf(`${own}-${where}`) : own;
    let slug = stem;
    for (let n = 2; used.has(slug); n++) slug = `${stem.slice(0, 54)}-${n}`;
    used.add(slug);
    return { path: c.path, shown: c.shown, kind: c.kind, folder: c.isDir, slug, bytes: c.bytes };
  });
  return { mode: r.mode, looked, unknown, candidates, truncated, skipped, notes };
}

/** Read one chosen candidate into `<slug>/...` files for planSkillImport. */
function filesFor(c: SkillCandidate): { path: string; content: string }[] | { error: string } {
  const read = (p: string): string | null => {
    const t = fs.readFileSync(p, 'utf8');
    return t.includes('\u0000') ? null : t;
  };
  try {
    if (c.folder) {
      const out: { path: string; content: string }[] = [];
      /* Stop reading at the writer's per-skill total: a folder of 40 large files is never read whole before it is refused. */
      let bytes = 0;
      const walkDir = (dir: string, rel: string[], depth: number) => {
        /* SKILL.md first, so a folder over the file cap still keeps the one file that makes it a skill. */
        const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name === 'SKILL.md' ? -1 : b.name === 'SKILL.md' ? 1 : a.name.localeCompare(b.name)));
        for (const e of entries) {
          if (e.isSymbolicLink() || out.length >= MAX_SKILL_FILES || bytes > MAX_SKILL_TOTAL_BYTES) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (depth < 3 && !SKIP_DIRS.has(e.name) && SEGMENT.test(e.name)) walkDir(full, [...rel, e.name], depth + 1);
          } else if (e.isFile() && SEGMENT.test(e.name)) {
            const size = fs.statSync(full).size;
            if (size > MAX_SKILL_FILE_BYTES) continue;
            bytes += size;
            if (bytes > MAX_SKILL_TOTAL_BYTES) return;
            const t = read(full);
            if (t !== null) out.push({ path: [c.slug, ...rel, e.name].join('/'), content: t });
          }
        }
      };
      walkDir(c.path, [], 0);
      /* Over the total it is refused whole, never imported cut short. */
      if (bytes > MAX_SKILL_TOTAL_BYTES) return { error: `${c.shown} is larger than ${MAX_SKILL_TOTAL_BYTES / 1024} KB in total` };
      return out;
    }
    const t = read(c.path);
    return t === null ? { error: `${c.shown} is not a text file` } : [{ path: `${c.slug}/SKILL.md`, content: t }];
  } catch (e) {
    return { error: `${c.shown}: ${(e as Error).message}` };
  }
}

/** One import request writes at most this much in total; the rest are named and wait for the next Import. */
export const MAX_IMPORT_REQUEST_FILES = 400;
export const MAX_IMPORT_REQUEST_BYTES = 4 * 1024 * 1024;

export type ImportAnswer =
  | { status: 200; body: { imported: string[]; kept: string[]; problems: string[] } }
  | { status: 400 | 409; body: { error: string; needsProject?: boolean } };

/**
 * What this server wrote into each project's .sequence/skills, by exact slug, so Edit can take back
 * only that. A skill the project already had is never recorded (it is "kept"), so it cannot be removed here.
 */
const wroteHere = new Map<string, Set<string>>();
const rootKey = (root: string) => path.resolve(root);

/** Import the `selected` paths that discovery finds again for `text`. */
export function importSelected(text: string, selected: unknown, d: DiscoverEnv): ImportAnswer {
  if (d.root === null) return { status: 409, body: { error: 'Open a project first: skills are saved inside it. You can import later from Settings, Skills.', needsProject: true } };
  if (!Array.isArray(selected) || selected.length === 0 || !selected.every((s) => typeof s === 'string')) {
    return { status: 400, body: { error: 'selected must be a non-empty list of paths' } };
  }
  const want = new Set((selected as string[]).map((s) => path.resolve(s).toLowerCase()));
  const found = discover(text, d).candidates.filter((c) => want.has(path.resolve(c.path).toLowerCase()));
  if (found.length === 0) return { status: 400, body: { error: 'none of those were found again; look again and pick from the list' } };
  const problems: string[] = [];
  /* One skill at a time into batches that fit the writer's caps; a skill that cannot be planned is named and the rest still go in. */
  const batches: { path: string; content: string }[][] = [];
  let cur: { path: string; content: string }[] = [];
  let curBytes = 0;
  let reqFiles = 0;
  let reqBytes = 0;
  for (const c of found) {
    if (reqFiles >= MAX_IMPORT_REQUEST_FILES || reqBytes >= MAX_IMPORT_REQUEST_BYTES) {
      problems.push(`${c.shown}: not imported this time (one import takes up to ${MAX_IMPORT_REQUEST_FILES} files or ${MAX_IMPORT_REQUEST_BYTES / 1024 / 1024} MB); press Import again for the rest`);
      continue;
    }
    const f = filesFor(c);
    if ('error' in f) {
      problems.push(f.error);
      continue;
    }
    const plan = planSkillImport(f);
    if (!plan.ok) {
      problems.push(`${c.shown}: ${plan.error}`);
      continue;
    }
    const bytes = f.reduce((n, x) => n + Buffer.byteLength(x.content, 'utf8'), 0);
    if (reqFiles + f.length > MAX_IMPORT_REQUEST_FILES || reqBytes + bytes > MAX_IMPORT_REQUEST_BYTES) {
      problems.push(`${c.shown}: not imported this time (one import takes up to ${MAX_IMPORT_REQUEST_FILES} files or ${MAX_IMPORT_REQUEST_BYTES / 1024 / 1024} MB); press Import again for the rest`);
      continue;
    }
    reqFiles += f.length;
    reqBytes += bytes;
    if (cur.length > 0 && (cur.length + f.length > MAX_SKILL_FILES || curBytes + bytes > MAX_SKILL_TOTAL_BYTES)) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(...f);
    curBytes += bytes;
  }
  if (cur.length > 0) batches.push(cur);
  if (batches.length === 0) return { status: 400, body: { error: problems[0] ?? 'nothing to import' } };
  const imported: string[] = [];
  const kept: string[] = [];
  for (const batch of batches) {
    let files = batch;
    for (let round = 0; round < 2 && files.length > 0; round++) {
      const plan = planSkillImport(files);
      if (!plan.ok) {
        problems.push(plan.error);
        break;
      }
      const done = writeSkillImport(d.root, plan, false);
      if ('refused' in done) {
        problems.push(done.refused);
        break;
      }
      if ('written' in done) {
        imported.push(...done.written);
        const rec = wroteHere.get(rootKey(d.root)) ?? new Set<string>();
        for (const w of done.written) rec.add(w);
        wroteHere.set(rootKey(d.root), rec);
        break;
      }
      /* Names already in the project are kept as they are; the rest still go in. */
      kept.push(...done.conflicts);
      files = files.filter((x) => !done.conflicts.includes(x.path.split('/')[0]!));
    }
  }
  if (imported.length === 0 && kept.length === 0) return { status: 400, body: { error: problems[0] ?? 'could not import' } };
  return { status: 200, body: { imported, kept, problems } };
}

export type RemoveAnswer = { status: 200; body: { removed: string[] } } | { status: 400 | 409; body: { error: string; needsProject?: boolean } };

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Take back skills this server just imported (by exact name, once each): each name is one real folder directly under `<root>/.sequence/skills`
 * that holds a SKILL.md. A name with a separator or dots, a link, a plain file or a folder with no SKILL.md is
 * left alone, and nothing outside `.sequence/skills` is ever touched.
 */
export function removeImported(names: unknown, d: DiscoverEnv): RemoveAnswer {
  if (d.root === null) return { status: 409, body: { error: 'Open a project first.', needsProject: true } };
  if (!Array.isArray(names) || names.length === 0 || names.length > 200 || !names.every((n) => typeof n === 'string')) {
    return { status: 400, body: { error: 'names must be a non-empty list of skill names' } };
  }
  const base = path.join(d.root, '.sequence', 'skills');
  try {
    if (fs.lstatSync(path.join(d.root, '.sequence')).isSymbolicLink() || fs.lstatSync(base).isSymbolicLink()) return { status: 400, body: { error: '.sequence/skills is a link; nothing was removed' } };
  } catch {
    return { status: 200, body: { removed: [] } };
  }
  const removed: string[] = [];
  const rec = wroteHere.get(rootKey(d.root));
  for (const n of names as string[]) {
    /* Exact match against what this server imported: a skill the person already had, or a case variant, stays. */
    if (!rec || !rec.has(n)) continue;
    if (!SKILL_NAME.test(n) || n === '.' || n === '..') continue;
    const dir = path.join(base, n);
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (!fs.lstatSync(path.join(dir, 'SKILL.md')).isFile()) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(n);
      rec.delete(n);
    } catch {
      /* Not there, or not ours to remove: left as it is. */
    }
  }
  return { status: 200, body: { removed } };
}

export interface SkillsRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  authOn: boolean;
  home: string;
  root: string | null;
  /** The repo owner check; sends its own 403 and returns true when refused. */
  denied: () => boolean;
  env?: NodeJS.ProcessEnv;
}

function send(res: http.ServerResponse, status: number, body: unknown): true {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}

/** Handle `/api/onboarding/skills/{find,import,remove}`. Returns false when the path is not ours. */
export async function handleSkillsDiscoverRoute(ctx: SkillsRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const which = url.pathname === '/api/onboarding/skills/find' ? 'find' : url.pathname === '/api/onboarding/skills/import' ? 'import' : url.pathname === '/api/onboarding/skills/remove' ? 'remove' : null;
  if (!which || method !== 'POST') return false;
  if (ctx.authOn) return send(res, 403, { error: 'skill discovery is local-only and is disabled in hosted (multi-user) mode.' });
  if (!isOriginAllowed(req)) return send(res, 403, { error: 'skill discovery is local-only: this request did not come from localhost.' });
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return send(res, 415, { error: 'expected content-type application/json' });
  let body: { text?: unknown; selected?: unknown; names?: unknown };
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new Error('body too large');
      chunks.push(c as Buffer);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as typeof body;
  } catch (e) {
    return send(res, 400, { error: `invalid JSON body: ${(e as Error).message}` });
  }
  const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : '';
  const d: DiscoverEnv = { home: ctx.home, root: ctx.root, ...(ctx.env ? { env: ctx.env } : {}) };
  if (which === 'find') return send(res, 200, discover(text, d));
  if (ctx.denied()) return true;
  if (which === 'remove') {
    const r = removeImported(body.names, d);
    return send(res, r.status, r.body);
  }
  const a = importSelected(text, body.selected, d);
  return send(res, a.status, a.body);
}
