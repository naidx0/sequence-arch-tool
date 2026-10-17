import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addAgent } from '../server/agentsStore.js';
import { bootMarks } from '../server/bootMarks.js';
import { goalRunState } from '../server/goalRunner.js';
import { createRepoServer } from '../server/repoServer.js';
import { sequenceMcpEntry } from '../server/sequenceMcp.js';
import { createSession, updateSession } from '../server/sessionsStore.js';

/**
 * A REPO WITH A GOAL RUN STILL WORKING IN IT KEEPS ITS CONTEXT, PAST THE CAP OF THREE; ONE WITHOUT LIVE WORK DOES NOT.
 *
 * Read: the `graphFromContext` boot mark an attach leaves when it was served from a parked context (no rescan), as
 * repo-contexts.test.ts reads it. The run is the mock ACP agent in `slow` mode (a turn takes six seconds), so no real
 * CLI and no network.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'goal-agent.mjs');
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('a context with a live goal lease survives more than MAX_REPO_CONTEXTS attaches; it is evicted by the first attach after the work ends', async () => {
  assert.ok(sequenceMcpEntry(), 'the MCP server must be built (packages/mcp/dist/server.js) for this test');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'goal-ctx-')));
  const names = 'abcdefghijk'.split('');
  const repos = names.map((n) => {
    const p = path.join(home, n);
    fs.cpSync(PLAINAPP, p, { recursive: true });
    return p;
  });
  const [A, ...others] = repos as [string, ...string[]];
  const store = path.join(home, '.sequence-user');
  fs.mkdirSync(store, { recursive: true });
  const log = path.join(home, 'agent.jsonl');
  addAgent(store, { id: 'mock', command: process.execPath, args: [FIXTURE, '--mode=slow', `--log=${log}`] });
  const events = (): Array<Record<string, any>> =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

  const made = createSession(A);
  updateSession(A, made.id, {
    goal: 'work the plan down',
    plan: Array.from({ length: 8 }, (_, i) => ({ id: `s${i + 1}`, text: `step number ${i + 1}`, status: 'open' as const })),
  });
  const id = made.id;

  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, recentStoreDir: store, browseRoot: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const attach = async (p: string): Promise<'context' | 'full'> => {
    const from = bootMarks().length;
    const res = await fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) });
    assert.strictEqual(res.status, 200, await res.clone().text());
    return bootMarks().slice(from).some((m) => m.name === 'graphFromContext') ? 'context' : 'full';
  };
  try {
    assert.strictEqual(await attach(A), 'full');
    const started = await fetch(`${base}/api/sessions/${id}/goal-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permission: 'build', agentRef: 'mock' }),
    });
    assert.strictEqual(started.status, 200, await started.clone().text());
    for (let i = 0; i < 100 && !events().some((e) => e.ev === 'slow-start'); i += 1) await sleep(100);
    assert.ok(events().some((e) => e.ev === 'slow-start'), 'the run is working');

    /* Five other repos: past the cap of three. */
    for (const p of others.slice(0, 5)) assert.strictEqual(await attach(p), 'full');
    assert.strictEqual(goalRunState(A, id).running, true, 'the run is still live');
    assert.strictEqual(await attach(A), 'context', 'A has live work: its context was not evicted, so coming back rescans nothing');

    /* Leave it again, fill the cache, then end the work while A is parked. */
    for (const p of others.slice(5, 9)) assert.strictEqual(await attach(p), 'full');
    const stop = await fetch(`${base}/api/sessions/${id}/goal-run/stop?repoPath=${encodeURIComponent(A)}`, { method: 'POST' });
    assert.strictEqual(stop.status, 200, await stop.clone().text());
    for (let i = 0; i < 100 && goalRunState(A, id).running; i += 1) await sleep(100);
    assert.strictEqual(goalRunState(A, id).running, false);
    await sleep(500);

    /* Nothing is evicted by the end of the work itself: the first attach after it does the evicting. */
    assert.strictEqual(await attach(others[9]!), 'full');
    assert.strictEqual(await attach(A), 'full', 'A had no live work any more and was the least recently used: it was evicted');
  } finally {
    await fetch(`${base}/api/sessions/${id}/goal-run/stop?repoPath=${encodeURIComponent(A)}`, { method: 'POST' }).catch(() => {});
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as import('node:http').Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
