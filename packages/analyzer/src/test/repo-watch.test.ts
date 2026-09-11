/**
 * P5 — repoWatch unit locks (ignore policy + debounce + stop).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { FSWatcher, WatchOptions } from 'node:fs';
import { EventEmitter } from 'node:events';

import {
  REPO_WATCH_DEBOUNCE_MS,
  shouldIgnoreWatchPath,
  startRepoWatch,
} from '../server/repoWatch.js';

test('shouldIgnoreWatchPath skips IGNORE_DIRS and .sequence', () => {
  assert.equal(shouldIgnoreWatchPath('src/app.ts'), false);
  assert.equal(shouldIgnoreWatchPath('node_modules/pkg/index.js'), true);
  assert.equal(shouldIgnoreWatchPath('dist/out.js'), true);
  assert.equal(shouldIgnoreWatchPath('.git/HEAD'), true);
  assert.equal(shouldIgnoreWatchPath('.sequence/sessions/x/chat.json'), true);
  assert.equal(shouldIgnoreWatchPath('pkg/.DS_Store'), true);
});

test('startRepoWatch debounces and reports relative paths; stop silences further events', async () => {
  const seen: string[][] = [];
  const callbacks: Array<(event: string, filename: string | null) => void> = [];
  const fakeWatcher = new EventEmitter() as EventEmitter & FSWatcher;
  fakeWatcher.close = () => undefined;

  const watch = ((
    _root: string,
    _opts: WatchOptions | undefined,
    cb?: (event: string, filename: string | null) => void,
  ): FSWatcher => {
    if (cb) callbacks.push(cb);
    return fakeWatcher;
  }) as unknown as typeof import('node:fs').watch;

  const handle = startRepoWatch('/tmp/repo', {
    debounceMs: 30,
    watch,
    onChange: (paths) => {
      seen.push([...paths]);
    },
  });

  assert.equal(callbacks.length, 1);
  const listener = callbacks[0]!;
  listener('change', 'src/a.ts');
  listener('change', 'src/b.ts');
  listener('change', 'node_modules/x.js');

  await new Promise((r) => setTimeout(r, 80));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.sort(), ['src/a.ts', 'src/b.ts']);

  handle.stop();
  listener('change', 'src/c.ts');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(seen.length, 1, 'stop() must not deliver further batches');
  assert.equal(handle.root, null);
});

test('REPO_WATCH_DEBOUNCE_MS is positive', () => {
  assert.ok(REPO_WATCH_DEBOUNCE_MS > 0);
});
