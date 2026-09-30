import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { isTrusted, runHooks } from '../server/hooks.js';
import { readHookFile, readHookTrust, setHookTrust } from '../server/store.js';

/**
 * GRANTING TRUST — the half that made hooks reachable at all.
 *
 * The mechanism shipped with the posture right and no way to say yes: a hooks
 * file could be committed, and nothing anywhere could turn it on. A feature no
 * user can enable is a feature that does not exist, and it would have sat there
 * looking finished.
 *
 * THE SPLIT IS THE SECURITY. `.sequence/hooks.json` is COMMITTED and only
 * declares; the trust list is USER-LEVEL and the repo cannot write it. A repo
 * that could grant itself trust would be a repo that runs its own code the
 * first time you open it.
 */

function workspace() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-trusthome-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-trustrepo-'));
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'hooks.json'),
    JSON.stringify({
      version: 1,
      hooks: {
        'pre-commit': [
          {
            command: [process.execPath, '-e', 'process.stderr.write("gate says no"); process.exit(2);'],
          },
        ],
      },
    }),
  );
  return {
    home,
    repo,
    clean: () => {
      for (const d of [home, repo]) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
        } catch {
          /* Windows may hold a killed child's cwd; temp is the OS's to clean. */
        }
      }
    },
  };
}

const fire = (home: string, repo: string) =>
  runHooks('pre-commit', {
    repoRoot: repo,
    file: readHookFile(repo),
    trusted: isTrusted(repo, readHookTrust(home)),
    payload: { message: 'a commit' },
  });

test('the same repo runs nothing before consent and blocks after it', async () => {
  const w = workspace();
  try {
    /* THE WHOLE FEATURE, in one test. Before: declared and inert. */
    const before = await fire(w.home, w.repo);
    assert.strictEqual(before.allowed, true);
    assert.strictEqual(before.skipped, 'not-trusted');

    setHookTrust(w.home, w.repo, true);

    /* After: the person said yes, and the project's gate can speak. */
    const after = await fire(w.home, w.repo);
    assert.strictEqual(after.allowed, false);
    assert.match(
      (after.outcomes.find((o) => o.kind === 'blocked') as { reason: string }).reason,
      /gate says no/,
    );
  } finally {
    w.clean();
  }
});

test('revoking works, and is not a one-way door', async () => {
  const w = workspace();
  try {
    setHookTrust(w.home, w.repo, true);
    assert.strictEqual((await fire(w.home, w.repo)).allowed, false);

    setHookTrust(w.home, w.repo, false);
    /* A consent that could be given and never taken back is not consent. */
    const after = await fire(w.home, w.repo);
    assert.strictEqual(after.allowed, true);
    assert.strictEqual(after.skipped, 'not-trusted');
  } finally {
    w.clean();
  }
});

test('trusting twice stores one entry, not two', () => {
  const w = workspace();
  try {
    setHookTrust(w.home, w.repo, true);
    const twice = setHookTrust(w.home, w.repo, true);
    /* Paths are stored resolved and de-duplicated: a list that grew on every
       click would eventually be a file nobody can audit. */
    assert.strictEqual(twice.trusted.length, 1);
  } finally {
    w.clean();
  }
});

test('a trailing slash is the same repo, not a second grant', () => {
  const w = workspace();
  try {
    setHookTrust(w.home, `${w.repo}${path.sep}`, true);
    /* Otherwise a trailing slash would be a way to hold trust the UI cannot
       see and the user cannot revoke. */
    assert.strictEqual(isTrusted(w.repo, readHookTrust(w.home)), true);
    assert.strictEqual(readHookTrust(w.home)!.trusted.length, 1);
  } finally {
    w.clean();
  }
});

test('trusting one repo does not trust another', () => {
  const a = workspace();
  const b = workspace();
  try {
    setHookTrust(a.home, a.repo, true);
    assert.strictEqual(isTrusted(b.repo, readHookTrust(a.home)), false);
  } finally {
    a.clean();
    b.clean();
  }
});

test('the trust list survives being read back through the validator', () => {
  const w = workspace();
  try {
    setHookTrust(w.home, w.repo, true);
    const read = readHookTrust(w.home);
    /* Written and read by the same pair, so a shape the writer produces can
       never be one the reader rejects — which would silently un-trust a repo
       the user had already approved. */
    assert.ok(read);
    assert.strictEqual(read!.version, 1);
    assert.strictEqual(isTrusted(w.repo, read), true);
  } finally {
    w.clean();
  }
});
