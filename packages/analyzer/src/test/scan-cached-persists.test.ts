import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanRepoCached } from '../server/graphCache.js';
import { resetTrackedMemo } from '../server/trackedSequence.js';

/**
 * THE MCP FIRST-SCAN FLAKE. A cache write is held back while git's tracked set is unknown and replayed when git answers,
 * so `scanRepoCached` could return with `.sequence/graph.json` not yet on disk, and the answer built on it
 * ("scanned just now") lost its freshness line. Returning from `scanRepoCached` now means the graph is persisted.
 */
test('scanRepoCached has persisted graph.json by the time it returns, even when git has not yet said what is tracked', async () => {
  for (let i = 0; i < 6; i++) {
    resetTrackedMemo(); /* git's answer is unknown again: the write is held back */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-scan-persist-'));
    try {
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"tiny","version":"1.0.0"}');
      fs.writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\n');
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'init', '-q'], { cwd: root });
      await scanRepoCached(root, { cluster: true });
      assert.ok(fs.existsSync(path.join(root, '.sequence', 'graph.json')), `round ${i}: graph.json is on disk when the scan returns`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }
});
