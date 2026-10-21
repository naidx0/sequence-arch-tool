/**
 * "THE PROJECT I STARTED WITH --repo NEVER APPEARS IN RECENT."
 *
 * Owner-seat review (polish3 item 3): the open-project dialog's Recent list
 * did not hold the project the app was started on, only the ones attached
 * afterwards. A `--repo` start files its root in `recent.json` once the scan
 * settles; a later switch must not lose it, and a project he already removed
 * is not re-filed by a later switch.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';
import { readRecentRaw, userStoreDir } from '../server/store.js';

const BROWSE_ROOT = fs.realpathSync(os.tmpdir());

function freshRepo(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sequence-${name}-`));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export {};\n');
  return fs.realpathSync(dir);
}

async function boot(root: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(root, { webDist: undefined, browseRoot: BROWSE_ROOT });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function resetStore(list: string[]): string {
  const store = userStoreDir();
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'recent.json'), JSON.stringify(list));
  return store;
}

test('the --repo startup project is in Recent while it is still open', async () => {
  const a = freshRepo('boot-recent');
  const store = resetStore([]);
  const { base, close } = await boot(a);
  try {
    assert.ok(readRecentRaw(store).includes(a), 'filed at startup, before any switch');
    const body = (await (await fetch(`${base}/api/recent`)).json()) as { recent: { path: string }[] };
    assert.ok(body.recent.some((r) => path.resolve(r.path) === path.resolve(a)), '/api/recent lists it');
  } finally {
    await close();
  }
});

test('an existing Recent order is kept: the startup project already listed does not move', async () => {
  const a = freshRepo('boot-keep-a');
  const x = freshRepo('boot-keep-x');
  const store = resetStore([x, a]);
  const { close } = await boot(a);
  try {
    assert.deepStrictEqual(readRecentRaw(store), [x, a]);
  } finally {
    await close();
  }
});
