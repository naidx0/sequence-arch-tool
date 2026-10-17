/* ══════════════════════════════════════════════════════════════════════════
   AGENT CHATS ON DISK, TITLED, WITH A LOG OF EVERY TURN (round 9)
   packages/analyzer/src/server/agentChatStore.ts

   Jaden, round 9: "Chats aren't saved: his earlier chat in the workspace was
   lost." "Chats aren't titled." Claude and Codex chats lived only in the
   page's memory; a relaunch lost them and nothing named them.

   The run-node handler records each agent turn here as it is answered and
   again when it ends, beside the chat's other files:

     .sequence/sessions/<id>/agent-runs.json     the turns: what was asked,
                                                 what the agent answered, its
                                                 tool rows, how it ended
     .sequence/sessions/<id>/agent-turns.jsonl   one diagnostic record per
                                                 turn (acp turnStatus.ts
                                                 TurnLog): phases, tool kinds,
                                                 stop reason, error. Never
                                                 the words.

   An untitled chat is named from its first exchange (`agentChatTitle`): the
   question, trimmed to a topic; or, when the question says nothing ("hi"),
   the answer's heading or first sentence. A person's rename always wins and a
   title is written once (`titleGenerated`).

   READ, NEVER MINT: every write needs the chat to be in the session index,
   so a stray id can neither create a store nor name a path outside it.
   ══════════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import type { AskClosure, AskLedgerResult } from '@sequence/schema';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bumpIndexUpdatedAt, readSessionIndex, summarizeSessionTitle, UNTITLED_CHAT, type SessionIndex } from './sessionsStore.js';
import { readJson, writeJson, SEQUENCE_DIR, SESSIONS_INDEX_FILE } from './store.js';
import { atomicWriteFileParts, atomicWriteFileSync, sweepStaleTmp } from './store.js';
import { flushWritesSync, scheduleAppend } from './asyncWriter.js';

export interface StoredAgentTool {
  id: string;
  title: string;
  toolKind: string | null;
  status: 'running' | 'done' | 'failed';
  /** A subagent (Task call): "Explore: find the auth code". Absent for ordinary calls and old records. */
  subagent?: string;
  /** The Task call this call ran inside. */
  parentId?: string;
  /** When the call was first seen / settled (epoch ms). */
  startedAt?: number;
  endedAt?: number;
  /**
   * How much of the turn's text had been written when the call began (UTF-16 units), so a reload can put the call
   * back between the prose before it and the prose after it, where the live chat showed it. Absent on older records.
   */
  at?: number;
}

/** Round 9 (ask 30): the tokens the agent reported for one turn. */
export interface StoredTurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  thought: number;
  total: number;
}

/** One steer: the words the person put into a running turn, and when. */
export interface StoredSteer {
  text: string;
  at: number;
}

export interface StoredAgentRun {
  id: string;
  agentRef: string;
  prompt: string;
  text: string;
  /**
   * done (answered or ended), failed, or stopped by the person. `running` is
   * written while a turn is in flight and replaced when it ends: one still
   * `running` after a restart is an interrupted turn (`interruptedRun`).
   */
  status: 'done' | 'failed' | 'stopped' | 'running';
  error: string | null;
  stopReason: string | null;
  startedAt: number;
  endedAt: number;
  model: string | null;
  nodeId: string | null;
  tools: StoredAgentTool[];
  /** Absent when the agent never said (never an estimate). */
  usage?: StoredTurnUsage;
  /** The server process that wrote a `running` record (see ownedByOtherLiveProcess). */
  owner?: RunOwner;
  /** A compaction turn: it is a turn in the provider's thread but not a message in the chat. */
  compact?: boolean;
  /** False when the turn failed before the prompt reached the provider (so it is not in the provider's thread). Absent on older records: counted. */
  reached?: boolean;
  /** The prompt carried the chat to an agent that was new to it ('full') or had missed turns ('delta'); `chars` is its length (UTF-16 units). */
  handoff?: { chars: number; kind: 'full' | 'delta' };
  /**
   * The provider's id for this turn (a string), or null when the provider never
   * accepted it (the turn failed or was stopped before that). Absent on records
   * from before ids were kept, or from a client that does not name its turns.
   */
  pturn?: string | null;
  /** The provider thread the turn ran on, so a rewind counts only turns that are in the thread it rolls back. */
  thread?: string;
  /** The ask ledger's closing line, read from the reply (the agent's own report). */
  askLedger?: AskLedgerResult;
  /** What the person added to this turn while it ran (codex steer), oldest first. Absent when nothing was added. */
  steers?: StoredSteer[];
  /** Repo-relative files and folders the run's Read, search and map calls named (and `svc:` ids from the map tool). Absent on older records and runs that read nothing. */
  readPaths?: string[];
}

export interface RunOwner {
  pid: number;
  boot: string;
}

