import fs from 'node:fs';
import path from 'node:path';

/**
 * One debounced async writer for state that is cheap to lose a few tens of ms of.
 *
 * What goes through here: bookkeeping rewrites (the sessions index when only derived fields moved) and
 * append-only logs. What does NOT: anything a person was just told succeeded (a sent message, a saved chat,
 * a created chat, a rename). Those stay on the synchronous, fsynced path in store.ts, and a synchronous write
 * to a path supersedes whatever is still queued for it (`dropPending`).
 *
 * Contract:
 *  - N `scheduleWrite` calls to one path inside the window become ONE file write (latest text wins).
 *  - `readPending` lets a reader in this process see queued text before it reaches disk, so the store never
 *    reads its own stale file.
 *  - `flushWrites` (async) and `flushWritesSync` (exit path) drain everything; the writer flushes on
 *    process exit and on SIGINT/SIGTERM.
 *  - AN ACKNOWLEDGED SYNCHRONOUS WRITE OR A DELETE IS NEVER OVERWRITTEN BY AN OLDER DEFERRED ONE. Every sync
 *    write, drop and delete bumps a per-path generation; the async drain re-checks the generation immediately
 *    before its rename and makes that rename synchronous, so nothing can land between check and rename. A
 *    superseded drain unlinks its temp file and writes nothing.
 *  - A deferred write may carry a `merge`: at drain time it is applied on top of a FRESH read of the file, so a
 *    whole-file index rewrite queued here cannot erase a change another process made in the meantime.
 */

export const WRITE_DEBOUNCE_MS = 75;

type Merge = (disk: string) => string;

interface PendingWrite {
  text: string;
  /** Present only when every write coalesced into this one carried a merge. */
  merges?: Merge[];
}

interface AppendJob {
  lines: string[];
  /** After the append, if the file is larger than `maxBytes`, keep the newest half of its lines. */
  maxBytes?: number;
  /** Written (by the drain or by a synchronous flush) or cancelled: never write it again. */
  done?: boolean;
}

const pending = new Map<string, PendingWrite>();
/** Text whose async write has started and not yet finished; still readable and still re-flushable. */
const inFlight = new Map<string, PendingWrite>();
const appends = new Map<string, AppendJob>();
/** Append jobs a drain has taken and not yet written: a synchronous flush must still see them, in order. */
const takenAppends = new Map<string, AppendJob[]>();
const generations = new Map<string, number>();
let timer: NodeJS.Timeout | undefined;
let chain: Promise<void> = Promise.resolve();
let fileWrites = 0;
let tmpCounter = 0;
/** The one temp-file namer for every writer in this process: two counters with one scheme could pick the same name. */
export function tmpName(p: string): string {
  return `${p}.${process.pid}.${++tmpCounter}.tmp`;
}
let hooked = false;

/** Tests: runs inside a drain after the temp file is complete and before the generation check + rename. */
let beforeRenameHook: ((p: string) => Promise<void>) | undefined;
/** Tests: runs inside a drain after the temp file is opened and before anything is written to it. */
let afterOpenHook: ((p: string) => Promise<void>) | undefined;
export function setAfterOpenHook(fn: ((p: string) => Promise<void>) | undefined): void {
  afterOpenHook = fn;
}
export function setBeforeRenameHook(fn: ((p: string) => Promise<void>) | undefined): void {
  beforeRenameHook = fn;
}

const generation = (p: string): number => generations.get(p) ?? 0;
const bump = (p: string): void => void generations.set(p, generation(p) + 1);

/** How many file writes (replace or append) the writer has performed; for tests and the bench. */
export function writerStats(): { fileWrites: number; queued: number } {
  return { fileWrites, queued: pending.size + appends.size };
}

/**
 * What this process should see for `p` while writes are queued: the newest blind text, with the merges queued
 * after it applied on top; or, when only merges are queued, those merges applied to a FRESH read of the file
 * (another process may have changed it since they were queued). `undefined` when nothing is queued OR when
 * merges are queued for a file that no longer exists (nothing to merge into: a reader falls through to the disk).
 */
export function readPending(p: string): string | undefined {
  return effectiveText(p) ?? undefined;
}

