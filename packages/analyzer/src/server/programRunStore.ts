/**
 * P8 — the DURABLE half of server-side program runs.
 *
 * A run lives at `<repo>/.sequence/program-runs/<runId>/`:
 *
 *   run.json      the {@link ProgramRunRecord} — rewritten atomically at every
 *                 status transition. The program AS SUBMITTED is stored inside
 *                 it, so reading a run needs no client and no second lookup.
 *   events.jsonl  the append-only log. One JSON object per line; the line's
 *                 1-based ordinal IS the event's `seq`, and `seq` IS the SSE
 *                 `id:`.
 *
 * WHY A LOG AND NOT JUST A RECORD — the argument is adopted from
 * `docs/research/ml-harness-adoption.md` §1.1 rather than invented here. Commit
 * every event to a durable, id-numbered log BEFORE yielding it, make the row id
 * the SSE event id, and replay from `since=`; then a reconnect is exact **by
 * construction rather than by timing**. There is no window in which an event
 * exists for a live subscriber but not for a reconnecting one, because the write
 * happens first. Sequence's ask stream writes `data:` with no `id:` line at all
 * (`repoServer.ts`'s `writeSseEvent`), which is precisely why a blip there loses
 * the turn.
 *
 * WHY `.sequence/program-runs/` AND NOT `.sequence/runs/` — `.sequence/runs/`
 * already holds `results.tsv`, the harness's append-only EXPERIMENT log written
 * by `POST /api/program/run-log`. Two different append-only logs under one
 * directory name is the sort of collision that reads fine and then deletes
 * someone's data during a cleanup; they get separate roots.
 *
 * WHY THE DIRECTORY IS THE LIST — there is no `index.json`. `listRuns` reads the
 * directory. An index would be a second statement of what runs exist, free to
 * disagree with the directory that actually holds them, and this repo has
 * already paid for one "two answers to the same question" design (the two web
 * stores). A local run count is small; a readdir is cheap; a drifting index is
 * not.
 *
 * NOTHING IN THIS FILE EXECUTES ANYTHING. It is fs + JSON. The scheduler, the
 * executors and the process-lifetime bookkeeping live in `programRunner.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ProgramRunEvent, ProgramRunRecord } from '@sequence/api-types';
import { SEQUENCE_DIR } from './store.js';

/** The program-run root under `.sequence/`. */
export const PROGRAM_RUNS_DIR = 'program-runs';

/** The record file inside one run's directory. */
export const RUN_RECORD_FILE = 'run.json';

/** The append-only event log inside one run's directory. */
export const RUN_EVENTS_FILE = 'events.jsonl';

/**
 * A run id is `run-<epochMs base36>-<8 hex>`.
 *
 * Time-prefixed so a directory listing sorts roughly chronologically without
 * opening every record, and random-suffixed so two runs started in the same
 * millisecond cannot collide. The character set is deliberately narrow — a run
 * id arrives from a URL path segment, and {@link isRunId} is what stops
 * `../../etc` from ever reaching `path.join`.
 */