function cleanLedger(raw: unknown): AskLedgerResult | undefined {
  const r = raw as { closures?: unknown } | null;
  if (!r || !Array.isArray(r.closures)) return undefined;
  const closures = r.closures
    .filter((c): c is AskClosure => !!c && typeof (c as AskClosure).n === 'number' && typeof (c as AskClosure).done === 'boolean')
    .map((c) => ({ n: c.n, text: typeof c.text === 'string' ? c.text : '', done: c.done, reason: typeof c.reason === 'string' ? c.reason : null }));
  return closures.length ? { closures, open: closures.filter((c) => !c.done).map((c) => c.n) } : undefined;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

function cleanUsage(raw: unknown): StoredTurnUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const out = { input: count(u.input), output: count(u.output), cacheRead: count(u.cacheRead), cacheWrite: count(u.cacheWrite), thought: count(u.thought), total: count(u.total) };
  if (!out.total) out.total = out.input + out.output;
  return out.total || out.cacheRead || out.cacheWrite ? out : undefined;
}

const RUNS_LEAF = 'agent-runs.json';
const LOG_LEAF = 'agent-turns.jsonl';
/** Kept per chat; the oldest go first. */
const MAX_RUNS = 200;
/** A turn log over this is cut to its newer half. */
const MAX_LOG_BYTES = 256 * 1024;

const rel = (id: string, leaf: string): string => `sessions/${id}/${leaf}`;

function chatExists(root: string, chatId: string): SessionIndex | null {
  const index = readSessionIndex(root);
  return index && index.sessions.some((s) => s.id === chatId) ? index : null;
}

function cleanRun(raw: unknown): StoredAgentRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StoredAgentRun>;
  if (typeof r.id !== 'string' || typeof r.prompt !== 'string' || typeof r.agentRef !== 'string') return null;
  const status = r.status === 'failed' || r.status === 'stopped' || r.status === 'running' ? r.status : 'done';
  return {
    id: r.id,
    agentRef: r.agentRef,
    prompt: r.prompt,
    text: typeof r.text === 'string' ? r.text : '',
    status,
    error: typeof r.error === 'string' ? r.error : null,
    stopReason: typeof r.stopReason === 'string' ? r.stopReason : null,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0,
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : 0,
    model: typeof r.model === 'string' ? r.model : null,
    nodeId: typeof r.nodeId === 'string' ? r.nodeId : null,
    tools: Array.isArray(r.tools)
      ? r.tools
          .filter((t): t is StoredAgentTool => !!t && typeof (t as StoredAgentTool).id === 'string')
          .map((t) => ({ id: t.id, title: typeof t.title === 'string' ? t.title : '', toolKind: typeof t.toolKind === 'string' ? t.toolKind : null, status: t.status === 'failed' ? 'failed' : t.status === 'running' ? 'running' : 'done', ...(typeof t.subagent === 'string' && t.subagent ? { subagent: t.subagent } : {}), ...(typeof t.parentId === 'string' && t.parentId ? { parentId: t.parentId } : {}), ...(typeof t.startedAt === 'number' && t.startedAt > 0 ? { startedAt: t.startedAt } : {}), ...(typeof t.endedAt === 'number' && t.endedAt > 0 ? { endedAt: t.endedAt } : {}), ...(typeof t.at === 'number' && Number.isFinite(t.at) && t.at >= 0 ? { at: Math.floor(t.at) } : {}) }))
      : [],
    ...(cleanUsage(r.usage) ? { usage: cleanUsage(r.usage)! } : {}),
    ...(r.owner && typeof r.owner.pid === 'number' && typeof r.owner.boot === 'string' ? { owner: { pid: r.owner.pid, boot: r.owner.boot } } : {}),
    ...(r.compact === true ? { compact: true } : {}),
    ...(r.reached === false ? { reached: false } : {}),
    ...(r.handoff && typeof r.handoff.chars === 'number' && r.handoff.chars > 0 && (r.handoff.kind === 'full' || r.handoff.kind === 'delta') ? { handoff: { chars: r.handoff.chars, kind: r.handoff.kind } } : {}),
    ...(typeof r.pturn === 'string' && r.pturn ? { pturn: r.pturn } : r.pturn === null ? { pturn: null } : {}),
    ...(typeof r.thread === 'string' && r.thread ? { thread: r.thread } : {}),
    ...(cleanLedger(r.askLedger) ? { askLedger: cleanLedger(r.askLedger)! } : {}),
    ...(Array.isArray(r.readPaths) && r.readPaths.some((p) => typeof p === 'string') ? { readPaths: r.readPaths.filter((p): p is string => typeof p === 'string').slice(0, 400) } : {}),
  };
}

/** What the chat's saved turns file said when read. */
export interface AgentRunsRead {
  runs: StoredAgentRun[];
  /** The file would not parse: `restored` when the last backup was used instead, else the turns are not readable. */
  damaged?: { restored: boolean };
  /** Turns older than the newest MAX_RUNS, kept in the archive file and not shown until asked for. */
  archived: number;
}

