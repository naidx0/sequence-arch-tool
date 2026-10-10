import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer, serverSettled } from '../server/repoServer.js';

/**
 * 0.1.5 G1: "I disconnected it. I reconnected it. Still nothing."
 *
 * The server kept what it had learnt about an agent's capabilities (the cached
 * answer, and the respawn gate's failures) by agent id, across a Disconnect
 * (DELETE /api/acp/agents/:id) and a Connect (POST /api/acp/agents/connect).
 * After three failed reads the gate stopped starting the agent until a person
 * asked with refresh=1, which the picker only offered once the chat was on the
 * agent: a reconnect, the obvious move, answered the same old error and
 * started nothing. Now both forget it, so the next read starts the agent.
 *
 * Every codex here is a FAKE in the test's own temp dir: `login status` says
 * "Logged in using ChatGPT"; the capabilities read is a process that prints a
 * reason and exits 2. No credential exists anywhere.
 */

const FAKE = `const [name, ...args] = process.argv.slice(2);
const a = args.join(' ');
if (a === '--version') process.stdout.write('codex-cli 0.153.4\\n');
else if (name === 'codex' && a === 'login status') process.stderr.write('Logged in using ChatGPT\\n');
else { process.stderr.write('unknown ' + a); process.exitCode = 2; }
`;
const DIES = `process.stderr.write('codex: config error in mcp_servers'); process.exit(2)`;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeCodex(dir: string): void {
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake.cjs" codex %*\r\n`);
    const bin = path.join(dir, 'node_modules', '@openai', 'codex', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'codex.js'), '/* the package entry the shim starts */\n');
  } else {
    const p = path.join(dir, 'codex');
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" codex "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

test('disconnect and connect forget a failed capabilities read: the next read starts the agent again', async () => {
  const bin = tempDir('seq-reconnect-bin-');
  const store = tempDir('seq-reconnect-store-');
  const work = tempDir('seq-reconnect-work-');
  fakeCodex(bin);
  let spawned = 0;
  const spawn = ((_cmd: string, _args: readonly string[], opts: childProcess.SpawnOptions) => {
    spawned++;
    return childProcess.spawn(process.execPath, ['-e', DIES], { ...opts, cwd: work });
  }) as unknown as typeof childProcess.spawn;
  const server = await createRepoServer(null, {
    webDist: undefined,
    browseRoot: work,
    recentStoreDir: store,
    userConfigDir: store,
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
    acpTurn: { spawn, killGraceMs: 0 },
    /* One failure and the gate gives up: the state a person meets after a few menu opens. */
    agentRespawn: { baseMs: 60_000, maxMs: 60_000, cap: 1 },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const caps = async () => {
    const r = await fetch(`${base}/api/acp/capabilities?agentRef=codex`);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const connect = () => fetch(`${base}/api/acp/agents/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'codex' }) });
  try {
    assert.equal((await connect()).status, 200);
    assert.equal((await caps()).status, 502);
    assert.equal(spawned, 1);
    /* Given up: no start, the old error (the control: nothing below works by itself). */
    const stuck = await caps();
    assert.equal(stuck.status, 503);
    assert.equal(stuck.body.gaveUp, true);
    assert.equal(spawned, 1);

    /* Disconnect, then Connect: the next read starts it again. */
    assert.equal((await fetch(`${base}/api/acp/agents/codex`, { method: 'DELETE' })).status, 200);
    assert.equal((await connect()).status, 200);
    const fresh = await caps();
    assert.equal(fresh.status, 502, JSON.stringify(fresh.body));
    assert.equal(spawned, 2, 'a reconnect starts the agent again');

    /* Connect alone (the picker's Connect on an agent already registered by an older page) forgets it too. */
    assert.equal((await caps()).status, 503);
    assert.equal((await connect()).status, 200);
    assert.equal((await caps()).status, 502);
    assert.equal(spawned, 3);

    /* Disconnect alone forgets it as well: a later registration starts clean. */
    assert.equal((await caps()).status, 503);
    assert.equal((await fetch(`${base}/api/acp/agents/codex`, { method: 'DELETE' })).status, 200);
    assert.equal((await connect()).status, 200);
    assert.equal((await caps()).status, 502);
    assert.equal(spawned, 4);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    for (const d of [bin, store, work]) fs.rmSync(d, { recursive: true, force: true });
  }
});
