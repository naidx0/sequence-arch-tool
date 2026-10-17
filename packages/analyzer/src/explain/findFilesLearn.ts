/**
 * find_files learns from the files the agent actually changed.
 *
 * THE LABEL. Every find_files call is logged with its candidates' feature rows
 * (the ~50 best by the model's own score) and a baseline: HEAD and the hash of
 * each file that was already dirty. Once the call is old enough (30 minutes by
 * default) the files that differ from that baseline NOW (committed since, or
 * still edited in the working tree, so an edit the user reverted does not
 * count) are its label: "which files the agent changed after the query". One to
 * eight files make a labelled query, the same truth rule the sealed studies use.
 *
 * THE UPDATE. With 30 labelled queries (and 10 new since the last try) the
 * ranker continues boosting from the frozen model on the older 80% of them and
 * is scored on the newest 20% against the frozen model. It replaces the frozen
 * model for this repo only if it is no worse on hit@5 and hit@1 and better on
 * one of them; otherwise the attempt is recorded and the frozen model stays.
 * What ships is a short list of residual trees in `model.json`; deleting the
 * file is the rollback.
 *
 * BACKGROUND. Maturing and training run after the index's LTR stage is ready,
 * never while a build is running, and the trainer yields to the event loop
 * after every round. Nothing here is awaited by a find_files call.
 *
 * FILES, under `<repo>/.sequence/findfiles/` (kept out of `git status` by
 * ensureSequenceIgnored): queries.jsonl, labels.jsonl, model.json, attempts.jsonl.
 * Nothing leaves the machine.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AskFileIndex } from './askFileIndex.js';
import { ASK_LTR_FEATURES, askLtrModel } from './askLtr.js';
import { ASK_LTR_MODEL_TEXT } from './askLtrModel.generated.js';
import { ensureSequenceIgnored } from '../server/snapshot.js';
import { hitAtK, trainResidualTrees, treesFromJson, treesToJson, withResidualTrees, type LtrExample, type LtrTrainOptions } from './ltrTrain.js';
import type { LightGbmModel } from './lightgbm.js';

const execFileAsync = promisify(execFile);

/** Candidates kept per logged query. */
export const FIND_FILES_LOG_CANDIDATES = 50;
export const FIND_FILES_MIN_LABELS = 30;
export const FIND_FILES_MIN_NEW_LABELS = 10;
export const FIND_FILES_HOLDOUT = 0.2;
export const FIND_FILES_MAX_RECORDS = 400;
const MATURE_MS_DEFAULT = 30 * 60_000;
const STALE_MS = 6 * 60 * 60_000;
const MAX_DIRTY_HASHED = 50;

interface QueryRecord {
  id: string;
  ts: number;
  /** The checkout the query was asked in (the main checkout and its chat worktrees share one store). Absent in records from before it was kept: the store's own checkout. */
  root?: string;
  q: string;
  head: string | null;
  dirty: Record<string, string>;
  cands: string[];
  rows: number[][];
}
interface LabelRecord {
  id: string;
  at: number;
  files: string[];
  stale?: boolean;
}
export interface RetrainReport {
  at: number;
  labelled: number;
  train: number;
  held: number;
  base: { hit5: number; hit1: number };
  next: { hit5: number; hit1: number };
  trees: number;
  deployed: boolean;
  reason: string;
}

export interface FindFilesLearner {
  /** The model find_files ranks with: frozen, or frozen + this repo's residual trees. */
  currentModel(): { model: LightGbmModel; kind: 'frozen' | 'repo' };
  /** Log one answered call (candidates in ranked order). Returns at once; the baseline is read behind it. */
  recordQuery(q: string, r: { cands: string[]; rows: number[][] }): void;
  /** The index's LTR stage is ready: schedule maturing and training. */
  onIndexReady(index: AskFileIndex): void;
  /** Label every mature query now (tests, benchmarks). Returns how many got a label. */
  matureNow(now?: number): Promise<number>;
  /** Train now if enough labels exist (tests, benchmarks). Null when it did not try. */
  retrainNow(opts?: LtrTrainOptions & { minLabels?: number; minNew?: number }): Promise<RetrainReport | null>;
  /** Wait for in-flight background work (tests). */
  idle(): Promise<void>;
}

