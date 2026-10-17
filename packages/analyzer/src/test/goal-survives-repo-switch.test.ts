import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addAgent } from '../server/agentsStore.js';
import { goalRunState } from '../server/goalRunner.js';
import { createRepoServer } from '../server/repoServer.js';
import { sequenceMcpEntry } from '../server/sequenceMcp.js';
import { createSession, readSessionGoal, updateSession } from '../server/sessionsStore.js';

/**
 * "START A GOAL, SWITCH REPOS AND BACK, AND IT IS STILL RUNNING" (audit P0-6).
 *
 * One engine, two repos. The agent is the repo's own mock (packages/acp/src/test/fixtures/goal-agent.mjs, mode `slow`:
 * a turn takes six seconds, then ticks its step through the real MCP goal tool), so there is no real CLI and no network.
 * What is read: the run row on disk under repo A, the plan on disk under repo A, and the mock's own log of its process.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'goal-agent.mjs');
const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('a goal run on an agent keeps running, in its own repo, while another repo is attached, and is the same run on return', async () => {
  assert.ok(sequenceMcpEntry(), 'the MCP server must be built (packages/mcp/dist/server.js) for this test');
  const parent = tmp('goal-switch-');
  const repoA = path.join(parent, 'a');
  const repoB = path.join(parent, 'b');
  for (const r of [repoA, repoB]) {
    fs.mkdirSync(r);
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: path.basename(r), version: '1.0.0' }));
  }
  const userConfigDir = tmp('goal-switch-user-');
  const log = path.join(tmp('goal-switch-log-'), 'agent.jsonl');
  addAgent(userConfigDir, { id: 'mock', command: process.execPath, args: [FIXTURE, '--mode=slow', `--log=${log}`] });
  const events = (): Array<Record<string, any>> =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

  const made = createSession(repoA);
  updateSession(repoA, made.id, {
    goal: 'work the plan down',
    plan: ['alpha step one', 'beta step two'].map((text, i) => ({ id: `s${i + 1}`, text, status: 'open' as const })),
  });
  const id = made.id;

  const server = await createRepoServer(repoA, { webDist: undefined, userConfigDir, browseRoot: parent });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const attach = (p: string): Promise<Response> =>
    fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: p }) });
  const planOf = (): string[] => (readSessionGoal(repoA, id).plan ?? []).map((s) => `${s.status}:${s.text}`);
  try {
    const started = await fetch(`${base}/api/sessions/${id}/goal-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permission: 'build', agentRef: 'mock' }),
    });
    assert.strictEqual(started.status, 200, await started.clone().text());
    for (let i = 0; i < 100 && !events().some((e) => e.ev === 'slow-start'); i += 1) await sleep(100);
    assert.ok(events().some((e) => e.ev === 'slow-start'), 'the first turn started');
    const before = goalRunState(repoA, id);
    assert.strictEqual(before.running, true);
    assert.ok(before.startedAt, 'the run has a start stamp: that is its identity');
    const agentPid = events().find((e) => e.ev === 'start')!.pid as number;

    /* Leave A for B while the turn is in flight. */
    assert.strictEqual((await attach(repoB)).status, 200);
    assert.strictEqual(path.resolve(((await (await fetch(`${base}/api/status`)).json()) as { root: string }).root), path.resolve(repoB));

    /* The run goes on in A: the turn that was in flight finishes and ticks step one, and step two is then taken. */
    for (let i = 0; i < 300 && !planOf()[0]?.startsWith('done:'); i += 1) await sleep(100);
    assert.strictEqual(planOf()[0], 'done:alpha step one', 'the in-flight turn finished and ticked A\'s plan');
    for (let i = 0; i < 100 && events().filter((e) => e.ev === 'slow-start').length < 2; i += 1) await sleep(100);
    assert.strictEqual(goalRunState(repoA, id).running, true, 'the run is still running with B attached');
    assert.ok(events().filter((e) => e.ev === 'slow-start').length >= 2, 'the next turn started while B was attached');
    assert.deepStrictEqual([...new Set(events().filter((e) => e.ev === 'start').map((e) => e.pid))], [agentPid], 'one agent process served every turn: it was not ended by the switch');
    assert.strictEqual(readSessionGoal(repoB, id).plan, undefined, 'nothing was ticked in B');

    /* Back to A: the same run, reported running or finished normally. */
    assert.strictEqual((await attach(repoA)).status, 200);
    const mid = (await (await fetch(`${base}/api/sessions/${id}/goal-run`)).json()) as { running: boolean; turns: number; startedAt?: string };
    assert.strictEqual(mid.startedAt, before.startedAt, 'the same run (same start stamp)');
    assert.ok(mid.turns >= 1, 'progress continued');
    let end = mid;
    for (let i = 0; i < 900 && end.running; i += 1) {
      await sleep(100);
      end = (await (await fetch(`${base}/api/sessions/${id}/goal-run`)).json()) as typeof mid;
    }
    const final = end as typeof mid & { lastStopReason?: string };
    assert.strictEqual(final.running, false);
    assert.strictEqual(final.startedAt, before.startedAt);
    assert.strictEqual(final.lastStopReason, 'audited_pass');
    assert.deepStrictEqual(planOf(), ['done:alpha step one', 'done:beta step two']);
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});

