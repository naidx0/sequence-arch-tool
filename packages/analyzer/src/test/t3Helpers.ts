import assert from 'node:assert';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { rmTree } from './rmTree.js';

/* Shared by the Edit-from-here, best-of-N and PR-flow tests. Every repo is a temp repo; removal waits out Windows' EPERM (rmTree). */

delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
export const FAKE_CODEX = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-app-server', 'codex.mjs');

export function git(cwd: string, args: string[]): string {
  const r = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

const temps: string[] = [];
export function temp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps.reverse()) rmTree(d);
});

/** A temp repo with an identity, one commit, `.sequence/` excluded the way S3 excludes it. */
export function repo(files: Record<string, string> = { 'a.txt': 'one\ntwo\nthree\n' }, from?: string): string {
  const dir = temp('seq-s7-repo-');
  if (from) fs.cpSync(from, dir, { recursive: true, filter: (p) => !/[\\/]\.sequence([\\/]|$)/.test(p) });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test Owner']);
  git(dir, ['config', 'user.email', 'owner@example.test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '/.sequence/\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

/** Everything the user could lose: HEAD, the index's entries, and the working tree's status. */
export function userState(dir: string): string {
  return [git(dir, ['rev-parse', 'HEAD']), git(dir, ['ls-files', '--stage']), git(dir, ['status', '--porcelain', '--untracked-files=all'])].join('\u0000');
}


export type Json = Record<string, unknown>;

export async function serve(root: string, store: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

export const call = async (base: string, p: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<{ status: number; json: Json }> => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: (await r.json()) as Json };
};

export async function turn(base: string, body: Json): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 200, await res.clone().text());
  const events: Json[] = [];
  for (const l of (await res.text()).split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6)) as Json);
  return events;
}

export const worktreeList = (dir: string): string[] =>
  git(dir, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9));

