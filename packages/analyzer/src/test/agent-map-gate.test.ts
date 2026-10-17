import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ThreadNoteLedger } from '../harness/refineNotes.js';
import { agentMapBlockForThread, writeAgentSettings } from '../server/askAgentMap.js';

/* Settings says "Off: the agent gets no map" when the main switch is off, so the
   Claude/Codex sub-setting must not send it on its own (review of 0.1.8 agent parity). */
test('the map reaches Claude/Codex only when both the map and "also send it to Claude and Codex" are on', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mapgate-'));
  try {
    const repo = path.join(tmp, 'repo');
    const store = path.join(tmp, 'store');
    fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(repo, '.sequence', 'map.md'), '# map repo · 2 services\n\n## services\n- web\n- api\n');
    const block = (key: string) =>
      agentMapBlockForThread({ storeDir: store, repoRoot: repo, designMode: false, key, thread: 't1', ledger: new ThreadNoteLedger() });

    writeAgentSettings(store, { includeArchitectureMap: true, mapToAgents: true });
    assert.ok(block('both-on'), 'positive control: both on sends the map');

    writeAgentSettings(store, { includeArchitectureMap: false, mapToAgents: true });
    assert.equal(block('main-off'), null, 'main switch off: nothing goes to the agents');

    writeAgentSettings(store, { includeArchitectureMap: true, mapToAgents: false });
    assert.equal(block('sub-off'), null, 'sub-setting off (the default): nothing goes to the agents');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
