/**
 * Components: bundled skills that are NOT in the agent's context by default.
 *
 * A component is a directory `<root>/<id>/` (id = `<group>/<name>`, optionally deeper for a
 * sub-component) holding `component.json` and, unless it is link-only, a `SKILL.md`. Two layers
 * share the layout: the catalog shipped with the app (`bundledCatalogRoot()`) and the person's
 * own at `<repo>/.sequence/components/`. A user component with the same id replaces the bundled one.
 *
 * Parsing is defensive, like skillLoader.ts: a malformed component is skipped BY ID with a
 * warning, never thrown, so one bad file cannot take the catalog down.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEQUENCE_DIR } from '../server/store.js';

export type ComponentStatus = 'ready' | 'review' | 'link-only';

export interface ComponentGroup {
  id: string;
  label: string;
  summary: string;
}

export interface ComponentEntry {
  id: string;
  group: string;
  label: string;
  summary: string;
  triggers: string[];
  status: ComponentStatus;
  parent?: string;
  license?: string;
  source?: { repo?: string; commit?: string; path?: string };
  url?: string;
  /** A file beside SKILL.md (say SEQUENCE.md) whose text goes in front of the body whenever it is injected; never truncated. */
  preamble?: string;
  /** Which layer it came from. */
  layer: 'bundled' | 'user';
  /** Absolute directory (server-side only; never sent to the web). */
  dir: string;
}

export interface Catalog {
  groups: ComponentGroup[];
  components: ComponentEntry[];
  /** One line per component that did not load, naming its id and what was wrong. */
  warnings: string[];
}

export const COMPONENT_FILE = 'component.json';
export const COMPONENT_SKILL_FILE = 'SKILL.md';
/** The user layer, under the repo's store: `<repo>/.sequence/components/`. */
export const USER_COMPONENTS_DIR = 'components';
const MAX_DEPTH = 3;
/** Bounds on a component's triggers, so a hostile or careless file cannot make matching slow. */
export const MAX_TRIGGERS = 8;
export const MAX_TRIGGER_WORDS = 8;
export const MAX_TRIGGER_CHARS = 64;
const ID_RE = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)+$/;

export function userCatalogRoot(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, USER_COMPONENTS_DIR);
}

/**
 * Where the catalog shipped with the app lives. `SEQUENCE_COMPONENTS_ROOT` names it; otherwise
 * the nearest `components/groups.json` above this file (analyzer/components in the workspace,
 * the analyzer's own folder when packaged). Falls back to the workspace path even when absent,
 * and `loadCatalog` then answers an empty catalog.
 */
