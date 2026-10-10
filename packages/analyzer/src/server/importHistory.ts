/* ══════════════════════════════════════════════════════════════════════════
   BRING A CLI CHAT INTO SEQUENCE (T3 gap G11, history import)
   packages/analyzer/src/server/importHistory.ts

   People arrive with weeks of work in the Claude Code and Codex CLIs. Both
   keep a transcript per session on disk:

     Claude Code   <claude home>/projects/<cwd slug>/<session id>.jsonl
                   one JSON record a line; `user` / `assistant` records carry
                   `message`, `cwd`, `sessionId`, `timestamp`; an `ai-title`
                   record names the chat.
     Codex         <codex home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl
                   `session_meta` (payload.id, payload.cwd), `turn_context`
                   (payload.model), `event_msg` user_message, and
                   `response_item` messages / function calls.

   (The record shapes follow T3 Code's AgentSessionScanner.ts, MIT, and the
   files the CLIs write today.)

   READ-ONLY, ALWAYS: this module only ever opens those files for reading. It
   never creates, edits or deletes anything under a CLI's home. Parsing is
   defensive: a line that is not JSON, a record of a shape it does not know, a
   file that vanishes mid-scan, are skipped, never thrown. The client names a
   session by its provider id; the file is found by listing the CLI's own
   folders, so no path from the client is ever opened.

   An import makes a Sequence chat of the repository: one saved agent turn per
   question (the answer's text, a row per tool call), and the chat's agent
   thread is set to the CLI's session id, so the next message rejoins the
   very session (session/load, codex thread/resume) when the agent can.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeAgentRunsBulk, type StoredAgentRun, type StoredAgentTool } from './agentChatStore.js';
import { createSession, ensureSessionsMigrated, readSessionIndex, sameRepoPath, summarizeSessionTitle, writeAgentThread } from './sessionsStore.js';
import { SESSIONS_INDEX_FILE, writeJson } from './store.js';

export type ImportSource = 'claude' | 'codex';

/** Where the CLIs keep their sessions. `home` is the user's profile (`%USERPROFILE%` on Windows). */
export interface ImportHomes {
  claudeDir: string;
  codexDir: string;
}

/** The CLIs' own folders: CLAUDE_CONFIG_DIR / CODEX_HOME when set, else `~/.claude` and `~/.codex`. */
export function cliHomes(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): ImportHomes {
  const claude = env.CLAUDE_CONFIG_DIR?.trim();
  const codex = env.CODEX_HOME?.trim();
  return { claudeDir: claude || path.join(home, '.claude'), codexDir: codex || path.join(home, '.codex') };
}

/** One session on disk, cheap to list. */
export interface ImportableSession {
  source: ImportSource;
  /** The CLI's own session id (the resume handle). */
  providerSessionId: string;
  title: string;
  firstPrompt: string;
  cwd: string;
  startedAt: string | null;
  /** The file's last write (ISO). */
  updatedAt: string;
  bytes: number;
  /** Already a Sequence chat of this repository. */
  imported: boolean;
  chatId?: string;
}

interface Found extends Omit<ImportableSession, 'imported' | 'chatId'> {
  file: string;
}

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
/** Newest sessions kept per CLI, and files looked at before stopping. */
const MAX_LISTED = 100;
const MAX_FILES = 600;
/** A transcript over this is not imported whole (it would not open in a chat). */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_TURNS = 400;
const MAX_TEXT = 60_000;

/* ── reading ────────────────────────────────────────────────────────────── */

async function readSlice(file: string, from: number, length: number): Promise<string> {
  let h: fsp.FileHandle | null = null;
  try {
    h = await fsp.open(file, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await h.read(buf, 0, length, from);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await h?.close().catch(() => undefined);
  }
}

function jsonLines(text: string, dropFirst = false, dropLast = false): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/);
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      /* A torn or foreign line. */
    }
  }
  return out;
}

/** Let the event loop run (timers, requests) before the next slice of work. */
export const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));
const SLICE_MS = 8;

