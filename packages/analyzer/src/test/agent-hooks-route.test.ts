import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';

/* S2b: the Agents panel's "Start Claude Code with hooks" asks the server for
   this session's hook settings. The file is fresh (never ~/.claude), points
   every hook at THIS server's port, and the answer is the command to run. */

test('POST /api/agent-hooks/claude writes a per-session settings file for this server and answers the command', async () => {
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hooks-cfg-')));
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  let file = '';
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/api/agent-hooks/claude`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { settingsFile: string; command: string };
    file = body.settingsFile;
    assert.equal(body.command, `claude --settings "${file}"`);
    assert.notEqual(path.resolve(file), path.resolve(os.homedir(), '.claude', 'settings.json'));
    const settings = JSON.parse(fs.readFileSync(file, 'utf8')) as { hooks: Record<string, { hooks: { url: string }[] }[]> };
    assert.equal(settings.hooks.UserPromptSubmit![0]!.hooks[0]!.url, `http://127.0.0.1:${port}/api/agent-event`);
    /* Not a form post: a plain cross-site request cannot trigger it. */
    const plain = await fetch(`http://127.0.0.1:${port}/api/agent-hooks/claude`, { method: 'POST', body: 'x' });
    assert.equal(plain.status, 415);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    if (file) fs.rmSync(path.dirname(file), { recursive: true, force: true });
    fs.rmSync(userConfigDir, { recursive: true, force: true });
  }
});
