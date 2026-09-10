import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listAgents,
  addAgent,
  removeAgent,
  getAgent,
} from '../server/agentsStore.js';
import { AGENTS_FILE } from '../server/store.js';

/**
 * Round-trip lock for the USER-LEVEL local-agent registry (~/.sequence/agents.json,
 * v16 Wave 2a): add/list/remove/get, upsert-by-id, and poison-resistance — mirroring
 * the store.ts github.json hardening (a malformed file never throws).
 */

/** A private temp dir standing in for `~/.sequence`, so tests never touch real home. */
function tempStoreDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-agents-')));
}

test('add → list → get → remove round-trips, and persists to agents.json', () => {
  const dir = tempStoreDir();
  assert.deepStrictEqual(listAgents(dir), [], 'empty store lists nothing');
  assert.strictEqual(getAgent(dir, 'claude'), undefined);

  addAgent(dir, { id: 'claude', command: 'npx', args: ['claude-code-acp'], label: 'Claude Code' });
  addAgent(dir, { id: 'codex', command: 'codex-acp', cwd: '/tmp/repo' });

  const all = listAgents(dir);
  assert.strictEqual(all.length, 2);
  const claude = getAgent(dir, 'claude');
  assert.ok(claude);
  assert.strictEqual(claude.command, 'npx');
  assert.deepStrictEqual(claude.args, ['claude-code-acp']);
  assert.strictEqual(claude.label, 'Claude Code');
  assert.strictEqual(getAgent(dir, 'codex')?.cwd, '/tmp/repo');

  // It really wrote agents.json.
  assert.ok(fs.existsSync(path.join(dir, AGENTS_FILE)), 'agents.json exists on disk');

  const rem = removeAgent(dir, 'claude');
  assert.strictEqual(rem.removed, true);
  assert.strictEqual(rem.agents.length, 1);
  assert.strictEqual(getAgent(dir, 'claude'), undefined);
  assert.ok(getAgent(dir, 'codex'), 'the other agent survives removal');
});

test('add REPLACES an existing id (upsert, no duplicates)', () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'a', command: 'first' });
  addAgent(dir, { id: 'a', command: 'second', label: 'updated' });
  const all = listAgents(dir);
  assert.strictEqual(all.length, 1, 'same id upserts, never duplicates');
  assert.strictEqual(all[0].command, 'second');
  assert.strictEqual(all[0].label, 'updated');
});

test('remove of a missing id reports removed:false (no silent pretend)', () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'a', command: 'x' });
  const rem = removeAgent(dir, 'does-not-exist');
  assert.strictEqual(rem.removed, false);
  assert.strictEqual(rem.agents.length, 1);
});

test('add rejects an entry with no id / no command (honest throw)', () => {
  const dir = tempStoreDir();
  assert.throws(() => addAgent(dir, { id: '', command: 'x' }), /non-empty/);
  assert.throws(() => addAgent(dir, { id: 'a', command: '   ' }), /non-empty/);
});

test('a poisoned / malformed agents.json yields an empty list, never a throw', () => {
  const dir = tempStoreDir();
  fs.writeFileSync(path.join(dir, AGENTS_FILE), '{ this is not json');
  assert.deepStrictEqual(listAgents(dir), []);

  // A structurally-valid file with junk entries: only the well-formed one survives.
  fs.writeFileSync(
    path.join(dir, AGENTS_FILE),
    JSON.stringify({ agents: [{ id: 'ok', command: 'bin' }, { id: 'bad' }, 42, null] })
  );
  const all = listAgents(dir);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].id, 'ok');
});
