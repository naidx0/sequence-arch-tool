/**
 * P3 — applyAskFileWrites locks Auto-edit disk writes without Accept.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyAskFileWrites,
  permissionAutoWrites,
} from '../server/applyAskFileWrites.js';

test('permissionAutoWrites: only autoEdit and full', () => {
  assert.equal(permissionAutoWrites('autoEdit'), true);
  assert.equal(permissionAutoWrites('full'), true);
  assert.equal(permissionAutoWrites('propose'), false);
  assert.equal(permissionAutoWrites('plan'), false);
  assert.equal(permissionAutoWrites(undefined), false);
});

test('applyAskFileWrites: writes jailed paths and refuses reserved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-apply-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const target = path.join(root, 'src', 'hello.ts');

  const ok = await applyAskFileWrites(
    [{ path: 'src/hello.ts', content: 'export const x = 1;\n' }],
    {
      repoRoot: root,
      resolveWritable: (rel) => {
        if (rel.includes('.git') || rel.includes('.sequence')) return null;
        return path.join(root, rel);
      },
      runPreWriteHook: async () => ({ allowed: true }),
    },
  );
  assert.deepEqual(ok.written, ['src/hello.ts']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'export const x = 1;\n');

  const refused = await applyAskFileWrites(
    [{ path: '.sequence/ai.json', content: '{}' }],
    {
      repoRoot: root,
      resolveWritable: () => null,
      runPreWriteHook: async () => ({ allowed: true }),
    },
  );
  assert.equal(refused.written.length, 0);
  assert.equal(refused.refused[0]?.path, '.sequence/ai.json');
});

/*
 * P10 / audit gap G1 — the agent's own writes must be visible to rewind.
 *
 * `trackSessionWrite` records a file's PRE-write state as its baseline, so the
 * hook has to fire after the hook gate (a hook-refused batch writes nothing and
 * must baseline nothing) and BEFORE the bytes land. This test pins the ORDER by
 * reading the file from inside the hook: if the write has already happened,
 * the hook sees the new content, which is exactly the "rewind past the first
 * touch is a no-op" defect the store's header warns about.
 */
test('applyAskFileWrites: trackWrite fires after the hook gate and BEFORE the write lands', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-apply-track-'));
  fs.writeFileSync(path.join(root, 'a.ts'), 'before\n');
  const order: string[] = [];
  const seenAtTrack: Record<string, string | null> = {};

  const result = await applyAskFileWrites(
    [
      { path: 'a.ts', content: 'after\n' },
      { path: 'b.ts', content: 'new\n' },
    ],
    {
      repoRoot: root,
      resolveWritable: (rel) => path.join(root, rel),
      runPreWriteHook: async (rel) => {
        order.push(`hook:${rel}`);
        return { allowed: true };
      },
      trackWrite: (rel) => {
        order.push(`track:${rel}`);
        const abs = path.join(root, rel);
        seenAtTrack[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      },
    },
  );

  assert.deepEqual(result.written, ['a.ts', 'b.ts']);
  assert.deepEqual(
    order,
    ['hook:a.ts', 'hook:b.ts', 'track:a.ts', 'track:b.ts'],
    'every hook runs before any tracking, and each path is tracked exactly once',
  );
  assert.equal(seenAtTrack['a.ts'], 'before\n', 'tracking saw the PRE-write content');
  assert.equal(seenAtTrack['b.ts'], null, 'tracking saw the new file as absent, not as its new content');
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), 'after\n');
  assert.equal(fs.readFileSync(path.join(root, 'b.ts'), 'utf8'), 'new\n');
});

test('applyAskFileWrites: a hook-refused batch tracks nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-apply-track-hook-'));
  const tracked: string[] = [];
  const result = await applyAskFileWrites(
    [{ path: 'a.ts', content: 'a' }],
    {
      repoRoot: root,
      resolveWritable: (rel) => path.join(root, rel),
      runPreWriteHook: async () => ({ allowed: false, reason: 'blocked by hook' }),
      trackWrite: (rel) => tracked.push(rel),
    },
  );
  assert.equal(result.blockedByHook, 'blocked by hook');
  assert.deepEqual(tracked, [], 'a path that will not be written must not enter the tracked set');
});

test('applyAskFileWrites: a tracking failure never fails the write', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-apply-track-throw-'));
  const result = await applyAskFileWrites(
    [{ path: 'a.ts', content: 'written anyway\n' }],
    {
      repoRoot: root,
      resolveWritable: (rel) => path.join(root, rel),
      runPreWriteHook: async () => ({ allowed: true }),
      trackWrite: () => {
        throw new Error('cannot checkpoint a.ts: simulated store failure');
      },
    },
  );
  assert.deepEqual(result.written, ['a.ts'], 'the user asked for the edit; bookkeeping failing does not refuse it');
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), 'written anyway\n');
});

test('applyAskFileWrites: pre-write hook blocks the whole batch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-apply-hook-'));
  const result = await applyAskFileWrites(
    [{ path: 'a.ts', content: 'a' }],
    {
      repoRoot: root,
      resolveWritable: (rel) => path.join(root, rel),
      runPreWriteHook: async () => ({ allowed: false, reason: 'blocked by hook' }),
    },
  );
  assert.equal(result.written.length, 0);
  assert.equal(result.blockedByHook, 'blocked by hook');
  assert.equal(fs.existsSync(path.join(root, 'a.ts')), false);
});
