import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { programAgentLaunch } from '../programRun.js';
import { writeComponentSettings } from '../components/settings.js';

/* S2a: a CLI program run given --repo runs its agents there with the board;
   without one, nothing is guessed. */

test("program run --repo: an agent node runs in the repo (or worktree) and gets Sequence's board server for it; without --repo it keeps its own cwd and gets no board", () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-program-board-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-program-repo-'));
  try {
    const entry = { id: 'codex', command: 'codex', cwd: path.join(os.tmpdir(), 'elsewhere') };
    const withRepo = programAgentLaunch(entry, { repo, storeDir: store });
    assert.equal(withRepo.cwd, path.resolve(repo));
    assert.equal(withRepo.mcpServers?.length, 1);
    const board = withRepo.mcpServers![0]!;
    assert.equal(board.name, 'sequence');
    /* The mode the person set is carried, so a load with no app to ask cannot be looser than approve. */
    assert.deepEqual(board.env, { SEQUENCE_REPO: path.resolve(repo), SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_COMPONENTS_MODE: 'approve' });
    writeComponentSettings(store, { mode: 'manual' });
    assert.deepEqual(programAgentLaunch(entry, { repo, storeDir: store }).mcpServers![0]!.env, { SEQUENCE_REPO: path.resolve(repo), SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_MCP_COMPONENTS: 'off', SEQUENCE_COMPONENTS_MODE: 'manual' });
    const without = programAgentLaunch(entry, { storeDir: store });
    assert.equal(without.cwd, entry.cwd);
    assert.equal(without.mcpServers, undefined);
  } finally {
    fs.rmSync(store, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
