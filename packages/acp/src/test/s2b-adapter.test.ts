/**
 * S2b IN THE ADAPTERS: what the CLI is doing, in ACP's words.
 *
 * Recorded frames go through the translator and the real clients:
 *   - live edit-with-plan: codex's goal (its plan), token usage and rate
 *     limits become plan_update / usage_update / session_info_update
 *   - todo-plan-synthetic (not run live): turn/plan/updated becomes plan
 *   - codex-s2b (not run live): model/list + skills/list, a turn on a chosen
 *     model and effort, a compaction
 *   - claude-plan-mode (not run live): config options, commands, usage,
 *     todos and ExitPlanMode through AcpClient
 * Nothing sleeps.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AcpClient } from '../client.js';
import { CodexAppServerClient } from '../codexAppServer.js';
import { codexUpdate } from '../codexUpdates.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { readFixture, type Json } from '../replay/fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'replay');

async function driven<T>(drain: () => Promise<void>, step: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  step.then(
    (v) => ((done = true), (value = v)),
    (e) => ((done = true), (error = e)),
  );
  for (let i = 0; i < 1000 && !done; i++) await drain();
  if (!done) throw new Error('the adapter did not settle while the replay drained');
  if (error) throw error;
  return value as T;
}

const s2c = (dir: string, name: string, method: string) =>
  readFixture(path.join(ROOT, dir, `${name}.jsonl`)).frames.filter((f) => f.dir === 's2c' && f.msg.method === method).map((f) => f.msg.params as Json);

/* ── the translator, on recorded frames ─────────────────────────────────── */

test('live edit-with-plan: codex\'s goal is its plan (plan_update, markdown), with the goal status kept', () => {
  const goals = s2c('codex', 'edit-with-plan', 'thread/goal/updated');
  assert.ok(goals.length >= 2);
  const u = codexUpdate('thread/goal/updated', goals[0]!) as Json;
  assert.equal(u.sessionUpdate, 'plan_update');
  const plan = u.plan as Json;
  assert.equal(plan.type, 'markdown');
  assert.match(String(plan.content), /^Three-step plan: 1\) inspect the target file/);
  assert.match(String(plan.planId), /^goal:01a10ef1-/);
  assert.equal(((u._meta as Json).codex as Json & { goal: Json }).goal.status, 'active');
});

test('live edit-with-plan: token usage is context used of the window; the limits are the account\'s', () => {
  const usage = s2c('codex', 'edit-with-plan', 'thread/tokenUsage/updated');
  const u = codexUpdate('thread/tokenUsage/updated', usage.at(-1)!) as Json;
  assert.deepEqual([u.sessionUpdate, u.used, u.size], ['usage_update', ((usage.at(-1)!.tokenUsage as Json).last as Json).totalTokens, 258_400]);
  assert.equal(u.used, 24_528, 'the last turn total, not the thread total');
  const limits = s2c('codex', 'edit-with-plan', 'account/rateLimits/updated');
  const r = codexUpdate('account/rateLimits/updated', limits.at(-1)!) as Json;
  assert.equal(r.sessionUpdate, 'session_info_update');
  assert.deepEqual(((r._meta as Json).sequence as Json).rateLimits, { plan: 'free', primary: { usedPercent: 52, windowMins: 43200, resetsAt: 1791837379 }, secondary: null });
});