/** The same records as `jsonLines`, read line by line with a pause whenever a slice has run for a few ms: a big file never holds the loop. */
async function jsonLinesChunked(text: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let at = 0;
  let sliceStart = Date.now();
  while (at < text.length) {
    let end = text.indexOf('\n', at);
    if (end === -1) end = text.length;
    const t = text.slice(at, end).trim();
    at = end + 1;
    if (t && t[0] === '{') {
      try {
        const v = JSON.parse(t) as unknown;
        if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
      } catch {
        /* A torn or foreign line. */
      }
    }
    if (Date.now() - sliceStart > SLICE_MS) {
      await yieldLoop();
      sliceStart = Date.now();
    }
  }
  return out;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const iso = (v: unknown): string | null => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};
const ms = (v: unknown): number => {
  const s = iso(v);
  return s ? Date.parse(s) : 0;
};

/* ── the text of a message ──────────────────────────────────────────────── */

/** Text blocks of a message's `content` (a string, or blocks of text / input_text / output_text). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const b of content) {
    const block = obj(b);
    if (!block) continue;
    if ((block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * What a person typed, from a Claude Code user record: slash commands keep
 * their name, the CLI's own wrappers (local command output, caveats, hook
 * and system reminders) are not the person's words.
 */
export function humanPrompt(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const cmd = /<command-name>\s*([^<]+?)\s*<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/.exec(text);
  if (cmd) return `${cmd[1]}${cmd[2]?.trim() ? ` ${cmd[2].trim()}` : ''}`;
  if (/^<(?:local-command-|system-reminder|user-prompt-submit-hook|session-context|task-notification)/.test(text)) return '';
  if (/^\[Request interrupted by user/.test(text)) return '';
  return text;
}

/** The environment blocks Codex puts in front of a conversation are not the person's words. */
function isCodexPreamble(text: string): boolean {
  return /^\s*<(?:environment_context|user_instructions|user_action|turn_aborted)/.test(text) || /^\s*#\s*AGENTS\.md instructions/i.test(text);
}

function cap(s: string): string {
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n\n[Imported text cut here.]` : s;
}

/* ── cwd matching ───────────────────────────────────────────────────────── */

/** Claude names a project folder by its path with every non-alphanumeric turned into `-`. */
export function claudeSlug(p: string): string {
  return p.replace(/[^A-Za-z0-9]/g, '-');
}

const looksWindows = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.includes('\\');

function within(root: string, child: string): boolean {
  if (sameRepoPath(root, child)) return true;
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return !(rel === '' || rel.startsWith('..') || path.isAbsolute(rel));
}

/**
 * A transcript's cwd belongs to the repository: the repo itself, or a folder
 * inside it. Case is folded only where the filesystem folds it (Windows, or a
 * Windows path read elsewhere): on Linux `/x/Repo` and `/x/repo` are two repos.
 */
export function cwdBelongsTo(repoRoot: string, cwd: string): boolean {
  if (!cwd) return false;
  const fold = process.platform === 'win32' || looksWindows(cwd) || looksWindows(repoRoot);
  const norm = (p: string): string => {
    const t = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return fold ? t.toLowerCase() : t;
  };
  if (norm(cwd) === norm(repoRoot) || norm(cwd).startsWith(`${norm(repoRoot)}/`)) return true;
  return !looksWindows(cwd) && within(repoRoot, cwd);
}

/* ── listing ────────────────────────────────────────────────────────────── */

async function safeReaddir(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statOf(file: string): Promise<fs.Stats | null> {
  try {
    const s = await fsp.stat(file);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

async function claudeFound(file: string, stat: fs.Stats, repoRoot: string): Promise<Found | null> {
  const id = path.basename(file, '.jsonl');
  const head = jsonLines(await readSlice(file, 0, HEAD_BYTES), false, stat.size > HEAD_BYTES);
  const tail = stat.size > HEAD_BYTES ? jsonLines(await readSlice(file, Math.max(0, stat.size - TAIL_BYTES), TAIL_BYTES), true) : [];
  let cwd = '';
  let sessionId = id;
  let startedAt: string | null = null;
  let firstPrompt = '';
  for (const r of head) {
    if (!cwd && str(r.cwd)) cwd = str(r.cwd)!;
    if (str(r.sessionId)) sessionId = str(r.sessionId)!;
    if (!startedAt) startedAt = iso(r.timestamp);
    if (!firstPrompt && r.type === 'user' && r.isMeta !== true && r.isSidechain !== true) firstPrompt = humanPrompt(textOf(obj(r.message)?.content));
    if (cwd && firstPrompt) break;
  }
  if (!cwdBelongsTo(repoRoot, cwd)) return null;
  let title = '';
  for (const r of [...head, ...tail]) if (r.type === 'ai-title' && str(r.aiTitle)) title = str(r.aiTitle)!;
  if (!firstPrompt && !title) return null;
  return {
    source: 'claude',
    providerSessionId: sessionId,
    title: title || summarizeSessionTitle(firstPrompt).slice(0, 120),
    firstPrompt: firstPrompt.slice(0, 300),
    cwd,
    startedAt,
    updatedAt: stat.mtime.toISOString(),
    bytes: stat.size,
    file,
  };
}

async function codexFound(file: string, stat: fs.Stats, repoRoot: string): Promise<Found | null> {
  const head = jsonLines(await readSlice(file, 0, HEAD_BYTES), false, stat.size > HEAD_BYTES);
  let id = '';
  let cwd = '';
  let startedAt: string | null = null;
  let firstPrompt = '';
  for (const r of head) {
    const p = obj(r.payload);
    if (r.type === 'session_meta' && p) {
      id = id || str(p.id) || str(p.session_id) || '';
      cwd = cwd || str(p.cwd) || '';
      startedAt = startedAt || iso(p.timestamp) || iso(r.timestamp);
    } else if (r.type === 'turn_context' && p && !cwd) cwd = str(p.cwd) || '';
    if (!firstPrompt && r.type === 'event_msg' && p?.type === 'user_message' && str(p.message) && !isCodexPreamble(String(p.message))) firstPrompt = String(p.message).trim();
    if (id && cwd && firstPrompt) break;
  }
  if (!id) id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(path.basename(file))?.[1] ?? '';
  if (!id || !cwdBelongsTo(repoRoot, cwd) || !firstPrompt) return null;
  return {
    source: 'codex',
    providerSessionId: id,
    title: summarizeSessionTitle(firstPrompt).slice(0, 120),
    firstPrompt: firstPrompt.slice(0, 300),
    cwd,
    startedAt,
    updatedAt: stat.mtime.toISOString(),
    bytes: stat.size,
    file,
  };
}

/** Claude sessions of this repository, newest first. */
async function scanClaude(homes: ImportHomes, repoRoot: string): Promise<Found[]> {
  const projects = path.join(homes.claudeDir, 'projects');
  /* The slug of the repo is the usual folder; a subfolder's or worktree's slug starts with it. */
  const slug = claudeSlug(path.resolve(repoRoot));
  const fold = process.platform === 'win32';
  const same = (n: string, want: string): boolean => (fold ? n.toLowerCase() === want.toLowerCase() : n === want);
  const starts = (n: string, want: string): boolean => (fold ? n.toLowerCase().startsWith(want.toLowerCase()) : n.startsWith(want));
  const dirs = (await safeReaddir(projects)).filter((d) => d.isDirectory() && (same(d.name, slug) || starts(d.name, `${slug}-`)));
  const files: { file: string; stat: fs.Stats }[] = [];
  for (const d of dirs) {
    for (const e of await safeReaddir(path.join(projects, d.name))) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const file = path.join(projects, d.name, e.name);
      const stat = await statOf(file);
      if (stat && stat.size > 0) files.push({ file, stat });
    }
  }
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const out: Found[] = [];
  for (const { file, stat } of files.slice(0, MAX_FILES)) {
    const f = await claudeFound(file, stat, repoRoot);
    if (f) out.push(f);
    if (out.length >= MAX_LISTED) break;
  }
  return out;
}

/** Codex rollouts of this repository, newest first (the date folders are walked newest first). */
async function scanCodex(homes: ImportHomes, repoRoot: string): Promise<Found[]> {
  const root = path.join(homes.codexDir, 'sessions');
  const byName = (a: fs.Dirent, b: fs.Dirent): number => (a.name < b.name ? 1 : -1);
  const out: Found[] = [];
  let looked = 0;
  for (const y of (await safeReaddir(root)).filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name)).sort(byName)) {
    for (const m of (await safeReaddir(path.join(root, y.name))).filter((e) => e.isDirectory()).sort(byName)) {
      for (const d of (await safeReaddir(path.join(root, y.name, m.name))).filter((e) => e.isDirectory()).sort(byName)) {
        const dir = path.join(root, y.name, m.name, d.name);
        for (const e of (await safeReaddir(dir)).filter((x) => x.isFile() && x.name.startsWith('rollout-') && x.name.endsWith('.jsonl')).sort(byName)) {
          if (++looked > MAX_FILES) return out.sort(newest);
          const file = path.join(dir, e.name);
          const stat = await statOf(file);
          if (!stat || stat.size === 0) continue;
          const f = await codexFound(file, stat, repoRoot);
          if (f) out.push(f);
          if (out.length >= MAX_LISTED) return out.sort(newest);
        }
      }
    }
  }
  return out.sort(newest);
}

const newest = (a: { updatedAt: string }, b: { updatedAt: string }): number => (a.updatedAt < b.updatedAt ? 1 : -1);

function importedMap(repoRoot: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of readSessionIndex(repoRoot)?.sessions ?? []) if (s.importedFrom) m.set(`${s.importedFrom.source}:${s.importedFrom.id}`, s.id);
  return m;
}

/** The CLI sessions that ran in this repository, newest first, marked with the chat they already became. */
export async function listImportable(repoRoot: string, homes: ImportHomes = cliHomes()): Promise<ImportableSession[]> {
  const done = importedMap(repoRoot);
  return [...(await scanClaude(homes, repoRoot)), ...(await scanCodex(homes, repoRoot))]
    .sort(newest)
    .map(({ file: _file, ...rest }) => {
      const chatId = done.get(`${rest.source}:${rest.providerSessionId}`);
      return { ...rest, imported: chatId !== undefined, ...(chatId ? { chatId } : {}) };
    });
}

/* ── parsing a whole session ────────────────────────────────────────────── */

export interface ParsedTurn {
  prompt: string;
  text: string;
  tools: StoredAgentTool[];
  startedAt: number;
  endedAt: number;
  model: string | null;
}

export interface ParsedSession {
  turns: ParsedTurn[];
  model: string | null;
  truncated: boolean;
}

function toolKindOf(name: string): string {
  const n = name.toLowerCase();
  if (/^(read|view|cat)/.test(n)) return 'read';
  if (/^(edit|write|multiedit|notebookedit|apply_patch|str_replace)/.test(n)) return 'edit';
  if (/^(bash|shell|exec|local_shell|powershell)/.test(n)) return 'execute';
  if (/^(grep|glob|ls|search|websearch)/.test(n)) return 'search';
  if (/^(webfetch|fetch)/.test(n)) return 'fetch';
  return 'other';
}

function brief(v: unknown): string {
  const o = obj(v);
  if (!o) return '';
  const pick = str(o.command) ?? str(o.cmd) ?? str(o.file_path) ?? str(o.path) ?? str(o.pattern) ?? str(o.url) ?? str(o.description) ?? str(o.query) ?? '';
  return pick.replace(/\s+/g, ' ').slice(0, 120);
}

export function parseClaudeSession(text: string, records: Record<string, unknown>[] = jsonLines(text)): ParsedSession {
  const turns: ParsedTurn[] = [];
  let model: string | null = null;
  let cur: ParsedTurn | null = null;
  const toolById = new Map<string, StoredAgentTool>();
  let lastAssistantId = '';
  for (const r of records) {
    if (r.isSidechain === true) continue;
    const at = ms(r.timestamp);
    const message = obj(r.message);
    if (r.type === 'user' && message) {
      const content = message.content;
      /* Tool results ride on user records: they settle a call, they are not a question. */
      if (Array.isArray(content)) {
        for (const b of content) {
          const block = obj(b);
          if (block?.type === 'tool_result' && str(block.tool_use_id) && block.is_error === true) {
            const t = toolById.get(String(block.tool_use_id));
            if (t) t.status = 'failed';
          }
        }
      }
      if (r.isMeta === true || r.isCompactSummary === true) continue;
      const prompt = humanPrompt(textOf(content));
      if (!prompt) {
        if (cur && at) cur.endedAt = Math.max(cur.endedAt, at);
        continue;
      }
      cur = { prompt: cap(prompt), text: '', tools: [], startedAt: at, endedAt: at, model: null };
      turns.push(cur);
      lastAssistantId = '';
    } else if (r.type === 'assistant' && message && cur) {
      const m = str(message.model);
      if (m && m !== '<synthetic>') {
        model = m;
        cur.model = m;
      }
      const mid = str(message.id) ?? '';
      const content = message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          const block = obj(b);
          if (!block) continue;
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            /* A new API message starts a new paragraph; chunks of one message continue it. */
            cur.text += `${cur.text && mid !== lastAssistantId ? '\n\n' : ''}${block.text}`;
          } else if (block.type === 'tool_use' && str(block.id)) {
            const name = str(block.name) ?? 'Tool';
            const detail = brief(block.input);
            const input = obj(block.input);
            const sub = name === 'Task' || name === 'Agent' ? str(input?.subagent_type) : null;
            const tool: StoredAgentTool = {
              id: String(block.id),
              title: detail ? `${name} ${detail}` : name,
              toolKind: toolKindOf(name),
              status: 'done',
              startedAt: at || cur.startedAt,
              endedAt: at || cur.startedAt,
              ...(sub ? { subagent: str(input?.description) ? `${sub}: ${str(input?.description)}` : sub } : {}),
            };
            toolById.set(tool.id, tool);
            if (cur.tools.length < 400) cur.tools.push(tool);
          }
        }
      } else if (typeof content === 'string' && content.trim()) cur.text += `${cur.text ? '\n\n' : ''}${content}`;
      lastAssistantId = mid || lastAssistantId;
      if (at) cur.endedAt = Math.max(cur.endedAt, at);
    }
  }
  const truncated = turns.length > MAX_TURNS;
  const kept = truncated ? turns.slice(-MAX_TURNS) : turns;
  for (const t of kept) t.text = cap(t.text);
  return { turns: kept, model, truncated };
}

export function parseCodexSession(text: string, records: Record<string, unknown>[] = jsonLines(text)): ParsedSession {
  /* Newer rollouts carry the person's words as event_msg user_message; older ones only as a response_item. */
  const hasEventUser = records.some((r) => r.type === 'event_msg' && obj(r.payload)?.type === 'user_message');
  const turns: ParsedTurn[] = [];
  let model: string | null = null;
  const holder: { cur: ParsedTurn | null } = { cur: null };
  const toolById = new Map<string, StoredAgentTool>();
  let sawResponseAssistant = false;
  let eventAssistant = '';
  const flushEvent = (): void => {
    if (holder.cur && !holder.cur.text && eventAssistant) holder.cur.text = eventAssistant;
    eventAssistant = '';
  };
  const begin = (prompt: string, at: number): void => {
    flushEvent();
    holder.cur = { prompt: cap(prompt), text: '', tools: [], startedAt: at, endedAt: at, model };
    turns.push(holder.cur);
  };
  for (const r of records) {
    const cur = holder.cur;
    const p = obj(r.payload);
    if (!p) continue;
    const at = ms(r.timestamp);
    if (r.type === 'turn_context' && str(p.model)) {
      model = str(p.model);
      if (cur) cur.model = model;
    } else if (r.type === 'event_msg' && p.type === 'user_message' && str(p.message)) {
      if (!isCodexPreamble(String(p.message))) begin(String(p.message).trim(), at);
    } else if (r.type === 'event_msg' && p.type === 'agent_message' && str(p.message) && cur) {
      eventAssistant += `${eventAssistant ? '\n\n' : ''}${String(p.message)}`;
      cur.endedAt = Math.max(cur.endedAt, at);
    } else if (r.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user' && !hasEventUser) {
        const t = textOf(p.content).trim();
        if (t && !isCodexPreamble(t)) begin(t, at);
      } else if (p.type === 'message' && p.role === 'assistant' && cur) {
        const t = textOf(p.content);
        if (t.trim()) {
          sawResponseAssistant = true;
          cur.text += `${cur.text ? '\n\n' : ''}${t}`;
        }
        cur.endedAt = Math.max(cur.endedAt, at);
      } else if ((p.type === 'function_call' || p.type === 'local_shell_call' || p.type === 'custom_tool_call') && cur) {
        const name = str(p.name) ?? (p.type === 'local_shell_call' ? 'shell' : 'Tool');
        let args: unknown = p.arguments ?? p.input ?? p.action;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = { command: args };
          }
        }
        const a = obj(args);
        const cmd = Array.isArray(a?.command) ? (a!.command as unknown[]).filter((x) => typeof x === 'string').join(' ') : '';
        const detail = cmd ? cmd.replace(/\s+/g, ' ').slice(0, 120) : brief(args);
        const id = str(p.call_id) ?? str(p.id) ?? `t${cur.tools.length}`;
        const tool: StoredAgentTool = { id, title: detail ? `${name} ${detail}` : name, toolKind: toolKindOf(name), status: 'done', startedAt: at || cur.startedAt, endedAt: at || cur.startedAt };
        toolById.set(id, tool);
        if (cur.tools.length < 400) cur.tools.push(tool);
        cur.endedAt = Math.max(cur.endedAt, at);
      }
    }
  }
  flushEvent();
  void sawResponseAssistant;
  const truncated = turns.length > MAX_TURNS;
  const kept = truncated ? turns.slice(-MAX_TURNS) : turns;
  for (const t of kept) t.text = cap(t.text);
  return { turns: kept, model, truncated };
}

/* ── making the chat ────────────────────────────────────────────────────── */

export type ImportResult = { ok: true; chatId: string; turns: number; already: boolean; truncated: boolean } | { ok: false; reason: 'not-found' | 'too-large' | 'empty' };

/**
 * Import one session as a new chat of `repoRoot`; a session already imported opens its chat. Never writes under a CLI's home.
 * The transcript is read without blocking the server, every turn is built in memory, and the chat is written once
 * (turns past the visible cap go to the chat's archive, which the chat pages through).
 */
export async function importSession(repoRoot: string, source: ImportSource, providerSessionId: string, homes: ImportHomes = cliHomes(), now = new Date()): Promise<ImportResult> {
  ensureSessionsMigrated(repoRoot);
  const existing = importedMap(repoRoot).get(`${source}:${providerSessionId}`);
  if (existing) return { ok: true, chatId: existing, turns: 0, already: true, truncated: false };
  const found = (source === 'claude' ? await scanClaude(homes, repoRoot) : await scanCodex(homes, repoRoot)).find((f) => f.providerSessionId === providerSessionId);
  if (!found) return { ok: false, reason: 'not-found' };
  const stat = await statOf(found.file);
  if (!stat) return { ok: false, reason: 'not-found' };
  if (stat.size > MAX_IMPORT_BYTES) return { ok: false, reason: 'too-large' };
  let text = '';
  try {
    text = await fsp.readFile(found.file, 'utf8');
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  /* A second click while this one reads must not make a second chat. */
  const raced = importedMap(repoRoot).get(`${source}:${providerSessionId}`);
  if (raced) return { ok: true, chatId: raced, turns: 0, already: true, truncated: false };
  const records = await jsonLinesChunked(text);
  const parsed = source === 'claude' ? parseClaudeSession(text, records) : parseCodexSession(text, records);
  if (parsed.turns.length === 0) return { ok: false, reason: 'empty' };

  const runs: StoredAgentRun[] = parsed.turns.map((t, i) => ({
    id: `import-${source}-${i}`,
    agentRef: source,
    prompt: t.prompt,
    text: t.text,
    status: 'done',
    error: null,
    stopReason: 'end_turn',
    startedAt: t.startedAt || stat.mtimeMs + i,
    endedAt: t.endedAt || t.startedAt || stat.mtimeMs + i,
    model: t.model,
    nodeId: null,
    tools: t.tools,
  }));
  const { id: chatId } = createSession(repoRoot, { mode: 'code' });
  await writeAgentRunsBulk(repoRoot, chatId, runs);
  /* The CLI's session is the chat's agent thread: the next message rejoins it. */
  writeAgentThread(repoRoot, chatId, source, { id: providerSessionId, kind: source === 'codex' ? 'codex' : 'acp' });
  const index = readSessionIndex(repoRoot)!;
  writeJson(repoRoot, SESSIONS_INDEX_FILE, {
    ...index,
    sessions: index.sessions.map((s) =>
      s.id === chatId
        ? {
            ...s,
            title: found.title || s.title,
            titleEdited: true,
            createdAt: found.startedAt ?? s.createdAt,
            updatedAt: found.updatedAt,
            importedFrom: { source, id: providerSessionId, at: now.toISOString() },
          }
        : s,
    ),
  });
  return { ok: true, chatId, turns: parsed.turns.length, already: false, truncated: parsed.truncated };
}
