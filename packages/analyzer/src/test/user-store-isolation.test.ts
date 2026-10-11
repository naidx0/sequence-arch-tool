/**
 * THE USER-LEVEL STORE, PROVED IN BOTH DIRECTIONS AND ON ANY MACHINE.
 *
 * `createRepoServer` falls back to `~/.sequence/ai.json` when the attached repo
 * configures no provider. That fallback is a feature - configure a local model
 * once and every repo sees it - and it is also how the test suite became a
 * function of the developer's own machine. Using the app to point Sequence at a
 * local Ollama wrote that file, and three tests asserting "no provider" then
 * found one:
 *
 *     /api/annotate: no provider -> 200 with empty annotations, mode none
 *       actual: 'ai'   expected: 'none'
 *
 * `src/test/isolate-user-store.ts` stops the suite reading the real store at
 * all. This file is the other half: it proves the fallback still WORKS, using
 * two directories it creates itself, so the result is the same on a machine
 * that has never run the product and on one that uses it daily.
 *
 * Deliberately checked through `GET /api/ai-config` rather than by asking for
 * an annotation: the question here is whether a configuration is FOUND, and
 * asking for an annotation would answer it by trying to reach a provider - a
 * network call whose timeout is exactly the 25 seconds those three red tests
 * spent before failing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRepoServer } from '../server/repoServer.js';
import { userStoreDir } from '../server/store.js';

function tempDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sequence-${tag}-`));
}

async function start(userConfigDir: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server: http.Server = await createRepoServer(null, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const configured = async (base: string): Promise<boolean> => {
  const res = await fetch(`${base}/api/ai-config`);
  assert.strictEqual(res.status, 200);
  return ((await res.json()) as { configured?: boolean }).configured === true;
};

test('the suite does not read the real ~/.sequence', () => {
  /*
   * The isolation, asserted rather than assumed. If `--import
   * ./dist/test/isolate-user-store.js` is ever dropped from the test script,
   * every server in this package silently starts reading the developer's own
   * store again - and the symptom is a test failing somewhere else entirely,
   * on one machine, for a reason nothing in its own file explains.
   */
  const real = path.join(os.homedir(), '.sequence');
  assert.notStrictEqual(
    userStoreDir(),
    real,
    'the test run is pointed at the real user store - is the isolate --import still in the test script?',
  );
});

test('userStoreDir honours an absolute SEQUENCE_USER_DIR and ignores a relative one', () => {
  const before = process.env.SEQUENCE_USER_DIR;
  const absolute = tempDir('userdir-abs');
  try {
    process.env.SEQUENCE_USER_DIR = absolute;
    assert.strictEqual(userStoreDir(), absolute);

    /*
     * A relative value is ignored rather than resolved: `.sequence` would mean a
     * different directory for every cwd the process happens to be started from,
     * which is the ambiguity the override exists to remove.
     *
     * WHAT THESE TWO ASSERTED BEFORE, and why they changed: they checked that an
     * unusable override falls back to `~/.sequence`. Under a test runner that
     * fallback is now REFUSED (LOCK 8) — a hand-rolled `node --test` without the
     * isolate hook once wrote five files into a real user store, including an
     * ai.json that pointed the app at a dead port. The property under test is
     * unchanged and is what still matters: an unusable override never becomes
     * the store dir. What changed is that the real home is no longer reachable
     * from a test at all, which is strictly stronger than falling back to it.
     */
    process.env.SEQUENCE_USER_DIR = 'some/relative/dir';
    assert.throws(() => userStoreDir(), /refusing to resolve the real/);

    process.env.SEQUENCE_USER_DIR = '';
    assert.throws(() => userStoreDir(), /refusing to resolve the real/);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_USER_DIR;
    else process.env.SEQUENCE_USER_DIR = before;
  }
});

test('an empty user store means no provider, and a populated one is still found', async () => {
  const empty = tempDir('store-empty');
  const populated = tempDir('store-populated');
  /* Keyless loopback: the one shape that needs no credential, so this fixture
     carries nothing secret and cannot leak one. */
  fs.writeFileSync(
    path.join(populated, 'ai.json'),
    JSON.stringify({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'a-local-model',
    }),
  );

  const blank = await start(empty);
  try {
    assert.strictEqual(
      await configured(blank.base),
      false,
      'an empty user store must read as unconfigured',
    );
  } finally {
    await blank.close();
  }

  const found = await start(populated);
  try {
    /*
     * The other direction, and the one that keeps the isolation honest. A fix
     * that made every test see "no provider" by BREAKING the fallback would
     * turn the three red tests green and quietly delete the feature they were
     * standing next to.
     */
    assert.strictEqual(
      await configured(found.base),
      true,
      'the user-level fallback must still find a config when one is there',
    );
  } finally {
    await found.close();
  }
});