test('live edit-with-plan: each reasoning item is a thought, started and ended in codex\'s own times (for "Thought for N s")', async () => {
  const fixture = readFixture(path.join(ROOT, 'codex', 'edit-with-plan.jsonl'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s2b-'));
  const h = replaySpawn(fixture, { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const updates: Json[] = [];
  const answers = [...(fixture.header.answers ?? [])];
  const client = new CodexAppServerClient({
    command: 'codex',
    cwd,
    accessMode: (fixture.header.accessMode ?? 'propose') as 'propose',
    spawn: h.spawn,
    onUpdate: (n) => updates.push(n.update as unknown as Json),
    onPermission: async () => answers.shift() ?? 'deny',
  });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(cwd));
    await driven(() => h.drain(), client.prompt(fixture.header.prompt ?? 'replay'));
    assert.deepEqual(h.replay.state.divergences, []);
    const started = s2c('codex', 'edit-with-plan', 'item/started').filter((p) => (p.item as Json).type === 'reasoning');
    const completed = s2c('codex', 'edit-with-plan', 'item/completed').filter((p) => (p.item as Json).type === 'reasoning');
    const thoughts = updates.filter((u) => u.sessionUpdate === 'agent_thought_chunk').map((u) => (u._meta as { sequence: Json }).sequence);
    assert.ok(started.length >= 1);
    assert.equal(thoughts.length, started.length + completed.length, 'one start and one end per reasoning item');
    const first = String((started[0]!.item as Json).id);
    const pair = thoughts.filter((t) => t.id === first);
    assert.deepEqual(pair.map((t) => t.thought), ['start', 'end']);
    assert.equal((pair[1]!.at as number) - (pair[0]!.at as number), 12_198, 'the first thought took 12.2 s on the recording');
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('todo-plan-synthetic (not run live): turn/plan/updated is the todo list (ACP plan entries)', () => {
  const plans = s2c('codex', 'todo-plan-synthetic', 'turn/plan/updated');
  const first = codexUpdate('turn/plan/updated', plans[0]!) as Json;
  assert.deepEqual(
    (first.entries as Json[]).map((e) => [e.content, e.status]),
    [
      ['Inspect module setup and imports', 'in_progress'],
      ['Inspect request handlers', 'pending'],
      ['Summarise what the file does', 'pending'],
    ],
  );
  const last = codexUpdate('turn/plan/updated', plans.at(-1)!) as Json;
  assert.ok((last.entries as Json[]).every((e) => e.status === 'completed'));
  assert.equal(((last._meta as Json).codex as Json).explanation, 'All three steps done.');
});

test('a notification with nothing to say translates to nothing', () => {
  assert.equal(codexUpdate('thread/goal/updated', { goal: { objective: '  ' } }), null);
  assert.equal(codexUpdate('thread/tokenUsage/updated', { tokenUsage: {} }), null);
  assert.equal(codexUpdate('warning', {}), null);
});

/* ── through the codex client ───────────────────────────────────────────── */

async function codex(dir: string, name: string) {
  const fixture = readFixture(path.join(ROOT, dir, `${name}.jsonl`));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s2b-'));
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const updates: Json[] = [];
  const client = new CodexAppServerClient({ command: 'codex', cwd, accessMode: 'propose', spawn: h.spawn, onUpdate: (n) => updates.push(n.update as unknown as Json) });
  await driven(() => h.drain(), client.start());
  return { client, h, cwd, updates, done: async () => (await client.dispose(), fs.rmSync(cwd, { recursive: true, force: true })) };
}

test('codex capabilities (not run live): model/list fills the picker (hidden models left out), skills/list the / menu (disabled left out)', async () => {
  const c = await codex('codex-s2b', 'capabilities');
  try {
    const caps = await driven(() => c.h.drain(), c.client.capabilities());
    assert.deepEqual(c.h.replay.state.divergences, []);
    assert.deepEqual(
      caps.models.map((m) => [m.id, m.name, m.efforts.join('/'), m.defaultEffort, m.isDefault ?? false]),
      [
        ['gpt-5-codex', 'GPT-5 Codex', 'low/medium/high', 'medium', true],
        ['gpt-5', 'GPT-5', 'minimal/low/medium/high', 'medium', false],
      ],
    );
    assert.deepEqual(caps.skills, [{ name: 'release-notes', description: 'Release notes from git' }]);
    assert.equal((c.h.replay.received.find((m) => m.method === 'skills/list')!.params as Json & { cwds: string[] }).cwds[0], c.cwd);
  } finally {
    await c.done();
  }
});

test('codex model-effort-turn (not run live): the chosen model and effort go on turn/start', async () => {
  const c = await codex('codex-s2b', 'model-effort-turn');
  try {
    await driven(() => c.h.drain(), c.client.newSession(c.cwd));
    await c.client.setTurnConfig({ model: 'gpt-5', effort: 'high' });
    const r = await driven(() => c.h.drain(), c.client.prompt('hi'));
    assert.equal(r.text, 'Answered on GPT-5, high effort.');
    const start = c.h.replay.received.find((m) => m.method === 'turn/start')!.params as Json;
    assert.deepEqual([start.model, start.effort], ['gpt-5', 'high']);
    assert.deepEqual(c.h.replay.state.divergences, []);
  } finally {
    await c.done();
  }
});

test('codex compact (not run live): thread/compact/start runs as a turn and ends when codex completes it; usage drops', async () => {
  const c = await codex('codex-s2b', 'compact');
  try {
    await driven(() => c.h.drain(), c.client.newSession(c.cwd));
    const r = await driven(() => c.h.drain(), c.client.compact());
    assert.equal(r.stopReason, 'end_turn');
    assert.deepEqual(c.h.replay.state.divergences, []);
    assert.equal(c.h.replay.state.finished, true);
    const usage = c.updates.filter((u) => u.sessionUpdate === 'usage_update');
    assert.deepEqual(usage.map((u) => u.used), [12_000]);
  } finally {
    await c.done();
  }
});

/* ── through the ACP client (Claude, not run live) ──────────────────────── */

test('claude-plan-mode (not run live): config options, commands, usage, todos and ExitPlanMode reach the stream; capabilities read them', async () => {
  const fixture = readFixture(path.join(ROOT, 'claude', 'claude-plan-mode.jsonl'));
  fixture.frames.at(-1)!.msg.result = { stopReason: 'end_turn', usage: { totalTokens: 155, inputTokens: 100, outputTokens: 20, cachedReadTokens: 30, cachedWriteTokens: 5 } };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s2b-acp-'));
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd } });
  const updates: Json[] = [];
  const asked: Json[] = [];
  const client = new AcpClient({
    command: 'claude-agent-acp',
    cwd,
    accessMode: 'plan',
    spawn: h.spawn,
    onUpdate: (n) => updates.push(n.update as unknown as Json),
    onPermission: async (r) => {
      asked.push(r as unknown as Json);
      return 'allow' as const;
    },
  });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(cwd));
    const caps = await driven(() => h.drain(), client.capabilities(undefined, 0));
    assert.deepEqual(caps.models.map((m) => m.id), ['sonnet', 'opus']);
    assert.deepEqual(caps.efforts, ['low', 'medium', 'high']);
    const r = await driven(() => h.drain(), client.prompt('Plan adding a ping endpoint.'));
    assert.equal(r.stopReason, 'end_turn');
    assert.deepEqual((r as unknown as Json).usage, { input: 100, output: 20, cacheRead: 30, cacheWrite: 5, thought: 0, total: 155 }, 'prompt usage is retained separately from context used/size');
    assert.deepEqual(h.replay.divergences, []);
    const kinds = updates.map((u) => u.sessionUpdate);
    for (const k of ['config_option_update', 'available_commands_update', 'usage_update', 'plan', 'current_mode_update']) assert.ok(kinds.includes(k), k);
    assert.deepEqual(
      (await client.capabilities(undefined, 0)).commands.map((c) => c.name),
      ['compact', 'review', 'init'],
    );
    assert.equal(asked.length, 1);
    const exit = asked[0]!.toolCall as Json;
    assert.equal(exit.kind, 'switch_mode');
    assert.match(String((exit.rawInput as Json).plan), /^## Plan/);
    assert.equal((h.replay.received.find((m) => m.method === 'session/set_mode')!.params as Json).modeId, 'plan');
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
