import fs from 'node:fs';

/**
 * Remove a temp directory that a find_files index host (a detached process) may still hold open.
 * Windows answers EPERM/EBUSY until it lets go, and on current Node a recursive rmSync does its own
 * removal and ignores maxRetries, so the retry is explicit. A directory that never frees still throws.
 */
export function rmDir(dir: string, waitMs = 15_000): void {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(code ?? '') || Date.now() > until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}