export function bundledCatalogRoot(env: NodeJS.ProcessEnv = process.env, from: string = path.dirname(fileURLToPath(import.meta.url))): string {
  const named = env.SEQUENCE_COMPONENTS_ROOT?.trim();
  if (named) return path.resolve(named);
  let dir = from;
  for (let i = 0; i < 8; i++) {
    for (const rel of ['components', path.join('analyzer', 'components'), path.join('packages', 'analyzer', 'components')]) {
      const cand = path.join(dir, rel);
      if (fs.existsSync(path.join(cand, 'groups.json'))) return cand;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(from, '..', '..', 'components');
}

const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function walk(root: string, rel: string, depth: number, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  if (rel && entries.some((e) => e.isFile() && e.name === COMPONENT_FILE)) out.push(rel);
  if (depth >= MAX_DEPTH) return;
  for (const e of entries.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) walk(root, rel ? `${rel}/${e.name}` : e.name, depth + 1, out);
}

function readOne(root: string, rel: string, layer: 'bundled' | 'user'): { entry: ComponentEntry } | { error: string } {
  const dir = path.join(root, ...rel.split('/'));
  let raw: unknown;
  try {
    if (!insideDir(dir, path.join(dir, COMPONENT_FILE))) throw new Error('missing or points outside its folder');
    raw = JSON.parse(fs.readFileSync(path.join(dir, COMPONENT_FILE), 'utf8'));
  } catch (e) {
    return { error: `component.json not readable (${(e as Error).message})` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'component.json is not an object' };
  const o = raw as Record<string, unknown>;
  if (o.id !== rel) return { error: `id ${JSON.stringify(o.id)} does not match its folder ${rel}` };
  if (!ID_RE.test(rel)) return { error: 'id must be <group>/<name> in lowercase letters, digits, - and _' };
  if (!str(o.label)) return { error: 'label is missing' };
  if (!str(o.summary)) return { error: 'summary is missing' };
  if (!Array.isArray(o.triggers) || !o.triggers.every(str)) return { error: 'triggers must be a list of phrases' };
  if (o.triggers.length > MAX_TRIGGERS) return { error: `at most ${MAX_TRIGGERS} triggers (has ${o.triggers.length})` };
  const longTrigger = (o.triggers as string[]).find((t) => t.trim().length > MAX_TRIGGER_CHARS || t.trim().split(/\s+/).length > MAX_TRIGGER_WORDS);
  if (longTrigger) return { error: `trigger ${JSON.stringify(longTrigger.slice(0, 40))} is over ${MAX_TRIGGER_WORDS} words or ${MAX_TRIGGER_CHARS} characters` };
  if (o.status !== 'ready' && o.status !== 'review' && o.status !== 'link-only') return { error: `status ${JSON.stringify(o.status)} is not ready, review or link-only` };
  if (o.status === 'link-only' && !str(o.url)) return { error: 'link-only needs a url' };
  if (o.status !== 'link-only' && !insideDir(dir, path.join(dir, COMPONENT_SKILL_FILE))) return { error: 'SKILL.md is missing or points outside its folder' };
  if (o.parent !== undefined && !str(o.parent)) return { error: 'parent must be an id' };
  if (o.preamble !== undefined) {
    if (!str(o.preamble) || /[\\/]/.test(o.preamble) || o.preamble.startsWith('.')) return { error: 'preamble must be a file name beside SKILL.md' };
    if (!insideDir(dir, path.join(dir, o.preamble))) return { error: `preamble ${o.preamble} is missing or points outside its folder, so the component is not loaded without its safety text` };
  }
  const group = rel.split('/')[0]!;
  const src = o.source && typeof o.source === 'object' && !Array.isArray(o.source) ? (o.source as Record<string, unknown>) : null;
  return {
    entry: {
      id: rel,
      group: str(o.group) ? o.group : group,
      label: o.label.trim(),
      summary: o.summary.trim(),
      triggers: (o.triggers as string[]).map((t) => t.trim()),
      status: o.status,
      ...(str(o.parent) ? { parent: o.parent } : {}),
      ...(str(o.license) ? { license: o.license } : {}),
      ...(src ? { source: { ...(str(src.repo) ? { repo: src.repo } : {}), ...(str(src.commit) ? { commit: src.commit } : {}), ...(str(src.path) ? { path: src.path } : {}) } } : {}),
      ...(str(o.url) ? { url: o.url } : {}),
      ...(str(o.preamble) ? { preamble: o.preamble } : {}),
      layer,
      dir,
    },
  };
}

function readGroups(root: string, warnings: string[]): ComponentGroup[] {
  const p = path.join(root, 'groups.json');
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    /* The shipped file is {"groups": [...]}; a bare list is accepted too. */
    const raw = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { groups?: unknown }).groups : undefined;
    if (!Array.isArray(raw)) throw new Error('expected {"groups": [...]} or a list');
    return raw.flatMap((g): ComponentGroup[] => {
      const o = g as Record<string, unknown>;
      return o && str(o.id) && str(o.label) ? [{ id: o.id, label: o.label, summary: str(o.summary) ? o.summary : '' }] : [];
    });
  } catch (e) {
    warnings.push(`groups.json: ${(e as Error).message}`);
    return [];
  }
}

/** Read one layer. A missing root is an empty catalog; nothing here throws. */
export function loadCatalog(root: string, layer: 'bundled' | 'user' = 'bundled'): Catalog {
  const warnings: string[] = [];
  const components: ComponentEntry[] = [];
  let groups: ComponentGroup[] = [];
  try {
    if (!fs.existsSync(root)) return { groups, components, warnings };
    if (layer === 'user' && fs.lstatSync(root).isSymbolicLink()) return { groups, components, warnings: ['the user layer folder is a symlink, so it is not read'] };
    groups = readGroups(root, warnings);
    const rels: string[] = [];
    walk(root, '', 0, rels);
    for (const rel of rels) {
      const r = readOne(root, rel, layer);
      if ('error' in r) warnings.push(`${rel}: ${r.error}`);
      else components.push(r.entry);
    }
  } catch (e) {
    warnings.push(`catalog: ${(e as Error).message}`);
  }
  return { groups, components, warnings };
}

/** The bundled catalog with the repo's own layer on top (same id: the repo's wins). */
export function loadMergedCatalog(repoRoot: string | null, bundledRoot: string = bundledCatalogRoot()): Catalog {
  const bundled = loadCatalog(bundledRoot, 'bundled');
  const user = repoRoot ? loadCatalog(userCatalogRoot(repoRoot), 'user') : { groups: [], components: [], warnings: [] };
  const byId = new Map<string, ComponentEntry>();
  for (const c of [...bundled.components, ...user.components]) byId.set(c.id, c);
  const components = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const groups = [...bundled.groups];
  for (const g of user.groups) if (!groups.some((x) => x.id === g.id)) groups.push(g);
  for (const c of components) if (!groups.some((g) => g.id === c.group)) groups.push({ id: c.group, label: c.group, summary: '' });
  return { groups, components, warnings: [...bundled.warnings, ...user.warnings.map((w) => `user layer, ${w}`)] };
}

/**
 * Is `file` a real file that resolves (symlinks followed) to somewhere inside `dir`? A component
 * from the user layer may be anything a repo contains, so a symlink must not read past its folder.
 */
export function insideDir(dir: string, file: string): boolean {
  try {
    const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(file));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** A file inside the component's own folder (a relative path), or null when it is outside, missing or not a file. */
export function readComponentFile(entry: ComponentEntry, rel: string): string | null {
  if (!rel || path.isAbsolute(rel)) return null;
  const file = path.resolve(entry.dir, rel);
  if (!insideDir(entry.dir, file)) return null;
  try {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

/** The SKILL.md body (front matter removed), or null for a link-only, unreadable or out-of-folder component. */
export function readComponentBody(entry: ComponentEntry): string | null {
  if (entry.status === 'link-only') return null;
  const raw = readComponentFile(entry, COMPONENT_SKILL_FILE);
  if (raw === null) return null;
  const m = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(raw);
  return (m ? m[1]! : raw).trim();
}

/** The preamble text, or null when the component has none (or it cannot be read inside its folder). */
export function readComponentPreamble(entry: ComponentEntry): string | null {
  if (!entry.preamble) return null;
  return readComponentFile(entry, entry.preamble)?.trim() || null;
}

/** Ids named as another component's parent: those components have sub-components. */
export function parentIds(c: Pick<Catalog, 'components'>): Set<string> {
  return new Set(c.components.flatMap((x) => (x.parent ? [x.parent] : [])));
}