test('a respawned agent for the goal run in A, while B is attached, still gets the goal tool', async () => {
  assert.ok(sequenceMcpEntry(), 'the MCP server must be built (packages/mcp/dist/server.js) for this test');
  const parent = tmp('goal-switch-tool-');
  const repoA = path.join(parent, 'a');
  const repoB = path.join(parent, 'b');
  for (const r of [repoA, repoB]) {
    fs.mkdirSync(r);
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: path.basename(r), version: '1.0.0' }));
  }
  const userConfigDir = tmp('goal-switch-tool-user-');
  const log = path.join(tmp('goal-switch-tool-log-'), 'agent.jsonl');
  addAgent(userConfigDir, { id: 'mock', command: process.execPath, args: [FIXTURE, '--mode=slow', `--log=${log}`] });
  const events = (): Array<Record<string, any>> =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const made = createSession(repoA);
  updateSession(repoA, made.id, {
    goal: 'work the plan down',
    plan: ['alpha step one', 'beta step two', 'gamma step three'].map((text, i) => ({ id: `s${i + 1}`, text, status: 'open' as const })),
  });
  const id = made.id;
  const server = await createRepoServer(repoA, { webDist: undefined, userConfigDir, browseRoot: parent });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const started = await fetch(`${base}/api/sessions/${id}/goal-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permission: 'build', agentRef: 'mock' }),
    });
    assert.strictEqual(started.status, 200, await started.clone().text());
    for (let i = 0; i < 100 && !events().some((e) => e.ev === 'slow-start'); i += 1) await sleep(100);
    const firstPid = events().find((e) => e.ev === 'start')!.pid as number;
    const at = await fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repoB }) });
    assert.strictEqual(at.status, 200);
    /* Second turn in flight with B attached: end the agent process so the next turn has to start a new one. */
    for (let i = 0; i < 200 && events().filter((e) => e.ev === 'slow-start').length < 2; i += 1) await sleep(100);
    process.kill(firstPid);
    const opened = (): Array<Record<string, any>> => events().filter((e) => e.pid !== firstPid && (e.ev === 'newSession' || e.ev === 'resumeSession'));
    for (let i = 0; i < 200 && opened().length < 1; i += 1) await sleep(100);
    assert.ok(opened().length >= 1, 'the agent was respawned and opened a session');
    const chats = (opened()[0]!.goalEnv as Array<{ chat: string | null } | string | null>).map((g) => (g !== null && typeof g === 'object' ? g.chat : g));
    assert.deepStrictEqual(chats, [id], 'the respawned agent was given the goal tool for the run in A while B is attached');
  } finally {
    await fetch(`${base}/api/sessions/${id}/goal-run/stop?repoPath=${encodeURIComponent(repoA)}`, { method: 'POST' }).catch(() => {});
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
