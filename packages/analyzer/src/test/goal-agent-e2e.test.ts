import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addAgent } from '../server/agentsStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { sequenceMcpEntry } from '../server/sequenceMcp.js';
import { createSession, readSessionGoal, updateSession } from '../server/sessionsStore.js';

/**
 * A GOAL RUN ON AN AGENT, END TO END: the real server, the real run-node path, the real
 * Sequence MCP server (a child process the agent spawns from the mcpServers it is given) and its
 * `goal` tool, with only the agent itself a mock (packages/acp/src/test/fixtures/goal-agent.mjs).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'goal-agent.mjs');
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

interface Srv {
  base: string;
  events: () => Array<Record<string, any>>;
  close: () => Promise<void>;
}

async function startServer(repo: string | null, mode: string, userConfigDir = tmp('goal-e2e-user-')): Promise<Srv> {
  assert.ok(sequenceMcpEntry(), 'the MCP server must be built (packages/mcp/dist/server.js) for this test');
  const log = path.join(tmp('goal-e2e-log-'), 'agent.jsonl');
  addAgent(userConfigDir, { id: 'mock', command: process.execPath, args: [FIXTURE, `--mode=${mode}`, `--log=${log}`] });
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    events: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

function seed(repo: string, steps: string[]): string {
  const made = createSession(repo);
  updateSession(repo, made.id, { goal: 'work the plan down', plan: steps.map((text, i) => ({ id: `s${i + 1}`, text, status: 'open' as const })) });
  return made.id;
}

const post = (base: string, id: string, body: object): Promise<Response> =>
  fetch(`${base}/api/sessions/${id}/goal-run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function ended(base: string, id: string, ms = 90_000): Promise<{ running: boolean; turns: number; lastStopReason?: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = (await (await fetch(`${base}/api/sessions/${id}/goal-run`)).json()) as { running: boolean; turns: number; lastStopReason?: string };
    if (!s.running) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the goal run did not end');
}

const planOf = (repo: string, id: string): string[] => (readSessionGoal(repo, id).plan ?? []).map((s) => `${s.status}:${s.text}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const THREE = ['alpha step one', 'beta step two', 'gamma step three'];

test('R1 a 3-step goal on a ticking agent completes through the real MCP goal tool and ends audited', async () => {
  const repo = tmp('goal-e2e-repo-');
  const id = seed(repo, THREE);
  const s = await startServer(repo, 'tick');
  try {
    const res = await post(s.base, id, { permission: 'build', agentRef: 'mock' });
    assert.strictEqual(res.status, 200, await res.clone().text());
    const end = await ended(s.base, id);
    assert.deepStrictEqual(planOf(repo, id), THREE.map((t) => `done:${t}`));
    assert.strictEqual(end.lastStopReason, 'audited_pass');
    assert.ok(s.events().filter((e) => e.ev === 'tick').every((e) => !e.r.isError), 'no tick was refused');
  } finally {
    await s.close();
  }
});

test('R1b with no plan the agent writes it through the tool, then works it', async () => {
  const repo = tmp('goal-e2e-repo-');
  const made = createSession(repo);
  updateSession(repo, made.id, { goal: 'do three things' });
  const s = await startServer(repo, 'tick');
  try {
    assert.strictEqual((await post(s.base, made.id, { permission: 'build', agentRef: 'mock' })).status, 200);
    await ended(s.base, made.id);
    assert.deepStrictEqual(planOf(repo, made.id), THREE.map((t) => `done:${t}`));
  } finally {
    await s.close();
  }
});

test('R3 Stop cancels the in-flight agent turn: it does not finish the step afterwards', async () => {
  const repo = tmp('goal-e2e-repo-');
  const id = seed(repo, THREE.slice(0, 2));
  const s = await startServer(repo, 'slow');
  try {
    await post(s.base, id, { permission: 'build', agentRef: 'mock' });
    for (let i = 0; i < 100 && !s.events().some((e) => e.ev === 'slow-start'); i += 1) await sleep(100);
    assert.ok(s.events().some((e) => e.ev === 'slow-start'), 'the turn started');
    assert.strictEqual((await fetch(`${s.base}/api/sessions/${id}/goal-run/stop`, { method: 'POST' })).status, 200);
    await sleep(8000);
    const ev = s.events();
    assert.ok(!ev.some((e) => e.ev === 'slow-finished'), 'the agent did not keep working after Stop');
    const pid = ev.find((e) => e.ev === 'start')!.pid as number;
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.ok(!alive, 'the agent process was ended');
    assert.deepStrictEqual(planOf(repo, id), ['open:alpha step one', 'open:beta step two']);
  } finally {
    await s.close();
  }
});

test('R4 two goals in two chats at once tick only their own plans', async () => {
  const repo = tmp('goal-e2e-repo-');
  const a = seed(repo, THREE);
  const b = seed(repo, THREE);
  const s = await startServer(repo, 'tick');
  try {
    const [ra, rb] = await Promise.all([post(s.base, a, { permission: 'build', agentRef: 'mock' }), post(s.base, b, { permission: 'build', agentRef: 'mock' })]);
    assert.strictEqual(ra.status, 200);
    assert.strictEqual(rb.status, 200);
    await Promise.all([ended(s.base, a), ended(s.base, b)]);
    assert.deepStrictEqual(planOf(repo, a), THREE.map((t) => `done:${t}`));
    assert.deepStrictEqual(planOf(repo, b), THREE.map((t) => `done:${t}`));
    assert.strictEqual(s.events().filter((e) => e.ev === 'tick').length, 6);
  } finally {
    await s.close();
  }
});

test('R10 two chats ticking 60 steps each from two agent processes lose no tick', async () => {
  const repo = tmp('goal-e2e-repo-');
  const N = 60;
  const steps = Array.from({ length: N }, (_, i) => `step number ${String(i).padStart(3, '0')} done`);
  const a = seed(repo, steps);
  const b = seed(repo, steps);
  const s = await startServer(repo, 'many');
  try {
    await Promise.all([post(s.base, a, { permission: 'build', agentRef: 'mock' }), post(s.base, b, { permission: 'build', agentRef: 'mock' })]);
    await Promise.all([ended(s.base, a, 180_000), ended(s.base, b, 180_000)]);
    const done = [a, b].map((id) => (readSessionGoal(repo, id).plan ?? []).filter((x) => x.status === 'done').length);
    assert.deepStrictEqual(done, [N, N], 'every successful tick persisted');
    assert.deepStrictEqual(s.events().filter((e) => e.ev === 'many').map((e) => e.bad), [0, 0]);
  } finally {
    await s.close();
  }
});

test('R5 an agent that prints a LATER step as done while the first is current ticks nothing', async () => {
  const repo = tmp('goal-e2e-repo-');
  const id = seed(repo, THREE);
  const s = await startServer(repo, 'textwrong');
  try {
    await post(s.base, id, { permission: 'build', agentRef: 'mock' });
    await ended(s.base, id);
    const plan = planOf(repo, id);
    assert.ok(!plan.includes('done:beta step two'), `step 2 was ticked out of order: ${plan.join(' | ')}`);
  } finally {
    await s.close();
  }
});

test('R6 the tick route refuses a call without the run key, and a run key for another chat', async () => {
  const repo = tmp('goal-e2e-repo-');
  const id = seed(repo, THREE.slice(0, 1));
  const other = seed(repo, ['other step']);
  const s = await startServer(repo, 'slow');
  try {
    await post(s.base, id, { permission: 'build', agentRef: 'mock' });
    for (let i = 0; i < 100 && !s.events().some((e) => e.ev === 'slow-start'); i += 1) await sleep(100);
    for (const body of [{ chat: id, key: 'guess', op: 'mark_step_done', step: 'alpha' }, { chat: other, key: 'guess', op: 'mark_step_done', step: 'other' }, { op: 'mark_step_done', step: 'alpha' }]) {
      const r = await fetch(`${s.base}/api/goal-tick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.strictEqual(r.status, 403);
    }
    await fetch(`${s.base}/api/sessions/${id}/goal-run/stop`, { method: 'POST' });
    assert.deepStrictEqual(planOf(repo, other), ['open:other step']);
    assert.deepStrictEqual(planOf(repo, id), ['open:alpha step one']);
  } finally {
    await s.close();
  }
});

test('R9 with no project open, an agent goal is refused at the door and no agent starts', async () => {
  const ws = tmp('goal-e2e-ws-');
  const userConfigDir = path.join(ws, '.sequence-user');
  fs.mkdirSync(userConfigDir, { recursive: true });
  const made = createSession(ws);
  updateSession(ws, made.id, { goal: 'g', plan: [{ id: 's1', text: 'alpha step one', status: 'open' }] });
  const s = await startServer(null, 'tick', userConfigDir);
  try {
    const res = await post(s.base, made.id, { permission: 'build', agentRef: 'mock' });
    assert.strictEqual(res.status, 400);
    assert.match(((await res.json()) as { error?: string }).error ?? '', /open this chat's project first/);
    assert.strictEqual(s.events().length, 0, 'no agent was spawned');
  } finally {
    await s.close();
  }
});

test('K1 a real run key is refused for another chat, and for its own chat once the run has ended', async () => {
  const repo = tmp('goal-e2e-repo-');
  const id = seed(repo, THREE.slice(0, 1));
  const other = seed(repo, ['other step']);
  const s = await startServer(repo, 'slow');
  const tick = (chat: string, key: string): Promise<Response> =>
    fetch(`${s.base}/api/goal-tick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat, key, op: 'mark_step_done', step: 'step' }) });
  try {
    await post(s.base, id, { permission: 'build', agentRef: 'mock' });
    for (let i = 0; i < 100 && !s.events().some((e) => e.ev === 'slow-start'); i += 1) await sleep(100);
    const key = (s.events().find((e) => e.ev === 'newSession' || e.ev === 'resumeSession')?.goalEnv as Array<{ key?: string }>)[0]!.key!;
    assert.ok(key, 'the agent session was given a run key');
    assert.strictEqual((await tick(other, key)).status, 403, 'a real key for another chat');
    await fetch(`${s.base}/api/sessions/${id}/goal-run/stop`, { method: 'POST' });
    await sleep(500);
    assert.strictEqual((await tick(id, key)).status, 403, 'the key after the run ended');
    assert.deepStrictEqual(planOf(repo, other), ['open:other step']);
  } finally {
    await s.close();
  }
});
