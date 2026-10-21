/* What an agent run looked at, for the coverage line (T4). Pure: one ACP tool_call(_update) in, repo-relative paths out. */
import path from 'node:path';

const MAX_PATHS = 400;

/** The Sequence MCP tools whose arguments name a service or a path (Claude: mcp__sequence__map; Codex: sequence.map). */
const SEQUENCE_READ_TOOL = /^(?:mcp__sequence__|sequence[.:])(?:map|find_files)$/;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** `path`, `file_path` and `paths` of an argument object. */
function pathArgs(a: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['file_path', 'path']) {
    const s = str(a[k]);
    if (s) out.push(s);
  }
  if (Array.isArray(a.paths)) for (const p of a.paths) if (str(p)) out.push(p as string);
  return out;
}

/**
 * Codex's own parse of a shell command (`commandActions` on a commandExecution item): a read names its file, a search or a
 * listing its folder. The command string itself is never parsed here: a shell line is not reliable enough to say what was read.
 */
function codexActionPaths(input: Record<string, unknown>): string[] {
  const actions = Array.isArray(input.commandActions) ? input.commandActions : [];
  const cwd = str(input.cwd);
  const base = cwd && path.isAbsolute(cwd) ? cwd : null;
  const out: string[] = [];
  for (const a of actions) {
    const o = obj(a);
    if (!o || (o.type !== 'read' && o.type !== 'search' && o.type !== 'listFiles')) continue;
    const p = str(o.path);
    if (!p) continue;
    out.push(base && !path.isAbsolute(p) ? path.join(base, p) : p);
  }
  return out;
}

/**
 * The repo-relative paths a read, search, or Sequence map/find_files call named, or a Codex shell command that Codex itself parsed
 * as a read, search or listing. Decided by the tool KIND, never by words in a title: an edit is not a read whatever it is called.
 * A path outside `root` is not the repo's; a call that names nothing returns [].
 */
export function readPathsOf(update: Record<string, unknown>, root: string | null): string[] {
  const kind = typeof update.kind === 'string' ? update.kind : '';
  const title = typeof update.title === 'string' ? update.title : '';
  const input = obj(update.rawInput);
  const raw: string[] = [];
  if (kind === 'read' || kind === 'search') {
    const locs = Array.isArray(update.locations) ? update.locations : [];
    for (const l of locs) if (str(obj(l)?.path)) raw.push(obj(l)!.path as string);
    if (input) raw.push(...pathArgs(input));
  }
  if ((kind === 'read' || kind === 'search' || kind === 'other') && SEQUENCE_READ_TOOL.test(title)) {
    const args = obj(input?.arguments) ?? input;
    const focus = args ? str(args.focus) : null;
    if (focus && focus.startsWith('svc:')) raw.push(focus);
    if (args) raw.push(...pathArgs(args));
  }
  if (kind === 'execute' && input?.type === 'commandExecution') raw.push(...codexActionPaths(input));
  const out: string[] = [];
  for (let r of raw) {
    if (r.startsWith('svc:')) {
      out.push(r);
      continue;
    }
    if (!root) continue;
    /* On POSIX a Windows-style path from an agent is not a name in this repo: a drive-letter path is outside it, and a
       backslash path is read as slash-separated, so `..\..\etc` still escapes and is dropped like `../../etc`. */
    if (path.sep === '/') {
      if (/^[A-Za-z]:[\\/]/.test(r)) continue;
      r = r.replace(/\\/g, '/');
    }
    const rel = path.relative(root, path.resolve(root, r));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

/** Add `more` to the run's set, in first-seen order, without duplicates, within a cap. */
export function addReadPaths(into: Set<string>, more: readonly string[]): void {
  for (const p of more) {
    if (into.size >= MAX_PATHS) return;
    into.add(p);
  }
}
