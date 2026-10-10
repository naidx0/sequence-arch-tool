import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { isTrusted, parseHookFile, runHooks } from '../server/hooks.js';
import { readHookFile, readHookTrust } from '../server/store.js';

/**
 * THE GATE THAT WAS ENFORCED BY PROSE.
 *
 * CANON reports this repository's own three gates as "enforced by prose" — a
 * rule nothing can enforce is a rule that holds until the round nobody has time
 * to read it. `pre-write` is where a project's rule becomes code, because
 * `PUT /api/file` is the only moment disk changes.
 *
 * This drives the same two store readers the route uses, so what is tested is
 * the path the server takes rather than a re-creation of it.
 */

function workspace(hooks: unknown, trusted: boolean) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hookhome-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hookrepo-'));
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'hooks.json'), JSON.stringify(hooks));
  if (trusted) {
    fs.writeFileSync(
      path.join(home, 'hook-trust.json'),
      JSON.stringify({ version: 1, trusted: [repo] }),
    );
  }
  return { home, repo, clean: () => {
    for (const d of [home, repo]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* Windows may still hold a killed child's cwd — the OS cleans temp. */
      }
    }
  } };
}

const REFUSE = {
  version: 1,
  hooks: {
    'pre-write': [
      {
        command: [
          process.execPath,
          '-e',
          'process.stderr.write("src/generated is not yours to edit"); process.exit(2);',
        ],
      },
    ],
  },
};

async function attemptWrite(home: string, repo: string) {
  return await runHooks('pre-write', {
    repoRoot: repo,
    file: readHookFile(repo),
    trusted: isTrusted(repo, readHookTrust(home)),
    payload: { path: 'src/generated/schema.ts' },
  });
}

test('a trusted repo’s pre-write hook BLOCKS the write, with its own reason', async () => {
  const w = workspace(REFUSE, true);
  try {
    const r = await attemptWrite(w.home, w.repo);
    assert.strictEqual(r.allowed, false);
    const blocked = r.outcomes.find((o) => o.kind === 'blocked');
    assert.ok(blocked, 'the hook blocked');
    /*
     * Verbatim, because the route turns this into the 403's body. A refusal a
     * user cannot get an explanation for is a wall, and the response to a wall
     * is to turn the hook off rather than read its source.
     */
    assert.match((blocked as { reason: string }).reason, /not yours to edit/);
  } finally {
    w.clean();
  }
});

test('THE SAME REPO, UNTRUSTED, runs nothing and the write proceeds', async () => {
  const w = workspace(REFUSE, false);
  try {
    const r = await attemptWrite(w.home, w.repo);
    /*
     * THE POSTURE, end to end. This repo declares a blocking hook and it does
     * not run, because the trust list is USER-level and the repo cannot write
     * it. Cloning a project can never grant itself the right to execute its own
     * code — and a repo that could block a write on attach could also run
     * anything else on attach.
     */
    assert.strictEqual(r.allowed, true);
    assert.deepStrictEqual(r.outcomes, []);
    assert.strictEqual(r.skipped, 'not-trusted');
  } finally {
    w.clean();
  }
});

test('trusting a DIFFERENT repo does not trust this one', async () => {
  const w = workspace(REFUSE, false);
  try {
    fs.writeFileSync(
      path.join(w.home, 'hook-trust.json'),
      JSON.stringify({ version: 1, trusted: [path.join(os.tmpdir(), 'some-other-repo')] }),
    );
    const r = await attemptWrite(w.home, w.repo);
    assert.strictEqual(r.skipped, 'not-trusted');
  } finally {
    w.clean();
  }
});

test('a repo with no hooks file is allowed and says which kind of nothing it was', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nohooks-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nohookhome-'));
  fs.writeFileSync(path.join(home, 'hook-trust.json'), JSON.stringify({ version: 1, trusted: [repo] }));
  try {
    const r = await runHooks('pre-write', {
      repoRoot: repo,
      file: readHookFile(repo),
      trusted: isTrusted(repo, readHookTrust(home)),
    });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.skipped, 'no-hooks');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a malformed hooks file does not break the write path', async () => {
  const w = workspace({ version: 1, hooks: { 'pre-write': 'not an array' } }, true);
  try {
    /* A file we half understand is one we must not run — but it must also not
       be a reason the server stops accepting writes. */
    const r = await attemptWrite(w.home, w.repo);
    assert.strictEqual(r.allowed, true);
  } finally {
    w.clean();
  }
});

test('a trust file with the wrong shape trusts nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-badtrust-'));
  try {
    fs.writeFileSync(path.join(home, 'hook-trust.json'), JSON.stringify({ trusted: '/everything' }));
    /* Failing CLOSED. A malformed trust file granting trust would be the one
       parse bug that turns into arbitrary code execution. */
    assert.strictEqual(readHookTrust(home), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the parser and the store agree — the route reads what the parser validated', () => {
  const w = workspace(REFUSE, true);
  try {
    const fromStore = readHookFile(w.repo);
    const fromParser = parseHookFile(REFUSE).file;
    assert.deepStrictEqual(fromStore, fromParser);
  } finally {
    w.clean();
  }
});