export function newRunId(now: number = Date.now()): string {
  return `run-${now.toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Is this a run id THIS module would have minted?
 *
 * The check is a whitelist, not a blacklist of traversal sequences: `.` and `/`
 * and `\` are simply not in the alphabet, so there is no encoding of a parent
 * directory that survives it. Every route that takes a `:runId` calls this
 * before touching the filesystem.
 */
export function isRunId(value: string): boolean {
  return /^run-[0-9a-z]+-[0-9a-f]{8}$/.test(value);
}

function runsRoot(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, PROGRAM_RUNS_DIR);
}

function runDir(repoRoot: string, runId: string): string {
  if (!isRunId(runId)) throw new Error(`refusing to resolve a path for a non-run id: ${runId}`);
  return path.join(runsRoot(repoRoot), runId);
}

/**
 * Write JSON via a temp file + rename.
 *
 * `run.json` is rewritten on every transition while a reader may be fetching it.
 * A plain `writeFileSync` truncates first, so a concurrent read has a real window
 * in which it sees an empty or half-written file and reports the run as
 * unreadable. Rename is atomic within a directory on both POSIX and Windows
 * (`fs.renameSync` maps to MoveFileEx with replace), so a reader sees either the
 * whole previous record or the whole next one.
 */
function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** Create the run's directory. Idempotent. */
export function ensureRunDir(repoRoot: string, runId: string): string {
  const dir = runDir(repoRoot, runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Persist the record. Atomic; safe to call on every transition. */
export function writeRunRecord(repoRoot: string, record: ProgramRunRecord): void {
  writeJsonAtomic(path.join(runDir(repoRoot, record.runId), RUN_RECORD_FILE), record);
}

/**
 * Read one run's record. `undefined` when the run does not exist OR its record
 * is unreadable.
 *
 * The two are folded together on purpose: from a caller's seat both mean "this
 * server cannot tell you about that run", and the alternative — reporting a
 * placeholder record assembled from the directory name — would be inventing a
 * run's contents from its filename.
 */
export function readRunRecord(repoRoot: string, runId: string): ProgramRunRecord | undefined {
  if (!isRunId(runId)) return undefined;
  const file = path.join(runDir(repoRoot, runId), RUN_RECORD_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as ProgramRunRecord;
  } catch {
    return undefined;
  }
}

/**
 * Every run recorded for this repo, newest `startedAt` first.
 *
 * A directory whose record will not parse is SKIPPED rather than surfaced as a
 * half-run: a row in a run list is a claim that the server knows what that run
 * was, and it does not.
 */
export function listRunRecords(repoRoot: string): ProgramRunRecord[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsRoot(repoRoot), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ProgramRunRecord[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isRunId(e.name)) continue;
    const rec = readRunRecord(repoRoot, e.name);
    if (rec) out.push(rec);
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/**
 * Read committed events with `seq > since`, oldest first.
 *
 * A trailing partial line (a process killed mid-append) is dropped rather than
 * parsed, and a mid-file unparseable line is skipped. Neither is fabricated into
 * a placeholder event, because an event row is a statement that something
 * happened and this reader does not know what.
 */
export function readRunEvents(repoRoot: string, runId: string, since = 0): ProgramRunEvent[] {
  if (!isRunId(runId)) return [];
  let text: string;
  try {
    text = fs.readFileSync(path.join(runDir(repoRoot, runId), RUN_EVENTS_FILE), 'utf8');
  } catch {
    return [];
  }
  const out: ProgramRunEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: ProgramRunEvent;
    try {
      evt = JSON.parse(trimmed) as ProgramRunEvent;
    } catch {
      continue;
    }
    if (typeof evt.seq === 'number' && evt.seq > since) out.push(evt);
  }
  return out;
}

/** The highest `seq` on disk for a run; 0 when the log is empty or absent. */
export function lastCommittedSeq(repoRoot: string, runId: string): number {
  const events = readRunEvents(repoRoot, runId, 0);
  return events.length > 0 ? events[events.length - 1].seq : 0;
}

/**
 * `Omit` that DISTRIBUTES over a union.
 *
 * A plain `Omit<ProgramRunEvent, 'seq'|'at'>` collapses the five event variants
 * into their common keys, which would let `{type:'run:finished'}` be appended
 * with a `nodeId` and no `status` and typecheck. Distributing keeps each variant
 * whole and keeps the discriminated union discriminating.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event as the caller supplies it — the log assigns `seq` and `at`. */
export type ProgramRunEventInput = DistributiveOmit<ProgramRunEvent, 'seq' | 'at'>;

/** An open append-only log for exactly one run. */
export interface RunLog {
  /**
   * Commit one event. Returns the committed row, `seq` assigned.
   *
   * The write lands on disk BEFORE this function returns, which is what makes
   * "commit before yield" enforceable at the call site: a caller that notifies
   * subscribers with the returned value cannot notify anyone about an event that
   * is not durable, because it does not have the value until the write is done.
   */
  append(input: ProgramRunEventInput): ProgramRunEvent;
  /** The highest `seq` this log has committed. */
  lastSeq(): number;
}

/**
 * Open (or create) a run's log.
 *
 * The counter is seeded from the FILE, not from a caller's memory, so a log
 * reopened after a restart continues the sequence instead of restarting it and
 * silently producing two events with the same id — which would break replay in
 * the one way replay exists to prevent. Within a process, one `RunLog` owns one
 * run's file: runs are keyed by a fresh id per start, so there is never a second
 * writer for the same log.
 */
export function openRunLog(
  repoRoot: string,
  runId: string,
  now: () => number = Date.now,
): RunLog {
  ensureRunDir(repoRoot, runId);
  const file = path.join(runDir(repoRoot, runId), RUN_EVENTS_FILE);
  let seq = lastCommittedSeq(repoRoot, runId);
  return {
    append(input: ProgramRunEventInput): ProgramRunEvent {
      seq += 1;
      const event = { ...input, seq, at: now() } as ProgramRunEvent;
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
      return event;
    },
    lastSeq: () => seq,
  };
}