const BAK_LEAF = 'agent-runs.json.bak';
const ARCHIVE_LEAF = 'agent-runs.archive.jsonl';
/** The archive keeps this many turns; past it the oldest go (the cut is rewritten whole). */
const MAX_ARCHIVE = 5000;
const ARCHIVE_KEEP = 4000;

/**
 * Who wrote a `running` record: another server process on the same folder is told apart from a dead one.
 * A bare pid is not proof (a crash or reboot hands the pid to an unrelated process), so a process that holds
 * running turns also touches a heartbeat file named by its boot id every few seconds; a record is "owned by
 * another live process" only while that pid is alive AND its heartbeat is fresh.
 */
export const BOOT_ID = crypto.randomUUID();
const LIVE_DIR = path.join(os.tmpdir(), 'sequence-live');
const BEAT_MS = 5_000;
const BEAT_STALE_MS = 20_000;
let beat: NodeJS.Timeout | null = null;

function touchHeartbeat(): void {
  try {
    fs.mkdirSync(LIVE_DIR, { recursive: true });
    fs.writeFileSync(path.join(LIVE_DIR, BOOT_ID), String(process.pid));
  } catch {
    /* No heartbeat means other processes call this one's turns cut off: the safe direction. */
  }
}
export function ownerNow(): RunOwner {
  if (!beat) {
    touchHeartbeat();
    beat = setInterval(touchHeartbeat, BEAT_MS);
    beat.unref();
    process.once('exit', () => {
      try {
        fs.unlinkSync(path.join(LIVE_DIR, BOOT_ID));
      } catch {
        /* already gone */
      }
    });
  }
  return { pid: process.pid, boot: BOOT_ID };
}
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
function beatFresh(boot: string): boolean {
  try {
    return Date.now() - fs.statSync(path.join(LIVE_DIR, path.basename(boot))).mtimeMs < BEAT_STALE_MS;
  } catch {
    return false;
  }
}
/** True when a different process, alive and still beating, wrote this record (its turn is live there, not cut off). */
export function ownedByOtherLiveProcess(owner: RunOwner | undefined): boolean {
  return !!owner && owner.boot !== BOOT_ID && owner.pid !== process.pid && pidAlive(owner.pid) && beatFresh(owner.boot);
}

/* The parsed turns of each chat, valid while the file's size and mtime are what this process last wrote or read.
   A progress write every two seconds then costs one stringify and one rename, not three reads. */
const runsCache = new Map<string, { size: number; mtimeMs: number; runs: StoredAgentRun[] }>();
const cacheKey = (root: string, chatId: string): string => `${root}\0${chatId}`;
const runsFile = (root: string, chatId: string): string => path.join(root, SEQUENCE_DIR, rel(chatId, RUNS_LEAF));

function statKey(file: string): { size: number; mtimeMs: number } | null {
  try {
    const st = fs.statSync(file);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

function parseRuns(file: string, key?: string): StoredAgentRun[] | 'absent' | 'damaged' {
  const st = statKey(file);
  if (!st) return 'absent';
  const hit = key ? runsCache.get(key) : undefined;
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.runs.slice();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 'absent';
  }
  try {
    const raw = JSON.parse(text) as { runs?: unknown } | null;
    if (!raw || !Array.isArray(raw.runs)) return 'damaged';
    const runs = raw.runs.map(cleanRun).filter((r): r is StoredAgentRun => r !== null);
    if (key) runsCache.set(key, { ...st, runs });
    return runs.slice();
  } catch {
    return 'damaged';
  }
}

/* ── the archive of older turns ─────────────────────────────────────────── */

interface ArchiveState {
  ids: Set<string>;
  count: number;
}
const archives = new Map<string, ArchiveState>();
const archiveFile = (root: string, chatId: string): string => path.join(root, SEQUENCE_DIR, rel(chatId, ARCHIVE_LEAF));

/** Valid archived turns, oldest first. A torn last line (a crash mid-append) is skipped, not counted. */
function readArchiveRuns(root: string, chatId: string): StoredAgentRun[] {
  let text = '';
  try {
    text = fs.readFileSync(archiveFile(root, chatId), 'utf8');
  } catch {
    return [];
  }
  const out: StoredAgentRun[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const run = cleanRun(JSON.parse(line));
      if (run) out.push(run);
    } catch {
      /* torn line */
    }
  }
  return out;
}

function archiveState(root: string, chatId: string): ArchiveState {
  const key = cacheKey(root, chatId);
  let st = archives.get(key);
  if (!st) {
    const runs = readArchiveRuns(root, chatId);
    st = { ids: new Set(runs.map((r) => r.id)), count: runs.length };
    archives.set(key, st);
  }
  return st;
}

