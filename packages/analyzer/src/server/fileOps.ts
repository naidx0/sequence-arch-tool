import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { resolveInRepo } from './jail.js';

/**
 * File operations for the Files rail (round 9, ask 20): create, mkdir, rename,
 * move, duplicate, delete, reveal.
 *
 * EVERY path goes through {@link resolveInRepo} (traversal, absolute, NUL and
 * symlink-escape refusal) AND the caller's reserved-dir test, for the source and
 * for the destination. The jail root itself is never a valid source: you cannot
 * rename, move or delete the project.
 *
 * Pure of HTTP so the guard can be tested without a server; `repoServer.ts`
 * owns the route and the cache/staleness bookkeeping.
 */

export type FileOp = 'create' | 'mkdir' | 'rename' | 'move' | 'duplicate' | 'delete' | 'reveal';

export const FILE_OPS: ReadonlySet<string> = new Set<FileOp>([
  'create',
  'mkdir',
  'rename',
  'move',
  'duplicate',
  'delete',
  'reveal',
]);

export interface FileOpRequest {
  op?: unknown;
  path?: unknown;
  to?: unknown;
}

export interface FileOpResult {
  status: number;
  body: { ok: true; op: FileOp; path: string; to?: string } | { error: string };
  /** Repo-relative paths whose content changed, for the staleness mark. */
  touched?: string[];
}

export interface FileOpDeps {
  /** True for .git/.sequence/.ssh/... — the caller's reserved-dir rule. */
  isReserved: (abs: string) => boolean;
  /** Override for tests; defaults to the platform's file manager. */
  reveal?: (abs: string) => void;
}

function fail(status: number, error: string): FileOpResult {
  return { status, body: { error } };
}

const toPosix = (p: string): string => p.replace(/\\/g, '/');

/** `a/b.txt` → `a/b copy.txt`, `a/b copy 2.txt`, … the first that is free. */
export function duplicateName(jail: string, rel: string): string {
  const posix = toPosix(rel);
  const dir = path.posix.dirname(posix);
  const ext = path.posix.extname(posix);
  const base = path.posix.basename(posix, ext);
  for (let n = 1; n < 1000; n += 1) {
    const name = `${base} copy${n === 1 ? '' : ` ${n}`}${ext}`;
    const candidate = dir === '.' ? name : `${dir}/${name}`;
    if (!fs.existsSync(path.resolve(jail, candidate))) return candidate;
  }
  return `${dir === '.' ? '' : `${dir}/`}${base} copy ${Date.now()}${ext}`;
}

function defaultReveal(abs: string): void {
  const dir = (() => {
    try {
      return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    } catch {
      return path.dirname(abs);
    }
  })();
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = fs.existsSync(abs) && !fs.statSync(abs).isDirectory() ? ['-R', abs] : [dir];
  } else if (process.platform === 'win32') {
    cmd = 'explorer.exe';
    args = fs.existsSync(abs) && !fs.statSync(abs).isDirectory() ? [`/select,${abs}`] : [dir];
  } else {
    cmd = 'xdg-open';
    args = [dir];
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {
    /* No file manager here (headless box): the route already answered. */
  });
  child.unref();
}

export function applyFileOp(jail: string, body: FileOpRequest, deps: FileOpDeps): FileOpResult {
  const op = body.op;
  if (typeof op !== 'string' || !FILE_OPS.has(op)) {
    return fail(400, `"op" must be one of ${[...FILE_OPS].join(', ')}`);
  }
  const kind = op as FileOp;
  if (typeof body.path !== 'string' || body.path.length === 0) {
    return fail(400, 'body must include a string "path"');
  }
  const rel = toPosix(body.path).replace(/^\.\//, '').replace(/\/+$/, '');
  if (rel === '' || rel === '.') return fail(403, 'the project root cannot be changed');

  const src = resolveInRepo(jail, rel);
  if (src === null || deps.isReserved(src) || src === jail) {
    return fail(403, 'path escapes repo root or is reserved');
  }

  if (kind === 'reveal') {
    if (!fs.existsSync(src)) return fail(404, 'no such file');
    (deps.reveal ?? defaultReveal)(src);
    return { status: 200, body: { ok: true, op: kind, path: rel } };
  }

  if (kind === 'create' || kind === 'mkdir') {
    if (fs.existsSync(src)) return fail(409, 'already exists');
    try {
      if (kind === 'mkdir') {
        fs.mkdirSync(src, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(src), { recursive: true });
        fs.writeFileSync(src, '', { flag: 'wx' });
      }
    } catch (e) {
      return fail(500, (e as Error).message);
    }
    return { status: 200, body: { ok: true, op: kind, path: rel }, touched: [rel] };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(src);
  } catch {
    return fail(404, 'no such file or folder');
  }

  if (kind === 'delete') {
    try {
      fs.rmSync(src, { recursive: true, force: false });
    } catch (e) {
      return fail(500, (e as Error).message);
    }
    return { status: 200, body: { ok: true, op: kind, path: rel }, touched: [rel] };
  }

  /* rename / move / duplicate need a destination. */
  let toRel: string;
  if (kind === 'duplicate' && (body.to === undefined || body.to === null || body.to === '')) {
    toRel = duplicateName(jail, rel);
  } else {
    if (typeof body.to !== 'string' || body.to.length === 0) {
      return fail(400, 'body must include a string "to"');
    }
    toRel = toPosix(body.to).replace(/^\.\//, '').replace(/\/+$/, '');
  }
  const dest = resolveInRepo(jail, toRel);
  if (dest === null || deps.isReserved(dest) || dest === jail) {
    return fail(403, 'destination escapes repo root or is reserved');
  }
  if (dest === src) return fail(400, 'source and destination are the same');
  if (stat.isDirectory() && dest.startsWith(src + path.sep)) {
    return fail(400, 'a folder cannot be moved into itself');
  }
  if (fs.existsSync(dest)) return fail(409, `${toRel} already exists`);

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (kind === 'duplicate') {
      fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false });
    } else {
      fs.renameSync(src, dest);
    }
  } catch (e) {
    return fail(500, (e as Error).message);
  }
  return {
    status: 200,
    body: { ok: true, op: kind, path: rel, to: toRel },
    touched: [rel, toRel],
  };
}
