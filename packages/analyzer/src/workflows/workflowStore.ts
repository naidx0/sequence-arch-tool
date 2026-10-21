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
import { createHash, randomUUID } from 'node:crypto';
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
import { readSessionIndex } from '../server/sessionsStore.js';

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export const WORKFLOW_CAPS = { workflows: 50, name: 80, chatId: 128 } as const;
/** What a chat id may look like (session ids, uuids); anything else is refused rather than put in a file. */
const CHAT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function workflowsDir(root: string): string {
  return path.join(root, '.sequence', 'workflows');
}

const now = (): string => new Date().toISOString();

/** On Windows a rename over a file another process has open (a reader, a scanner) fails with EPERM/EBUSY/EACCES until that handle closes, which is a moment: retry for a bounded time, never swallow it. */
function renameOverReaders(from: string, to: string): void {
  const t0 = Date.now();
  for (let k = 0; ; k++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || Date.now() - t0 > 5_000) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(2 + k * 2, 25));
    }
  }
}

/** Temp file then rename. The folder is made (and checked) by `workflowsFolder` first, never here. */
function writeAtomic(file: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
  try {
    renameOverReaders(tmp, file);
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
    ...(typeof o.chatId === 'string' && CHAT_ID_RE.test(o.chatId) ? { chatId: o.chatId } : {}),
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

/** Every saved workflow, newest edit first. Reading never writes: a project with none has no folder.
    With `chatId`, only the workflows that chat owns (at most one); without it, every workflow in the project. */
export function listWorkflows(root: string, opts: { chatId?: string } = {}): WorkflowDoc[] {
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
  const mine = opts.chatId === undefined ? docs : docs.filter((d) => d.chatId === opts.chatId);
  return mine.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
}

function checkChatId(chatId: unknown): string {
  if (typeof chatId !== 'string' || !CHAT_ID_RE.test(chatId)) throw new WorkflowError('chatId is not a chat id');
  return chatId;
}

/** The ids of the chats that exist in this project, or undefined when there is no chat index to ask (then nothing is treated as orphaned). */
export function liveChatIds(root: string): ReadonlySet<string> | undefined {
  try {
    const idx = readSessionIndex(root);
    return idx ? new Set(idx.sessions.map((s) => s.id)) : undefined;
  } catch {
    return undefined;
  }
}

/** A workflow whose owner chat no longer exists. Without the list of live chats, none is. */
/** A chat can be open in the app before it is saved to the index, so a workflow edited within the last hour is never an orphan. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const isOrphan = (d: WorkflowDoc, live?: ReadonlySet<string>): boolean =>
  d.chatId !== undefined && live !== undefined && !live.has(d.chatId) && Date.now() - Date.parse(d.updatedAt) > ORPHAN_GRACE_MS;

/** The one workflow a chat owns, or null. */
export function workflowForChat(root: string, chatId: string): WorkflowDoc | null {
  return listWorkflows(root, { chatId: checkChatId(chatId) })[0] ?? null;
}

/** Workflows no chat owns: saved before chats owned them, or left behind by a chat that was deleted. Offered to a chat to take. */
export function unownedWorkflows(root: string, live?: ReadonlySet<string>): WorkflowDoc[] {
  return listWorkflows(root).filter((d) => d.chatId === undefined || isOrphan(d, live));
}

/** A chat's workflow id is derived from the chat id, so two concurrent first uses of one chat cannot make two files. */
function chatKey(chatId: string): string {
  return `chat-${createHash('sha1').update(chatId).digest('hex').slice(0, 12)}`;
}

/** Write a new file only if none is there; false when another writer got there first. A hard link makes it whole at once;
    where the filesystem has no hard links the exclusive create is used instead. */
function writeNew(file: string, data: unknown): boolean {
  const text = JSON.stringify(data, null, 2);
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    try {
      fs.writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e2;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* ── The claim ─────────────────────────────────────────────────────────────
   "A chat owns at most one workflow" has to hold across processes and between the two ways a chat gets one (made on
   first use, or taking an older one). The claim is a file `<chat-key>.claim` holding the id of the workflow, created
   exclusively: whoever creates it owns the chat's slot, everyone else sees it taken. A claim whose workflow is gone is
   stale and is replaced. */
function claimPath(dir: string, chat: string): string {
  return path.join(dir, `${chatKey(chat)}.claim`);
}

interface ClaimInfo {
  id: string;
  pid: number | null;
}

function readClaim(file: string): ClaimInfo | null {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8')) as { id?: unknown; pid?: unknown };
    return typeof o.id === 'string' ? { id: o.id, pid: typeof o.pid === 'number' ? o.pid : null } : null;
  } catch {
    return null;
  }
}

const CLAIM_STALE_MS = 15_000;
function claimAgeMs(file: string): number {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
}

/** Is a writer of this workflow file holding (or queued for) its lock right now? */
function lockHeld(file: string): boolean {
  const lock = `${file}.lock`;
  return queues.has(lock) || fs.existsSync(lock);
}

/** Take the chat's slot for workflow `id`: 'mine', or 'taken' when a workflow of this chat already holds it. A claim whose workflow is
    not this chat's is stale unless a writer is still on it (this process's lock queue, or another live process that wrote the claim
    a moment ago); a stale claim is replaced at once. Nothing here waits: a claim another process is still working on is refused
    with "try again" and the caller retries. */
function claimChat(root: string, dir: string, chat: string, id: string): 'mine' | 'taken' {
  const file = claimPath(dir, chat);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (writeNew(file, { id, pid: process.pid })) return 'mine';
    const held = readClaim(file);
    const doc = held ? readWorkflow(root, held.id) : null;
    if (doc?.chatId === chat) return 'taken';
    const elsewhere = held?.pid != null && held.pid !== process.pid && pidAlive(held.pid) && claimAgeMs(file) < CLAIM_STALE_MS;
    if (elsewhere) {
      if (doc) return 'taken';
      throw new WorkflowError('this chat\'s workflow is being made, try again', 409);
    }
    if (doc && held && lockHeld(path.join(dir, `${held.id}.json`))) return 'taken';
    fs.rmSync(file, { force: true });
  }
  throw new WorkflowError('this chat\'s workflow could not be claimed, try again', 409);
}

function releaseClaim(dir: string, chat: string): void {
  fs.rmSync(claimPath(dir, chat), { force: true });
}

/** The chat's workflow, made on first use. A chat has at most one: asking again returns the same file, with `created` false.
    `live` (the chats that exist) keeps workflows of deleted chats out of the project's cap. */
export function ensureChatWorkflow(root: string, chatId: unknown, input: { name?: unknown; from?: unknown; live?: ReadonlySet<string> } = {}): { doc: WorkflowDoc; created: boolean } {
  const chat = checkChatId(chatId);
  const have = workflowForChat(root, chat);
  if (have) return { doc: have, created: false };
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.replace(/\s+/g, ' ').trim() : 'Workflow';
  if (name.length > WORKFLOW_CAPS.name) throw new WorkflowError(`name is longer than ${WORKFLOW_CAPS.name} characters`);
  const from = input.from ?? 'fresh';
  if (from !== 'fresh' && from !== 'empty') throw new WorkflowError('from must be "fresh" or "empty"');
  const dir = workflowsFolder(root, true)!;
  if (listWorkflows(root).filter((d) => !isOrphan(d, input.live)).length >= WORKFLOW_CAPS.workflows) throw new WorkflowError(`a project holds at most ${WORKFLOW_CAPS.workflows} workflows`, 409);
  /* never reuse (or delete) a file that is there: it may belong to another chat now, so this chat's gets the next free id */
  let id = chatKey(chat);
  for (let n = 2; fs.existsSync(path.join(dir, `${id}.json`)); n += 1) id = `${chatKey(chat)}-${n}`;
  if (claimChat(root, dir, chat, id) === 'taken') {
    const raced = workflowForChat(root, chat);
    if (raced) return { doc: raced, created: false };
    throw new WorkflowError('the workflow could not be created, try again', 409);
  }
  const t = now();
  const blocks = from === 'fresh' ? freshWorkflowBlocks() : [{ id: 'b1', kind: 'finish' as const, title: 'Finish' }];
  const doc: WorkflowDoc = { version: 1, id, name, blocks, rev: 1, createdAt: t, updatedAt: t, chatId: chat };
  if (!writeNew(path.join(dir, `${id}.json`), doc)) {
    releaseClaim(dir, chat);
    throw new WorkflowError('the workflow could not be created, try again', 409);
  }
  return { doc, created: true };
}

/** Give a workflow no chat owns (older, or left by a deleted chat) to a chat that has none. Refused when either side is already taken. */
export async function adoptWorkflow(root: string, id: string, chatId: unknown, live?: ReadonlySet<string>): Promise<WorkflowDoc> {
  const chat = checkChatId(chatId);
  if (!ID_RE.test(id)) throw new WorkflowError(`no workflow "${id}"`, 404);
  const dir = workflowsFolder(root, false);
  const file = dir ? path.join(dir, `${id}.json`) : '';
  if (!dir || !fs.existsSync(file)) throw new WorkflowError(`no workflow "${id}"`, 404);
  if (claimChat(root, dir, chat, id) === 'taken') throw new WorkflowError('this chat already has a workflow', 409);
  try {
    /* a chat that already owns one (made before claims existed) takes no second */
    const owns = workflowForChat(root, chat);
    if (owns && owns.id !== id) throw new WorkflowError('this chat already has a workflow', 409);
    return await withLock(file, () => {
      const cur = readWorkflow(root, id);
      if (!cur) throw new WorkflowError(`no workflow "${id}"`, 404);
      if (cur.chatId !== undefined && !isOrphan(cur, live)) throw new WorkflowError('that workflow already belongs to a chat', 409);
      if (cur.chatId !== undefined) releaseClaim(dir, cur.chatId);
      const doc: WorkflowDoc = { ...cur, chatId: chat, rev: cur.rev + 1, updatedAt: now() };
      writeAtomic(file, doc);
      return doc;
    });
  } catch (e) {
    releaseClaim(dir, chat);
    throw e;
  }
}

/** Find by id, or by name (case-insensitive): an agent says "the fix workflow", not "fix-1".
    With `chatId`, only what that chat may touch: its own and the unowned ones, never another chat's, by id or by name. */
export function findWorkflow(root: string, ref: string, opts: { chatId?: string; live?: ReadonlySet<string> } = {}): WorkflowDoc | null {
  const visible = (d: WorkflowDoc): boolean => opts.chatId === undefined || d.chatId === undefined || d.chatId === opts.chatId || isOrphan(d, opts.live);
  const byId = readWorkflow(root, ref);
  if (byId) return visible(byId) ? byId : null;
  const low = ref.trim().toLowerCase();
  return listWorkflows(root).find((d) => visible(d) && d.name.toLowerCase() === low) ?? null;
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
export function createWorkflow(root: string, input: { name: unknown; from?: unknown; live?: ReadonlySet<string> }): WorkflowDoc {
  if (typeof input.name !== 'string' || !input.name.trim()) throw new WorkflowError('name is empty');
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length > WORKFLOW_CAPS.name) throw new WorkflowError(`name is longer than ${WORKFLOW_CAPS.name} characters`);
  const from = input.from ?? 'fresh';
  if (from !== 'fresh' && from !== 'empty') throw new WorkflowError('from must be "fresh" or "empty"');
  const dir = workflowsFolder(root, true)!;
  const existing = listWorkflows(root);
  if (existing.filter((d) => !isOrphan(d, input.live)).length >= WORKFLOW_CAPS.workflows) throw new WorkflowError(`a project holds at most ${WORKFLOW_CAPS.workflows} workflows`, 409);
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
  const doc = readWorkflow(root, id);
  if (!doc) throw new WorkflowError(`no workflow "${id}"`, 404);
  const dir = workflowsFolder(root, false);
  if (dir) {
    fs.rmSync(path.join(dir, `${id}.json`), { force: true });
    if (doc.chatId !== undefined) releaseClaim(dir, doc.chatId);
  }
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
