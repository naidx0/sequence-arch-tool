import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { killTree } from '../client.js';

/* Windows: an agent started through npx or cmd.exe is a grandchild of the process Sequence holds, so
   stopping it must end the whole tree (taskkill /T /F), or it keeps running after Stop. */

test('killTree asks taskkill for the whole tree, forcefully, by pid', async () => {
  const calls: [string, string[]][] = [];
  await killTree(4321, async (file, args) => {
    calls.push([file, args]);
  });
  assert.equal(calls.length, 1);
  assert.equal(path.basename(calls[0]![0]).toLowerCase(), 'taskkill.exe');
  assert.deepEqual(calls[0]![1], ['/pid', '4321', '/T', '/F']);
});

test('killTree ignores a pid that is not one, and never rejects', async () => {
  const calls: unknown[] = [];
  const note = async (): Promise<void> => {
    calls.push(1);
  };
  await killTree(0, note);
  await killTree(-5, note);
  await killTree(1.5, note);
  assert.equal(calls.length, 0);
  await killTree(7, () => {
    throw new Error('no taskkill here');
  });
  await killTree(7, async () => {
    throw new Error('taskkill failed');
  });
});
