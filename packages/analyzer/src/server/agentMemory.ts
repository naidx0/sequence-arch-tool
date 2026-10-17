/**
 * ONE MEMORY FOR ALL YOUR AGENTS.
 *
 * Every coding agent reads its own user-level instruction file at start: Claude Code
 * ~/.claude/CLAUDE.md, Codex ~/.codex/AGENTS.md, Gemini CLI ~/.gemini/GEMINI.md, Qwen Code
 * ~/.qwen/QWEN.md, OpenCode ~/.config/opencode/AGENTS.md, Copilot CLI
 * ~/.copilot/copilot-instructions.md, Amp ~/.config/amp/AGENTS.md, and Auggie and Cline a folder of
 * rule files (~/.augment/rules, ~/.cline/rules), where Sequence keeps one file of its own. Paths are
 * from each agent's docs (docs/research/plug-and-play-harness.md, round four). A person who uses three of them keeps
 * three copies of "how I like to work", and they drift. Sequence keeps ONE copy
 * (`<user store>/memory/shared.md`) and shares it into each agent's own file, so every agent
 * reads it the way it already reads its own memory: no prompt injection per turn, nothing for
 * the agent to learn, and it works when the person runs the agent outside Sequence too.
 *
 * WHAT IT TOUCHES, AND HOW IT UNDOES ITSELF.
 *   - Only the block between {@link BLOCK_START} and {@link BLOCK_END}. Everything else in the
 *     file is the person's and is never changed; Remove takes the block out and leaves the rest
 *     byte for byte.
 *   - Only on a click (POST), only for the agents named, and only where that agent is already set
 *     up here (its folder exists): Sequence never creates ~/.qwen for someone who does not use Qwen.
 *   - The first time it changes a file that already existed, it keeps the original beside it
 *     (`<file>.sequence-backup`), once, never overwritten.
 *
 * Gather is the one-click start: it reads what the person already wrote in each agent's file
 * (outside Sequence's block) and proposes it as the shared memory, identical paragraphs once. It
 * proposes; it saves nothing.
 */

import fs from 'node:fs';
import path from 'node:path';

export const BLOCK_START = '<!-- sequence:shared-memory:start (written by Sequence; edit it in Sequence, Settings › Agents) -->';
/** Any start marker, whatever its wording: files written before the wording changed still parse. */
const START_RE = /<!-- sequence:shared-memory:start[^\n]*?-->/g;
export const BLOCK_END = '<!-- sequence:shared-memory:end -->';
export const SHARED_FILE = path.join('memory', 'shared.md');
export const MAX_SHARED_BYTES = 32 * 1024;
/** A target file larger than this is not touched (a log someone named CLAUDE.md, a mistake). */
export const MAX_TARGET_BYTES = 256 * 1024;

export interface MemoryTarget {
  id: string;
  agent: string;
  /** Path parts under the agent's home folder. */
  file: string[];
  /** The agent's own folder, under home, unless {@link homeEnv} names another. */
  dir: string[];
  /** An environment variable that moves the agent's folder (Codex: CODEX_HOME). */
  homeEnv?: string;
}

export const MEMORY_TARGETS: readonly MemoryTarget[] = [
  { id: 'claude', agent: 'Claude Code', dir: ['.claude'], file: ['CLAUDE.md'] },
  { id: 'codex', agent: 'Codex', dir: ['.codex'], file: ['AGENTS.md'], homeEnv: 'CODEX_HOME' },
  { id: 'gemini', agent: 'Gemini CLI', dir: ['.gemini'], file: ['GEMINI.md'] },
  { id: 'qwen', agent: 'Qwen Code', dir: ['.qwen'], file: ['QWEN.md'] },
  { id: 'opencode', agent: 'OpenCode', dir: ['.config', 'opencode'], file: ['AGENTS.md'] },
  { id: 'copilot', agent: 'Copilot CLI', dir: ['.copilot'], file: ['copilot-instructions.md'], homeEnv: 'COPILOT_HOME' },
  /* Agents that read a folder of rule files get one file of Sequence's own in it. */
  { id: 'auggie', agent: 'Auggie', dir: ['.augment'], file: ['rules', 'sequence-shared.md'] },
  { id: 'cline', agent: 'Cline', dir: ['.cline'], file: ['rules', 'sequence-shared.md'] },
  { id: 'amp', agent: 'Amp', dir: ['.config', 'amp'], file: ['AGENTS.md'] },
];

/** What each agent loads at most, where its docs say (Codex: project_doc_max_bytes, 32 KiB combined). */
export const LOAD_LIMIT_BYTES: Readonly<Record<string, number>> = { codex: 32 * 1024 };