/** Add turns to the archive: ones it already holds are skipped, a torn tail is closed off first, and it is bounded. */
function appendArchive(root: string, chatId: string, over: readonly StoredAgentRun[], lines?: ReadonlyMap<string, string>): boolean {
  try {
    const st = archiveState(root, chatId);
    const fresh = over.filter((r) => !st.ids.has(r.id));
    if (fresh.length === 0) return true;
    const file = archiveFile(root, chatId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let lead = '';
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size > 0) {
          const b = Buffer.alloc(1);
          fs.readSync(fd, b, 0, 1, size - 1);
          if (b[0] !== 0x0a) lead = '\n';
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* no archive yet */
    }
    fs.appendFileSync(file, lead + fresh.map((r) => lines?.get(r.id) ?? JSON.stringify(r)).join('\n') + '\n');
    for (const r of fresh) st.ids.add(r.id);
    st.count += fresh.length;
    if (st.count > MAX_ARCHIVE) {
      const all = readArchiveRuns(root, chatId).slice(-ARCHIVE_KEEP);
      atomicWriteFileSync(file, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
      archives.set(cacheKey(root, chatId), { ids: new Set(all.map((r) => r.id)), count: all.length });
    }
    return true;
  } catch {
    return false;
  }
}

/** Empty the archive (its turns are about to be written again by commitRuns, newest 200 to the main file). */
function resetArchive(root: string, chatId: string): void {
  fs.rmSync(archiveFile(root, chatId), { force: true });
  archives.delete(cacheKey(root, chatId));
}

/**
 * A page of the archive, newest first by position: `offset` turns already loaded from its end,
 * up to `limit` more (returned oldest first), and how many remain older still.
 */
export function readArchivePage(root: string, chatId: string, offset: number, limit = 100): { runs: StoredAgentRun[]; remaining: number } {
  if (!chatExists(root, chatId)) return { runs: [], remaining: 0 };
  const all = readArchiveRuns(root, chatId);
  const end = Math.max(0, all.length - Math.max(0, Math.floor(offset)));
  const start = Math.max(0, end - Math.max(1, Math.min(500, Math.floor(limit))));
  return { runs: all.slice(start, end), remaining: start };
}

/* Finished turns whose closing write failed (a locked file, a full disk). They are served from memory as finished
   and written with the chat's next successful write, so a later turn clears a stuck `running` record. */
const unsaved = new Map<string, Map<string, StoredAgentRun>>();

/** Finished turns held in memory only (their write failed): a search of the files alone would miss them. */
export function hasUnsavedRuns(root: string, chatId: string): boolean {
  return (unsaved.get(cacheKey(root, chatId))?.size ?? 0) > 0;
}

function withUnsaved(root: string, chatId: string, runs: StoredAgentRun[]): StoredAgentRun[] {
  const held = unsaved.get(cacheKey(root, chatId));
  if (!held || held.size === 0) return runs;
  const byId = new Map(runs.map((r) => [r.id, r]));
  for (const [id, r] of held) byId.set(id, r);
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** The chat's turns with the state of the file they came from. Never throws. */
export function readAgentRunsChecked(root: string, chatId: string, opts: { withCompactions?: boolean } = {}): AgentRunsRead {
  const read = readAgentRunsFromFile(root, chatId);
  const merged = read.runs.length || unsaved.has(cacheKey(root, chatId)) ? { ...read, runs: withUnsaved(root, chatId, read.runs) } : read;
  /* A compaction turn is a turn in the provider's thread, not a message in the chat. */
  return opts.withCompactions ? merged : { ...merged, runs: merged.runs.filter((r) => !r.compact) };
}

function readAgentRunsFromFile(root: string, chatId: string): AgentRunsRead {
  if (!chatExists(root, chatId)) return { runs: [], archived: 0 };
  const dir = path.join(root, SEQUENCE_DIR);
  const main = parseRuns(runsFile(root, chatId), cacheKey(root, chatId));
  const archived = archiveState(root, chatId).count;
  if (main === 'absent') return { runs: [], archived };
  if (main !== 'damaged') return { runs: main, archived };
  /* A damaged file is never read as empty: the last good copy stands in, and the person is told. */
  const bak = parseRuns(path.join(dir, rel(chatId, BAK_LEAF)));
  if (bak !== 'absent' && bak !== 'damaged') return { runs: bak, damaged: { restored: true }, archived };
  return { runs: [], damaged: { restored: false }, archived };
}

/** The chat's agent turns, oldest first. Total on a missing or broken file. */
export function readAgentRuns(root: string, chatId: string, opts: { withCompactions?: boolean } = {}): StoredAgentRun[] {
  return readAgentRunsChecked(root, chatId, opts).runs;
}

/**
 * Before a write: a file that will not parse is set aside under its own name
 * (never overwritten). A finished turn's write also keeps the last good file
 * as `.bak`; progress writes skip the copy and, when the cache vouches for
 * the file, the parse.
 */
function protectBeforeWrite(root: string, chatId: string, terminal: boolean): void {
  const file = runsFile(root, chatId);
  const st = statKey(file);
  if (!st) return;
  const hit = runsCache.get(cacheKey(root, chatId));
  const good = hit !== undefined && hit.size === st.size && hit.mtimeMs === st.mtimeMs ? true : parseRuns(file, cacheKey(root, chatId)) !== 'damaged';
  try {
    if (!good) fs.copyFileSync(file, path.join(path.dirname(file), `agent-runs.damaged-${Date.now()}.json`));
    else if (terminal) fs.copyFileSync(file, path.join(path.dirname(file), BAK_LEAF));
  } catch {
    /* A copy that cannot be made must not stop the turn being saved. */
  }
}

const sweptDirs = new Set<string>();

/** Sort, move the overflow to the archive, write the file once (atomically, compact), and remember what was written. */
function commitRuns(root: string, chatId: string, runsIn: StoredAgentRun[]): void {
  const runs = runsIn.slice().sort((a, b) => a.startedAt - b.startedAt);
  /* Turns past the cap move to the archive file, in order; if that cannot be written they stay in the main file. */
  const over = runs.length > MAX_RUNS ? runs.slice(0, runs.length - MAX_RUNS) : [];
  const keep = over.length && appendArchive(root, chatId, over) ? runs.slice(-MAX_RUNS) : runs;
  const file = runsFile(root, chatId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!sweptDirs.has(path.dirname(file))) {
    sweptDirs.add(path.dirname(file));
    sweepStaleTmp(path.dirname(file));
  }
  atomicWriteFileSync(file, JSON.stringify({ version: 1, runs: keep }));
  const st = statKey(file);
  if (st) runsCache.set(cacheKey(root, chatId), { ...st, runs: keep });
}

/**
 * Write one turn (replacing its earlier record) and move the chat up the
 * rail: an agent turn is activity in the chat. False when the chat is unknown.
 * A `running` record marks the chat in the session index (`runningTurn`), a
 * finished one clears it, so the rail can tell a cut-off chat without opening files.
 */
export function recordAgentRun(root: string, chatId: string, runIn: StoredAgentRun, now = new Date(), opts: { touch?: boolean } = {}): boolean {
  const index = chatExists(root, chatId);
  if (!index) return false;
  /* The turn rebuilds its record from its own state on every write; the steers were added from outside it (the steer
     route), so they are folded back in here and no progress write drops them. */
  const held = steersHeld.get(steerKey(root, chatId, runIn.id));
  const run = held && !runIn.steers ? { ...runIn, steers: held } : runIn;
  const terminal = run.status !== 'running';
  if (terminal) steersHeld.delete(steerKey(root, chatId, runIn.id));
  const runs = readAgentRuns(root, chatId, { withCompactions: true }).filter((r) => r.id !== run.id);
  protectBeforeWrite(root, chatId, terminal);
  runs.push(run);
  try {
    commitRuns(root, chatId, runs);
    unsaved.delete(cacheKey(root, chatId));
  } catch (e) {
    if (!terminal) throw e;
    /* A finished turn that could not be written is kept (and served) in memory until a write succeeds. */
    const held = unsaved.get(cacheKey(root, chatId)) ?? new Map<string, StoredAgentRun>();
    held.set(run.id, run);
    unsaved.set(cacheKey(root, chatId), held);
    return true;
  }
  /* A new turn is the next send: an edit can no longer be undone. */
  dropRewindBackup(root, chatId);
  /* A progress write while the turn runs does not move the chat on the rail again. */
  if (opts.touch === false) return true;
  const stamp = now.toISOString();
  /* The marker the rail reads for "interrupted by a restart" is written at once whenever it changes (a turn starts or
     ends). A progress write that only moves `updatedAt` is bookkeeping and goes behind the debounced writer. */
  const before = index.sessions.find((s) => s.id === chatId)?.runningTurn?.id;
  const afterId = run.status === 'running' ? run.id : before && before !== run.id ? before : undefined;
  const newStamp = (() => {
    const cur = index.sessions.find((s) => s.id === chatId)?.updatedAt ?? stamp;
    return stamp > cur ? stamp : new Date(Date.parse(cur) + 1).toISOString();
  })();
  writeJson(root, SESSIONS_INDEX_FILE, {
    ...index,
    sessions: index.sessions.map((s) => {
      if (s.id !== chatId) return s;
      const { runningTurn: held, ...rest } = s;
      const runningTurn = run.status === 'running' ? { id: run.id, ...(run.owner ?? ownerNow()) } : held && held.id !== run.id ? held : undefined;
      return { ...rest, updatedAt: stamp > s.updatedAt ? stamp : new Date(Date.parse(s.updatedAt) + 1).toISOString(), ...(runningTurn ? { runningTurn } : {}) };
    }),
  }, {
    compact: true,
    defer: before === afterId,
    /* A deferred progress write moves only `updatedAt`; applied to the file as it is when it drains. */
    merge: (disk: SessionIndex) => bumpIndexUpdatedAt(disk, chatId, newStamp),
  });
  return true;
}

/** Steers added to a turn that is still running, by turn (see recordAgentRun). */
const steersHeld = new Map<string, StoredSteer[]>();
const steerKey = (root: string, chatId: string, runId: string): string => `${cacheKey(root, chatId)}\u0000${runId}`;

/**
 * The person steered the turn this chat's agent is running: add the words to that turn's record (kept in order, so a reload
 * draws them where they were sent). False when the chat has no running turn of that agent.
 */
export function recordSteer(root: string, chatId: string, agentRef: string, text: string, at = Date.now()): boolean {
  const words = text.trim();
  if (words === '') return false;
  const running = readAgentRuns(root, chatId, { withCompactions: true })
    .filter((r) => r.status === 'running' && r.agentRef === agentRef)
    .at(-1);
  if (!running) return false;
  const steers = [...(steersHeld.get(steerKey(root, chatId, running.id)) ?? running.steers ?? []), { text: words, at }];
  steersHeld.set(steerKey(root, chatId, running.id), steers);
  return recordAgentRun(root, chatId, { ...running, steers }, new Date(at), { touch: false });
}

/** Write a whole chat's turns once (an import): one backup check, one archive append, one write. The caller updates the index. */
export async function writeAgentRunsBulk(root: string, chatId: string, runsIn: StoredAgentRun[]): Promise<boolean> {
  if (!chatExists(root, chatId)) return false;
  const runs = runsIn.slice().sort((a, b) => a.startedAt - b.startedAt);
  const over = runs.length > MAX_RUNS ? runs.slice(0, runs.length - MAX_RUNS) : [];
  const keep = over.length ? runs.slice(-MAX_RUNS) : runs;
  /* A big import is serialised a turn at a time with a pause between slices, and each file write is its own slice,
     so the event loop (requests, timers) is never held for more than a few tens of ms. */
  const lines = new Map<string, string>();
  let sliceStart = Date.now();
  const pieces: string[] = [];
  for (const r of runs) {
    const line = JSON.stringify(r);
    lines.set(r.id, line);
    if (Date.now() - sliceStart > 8) {
      await new Promise<void>((res) => setImmediate(res));
      sliceStart = Date.now();
    }
  }
  for (const r of keep) pieces.push(lines.get(r.id)!);
  protectBeforeWrite(root, chatId, true);
  await new Promise<void>((res) => setImmediate(res));
  /* The archive goes in small batches (an append is a few ms per MB), then the chat file. */
  let archived = over.length > 0;
  for (let at = 0; archived && at < over.length; at += 20) {
    archived = appendArchive(root, chatId, over.slice(at, at + 20), lines);
    await new Promise<void>((res) => setImmediate(res));
  }
  const kept = archived ? keep : runs;
  const file = runsFile(root, chatId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const all = archived ? pieces : runs.map((r) => lines.get(r.id)!);
  /* The file goes out in ~1 MB parts through the async file API. */
  const parts: string[] = ['{"version":1,"runs":['];
  let batch: string[] = [];
  let size = 0;
  all.forEach((line, i) => {
    batch.push(i === 0 ? line : `,${line}`);
    size += line.length;
    if (size > 1_000_000) {
      parts.push(batch.join(''));
      batch = [];
      size = 0;
    }
  });
  parts.push(batch.join(''), ']}');
  await atomicWriteFileParts(file, parts);
  const st = statKey(file);
  if (st) runsCache.set(cacheKey(root, chatId), { ...st, runs: kept });
  await new Promise<void>((res) => setImmediate(res));
  return true;
}

/* ── turns a restart cut off ────────────────────────────────────────────── */

/** Turn ids that have a live runtime in this process (agentTurnRuntime.ts adds and removes them). */
export const liveTurnIds = new Set<string>();

/**
 * The chat's interrupted turn: its newest record is still `running`, no
 * runtime in this process owns it, and no OTHER live server process wrote it
 * (the app was closed or killed mid-turn, so it never got a stop reason).
 * Null when the chat ended cleanly. Only the newest turn counts; an older
 * cut-off turn was followed by another ask.
 */
export function interruptedRun(runs: readonly StoredAgentRun[], live: ReadonlySet<string> = liveTurnIds): StoredAgentRun | null {
  const last = runs[runs.length - 1];
  return last && last.status === 'running' && !live.has(last.id) && !ownedByOtherLiveProcess(last.owner) ? last : null;
}

/** A run as the page reads it: a cut-off turn says `interrupted`, never `running`; only the newest is `continuable`. A turn live in this or another process stays `running`. */
export type WireAgentRun = Omit<StoredAgentRun, 'status'> & { status: StoredAgentRun['status'] | 'interrupted'; continuable?: true };
export function runsForWire(runs: readonly StoredAgentRun[], live: ReadonlySet<string> = liveTurnIds): WireAgentRun[] {
  const cut = interruptedRun(runs, live);
  return runs.map((r) => {
    if (r.status !== 'running' || live.has(r.id) || ownedByOtherLiveProcess(r.owner)) return r;
    return r === cut ? { ...r, status: 'interrupted' as const, continuable: true as const } : { ...r, status: 'interrupted' as const };
  });
}

/** Chats of the project whose last turn was cut off, from the session index alone (no chat file is opened). */
export function listInterruptedChats(root: string, live: ReadonlySet<string> = liveTurnIds): { chatId: string; runId: string }[] {
  const index = readSessionIndex(root);
  if (!index) return [];
  const out: { chatId: string; runId: string }[] = [];
  for (const s of index.sessions) {
    const t = s.runningTurn;
    if (t && !live.has(t.id) && !ownedByOtherLiveProcess({ pid: t.pid, boot: t.boot })) out.push({ chatId: s.id, runId: t.id });
  }
  return out;
}

/* ── titles ─────────────────────────────────────────────────────────────── */

const SAYS_NOTHING = /^(?:hi|hey|hello|yo|sup|test(?:ing)?|ok(?:ay)?|thanks?|thank you|ping|hm+|continue|go|go on|yes|no)\b[\s!.?]*$/i;
const ID_DERIVED = /^session[ -]\d+[\w-]*$/i;

/** One line of an answer, without Markdown's marks. */
function plainLine(answer: string): string {
  const heading = /^#{1,4}\s+(.+?)\s*#*\s*$/m.exec(answer)?.[1];
  const line = heading ?? answer.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('```')) ?? '';
  const plain = line
    .replace(/^[-*>\d.)\s]+/, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
  if (heading) return plain;
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.replace(/[.!?]+$/, '');
}

/** A short title from the first exchange. Empty when there is nothing to name it by. */
export function agentChatTitle(prompt: string, answer: string): string {
  const asked = prompt.trim();
  const words = asked.split(/\s+/).filter(Boolean);
  const vague = !asked || SAYS_NOTHING.test(asked) || (words.length < 3 && asked.length < 12);
  if (!vague) return summarizeSessionTitle(asked);
  const said = plainLine(answer);
  if (said) return summarizeSessionTitle(said);
  return asked ? summarizeSessionTitle(asked) : '';
}

/**
 * Name the chat from its first agent exchange, once, unless a person named it
 * or something already did. Returns the title written, or null for none.
 */
export function titleChatFromAgent(root: string, chatId: string, prompt: string, answer: string): string | null {
  const index = chatExists(root, chatId);
  if (!index) return null;
  const entry = index.sessions.find((s) => s.id === chatId)!;
  if (entry.titleEdited || entry.titleGenerated) return null;
  const current = (entry.title ?? '').trim();
  if (current && current !== UNTITLED_CHAT && !ID_DERIVED.test(current)) return null;
  const title = agentChatTitle(prompt, answer).slice(0, 120);
  if (!title || title === UNTITLED_CHAT) return null;
  writeJson(root, SESSIONS_INDEX_FILE, {
    ...index,
    sessions: index.sessions.map((s) => (s.id === chatId ? { ...s, title, titleGenerated: true } : s)),
  }, { compact: true });
  return title;
}

/* ── the turn log ───────────────────────────────────────────────────────── */

function logPath(root: string, chatId: string | null, userConfigDir: string): string {
  return chatId ? path.join(root, SEQUENCE_DIR, rel(chatId, LOG_LEAF)) : path.join(userConfigDir, 'logs', LOG_LEAF);
}

/** Append one turn's record. A chat that is not in the index logs to the user store. Never throws. */
export function appendTurnLog(root: string | null, chatId: string | null, userConfigDir: string, record: object): void {
  try {
    const known = root && chatId && chatExists(root, chatId) ? chatId : null;
    const file = logPath(root ?? userConfigDir, known, userConfigDir);
    /* The log is a diagnostic trail, not something a person was told is saved: it goes behind the debounced writer. */
    scheduleAppend(file, JSON.stringify(record), MAX_LOG_BYTES);
  } catch {
    /* A log that cannot be written must never fail the turn it describes. */
  }
}

/** The newest `limit` turn records for a chat, oldest first. */
export function readTurnLog(root: string, chatId: string, userConfigDir: string, limit = 20): unknown[] {
  if (!chatExists(root, chatId)) return [];
  try {
    const file = logPath(root, chatId, userConfigDir);
    flushWritesSync(file);
    const text = fs.readFileSync(file, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as unknown;
        } catch {
          return null;
        }
      })
      .filter((x) => x !== null);
  } catch {
    return [];
  }
}