/** The frozen model a model.json must have been trained on (tests write files against it). */
export const findFilesModelBaseId = (): string => baseId();
const baseId = (): string => `${ASK_LTR_FEATURES.length}:${ASK_LTR_MODEL_TEXT.length}:${ASK_LTR_MODEL_TEXT.slice(-64).replace(/\s+/g, '')}`;
const round6 = (n: number): number => (Number.isFinite(n) ? Number(n.toPrecision(6)) : 0);

async function git(root: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', '-C', root, ...args], { windowsHide: true, maxBuffer: 1 << 26 });
    return stdout;
  } catch {
    return null;
  }
}

/** The blob hash of each file that exists, ONE git process per 50 files (a process per file made a query's snapshot cost as many spawns as the tree has uncommitted files). Unreadable files are left out. */
async function hashFiles(root: string, names: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const present = names.filter((n) => fs.existsSync(path.join(root, n)));
  for (let i = 0; i < present.length; i += 50) {
    const chunk = present.slice(i, i + 50);
    const text = await git(root, 'hash-object', '--', ...chunk);
    const lines = text === null ? [] : text.split('\n').filter((l) => l.length > 0);
    if (lines.length === chunk.length) chunk.forEach((n, k) => (out[n] = lines[k]!.trim()));
    else {
      for (const n of chunk) {
        const h = await git(root, 'hash-object', '--', n);
        if (h) out[n] = h.trim();
      }
    }
  }
  return out;
}

