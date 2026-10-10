import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';

import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { agentSpecimen } from './support/agentServer.js';

/**
 * ROUND 7, A1: A FAILING AGENT IS NOT STARTED AGAIN BY EVERY CALLER.
 *
 * Jaden: "infinitely opening and closing different terminals". Each model
 * menu open and composer mount asked for the agent's capabilities, a failure
 * cached nothing, and the next ask started the agent again. Now a failure
 * backs off (doubling) and after three in a row the server stops starting it
 * and answers with the last error until a person asks again (refresh=1).
 *
 * The agent is a real process that prints a reason and exits 2.
 */

const DIES = `process.stderr.write('codex: config error in mcp_servers'); process.exit(2)`;

test('capabilities: a dying agent is started at most once per backoff window and not at all after the cap', async () => {
  const s = agentSpecimen({ id: 'codex', command: 'codex' });
  let spawned = 0;
  const spawn = ((_cmd: string, _args: readonly string[], opts: childProcess.SpawnOptions) => {
    spawned++;
    return childProcess.spawn(process.execPath, ['-e', DIES], { ...opts, cwd: s.work });
  }) as unknown as typeof childProcess.spawn;
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: s.store,
    acpTurn: { spawn, killGraceMs: 0 },
    agentRespawn: { baseMs: 150, maxMs: 1000, cap: 3 },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const get = async (q = '') => {
    const r = await fetch(`${base}/api/acp/capabilities?agentRef=codex${q}`);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const first = await get();
    assert.equal(first.status, 502);
    assert.match(String(first.body.error), /config error in mcp_servers/);
    assert.equal(spawned, 1);

    /* Five more asks at once, inside the wait: none starts the agent. */
    const burst = await Promise.all([get(), get(), get(), get(), get()]);
    assert.deepEqual(burst.map((b) => b.status), [503, 503, 503, 503, 503]);
    assert.equal(spawned, 1, 'no spawn inside the backoff window');
    assert.equal(burst[0]!.body.gaveUp, false);

    await sleep(170);
    assert.equal((await get()).status, 502);
    assert.equal(spawned, 2);
    await sleep(320);
    assert.equal((await get()).status, 502);
    assert.equal(spawned, 3);

    /* The cap: no more starts, however long it waits; one clear error. */
    await sleep(1100);
    const capped = await get();
    assert.equal(capped.status, 503);
    assert.equal(capped.body.gaveUp, true);
    assert.match(String(capped.body.error), /config error in mcp_servers/);
    assert.equal(spawned, 3);

    /* A person's Retry starts it again. */
    assert.equal((await get('&refresh=1')).status, 502);
    assert.equal(spawned, 4);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