const BACKUP_LEAF = 'agent-runs.before-rewind.json';

export function dropRewindBackup(root: string, chatId: string): void {
  try {
    fs.rmSync(path.join(root, SEQUENCE_DIR, rel(chatId, BACKUP_LEAF)), { force: true });
  } catch {
    /* nothing to drop */
  }
}

/**
 * The chat's newest turn is running in ANOTHER live server process on this folder (a second Sequence window).
 * This process cannot stop it, and its next progress write would put the cut turn back, so an edit waits.
 */
export function runOwnedElsewhere(root: string, chatId: string): boolean {
  const last = readAgentRuns(root, chatId, { withCompactions: true }).at(-1);
  return !!last && last.status === 'running' && !liveTurnIds.has(last.id) && ownedByOtherLiveProcess(last.owner);
}

/**
 * After an edit or an undo the session index must agree with the turns that stand: its `runningTurn` (what the
 * rail's "Interrupted by a restart" dot reads) follows the newest turn, running or not. The chat is not moved on the rail.
 */
function syncRunningTurn(root: string, chatId: string, runs: readonly StoredAgentRun[]): void {
  const index = chatExists(root, chatId);
  if (!index) return;
  const last = runs[runs.length - 1];
  const want = last && last.status === 'running' ? { id: last.id, ...(last.owner ?? ownerNow()) } : undefined;
  const entry = index.sessions.find((s) => s.id === chatId);
  if (!entry || entry.runningTurn?.id === want?.id) return;
  writeJson(root, SESSIONS_INDEX_FILE, {
    ...index,
    sessions: index.sessions.map((s) => {
      if (s.id !== chatId) return s;
      const { runningTurn: _held, ...rest } = s;
      return want ? { ...rest, runningTurn: want } : rest;
    }),
  }, { compact: true });
}