/** null: nothing queued. undefined: merges queued but the file is gone. string: the text. */
function effectiveText(p: string): string | undefined | null {
  const queue = [inFlight.get(p), pending.get(p)].filter((w): w is PendingWrite => !!w);
  if (queue.length === 0) return null;
  let lastBlind = -1;
  queue.forEach((w, i) => {
    if (!w.merges) lastBlind = i;
  });
  let text: string;
  if (lastBlind >= 0) text = queue[lastBlind]!.text;
  else {
    try {
      text = fs.readFileSync(p, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return queue[queue.length - 1]!.text;
    }
  }
  try {
    for (const w of queue.slice(lastBlind + 1)) for (const m of w.merges!) text = m(text);
    return text;
  } catch {
    return queue[queue.length - 1]!.text;
  }
}

/** A synchronous write to (or a delete of) `p` has just made everything queued for it stale. */
export function dropPending(p: string): void {
  bump(p);
  pending.delete(p);
  inFlight.delete(p);
}

function under(dir: string, p: string): boolean {
  const d = path.resolve(dir);
  const f = path.resolve(p);
  return f === d || f.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

/** A folder is being deleted: nothing queued to append inside it may recreate it. */
export function dropAppendsUnder(dir: string): void {
  for (const [p, job] of [...appends]) {
    if (!under(dir, p)) continue;
    appends.delete(p);
    job.done = true;
  }
  for (const [p, jobs] of [...takenAppends]) {
    if (!under(dir, p)) continue;
    for (const job of jobs) job.done = true;
    takenAppends.delete(p);
  }
}

/** Write the queued appends for every file inside `dir` now (a copy of the folder must see them). */
export function flushAppendsUnder(dir: string): void {
  for (const p of new Set([...appends.keys(), ...takenAppends.keys()])) if (under(dir, p)) flushAppendsFor(p);
}

function hook(): void {
  if (hooked) return;
  hooked = true;
  process.on('exit', () => flushWritesSync());
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    const onSig = (): void => {
      flushWritesSync();
      /* With no other listener the default action (exit) would have happened: restore it. */
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    };
    process.once(sig, onSig);
  }
}

function arm(): void {
  hook();
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flushWrites();
  }, WRITE_DEBOUNCE_MS);
  timer.unref();
}

/**
 * Queue `text` for `p`; a later call for the same path inside the window replaces it.
 * `merge`, when given, is applied to the file's CONTENT AT DRAIN TIME instead of writing `text` blind (it falls
 * back to `text` when the file is absent or unreadable). Merges of calls that coalesce are applied in order.
 */
export function scheduleWrite(p: string, text: string, merge?: Merge): void {
  const prev = pending.get(p);
  const merges = merge ? (prev ? (prev.merges ? [...prev.merges, merge] : undefined) : [merge]) : undefined;
  pending.set(p, merges ? { text, merges } : { text });
  arm();
}

/** Queue one line for the end of `p`. */
export function scheduleAppend(p: string, line: string, maxBytes?: number): void {
  const job = appends.get(p) ?? { lines: [], maxBytes };
  job.lines.push(line);
  appends.set(p, job);
  arm();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The text to put on disk for `w`: merges applied to a fresh read of the file, else its own text.
 * `undefined` = write nothing (merges queued, and the file is gone: another process deleted it, and a
 * merge must not bring it back).
 */
function resolveText(p: string, w: PendingWrite): string | undefined | typeof RETRY {
  if (!w.merges) return w.text;
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    /* Gone: write nothing. Unreadable for now (EBUSY/EPERM): the stale whole-file snapshot must not be written
       over what is really there; the caller retries. */
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : RETRY;
  }
  try {
    for (const m of w.merges) text = m(text);
    return text;
  } catch {
    return w.text;
  }
}

const RETRY = Symbol('retry');
/** Paths whose merges could not read the live file in the last drain; they wait for the next timer, not a tight loop. */
const retrying = new Set<string>();

/** Synchronous temp-file write + rename (no fsync: only deferred, cheap-to-lose state comes here). */
function writeSyncPlain(p: string, text: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = tmpName(p);
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, p);
  } catch {
    fs.writeFileSync(p, text);
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Write `text` to `p` off the event loop, then rename it into place ONLY IF `current()` still holds. The check
 * and the rename are adjacent synchronous calls, so a synchronous writer cannot land between them.
 */
async function writeFileAtomicAsync(p: string, text: string, current: () => boolean): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tmp = tmpName(p);
  const fh = await fs.promises.open(tmp, 'w');
  try {
    await afterOpenHook?.(p);
    await fh.writeFile(text);
    try {
      await fh.sync();
    } catch {
      /* a filesystem without fsync still gets the rename */
    }
  } catch (e) {
    await fh.close().catch(() => undefined);
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw e;
  }
  await fh.close();
  await beforeRenameHook?.(p);
  for (let i = 0; ; i++) {
    if (!current()) {
      fs.rmSync(tmp, { force: true });
      return false;
    }
    try {
      fs.renameSync(tmp, p);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && i < 6) {
        await sleep(10 * (i + 1));
        continue;
      }
      try {
        fs.writeFileSync(p, text);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
      return true;
    }
  }
}

