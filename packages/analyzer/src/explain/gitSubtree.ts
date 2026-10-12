/**
 * S-new3: `git log --relative` makes paths relative to a subdirectory but does
 * not limit WHICH commits are counted: `-n 300` still walks the whole repo.
 * Opened at a subdirectory, the logs need the pathspec `.` as well. At the
 * repo root they do not, and must not get it: a pathspec turns on history
 * simplification, which drops empty commits and tree-same merges and so
 * shifts the commit windows the reference (harness-study ftf3 / search3) uses.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PREFIX = new Map<string, string>();

function args(root: string): string[] {
  return ['-c', 'core.quotePath=false', '-C', root, 'rev-parse', '--show-prefix'];
}

/** The pathspec to append after `--`: `['.']` when `root` is a subdirectory of its repo, else none. */
export function subtreePathspec(root: string): string[] {
  let p = PREFIX.get(root);
  if (p === undefined) {
    try {
      p = execFileSync('git', args(root), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    } catch {
      p = '';
    }
    PREFIX.set(root, p);
  }
  return p ? ['.'] : [];
}

/** {@link subtreePathspec} without blocking the event loop. */
export async function subtreePathspecAsync(root: string): Promise<string[]> {
  let p = PREFIX.get(root);
  if (p === undefined) {
    try {
      p = (await execFileAsync('git', args(root), { encoding: 'utf8', windowsHide: true })).stdout.trim();
    } catch {
      p = '';
    }
    PREFIX.set(root, p);
  }
  return p ? ['.'] : [];
}
