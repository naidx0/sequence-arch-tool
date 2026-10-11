import assert from 'node:assert/strict';
import test from 'node:test';

import { labelCluster } from '../cluster/cluster.js';

/**
 * A MODULE IS NEVER NAMED AFTER A FILE THAT NAMES A POSITION.
 *
 * When a cluster's files share no directory, the label falls back to its ANCHOR
 * — the member the rest of the service depends on most by PageRank. That is real
 * signal, and it is the right idea. But `basenameNoExt('__init__.py')` is
 * `'__init__'`, and `humanizeSegment` turns that into **"Init"**, so a Python
 * package marker got to name a module.
 *
 * Measured on ml-harness after the import resolver was fixed: the module holding
 * the Conductor, the Event Spine and the security middleware came back as
 * "Init". The same shape exists in every ecosystem this scanner reads —
 * `index.ts` in JavaScript, `mod.rs`-style `mod`, `main.go`, `setup.py` — and in
 * each case the filename says where the file sits in a package, not what the
 * code is. "Init" is not a worse name than "Top level"; it is a name that looks
 * specific while saying less.
 *
 * The anchor itself is still chosen and still used elsewhere. Only its use as a
 * NAME is vetoed, so the cluster falls through to the honest structural
 * statement instead.
 */

test('a package marker never names a module', () => {
  for (const marker of [
    'app/__init__.py',
    'app/__main__.py',
    'src/index.ts',
    'src/index.tsx',
    'cmd/main.go',
    'setup.py',
  ]) {
    const label = labelCluster(['app/conductor.py', 'app/events.py'], '.', marker, 'ml-harness');
    const normalised = label.toLowerCase().replace(/[^a-z]/g, '');
    assert.ok(
      !['init', 'main', 'index', 'setup', 'mod'].includes(normalised),
      `${marker} must not name a module, got ${JSON.stringify(label)}`,
    );
    assert.notEqual(label.trim(), '', `${marker} must still yield SOME label`);
  }
});

test('a real filename still names its module — the signal is kept', () => {
  const label = labelCluster(['app/conductor.py', 'app/events.py'], '.', 'app/conductor.py', 'ml-harness');
  assert.match(label, /conductor/i);
});

test('a shared directory still wins over any anchor', () => {
  // An explicit name always beats the anchor heuristic.
  const label = labelCluster(
    ['app/providers/ollama.py', 'app/providers/openai_compatible.py'],
    '.',
    'app/providers/__init__.py',
    'ml-harness',
  );
  assert.match(label, /provider/i);
});
