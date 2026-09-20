/**
 * Shallow, pinned-SHA clone cache.
 *
 * The cache lives OUTSIDE this repo (env `SEQUENCE_QA_CACHE`, else
 * `<os.tmpdir()>/sequence-qa-cache`) so a benchmark run can never pollute the
 * working tree, and so the Sequence scanner never accidentally reads a
 * benchmark repo as part of Sequence itself.
 *
 * Pinning is the whole point, so this module NEVER falls back to HEAD. If the
 * pinned SHA cannot be fetched it fails with the git stderr verbatim; a
 * benchmark that silently moved to a newer commit produces numbers nobody can
 * compare.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export function cacheRoot(explicit) {
  return explicit ?? process.env.SEQUENCE_QA_CACHE ?? path.join(os.tmpdir(), 'sequence-qa-cache');
}

/**
 * Run git, resolving with `{ code, stdout, stderr }` — never rejecting, so the
 * caller reports a real failure instead of an exception from the plumbing.
 */
export function git(args, cwd, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          killed: Boolean(err && err.killed),
        });
      }
    );
  });
}

async function headSha(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const r = await git(['rev-parse', 'HEAD'], dir, 60_000);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * Ensure `<cache>/<id>` is checked out at exactly `row.sha`.
 *
 * @param {{id: string, sha: string}} row
 * @param {string} url
 * @param {string} root cache root
 * @returns {Promise<{ok: true, dir: string, cached: boolean} | {ok: false, dir: string, reason: string}>}
 */
export async function ensureRepo(row, url, root) {
  const dir = path.join(root, row.id);
  if (row.sha === 'pin-me') {
    return {
      ok: false,
      dir,
      reason:
        `manifest row "${row.id}" still has the placeholder sha "pin-me". Resolve it with ` +
        `\`git ls-remote ${url} HEAD\` and commit the real 40-char commit before benchmarking it.`,
    };
  }

  const existing = await headSha(dir);
  if (existing === row.sha) return { ok: true, dir, cached: true };

  fs.mkdirSync(dir, { recursive: true });
  const init = await git(['init', '-q'], dir);
  if (init.code !== 0) return { ok: false, dir, reason: `git init failed: ${init.stderr.trim() || init.code}` };

  // `remote add` fails when it already exists; `set-url` fails when it does not.
  // Try add, fall back to set-url — either way the remote ends up correct.
  const add = await git(['remote', 'add', 'origin', url], dir);
  if (add.code !== 0) {
    const setUrl = await git(['remote', 'set-url', 'origin', url], dir);
    if (setUrl.code !== 0) {
      return { ok: false, dir, reason: `git remote setup failed: ${(add.stderr + setUrl.stderr).trim()}` };
    }
  }

  const fetch = await git(['fetch', '--depth', '1', 'origin', row.sha], dir);
  if (fetch.code !== 0) {
    return {
      ok: false,
      dir,
      reason:
        `clone failed: shallow fetch of pinned sha ${row.sha} from ${url} exited ${fetch.code}` +
        (fetch.killed ? ' (timed out)' : '') +
        `\n${fetch.stderr.trim()}`,
    };
  }

  const checkout = await git(['checkout', '-q', '--detach', 'FETCH_HEAD'], dir);
  if (checkout.code !== 0) {
    return { ok: false, dir, reason: `clone failed: checkout FETCH_HEAD exited ${checkout.code}\n${checkout.stderr.trim()}` };
  }

  const now = await headSha(dir);
  if (now !== row.sha) {
    return {
      ok: false,
      dir,
      reason: `clone failed: checked-out HEAD is ${now}, expected pinned ${row.sha}`,
    };
  }
  return { ok: true, dir, cached: false };
}
