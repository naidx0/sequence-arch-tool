/* ══════════════════════════════════════════════════════════════════════════
   WORKFLOWS — saved block workflows, one file each
   packages/analyzer/src/workflows/workflowStore.ts

   Round 13 (A8). A workflow is an ordered list of ready-made blocks
   (`@sequence/schema` workflowBlocks.ts) that compiles to the Program the
   scheduler runs:

     <root>/.sequence/workflows/<id>.json

   Shared by the app server (`workflowsRoutes.ts`) and the MCP server, which runs
   in ANOTHER process: that is how "ask an agent in chat to edit the workflow
   graph" reaches the open tab. Every write is a list of OPS applied to the file
   as it is on disk now (read, apply, write to a temp file, rename), never a
   whole document from memory, so a person's drag and an agent's edit land a
   second apart without one erasing the other. The tab polls `rev`.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  BLOCK_KINDS,
  WorkflowEditError,
  applyWorkflowOps,
  freshWorkflowBlocks,
  type WorkflowBlock,
  type WorkflowDoc,
  type WorkflowOp,
} from '@sequence/schema';

import { realpathContained } from '../server/jail.js';

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export const WORKFLOW_CAPS = { workflows: 50, name: 80 } as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function workflowsDir(root: string): string {
  return path.join(root, '.sequence', 'workflows');
}

const now = (): string => new Date().toISOString();

/** Temp file then rename. The folder is made (and checked) by `workflowsFolder` first, never here. */
function writeAtomic(file: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* ── The lock ──────────────────────────────────────────────────────────────
   One writer at a time per workflow, across processes (the app server and the
   MCP server), and never by blocking a thread: the wait is an awaited timer.
   Inside one process writers queue on a promise chain; across processes the
   lock is a file `<id>.json.lock` holding {pid, startedAt, token}, created
   whole and at once (written to a unique temp name, then hard-linked into
   place, which fails if a lock is already there). A lock whose pid is gone,
   or older than LOCK_STALE_MS, is broken by renaming it to a unique name: only
   the process whose rename succeeds holds the stale file, and it checks that
   file is the one it judged stale (putting a fresh one back if not). A writer
   releases only a lock carrying its own token. */
export const LOCK_STALE_MS = 60_000;
/** A lock with no readable owner (an older build, or garbage) is broken after this long. */
const LOCK_UNREADABLE_MS = 1_000;
const LOCK_GIVE_UP_MS = 15_000;

interface LockOwner {
  pid: number;
  startedAt: number;
  token: string;
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readLock(lock: string): { owner: LockOwner | null; mtimeMs: number } | null {
  let text: string;
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(lock).mtimeMs;
    text = fs.readFileSync(lock, 'utf8');
  } catch {
    return null;
  }
  try {
    const o = JSON.parse(text) as Partial<LockOwner>;
    if (typeof o.pid === 'number' && typeof o.startedAt === 'number' && typeof o.token === 'string') return { owner: o as LockOwner, mtimeMs };
  } catch { /* unreadable */ }
  return { owner: null, mtimeMs };
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isStale(seen: { owner: LockOwner | null; mtimeMs: number }): boolean {
  if (!seen.owner) return Date.now() - seen.mtimeMs > LOCK_UNREADABLE_MS;
  return !pidAlive(seen.owner.pid) || Date.now() - seen.owner.startedAt > LOCK_STALE_MS;
}

function tryTake(lock: string, owner: LockOwner): boolean {
  const tmp = `${lock}.${owner.pid}.${owner.token}.new`;
  fs.writeFileSync(tmp, JSON.stringify(owner), { flag: 'wx' });
  try {
    fs.linkSync(tmp, lock);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return false;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Move the lock file aside to a unique name; the caller then owns that copy (or gets null if someone else moved it first). */
function moveAside(lock: string): string | null {
  const aside = `${lock}.${process.pid}.${randomUUID()}.old`;
  try {
    fs.renameSync(lock, aside);
    return aside;
  } catch {
    return null;
  }
}

/** Put a lock we moved aside by mistake back in place (unless someone has taken the lock since), then drop our copy. */
function putBack(lock: string, aside: string): void {
  try {
    fs.linkSync(aside, lock);
  } catch { /* the lock is taken again; that writer holds it */ }
  fs.rmSync(aside, { force: true });
}

function breakIfStale(lock: string): void {
  const seen = readLock(lock);
  if (!seen || !isStale(seen)) return;
  const aside = moveAside(lock);
  if (!aside) return; /* another process broke it first */
  const got = readLock(aside);
  const same = got && (seen.owner ? got.owner?.token === seen.owner.token : !got.owner && got.mtimeMs === seen.mtimeMs);
  if (same) fs.rmSync(aside, { force: true });
  else putBack(lock, aside);
}

function release(lock: string, token: string): void {
  const aside = moveAside(lock);
  if (!aside) return;
  if (readLock(aside)?.owner?.token === token) fs.rmSync(aside, { force: true });
  else putBack(lock, aside);
}

const queues = new Map<string, Promise<unknown>>();

async function withFileLock<T>(lock: string, fn: () => T): Promise<T> {
  const owner: LockOwner = { pid: process.pid, startedAt: Date.now(), token: randomUUID() };
  const t0 = Date.now();
  for (;;) {
    if (tryTake(lock, { ...owner, startedAt: Date.now() })) break;
    breakIfStale(lock);
    if (Date.now() - t0 > LOCK_GIVE_UP_MS) throw new WorkflowError('the workflow is busy, try again', 409);
    await pause(2 + Math.floor(Math.random() * 6));
  }
  try {
    return fn();
  } finally {
    release(lock, owner.token);
  }
}

/** Run `fn` holding the workflow's lock: queued behind this process's other writers, then the cross-process lock file. */
export function withLock<T>(file: string, fn: () => T): Promise<T> {
  const lock = `${file}.lock`;
  const prev = queues.get(lock) ?? Promise.resolve();
  const run = prev.then(() => withFileLock(lock, fn));
  const tail = run.catch(() => undefined);
  queues.set(lock, tail);
  void tail.then(() => {
    if (queues.get(lock) === tail) queues.delete(lock);
  });
  return run;
}

/* ── The folder ────────────────────────────────────────────────────────────
   `.sequence` and `.sequence/workflows` must be real folders inside the
   project. Each level is checked before anything is made in it: lstat (a
   symlink is refused), then made one level at a time, then its real path must
   be exactly where it should be under the project's real path. */
function workflowsFolder(root: string, create: boolean): string | null {
  const rootReal = realpathContained(path.resolve(root));
  let at = path.resolve(root);
  let want = rootReal;
  for (const seg of ['.sequence', 'workflows']) {
    at = path.join(at, seg);
    want = path.join(want, seg);
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(at);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (!st) {
      if (!create) return null;
      try {
        fs.mkdirSync(at);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      st = fs.lstatSync(at);
    }
    const rel = seg === '.sequence' ? '.sequence' : '.sequence/workflows';
    if (st.isSymbolicLink()) throw new WorkflowError(`${rel} is a symbolic link, which is not followed`, 403);
    if (!st.isDirectory()) throw new WorkflowError(`${rel} is not a folder`, 403);
    if (realpathContained(at) !== want) throw new WorkflowError(`${rel} resolves outside the project`, 403);
  }
  return at;
}

/** A file on disk, read defensively: a hand-edited file keeps what is valid and drops the rest. */
function parseDoc(id: string, raw: unknown): WorkflowDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<WorkflowDoc>;
  if (!Array.isArray(o.blocks)) return null;
  const blocks: WorkflowBlock[] = [];
  for (const b of o.blocks) {
    if (!b || typeof b !== 'object') continue;
    const x = b as Partial<WorkflowBlock>;
    if (typeof x.id !== 'string' || typeof x.title !== 'string' || !BLOCK_KINDS.includes(x.kind as never)) continue;
    blocks.push(x as WorkflowBlock);
  }
  const t = now();
  return {
    version: 1,
    id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, WORKFLOW_CAPS.name) : id,
    blocks,
    rev: typeof o.rev === 'number' && Number.isFinite(o.rev) ? o.rev : 0,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : t,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : t,
  };
}

export function readWorkflow(root: string, id: string): WorkflowDoc | null {
  if (!ID_RE.test(id)) return null;
  try {
    const dir = workflowsFolder(root, false);
    if (!dir) return null;
    const file = path.join(dir, `${id}.json`);
    /* a file-level symlink is not followed either */
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    return parseDoc(id, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** Every saved workflow, newest edit first. Reading never writes: a project with none has no folder. */
export function listWorkflows(root: string): WorkflowDoc[] {
  let files: string[] = [];
  try {
    const dir = workflowsFolder(root, false);
    if (!dir) return [];
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const docs: WorkflowDoc[] = [];
  for (const f of files) {
    const d = readWorkflow(root, f.slice(0, -'.json'.length));
    if (d) docs.push(d);
  }
  return docs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
}

/** Find by id, or by name (case-insensitive): an agent says "the fix workflow", not "fix-1". */
export function findWorkflow(root: string, ref: string): WorkflowDoc | null {
  const byId = readWorkflow(root, ref);
  if (byId) return byId;
  const low = ref.trim().toLowerCase();
  return listWorkflows(root).find((d) => d.name.toLowerCase() === low) ?? null;
}

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'workflow';
}

/** Create a workflow. `from: 'fresh'` (the default) starts from the ready-made blocks; `'empty'` has only Finish. */
export function createWorkflow(root: string, input: { name: unknown; from?: unknown }): WorkflowDoc {
  if (typeof input.name !== 'string' || !input.name.trim()) throw new WorkflowError('name is empty');
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length > WORKFLOW_CAPS.name) throw new WorkflowError(`name is longer than ${WORKFLOW_CAPS.name} characters`);
  const from = input.from ?? 'fresh';
  if (from !== 'fresh' && from !== 'empty') throw new WorkflowError('from must be "fresh" or "empty"');
  const dir = workflowsFolder(root, true)!;
  const existing = listWorkflows(root);
  if (existing.length >= WORKFLOW_CAPS.workflows) throw new WorkflowError(`a project holds at most ${WORKFLOW_CAPS.workflows} workflows`, 409);
  const taken = new Set(existing.map((d) => d.id));
  let id = slug(name);
  if (taken.has(id)) {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n += 1;
    id = `${id}-${n}`;
  }
  const t = now();
  const blocks = from === 'fresh' ? freshWorkflowBlocks() : [{ id: 'b1', kind: 'finish' as const, title: 'Finish' }];
  const doc: WorkflowDoc = { version: 1, id, name, blocks, rev: 1, createdAt: t, updatedAt: t };
  writeAtomic(path.join(dir, `${id}.json`), doc);
  return doc;
}

export function deleteWorkflow(root: string, id: string): void {
  if (!readWorkflow(root, id)) throw new WorkflowError(`no workflow "${id}"`, 404);
  const dir = workflowsFolder(root, false);
  if (dir) fs.rmSync(path.join(dir, `${id}.json`), { force: true });
}

/** Apply ops to the file as it is on disk now, under the per-workflow lock. Refuses whole (nothing written) on any bad op.
    `expectedRev`, when given, is a compare-and-swap: the edit is refused with 409 if the file moved on since the caller read it. */
export async function applyWorkflowEdit(root: string, id: string, ops: readonly WorkflowOp[], expectedRev?: number): Promise<WorkflowDoc> {
  if (!ID_RE.test(id)) throw new WorkflowError(`no workflow "${id}"`, 404);
  const dir = workflowsFolder(root, false);
  const file = dir ? path.join(dir, `${id}.json`) : '';
  if (!dir || !fs.existsSync(file)) throw new WorkflowError(`no workflow "${id}"`, 404);
  return withLock(file, () => {
    const cur = readWorkflow(root, id);
    if (!cur) throw new WorkflowError(`no workflow "${id}"`, 404);
    if (expectedRev !== undefined && cur.rev !== expectedRev) {
      throw new WorkflowError(`the workflow changed (now revision ${cur.rev}, you had ${expectedRev}); read it again`, 409);
    }
    let next: { name: string; blocks: WorkflowBlock[] };
    try {
      next = applyWorkflowOps(cur, ops);
    } catch (e) {
      if (e instanceof WorkflowEditError) throw new WorkflowError(e.message);
      throw e;
    }
    const doc: WorkflowDoc = { ...cur, name: next.name, blocks: next.blocks, rev: cur.rev + 1, updatedAt: now() };
    writeAtomic(file, doc);
    return doc;
  });
}
