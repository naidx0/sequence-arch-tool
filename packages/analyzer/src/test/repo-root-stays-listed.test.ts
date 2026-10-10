/**
 * "THE PROJECT I LAUNCHED WITH --repo VANISHED FROM THE WORKSPACES LIST."
 *
 * Audit 2026-10, item 9: after switching to a chat in another workspace, the
 * folder opened with `--repo` was gone from the sidebar until the server
 * restarted. Cause: a `--repo` start is not recorded in `recent.json` (it must
 * not write to the caller's home at launch), and `GET /api/sessions` builds
 * `repos` from that file. While the folder was the attached root it showed as
 * `index`; the moment another folder was attached it was in neither place.
 *
 * Built from that shape: a `--repo` root, a second workspace, then the switch.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';
import { addRecent, readRecentRaw, userStoreDir } from '../server/store.js';

/* The specimens live in os.tmpdir(), which is not under $HOME on Linux (/tmp, against /home/runner): the default
   browse root (the home folder) would refuse every one of them (403 on attach, filtered out of the recent list).
   Say where the browse root is instead of relying on the temp dir sitting under the user profile, as it does on Windows. */
const BROWSE_ROOT = fs.realpathSync(os.tmpdir());

function freshRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sequence-${name}-`));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export {};\n');
  return dir;
}

async function boot(a: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(a, { webDist: undefined, browseRoot: BROWSE_ROOT });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
const attach = (base: string, p: string) =>
  fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) });
function resetStore(list: string[]): string {
  const store = userStoreDir();
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'recent.json'), JSON.stringify(list));
  return store;
}

test('a workspace he removed stays removed after the next switch', async () => {
  const a = fs.realpathSync(freshRepo('rm-a'));
  const b = fs.realpathSync(freshRepo('rm-b'));
  const c = fs.realpathSync(freshRepo('rm-c'));
  const store = resetStore([]);
  const { base, close } = await boot(a);
  try {
    assert.strictEqual((await attach(base, b)).status, 200);
    assert.ok(readRecentRaw(store).includes(a), 'positive control: the boot root was filed on leaving');
    await fetch(`${base}/api/recent`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: a }) });
    assert.strictEqual((await attach(base, c)).status, 200);
    assert.ok(!readRecentRaw(store).includes(a), 'removed, and a later switch did not bring it back');
    assert.strictEqual((await attach(base, b)).status, 200);
    assert.ok(!readRecentRaw(store).includes(a));
  } finally {
    await close();
  }
});

test('removing the boot root while it is still open means it is not filed on leaving', async () => {
  const a = fs.realpathSync(freshRepo('rm2-a'));
  const b = fs.realpathSync(freshRepo('rm2-b'));
  const store = resetStore([]);
  const { base, close } = await boot(a);
  try {
    await fetch(`${base}/api/recent`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: a }) });
    await attach(base, b);
    assert.ok(!readRecentRaw(store).includes(a));
  } finally {
    await close();
  }
});

test('a dragged order is unchanged by a switch', async () => {
  const a = fs.realpathSync(freshRepo('ord-a'));
  const x = fs.realpathSync(freshRepo('ord-x'));
  const y = fs.realpathSync(freshRepo('ord-y'));
  const z = fs.realpathSync(freshRepo('ord-z'));
  const store = resetStore([]);
  for (const p of [z, y, x]) addRecent(store, p); // [x, y, z]
  const { base, close } = await boot(a);
  try {
    await fetch(`${base}/api/recent`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: [z, x, y] }) });
    assert.deepStrictEqual(readRecentRaw(store), [z, x, y], 'positive control: the drag stuck');
    await attach(base, y); // leaves a (filed once at the end) and moves y to front as a normal attach does
    await attach(base, x); // leaves y: y is NOT re-added/moved by the leave itself
    assert.deepStrictEqual(readRecentRaw(store), [x, y, z, a]);
  } finally {
    await close();
  }
});

test('the --repo root stays in the catalog after a switch to another workspace', async () => {
  const store = userStoreDir();
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'recent.json'), '[]');
  const a = fs.realpathSync(freshRepo('launch-root'));
  const b = fs.realpathSync(freshRepo('second'));

  const server = await createRepoServer(a, { webDist: undefined, browseRoot: BROWSE_ROOT });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const attach = await fetch(`${base}/api/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: b }),
    });
    assert.strictEqual(attach.status, 200, 'attaching the second workspace works');

    const res = await fetch(`${base}/api/sessions`);
    const body = (await res.json()) as { repos: { path: string }[] };
    const paths = body.repos.map((r) => path.resolve(r.path).toLowerCase());
    assert.ok(paths.includes(path.resolve(a).toLowerCase()), 'the --repo root is still listed');
    assert.strictEqual(readRecentRaw(store)[0], b, 'the newest attach still leads');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
