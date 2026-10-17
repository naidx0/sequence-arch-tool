/**
 * Audit P1-11 — two runs writing the same file never interleave.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyAskFileWrites } from '../server/applyAskFileWrites.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(): { root: string; base: Parameters<typeof applyAskFileWrites>[1] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-lock-'));
  return {
    root,
    base: {
      repoRoot: root,
      resolveWritable: (rel) => path.join(root, rel),
      runPreWriteHook: async () => ({ allowed: true }),
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test('two runs writing the same files: one run then the other, never mixed', async () => {
  const { root, base } = setup();
  const gate = deferred();
  const reachedB = deferred();
  // Run 1 stalls between its two files (a slow checkpoint tracker), the exact
  // window where an unlocked run 2 lands its whole batch.
  const run1 = applyAskFileWrites(
    [
      { path: 'a.txt', content: 'ONE' },
      { path: 'b.txt', content: 'ONE' },
    ],
    {
      ...base,
      runId: 'run one',
      trackWrite: async (rel) => {
        if (rel === 'b.txt') {
          reachedB.resolve();
          await gate.promise;
        }
      },
    },
  );
  await reachedB.promise;
  const run2 = applyAskFileWrites(
    [
      { path: 'a.txt', content: 'TWO' },
      { path: 'b.txt', content: 'TWO' },
    ],
    { ...base, runId: 'run two' },
  );
  await tick();
  await tick();
  gate.resolve();
  await Promise.all([run1, run2]);
  const a = fs.readFileSync(path.join(root, 'a.txt'), 'utf8');
  const b = fs.readFileSync(path.join(root, 'b.txt'), 'utf8');
  assert.equal(a, b, `files were mixed: a=${a} b=${b}`);
  assert.equal(a, 'TWO', 'the later batch lands after the earlier one');
});

test('a run waiting on a held path gets a plain warning naming the wait', async () => {
  const { base } = setup();
  const gate = deferred();
  const held = deferred();
  const run1 = applyAskFileWrites([{ path: 'a.txt', content: 'ONE' }], {
    ...base,
    runId: 'run one',
    trackWrite: async () => {
      held.resolve();
      await gate.promise;
    },
  });
  await held.promise;
  const run2 = applyAskFileWrites([{ path: 'a.txt', content: 'TWO' }], { ...base, runId: 'run two' });
  await tick();
  gate.resolve();
  const [r1, r2] = await Promise.all([run1, run2]);
  assert.equal(r1.warnings, undefined, 'the holder has nothing to be warned about');
  assert.equal(r2.warnings?.length, 1);
  assert.match(r2.warnings![0]!, /^a\.txt was being changed by another run \(run one\); waited \d+\.\d s$/);
});

test('a wait that outlives the timeout is refused naming the other run; nothing is written', async () => {
  const { root, base } = setup();
  const gate = deferred();
  const held = deferred();
  const run1 = applyAskFileWrites([{ path: 'a.txt', content: 'ONE' }], {
    ...base,
    runId: 'run one',
    trackWrite: async () => {
      held.resolve();
      await gate.promise;
    },
  });
  await held.promise;
  const r2 = await applyAskFileWrites(
    [
      { path: 'free.txt', content: 'X' },
      { path: 'a.txt', content: 'TWO' },
    ],
    { ...base, runId: 'run two', lockTimeoutMs: 20 },
  );
  assert.deepEqual(r2.written, []);
  assert.equal(r2.refused.length, 1);
  assert.equal(r2.refused[0]!.path, 'a.txt');
  assert.match(r2.refused[0]!.reason, /run one/);
  assert.equal(fs.existsSync(path.join(root, 'free.txt')), false, 'all-or-nothing, and the partial lock is released');
  gate.resolve();
  await run1;
});

test('abort releases the lock: an aborted waiter is refused and the path is free again', async () => {
  const { root, base } = setup();
  const gate = deferred();
  const held = deferred();
  const run1 = applyAskFileWrites([{ path: 'a.txt', content: 'ONE' }], {
    ...base,
    runId: 'run one',
    trackWrite: async () => {
      held.resolve();
      await gate.promise;
    },
  });
  await held.promise;
  const ac = new AbortController();
  const run2 = applyAskFileWrites([{ path: 'a.txt', content: 'TWO' }], { ...base, runId: 'run two', signal: ac.signal });
  await tick();
  ac.abort();
  const r2 = await run2;
  assert.deepEqual(r2.written, []);
  assert.match(r2.refused[0]!.reason, /stopped while waiting/);
  gate.resolve();
  await run1;
  // The holder's lock was released too, so a fresh run does not wait.
  const r3 = await applyAskFileWrites([{ path: 'a.txt', content: 'THREE' }], { ...base, runId: 'run three', lockTimeoutMs: 20 });
  assert.deepEqual(r3.written, ['a.txt']);
  assert.equal(r3.warnings, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'THREE');
});

test('a throwing write releases the lock', async () => {
  const { root, base } = setup();
  fs.writeFileSync(path.join(root, 'blocker'), 'file');
  // mkdir under a regular file throws inside the locked section.
  await assert.rejects(
    applyAskFileWrites([{ path: 'blocker/x.txt', content: 'X' }], { ...base, runId: 'run one' }),
  );
  const r = await applyAskFileWrites([{ path: 'blocker/x.txt', content: 'X' }], { ...base, runId: 'run two', lockTimeoutMs: 20 }).catch((e: Error) => e);
  assert.ok(r instanceof Error && !/being changed by another run/.test(r.message), 'second call fails on the write, not on a stuck lock');
});

test('different files do not block each other', async () => {
  const { root, base } = setup();
  const gate = deferred();
  const held = deferred();
  const run1 = applyAskFileWrites([{ path: 'a.txt', content: 'ONE' }], {
    ...base,
    runId: 'run one',
    trackWrite: async () => {
      held.resolve();
      await gate.promise;
    },
  });
  await held.promise;
  const r2 = await applyAskFileWrites([{ path: 'b.txt', content: 'TWO' }], { ...base, runId: 'run two', lockTimeoutMs: 20 });
  assert.deepEqual(r2.written, ['b.txt']);
  assert.equal(r2.warnings, undefined);
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'TWO');
  gate.resolve();
  await run1;
});
