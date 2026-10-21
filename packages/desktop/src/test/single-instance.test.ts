import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { claimSingleInstance, showOrCreate, stopWithin, type WindowLike } from '../singleInstance.js';

/*
 * ROUND 7, A8: a double click while Sequence is already running (or left
 * running without a window) started a second app that waited ~6 s on the
 * first one's Chromium profile. The second launch now hands over and quits;
 * a quit never waits on the server for ever.
 */

const here = __dirname;

function fakeApp(locked: boolean) {
  const handlers: (() => void)[] = [];
  return {
    handlers,
    requestSingleInstanceLock: () => locked,
    on: (_e: 'second-instance', fn: () => void) => handlers.push(fn),
  };
}

test('the first launch holds the lock and answers a second one; a second launch is told to quit', () => {
  let shown = 0;
  const first = fakeApp(true);
  assert.equal(claimSingleInstance(first, { smoke: false, onSecondInstance: () => shown++ }), true);
  first.handlers.forEach((h) => h());
  assert.equal(shown, 1);
  assert.equal(claimSingleInstance(fakeApp(false), { smoke: false, onSecondInstance: () => {} }), false);
  /* A smoke run measures a fresh launch and never takes the lock. */
  const smoke = fakeApp(false);
  assert.equal(claimSingleInstance(smoke, { smoke: true, onSecondInstance: () => {} }), true);
  assert.equal(smoke.handlers.length, 0);
});

test('the running app shows its window, restoring a minimised or hidden one, or makes a new one', () => {
  const calls: string[] = [];
  const win = (o: Partial<Record<'destroyed' | 'minimized' | 'visible', boolean>>): WindowLike => ({
    isDestroyed: () => o.destroyed === true,
    isMinimized: () => o.minimized === true,
    restore: () => calls.push('restore'),
    isVisible: () => o.visible !== false,
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  });
  assert.equal(showOrCreate(win({ minimized: true, visible: false }), () => calls.push('create')), 'focused');
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
  calls.length = 0;
  assert.equal(showOrCreate(null, () => calls.push('create')), 'created');
  assert.equal(showOrCreate(win({ destroyed: true }), () => calls.push('create')), 'created');
  assert.deepEqual(calls, ['create', 'create']);
});

test('a teardown that hangs is given up on, so quitting ends the process', async () => {
  assert.equal(await stopWithin(() => new Promise(() => {}), 30), 'timeout');
  assert.equal(await stopWithin(async () => {}, 1000), 'stopped');
  assert.equal(await stopWithin(async () => { throw new Error('x'); }, 1000), 'stopped');
});

test('main.ts takes the lock before it starts anything, and bounds the quit', () => {
  const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'main.ts'), 'utf8');
  const lock = src.indexOf('claimSingleInstance(app');
  const ready = src.indexOf('app.whenReady().then(bootstrap)');
  assert.ok(lock > 0 && ready > lock, 'the lock is taken before the app boots');
  assert.match(src, /if \(!firstInstance\) app\.quit\(\);\s*else app\.whenReady\(\)\.then\(bootstrap\);/);
  assert.match(src, /stopWithin\(\(\) => controller\.stop\(\), \d+\)/);
});