function readJsonl<T>(file: string): T[] {
  try {
    const out: T[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        /* a torn last line (a crash mid-append) is skipped, not fatal */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export interface LearnerDeps {
  /** Where the learning files live: the main checkout when `root` is a linked worktree (a chat worktree is deleted; what it taught must outlive it). Default `root`. */
  storeRoot?: string;
  /** True while the index is building: maintenance waits. */
  busy?: () => boolean;
  /** Minimum age before a query is labelled (tests shorten it; env SEQUENCE_FIND_FILES_MATURE_MS too). */
  matureMs?: number;
  /** Delay before background maintenance starts after the index is ready or a query is logged. */
  maintainDelayMs?: number;
}

export function createFindFilesLearner(root: string, deps: LearnerDeps = {}): FindFilesLearner {
  const storeRoot = deps.storeRoot ?? root;
  const dir = path.join(storeRoot, '.sequence', 'findfiles');
  const files = { q: path.join(dir, 'queries.jsonl'), l: path.join(dir, 'labels.jsonl'), m: path.join(dir, 'model.json'), a: path.join(dir, 'attempts.jsonl'), lock: path.join(dir, 'retrain.lock') };
  const matureMs = deps.matureMs ?? (Number(process.env.SEQUENCE_FIND_FILES_MATURE_MS) || MATURE_MS_DEFAULT);
  const delay = deps.maintainDelayMs ?? 5_000;
  const disabled = (): boolean => process.env.SEQUENCE_FIND_FILES_LEARN === '0';
  let enabled: boolean | undefined;
  let inflight: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cached: { model: LightGbmModel; kind: 'frozen' | 'repo'; checkedAt: number; mtime: number } | undefined;
  let seq = 0;

  const ensureDir = (): boolean => {
    if (enabled === undefined) enabled = fs.existsSync(path.join(storeRoot, '.git'));
    if (!enabled) return false;
    try {
      if (!fs.existsSync(dir)) {
        ensureSequenceIgnored(storeRoot);
        fs.mkdirSync(dir, { recursive: true });
      }
      return true;
    } catch {
      enabled = false;
      return false;
    }
  };

  const loadModel = (): { model: LightGbmModel; kind: 'frozen' | 'repo' } => {
    const base = askLtrModel();
    try {
      const st = fs.statSync(files.m);
      const j = JSON.parse(fs.readFileSync(files.m, 'utf8')) as { v?: number; base?: string; trees?: unknown };
      if (j.v === 1 && j.base === baseId()) {
        const trees = treesFromJson(j.trees, base.featureNames.length);
        if (trees && trees.length > 0) {
          cached = { model: withResidualTrees(base, trees), kind: 'repo', checkedAt: Date.now(), mtime: st.mtimeMs };
          return cached;
        }
      }
    } catch {
      /* no model.json, or an unreadable one: frozen */
    }
    cached = { model: base, kind: 'frozen', checkedAt: Date.now(), mtime: 0 };
    return cached;
  };

  const currentModel: FindFilesLearner['currentModel'] = () => {
    if (disabled()) return { model: askLtrModel(), kind: 'frozen' };
    if (!cached) return loadModel();
    /* Another session may have trained: look again at most every 30 s. */
    if (Date.now() - cached.checkedAt > 30_000) {
      let m = 0;
      try {
        m = fs.statSync(files.m).mtimeMs;
      } catch {
        /* none */
      }
      if (m !== cached.mtime) return loadModel();
      cached.checkedAt = Date.now();
    }
    return cached;
  };

  const recordQuery: FindFilesLearner['recordQuery'] = (q, r) => {
    if (disabled() || !ensureDir()) return;
    const ts = Date.now();
    const id = `${ts.toString(36)}-${process.pid.toString(36)}-${(seq++).toString(36)}`;
    const cands = r.cands.slice(0, FIND_FILES_LOG_CANDIDATES);
    const rows = r.rows.slice(0, FIND_FILES_LOG_CANDIDATES).map((row) => row.map(round6));
    inflight = inflight.then(async () => {
      try {
        const head = (await git(root, 'rev-parse', 'HEAD'))?.trim() ?? null;
        const dirty: Record<string, string> = {};
        const st = await git(root, 'status', '--porcelain', '-z', '--untracked-files=no');
        if (st) {
          const names = st.split('\0').filter((l) => l.length > 3).map((l) => l.slice(3)).slice(0, MAX_DIRTY_HASHED);
          Object.assign(dirty, await hashFiles(root, names));
        }
        const rec: QueryRecord = { id, ts, root: path.resolve(root), q: q.slice(0, 200), head, dirty, cands, rows };
        fs.appendFileSync(files.q, `${JSON.stringify(rec)}\n`);
        compact();
      } catch {
        /* logging must never fail a call */
      }
    });
    schedule();
  };

  /** Keep the newest FIND_FILES_MAX_RECORDS queries (and their labels). */
  const compact = (): void => {
    try {
      const st = fs.statSync(files.q);
      if (st.size < 8_000_000) return;
      const recs = readJsonl<QueryRecord>(files.q).slice(-FIND_FILES_MAX_RECORDS);
      const keep = new Set(recs.map((r) => r.id));
      writeAtomic(files.q, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const labs = readJsonl<LabelRecord>(files.l).filter((l) => keep.has(l.id));
      writeAtomic(files.l, labs.map((l) => JSON.stringify(l)).join('\n') + (labs.length ? '\n' : ''));
    } catch {
      /* compaction is best effort */
    }
  };

  const matureNow: FindFilesLearner['matureNow'] = async (now = Date.now()) => {
    if (!ensureDirExists()) return 0;
    const labelled = new Set(readJsonl<LabelRecord>(files.l).map((l) => l.id));
    /* Only this checkout's queries: a chat worktree's edits are not the main checkout's, nor another chat's. */
    const mine = path.resolve(root);
    const open = readJsonl<QueryRecord>(files.q).filter((r) => !labelled.has(r.id) && now - r.ts >= matureMs);
    const pending = open.filter((r) => (r.root ?? path.resolve(storeRoot)) === mine);
    /* A removed chat worktree's queries can never be labelled: close them. */
    for (const r of open) if (r.root && r.root !== mine && !fs.existsSync(r.root)) fs.appendFileSync(files.l, `${JSON.stringify({ id: r.id, at: now, files: [], stale: true } satisfies LabelRecord)}\n`);
    let n = 0;
    for (const rec of pending) {
      let changed: string[] = [];
      if (now - rec.ts > STALE_MS || !rec.head) {
        fs.appendFileSync(files.l, `${JSON.stringify({ id: rec.id, at: now, files: [], stale: true } satisfies LabelRecord)}\n`);
        continue;
      }
      const out = await git(root, 'diff', '--name-only', '-z', rec.head);
      if (out === null) continue;
      const touched = out.split('\0').filter((f) => f && fs.existsSync(path.join(root, f)));
      const nowHash = await hashFiles(root, touched.filter((f) => rec.dirty[f] !== undefined));
      for (const f of touched) {
        const was = rec.dirty[f];
        if (was !== undefined && nowHash[f] === was) continue;
        changed.push(f);
      }
      const inCands = new Set(rec.cands);
      changed = changed.filter((f) => inCands.has(f));
      fs.appendFileSync(files.l, `${JSON.stringify({ id: rec.id, at: now, files: changed } satisfies LabelRecord)}\n`);
      if (changed.length > 0) n++;
    }
    return n;
  };
  const ensureDirExists = (): boolean => !disabled() && fs.existsSync(files.q);

  const examples = (): { ex: LtrExample; ts: number }[] => {
    const recs = new Map(readJsonl<QueryRecord>(files.q).map((r) => [r.id, r]));
    const out: { ex: LtrExample; ts: number }[] = [];
    for (const l of readJsonl<LabelRecord>(files.l)) {
      const r = recs.get(l.id);
      if (!r || l.files.length < 1 || l.files.length > 8) continue;
      const want = new Set(l.files);
      const labels = r.cands.map((c) => (want.has(c) ? 1 : 0));
      if (!labels.some((x) => x > 0)) continue;
      out.push({ ex: { rows: r.rows, labels }, ts: r.ts });
    }
    return out.sort((a, b) => a.ts - b.ts);
  };

  const retrainNow: FindFilesLearner['retrainNow'] = async (opts = {}) => {
    if (!ensureDirExists()) return null;
    const minLabels = opts.minLabels ?? FIND_FILES_MIN_LABELS;
    const minNew = opts.minNew ?? FIND_FILES_MIN_NEW_LABELS;
    const all = examples();
    const prev = readJsonl<RetrainReport>(files.a);
    const lastN = prev.length ? prev[prev.length - 1]!.labelled : 0;
    if (all.length < minLabels || all.length - lastN < minNew) return null;
    /* One trainer at a time across sessions. */
    let fd: number;
    try {
      try {
        if (Date.now() - fs.statSync(files.lock).mtimeMs > 10 * 60_000) fs.unlinkSync(files.lock);
      } catch {
        /* no lock */
      }
      fd = fs.openSync(files.lock, 'wx');
    } catch {
      return null;
    }
    try {
      const nHeld = Math.max(6, Math.round(all.length * FIND_FILES_HOLDOUT));
      const train = all.slice(0, all.length - nHeld).map((x) => x.ex);
      const held = all.slice(all.length - nHeld).map((x) => x.ex);
      const base = askLtrModel();
      const trees = await trainResidualTrees(base, train, { yieldNow: () => new Promise((r) => setImmediate(r)), ...opts });
      const next = withResidualTrees(base, trees);
      const score = (m: LightGbmModel, k: number): number => held.reduce((s, e) => s + (hitAtK(m, e, k) ?? 0), 0) / held.length;
      const b5 = score(base, 5), b1 = score(base, 1), n5 = score(next, 5), n1 = score(next, 1);
      const deployed = trees.length > 0 && n5 >= b5 && n1 >= b1 && (n5 > b5 || n1 > b1);
      const report: RetrainReport = {
        at: Date.now(),
        labelled: all.length,
        train: train.length,
        held: held.length,
        base: { hit5: b5, hit1: b1 },
        next: { hit5: n5, hit1: n1 },
        trees: trees.length,
        deployed,
        reason: trees.length === 0 ? 'no trainable queries' : deployed ? 'no worse on the newest 20% and better on one of hit@5 / hit@1' : 'not better than the frozen model on the newest 20%; frozen model kept',
      };
      fs.appendFileSync(files.a, `${JSON.stringify(report)}\n`);
      if (deployed) {
        writeAtomic(files.m, JSON.stringify({ v: 1, base: baseId(), at: report.at, trainedOn: train.length, trees: treesToJson(trees) }));
        cached = undefined;
      }
      return report;
    } finally {
      try {
        fs.closeSync(fd);
        fs.unlinkSync(files.lock);
      } catch {
        /* a stale lock expires after 10 minutes */
      }
    }
  };

  let ready = false;
  const maintain = async (): Promise<void> => {
    if (disabled() || !ready || deps.busy?.()) return;
    try {
      await matureNow();
      await retrainNow();
    } catch {
      /* maintenance never surfaces */
    }
  };
  function schedule(): void {
    if (disabled() || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      inflight = inflight.then(maintain);
    }, delay);
    timer.unref?.();
  }

  return {
    currentModel,
    recordQuery,
    onIndexReady: () => {
      ready = true;
      schedule();
    },
    matureNow,
    retrainNow,
    idle: async () => {
      await inflight;
    },
  };
}