export interface Where {
  home: string;
  env?: NodeJS.ProcessEnv;
}

function dirOf(t: MemoryTarget, w: Where): string {
  const moved = t.homeEnv ? (w.env ?? process.env)[t.homeEnv] : undefined;
  return moved && path.isAbsolute(moved) ? moved : path.join(w.home, ...t.dir);
}

export function targetPath(t: MemoryTarget, w: Where): string {
  return path.join(dirOf(t, w), ...t.file);
}

function shown(p: string, home: string): string {
  const rel = path.relative(home, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel.split(path.sep).join('/')}` : p.split(path.sep).join('/');
}

/* ── READING A TARGET, STRICTLY ──────────────────────────────────────────────
   Round-four review: a file that is not UTF-8 (PowerShell 5.1 writes UTF-16), a link, a folder, or a read
   that fails for any reason but "no such file" is NOT a file Sequence may rewrite. Each is refused with
   what it is, and nothing is written. Valid UTF-8 (a UTF-8 BOM kept) round-trips byte for byte. */

type Read =
  | { kind: 'missing' }
  | { kind: 'text'; text: string }
  | { kind: 'refused'; why: string };

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function readTarget(p: string): Read {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'refused', why: `it could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  if (st.isSymbolicLink()) return { kind: 'refused', why: 'it is a link to another file, which Sequence does not change' };
  if (!st.isFile()) return { kind: 'refused', why: 'it is not a file' };
  if (st.size > MAX_TARGET_BYTES) return { kind: 'refused', why: 'the file is too large to change safely' };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    return { kind: 'refused', why: `it could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return { kind: 'refused', why: 'it is saved as UTF-16; save it as UTF-8 first' };
  try {
    return { kind: 'text', text: utf8.decode(buf) };
  } catch {
    return { kind: 'refused', why: 'it is not UTF-8 text' };
  }
}

/** Gather and the row states read leniently: anything not readable as text is just skipped. */
function readText(p: string): string | null {
  const r = readTarget(p);
  return r.kind === 'text' ? r.text : null;
}

/** Write through a temporary file and a rename, so a crash never leaves the file half-written. */
function writeAtomic(p: string, text: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.sequence-tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

/* ── THE BLOCK ────────────────────────────────────────────────────────────── */

const count = (s: string, sub: string): number => s.split(sub).length - 1;

/** Where the one block is: null when there is none; an error when the markers do not pair (one START before one END). */
export function findBlock(text: string): { start: number; end: number } | null | { error: string } {
  const starts = [...text.matchAll(START_RE)];
  const s = starts.length;
  const e = count(text, BLOCK_END);
  if (s === 0 && e === 0) return null;
  const at = starts[0]?.index ?? -1;
  const to = text.indexOf(BLOCK_END);
  if (s !== 1 || e !== 1 || at < 0 || to < at) return { error: 'the file has an unmatched Sequence marker; fix or remove it by hand first' };
  /* The block runs to the end of the END line. */
  let end = to + BLOCK_END.length;
  if (text.startsWith('\r\n', end)) end += 2;
  else if (text.startsWith('\n', end)) end += 1;
  return { start: at, end };
}

const isErr = (x: unknown): x is { error: string } => typeof x === 'object' && x !== null && 'error' in x;

/** The file's line ending: CRLF when it has any, else LF. */
const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

export function blockText(shared: string, nl: string): string {
  const body = shared.replace(/\r\n|\r|\n/g, nl).replace(new RegExp(`(${nl})+$`), '');
  return `${BLOCK_START}${nl}${body}${nl}${BLOCK_END}${nl}`;
}

/** The separator put between the person's text and an appended block: exactly what Remove takes away again. */
export function separatorFor(text: string): string {
  const nl = eolOf(text);
  if (text === '') return '';
  if (text.endsWith(`${nl}${nl}`)) return '';
  return text.endsWith(nl) ? nl : `${nl}${nl}`;
}

/** The person's text with the block (and, when known, the separator Sequence added) taken out, and the block's body. */
export function splitBlock(text: string, sep?: string): { own: string; block: string | null } | { error: string } {
  const b = findBlock(text);
  if (b === null) return { own: text, block: null };
  if (isErr(b)) return b;
  const startLen = /^<!-- sequence:shared-memory:start[^\n]*?-->/.exec(text.slice(b.start))?.[0].length ?? BLOCK_START.length;
  const inner = text.slice(b.start + startLen, b.end);
  const body = inner.slice(0, inner.lastIndexOf(BLOCK_END)).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  let before = text.slice(0, b.start);
  /* The separator was added only to keep the block off the person's last line; text after the block means it is theirs now. */
  const after = text.slice(b.end);
  if (sep && after === '' && before.endsWith(sep)) before = before.slice(0, before.length - sep.length);
  return { own: before + text.slice(b.end), block: body };
}

/** The shared memory without any paragraph the person's own text (outside the block) already holds. */
export function sharedFor(own: string, shared: string): string {
  const mine = new Set(norm(own).split(/\n{2,}/).map((x) => x.trim()).filter((x) => x !== ''));
  return norm(shared)
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter((x) => x !== '' && !mine.has(x))
    .join('\n\n');
}

/** The file with the shared memory as its block: replaced in place, else appended after `separatorFor`. */
export function withBlock(text: string, shared: string): { text: string; sep: string } | { error: string } {
  const b = findBlock(text);
  if (isErr(b)) return b;
  const nl = eolOf(text);
  if (b) return { text: text.slice(0, b.start) + blockText(shared, nl) + text.slice(b.end), sep: '' };
  const sep = separatorFor(text);
  return { text: text + sep + blockText(shared, nl), sep };
}

/* ── WHAT SEQUENCE REMEMBERS ABOUT EACH FILE ───────────────────────────────
   `<store>/memory/shared-state.json`: per agent, the separator it added and whether it created the file,
   so Remove is an exact inverse (and deletes a file Sequence made), and a block that vanished (a tool that
   regenerates the file) is said as such. */

interface TargetRecord {
  sep: string;
  created: boolean;
}
type State = Record<string, TargetRecord>;
const STATE_FILE = path.join('memory', 'shared-state.json');

function readState(storeDir: string): State {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(storeDir, STATE_FILE), 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: State = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const r = v as Partial<TargetRecord> | null;
      if (r && typeof r.sep === 'string' && /^(\r?\n){0,2}$/.test(r.sep) && typeof r.created === 'boolean') out[k] = { sep: r.sep, created: r.created };
    }
    return out;
  } catch {
    return {};
  }
}

function writeState(storeDir: string, s: State): void {
  writeAtomic(path.join(storeDir, STATE_FILE), JSON.stringify(s, null, 2));
}

/* ── THE SHARED TEXT ──────────────────────────────────────────────────────── */

export function readShared(storeDir: string): string {
  try {
    return fs.readFileSync(path.join(storeDir, SHARED_FILE), 'utf8');
  } catch {
    return '';
  }
}

export function writeShared(storeDir: string, text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_SHARED_BYTES) throw new Error(`the shared memory is over ${MAX_SHARED_BYTES / 1024} KB`);
  /* A marker inside the text would make the block unfindable and Remove leave text behind. */
  if (text.includes('sequence:shared-memory:')) throw new Error("the text can't contain Sequence's own block markers");
  writeAtomic(path.join(storeDir, SHARED_FILE), text.replace(/\r\n/g, '\n'));
}

const norm = (s: string): string => s.replace(/\r\n/g, '\n').trim();

export interface TargetState {
  id: string;
  agent: string;
  /** `~/.claude/CLAUDE.md`. */
  path: string;
  /** The agent's folder exists here: it is set up on this machine, so sharing may create its file. */
  present: boolean;
  exists: boolean;
  bytes: number;
  /** Sequence's block is in the file. */
  shared: boolean;
  /** The block matches the current shared memory. */
  current: boolean;
  /** Sequence shared into this file and the block has since gone (something else rewrote the file). */
  lost?: true;
  /** Why Sequence will not change this file (UTF-16, a link, too large, unmatched markers). */
  refused?: string;
  /** The agent's own load limit, where documented. */
  limitBytes?: number;
}

export function targetStates(w: Where, shared: string, storeDir?: string): TargetState[] {
  const state = storeDir ? readState(storeDir) : {};
  return MEMORY_TARGETS.map((t) => {
    const p = targetPath(t, w);
    let present = false;
    try {
      present = fs.statSync(dirOf(t, w)).isDirectory();
    } catch {
      /* not set up here */
    }
    const r = readTarget(p);
    let bytes = 0;
    try {
      bytes = fs.lstatSync(p).size;
    } catch {
      /* none */
    }
    const split = r.kind === 'text' ? splitBlock(r.text) : null;
    const refused = r.kind === 'refused' ? r.why : split && isErr(split) ? split.error : undefined;
    const block = split && !isErr(split) ? split.block : null;
    const wanted = split && !isErr(split) ? sharedFor(split.own, shared) : shared;
    return {
      id: t.id,
      agent: t.agent,
      path: shown(p, w.home),
      present,
      exists: r.kind !== 'missing',
      bytes,
      shared: block !== null,
      current: block !== null && norm(block) === norm(wanted),
      ...(block === null && state[t.id] && !refused ? { lost: true as const } : {}),
      ...(refused ? { refused } : {}),
      ...(LOAD_LIMIT_BYTES[t.id] ? { limitBytes: LOAD_LIMIT_BYTES[t.id] } : {}),
    };
  });
}

/**
 * The one-click start: what the person already wrote in each agent's file (outside Sequence's
 * block), as one proposal of plain paragraphs, each once. Where they came from is in `sources`.
 */
export function gatherMemory(w: Where): { text: string; sources: string[] } {
  const seen = new Set<string>();
  const parts: string[] = [];
  const sources: string[] = [];
  for (const t of MEMORY_TARGETS) {
    const p = targetPath(t, w);
    const text = readText(p);
    if (text === null) continue;
    const split = splitBlock(text);
    if (isErr(split)) continue;
    const paras = norm(split.own)
      .split(/\n{2,}/)
      .map((x) => x.trim())
      .filter((x) => x !== '' && !x.includes('sequence:shared-memory:') && !seen.has(x));
    if (paras.length === 0) continue;
    paras.forEach((x) => seen.add(x));
    sources.push(shown(p, w.home));
    parts.push(paras.join('\n\n'));
  }
  return { text: parts.join('\n\n'), sources };
}

export interface SyncResult {
  id: string;
  ok: boolean;
  /** What happened, in words: "shared", "updated", "created", "removed", or why not. */
  note: string;
}

/** Share (or with `remove`, take back) the shared memory into each named agent's file. One agent's refusal never stops the rest. */
export function syncMemory(w: Where, ids: readonly string[], shared: string, opts: { remove?: boolean; storeDir?: string } = {}): SyncResult[] {
  const state = opts.storeDir ? readState(opts.storeDir) : {};
  const out: SyncResult[] = [];
  for (const id of ids) {
    try {
      out.push(syncOne(w, id, shared, state, opts.remove === true));
    } catch (e) {
      out.push({ id, ok: false, note: `could not write it (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` });
    }
  }
  if (opts.storeDir) writeState(opts.storeDir, state);
  return out;
}

function syncOne(w: Where, id: string, shared: string, state: State, remove: boolean): SyncResult {
  const t = MEMORY_TARGETS.find((x) => x.id === id);
  if (!t) return { id, ok: false, note: 'not an agent Sequence knows' };
  try {
    if (!fs.statSync(dirOf(t, w)).isDirectory()) throw new Error('not a folder');
  } catch {
    return { id, ok: false, note: `${t.agent} is not set up on this machine` };
  }
  const p = targetPath(t, w);
  const r = readTarget(p);
  if (r.kind === 'refused') return { id, ok: false, note: r.why };
  const before = r.kind === 'text' ? r.text : '';
  const rec = state[id];
  if (remove) {
    const split = splitBlock(before, rec?.sep);
    if (isErr(split)) return { id, ok: false, note: split.error };
    if (split.block === null) {
      delete state[id];
      return { id, ok: true, note: 'nothing to remove' };
    }
    if (rec?.created && split.own === '') fs.rmSync(p, { force: true });
    else writeAtomic(p, split.own);
    delete state[id];
    return { id, ok: true, note: 'removed' };
  }
  if (norm(shared) === '') return { id, ok: false, note: 'the shared memory is empty' };
  if (shared.includes('sequence:shared-memory:')) return { id, ok: false, note: "the text can't contain Sequence's own block markers" };
  const had = r.kind === 'text' && findBlock(before) !== null;
  /* A paragraph this file already holds outside the block is not written a second time. */
  const own = splitBlock(before, rec?.sep);
  const wanted = isErr(own) ? shared : sharedFor(own.own, shared);
  if (!isErr(own) && wanted === '') return { id, ok: true, note: 'this file already holds all of it' };
  const next = withBlock(before, wanted);
  if (isErr(next)) return { id, ok: false, note: next.error };
  if (r.kind === 'text' && !had) {
    /* The original bytes, once: never rewritten by a later share. */
    const backup = `${p}.sequence-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(p, backup);
  }
  writeAtomic(p, next.text);
  if (!had) state[id] = { sep: next.sep, created: r.kind === 'missing' };
  return { id, ok: true, note: had ? 'updated' : r.kind === 'missing' ? 'created' : 'shared' };
}