function trimLog(p: string, maxBytes: number): void {
  const size = fs.statSync(p).size;
  if (size <= maxBytes) return;
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(p, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
}

/** Append one job's lines now (synchronous, so no flush can interleave with it). Each job is written once. */
function writeAppend(p: string, job: AppendJob): void {
  if (job.done) return;
  job.done = true;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, job.lines.join('\n') + '\n');
    fileWrites++;
    if (job.maxBytes) trimLog(p, job.maxBytes);
  } catch {
    /* a log that cannot be written must never fail what it describes */
  }
}

/** Everything queued for the append file `p`, oldest first: jobs a drain already took, then the open one. */
function flushAppendsFor(p: string): void {
  for (const job of takenAppends.get(p) ?? []) writeAppend(p, job);
  takenAppends.delete(p);
  const job = appends.get(p);
  if (job) {
    appends.delete(p);
    writeAppend(p, job);
  }
}

async function drainOnce(): Promise<void> {
  const writes = [...pending];
  pending.clear();
  for (const [p, w] of writes) inFlight.set(p, w);
  const jobs = [...appends];
  appends.clear();
  for (const [p, job] of jobs) takenAppends.set(p, [...(takenAppends.get(p) ?? []), job]);
  for (const [p, w] of writes) {
    try {
      /* A sync write that landed meanwhile removed our inFlight entry: it is newer, so do not overwrite it. */
      if (inFlight.get(p) !== w) continue;
      const gen = generation(p);
      if (w.merges) {
        /* Merge on a fresh read and write in one synchronous step: nothing can interleave. */
        let merged = resolveText(p, w);
        for (let i = 0; merged === RETRY && i < 6; i++) {
          await sleep(10 * (i + 1));
          if (inFlight.get(p) !== w) break;
          merged = resolveText(p, w);
        }
        if (inFlight.get(p) !== w) continue;
        if (merged === RETRY) {
          /* Still unreadable: put the merges back (ahead of anything newer) and try again on the next timer. */
          const newer = pending.get(p);
          if (!newer) pending.set(p, w);
          else if (newer.merges) pending.set(p, { text: newer.text, merges: [...w.merges, ...newer.merges] });
          retrying.add(p);
          arm();
        } else if (merged !== undefined) {
          writeSyncPlain(p, merged);
          fileWrites++;
        }
      } else if (await writeFileAtomicAsync(p, w.text, () => generation(p) === gen && inFlight.get(p) === w)) {
        fileWrites++;
      }
    } catch {
      /* best effort: the next change to this path queues it again */
    } finally {
      if (inFlight.get(p) === w) inFlight.delete(p);
    }
  }
  for (const [p, job] of jobs) {
    if (job.done) continue;
    writeAppend(p, job);
    const list = takenAppends.get(p)?.filter((j) => j !== job) ?? [];
    if (list.length) takenAppends.set(p, list);
    else takenAppends.delete(p);
  }
}

/** Write everything queued, off the event loop. Resolves when the disk has it. */
export function flushWrites(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  retrying.clear();
  chain = chain.then(async () => {
    while ([...pending.keys()].some((k) => !retrying.has(k)) || appends.size) await drainOnce();
  });
  return chain;
}

/**
 * Write everything queued, now, synchronously. For process exit, and for a reader that must see an
 * append-only file. `only` limits it to one path.
 */
export function flushWritesSync(only?: string): void {
  for (const p of new Set([...pending.keys(), ...inFlight.keys()])) {
    if (only && p !== only) continue;
    /* Every queued write counts, oldest first: an in-flight merge is not lost behind a newer pending one. */
    const text = effectiveText(p);
    /* Bump first: a drain that is mid-write for this path abandons its older text instead of renaming it over this. */
    dropPending(p);
    if (text === null || text === undefined) continue;
    try {
      writeSyncPlain(p, text);
      fileWrites++;
    } catch {
      /* nothing more to do at exit */
    }
  }
  for (const p of new Set([...appends.keys(), ...takenAppends.keys()])) {
    if (only && p !== only) continue;
    flushAppendsFor(p);
  }
}
