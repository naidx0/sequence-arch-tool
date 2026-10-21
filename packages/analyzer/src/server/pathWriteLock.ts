/**
 * Per-path write lock for agent file writes (audit P1-11).
 *
 * Two goal runs, or a goal run and an ask, can propose edits to the same file
 * at the same time. Each batch is a multi-step write (track, mkdir, write per
 * file); without a lock one run's batch can land between another's steps and
 * leave a mix neither run wrote. This lock serialises WRITE BATCHES per
 * canonical path, in-process.
 *
 * Crash safety: the lock is in-memory, so a dead process holds nothing. Inside
 * a live process every acquisition is released by the caller's `finally`, a
 * waiter gives up on its AbortSignal, and a waiter gives up after `timeoutMs`
 * rather than queueing forever behind a wedged holder.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PATH_LOCK_TIMEOUT_MS = 30_000;

/** Canonical key: realpath of the deepest existing ancestor + the rest; case-folded on win32. */
export function canonicalLockKey(abs: string): string {
  const resolved = path.resolve(abs);
  const tail: string[] = [];
  let probe = resolved;
  for (;;) {
    try {
      probe = fs.realpathSync.native(probe);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
  const full = tail.length > 0 ? path.join(probe, ...tail) : probe;
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

export class PathLockTimeout extends Error {
  constructor(
    readonly lockedPath: string,
    readonly heldBy: string,
    readonly waitedMs: number,
  ) {
    super(
      `${lockedPath} is being changed by another run (${heldBy}); gave up waiting after ${(waitedMs / 1000).toFixed(1)} s`,
    );
    this.name = 'PathLockTimeout';
  }
}

export class PathLockAborted extends Error {
  constructor(readonly lockedPath: string) {
    super(`stopped while waiting for ${lockedPath}`);
    this.name = 'PathLockAborted';
  }
}

interface Held {
  token: symbol;
  holder: string;
  waiters: Set<() => void>;
}

const held = new Map<string, Held>();

export interface PathLockHandle {
  release: () => void;
  /** One entry per path this acquisition had to wait for. */
  waited: { path: string; heldBy: string; waitedMs: number }[];
}

export interface AcquireOpts {
  /** Names this run in the message a waiter sees. */
  holder: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Acquire every path (sorted by key, so two batches can never deadlock on each
 * other). On timeout/abort, anything already taken is released and it throws.
 */
export async function acquirePathLocks(
  files: readonly { abs: string; label: string }[],
  opts: AcquireOpts,
): Promise<PathLockHandle> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PATH_LOCK_TIMEOUT_MS;
  const token = Symbol(opts.holder);
  const uniq = new Map<string, string>();
  for (const f of files) uniq.set(canonicalLockKey(f.abs), f.label);
  const keys = [...uniq.keys()].sort();
  const mine: string[] = [];
  const waited: PathLockHandle['waited'] = [];
  const release = (): void => {
    for (const key of mine.splice(0)) {
      const h = held.get(key);
      if (!h || h.token !== token) continue;
      held.delete(key);
      for (const wake of [...h.waiters]) wake();
    }
  };
  try {
    for (const key of keys) {
      const label = uniq.get(key) ?? key;
      const start = Date.now();
      let blockedBy: string | null = null;
      for (;;) {
        if (opts.signal?.aborted) throw new PathLockAborted(label);
        const cur = held.get(key);
        if (!cur) break;
        blockedBy = cur.holder;
        await new Promise<void>((resolve, reject) => {
          const remaining = timeoutMs - (Date.now() - start);
          if (remaining <= 0) {
            reject(new PathLockTimeout(label, cur.holder, Date.now() - start));
            return;
          }
          const cleanup = (): void => {
            clearTimeout(timer);
            cur.waiters.delete(wake);
            opts.signal?.removeEventListener('abort', onAbort);
          };
          const wake = (): void => {
            cleanup();
            resolve();
          };
          const onAbort = (): void => {
            cleanup();
            reject(new PathLockAborted(label));
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(new PathLockTimeout(label, cur.holder, Date.now() - start));
          }, remaining);
          cur.waiters.add(wake);
          opts.signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      held.set(key, { token, holder: opts.holder, waiters: new Set() });
      mine.push(key);
      if (blockedBy !== null) waited.push({ path: label, heldBy: blockedBy, waitedMs: Date.now() - start });
    }
  } catch (e) {
    release();
    throw e;
  }
  return { release, waited };
}