/**
 * Edit from here: forget the turn `fromTurnId` and every turn after it, found
 * by the server's own turn id (never a position the page counted). The list
 * before the cut is kept until the next turn is recorded, so the edit can be
 * undone (`restoreRewound`). Null when the chat or the turn is unknown, or when a turn of the chat runs in another server process.
 * Compaction turns are in `dropped` (they are turns in the provider's thread)
 * and in no `kept` list a person reads.
 */
export function truncateAgentRunsAt(root: string, chatId: string, fromTurnId: string | null): { kept: StoredAgentRun[]; dropped: StoredAgentRun[] } | null {
  if (!chatExists(root, chatId)) return null;
  if (runOwnedElsewhere(root, chatId)) return null;
  let all = readAgentRuns(root, chatId, { withCompactions: true });
  let at = fromTurnId === null ? all.length : all.findIndex((r) => r.id === fromTurnId);
  /* A turn "Show older turns" loaded lives in the archive: the cut is made across archive and main file together. */
  let acrossArchive = false;
  if (at < 0 && fromTurnId !== null) {
    const older = readArchiveRuns(root, chatId);
    const inArchive = older.findIndex((r) => r.id === fromTurnId);
    if (inArchive < 0) return null;
    all = [...older, ...all];
    at = inArchive;
    acrossArchive = true;
  }
  const kept = all.slice(0, at);
  const dropped = all.slice(at);
  if (dropped.length > 0) {
    writeJson(root, rel(chatId, BACKUP_LEAF), { version: 1, runs: all, ...(acrossArchive ? { withArchive: true } : {}) });
    if (acrossArchive) resetArchive(root, chatId);
    commitRuns(root, chatId, kept);
    /* What stood in memory after a failed write is now in the file (kept) or cut: it must not come back on the next read. */
    unsaved.delete(cacheKey(root, chatId));
    syncRunningTurn(root, chatId, kept);
  }
  return { kept: kept.filter((r) => !r.compact), dropped };
}

/** Put back the turns the last edit cut, if no turn has been recorded since. */
export function restoreRewound(root: string, chatId: string): StoredAgentRun[] | null {
  if (!chatExists(root, chatId)) return null;
  try {
    const raw = readJson<{ runs?: unknown; withArchive?: unknown }>(root, rel(chatId, BACKUP_LEAF));
    const runs = Array.isArray(raw?.runs) ? raw.runs.map(cleanRun).filter((r): r is StoredAgentRun => r !== null) : null;
    if (!runs) return null;
    /* A cut made across the archive saved both halves: write both back. */
    if (raw?.withArchive === true) resetArchive(root, chatId);
    commitRuns(root, chatId, runs);
    unsaved.delete(cacheKey(root, chatId));
    syncRunningTurn(root, chatId, runs.slice().sort((a, b) => a.startedAt - b.startedAt));
    dropRewindBackup(root, chatId);
    return runs.filter((r) => !r.compact);
  } catch {
    return null;
  }
}

export function hasRewindBackup(root: string, chatId: string): boolean {
  return fs.existsSync(path.join(root, SEQUENCE_DIR, rel(chatId, BACKUP_LEAF)));
}
