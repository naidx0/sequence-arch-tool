import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn } from '@sequence/acp/dist/replay/codexReplay.js';
import type { Json } from '@sequence/acp/dist/replay/fixture.js';

import { agentSpecimen, replayFixture, serveAgent, sseGolden, streamTurn, updatesOf, whileDraining } from './support/agentServer.js';
import { REPLAY_FIXTURES } from './support/replayRunNode.js';

/**
 * S2b THROUGH THE REAL SERVER: what the CLI is doing reaches the stream;
 * what it offers reaches /api/acp/capabilities; a chosen model and effort
 * and a compaction reach the agent. The agent is a replay; fixtures marked
 * "not run live" were built from the protocol types.
 *
 * The streams are kept as goldens under fixtures/replay/sse-s2b/ for web2.
 */

const CODEX = { id: 'codex', command: 'codex' };

test('live edit-with-plan: the goal (plan_update), usage and rate limits reach the stream', async () => {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex', 'edit-with-plan'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serveAgent(s.store, h, clock);
  try {
    const events = await streamTurn(srv.base, { agentRef: 'codex', prompt: 'go', permissionMode: 'autoEdit', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.match(String((updatesOf(events, 'plan_update')[0]!.plan as Json).content), /^Three-step plan/);
    assert.ok(updatesOf(events, 'usage_update').length >= 2);
    assert.ok(updatesOf(events, 'session_info_update').some((u) => ((u._meta as Json)?.sequence as Json)?.rateLimits));
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('capabilities (not run live): GET /api/acp/capabilities asks the agent once and caches it; refresh=1 asks again', async () => {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-s2b', 'capabilities'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serveAgent(s.store, h, clock);
  try {
    const get = (q = '') => whileDraining(h, fetch(`${srv.base}/api/acp/capabilities?agentRef=codex${q}`).then(async (r) => ({ status: r.status, body: (await r.json()) as Json })));
    const first = await get();
    assert.strictEqual(first.status, 200);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.deepStrictEqual((first.body.models as Json[]).map((m) => m.id), ['gpt-5-codex', 'gpt-5']);
    assert.deepStrictEqual((first.body.skills as Json[]).map((k) => k.name), ['release-notes']);
    /* Kept for web2's picker and `/` tests (sse-s2b/capabilities.json). */
    const goldenFile = path.join(REPLAY_FIXTURES, 'sse-s2b', 'capabilities.json');
    const now = JSON.stringify(first.body, null, 2) + '\n';
    if (process.env.SEQUENCE_UPDATE_REPLAY === '1' || !fs.existsSync(goldenFile)) fs.writeFileSync(goldenFile, now);
    assert.strictEqual(fs.readFileSync(goldenFile, 'utf8').replace(/\r\n/g, '\n'), now);
    const again = await get();
    assert.deepStrictEqual(again.body, first.body);
    assert.strictEqual(h.spawned.length, 1, 'cached: one agent process for two asks');
    await get('&refresh=1');
    assert.strictEqual(h.spawned.length, 2, 'refresh asks again');
    const unknown = await fetch(`${srv.base}/api/acp/capabilities?agentRef=nope`);
    assert.strictEqual(unknown.status, 400);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('model-effort-turn (not run live): run-node config { model, effort } goes on codex turn/start', async () => {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-s2b', 'model-effort-turn'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serveAgent(s.store, h, clock);
  try {
    const events = await streamTurn(srv.base, { agentRef: 'codex', prompt: 'hi', permissionMode: 'propose', chatId: s.chatId, config: { model: 'gpt-5', effort: 'high' } }, h);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    const start = h.replay.received.find((m) => m.method === 'turn/start')!.params as Json;
    assert.deepStrictEqual([start.model, start.effort], ['gpt-5', 'high']);
    assert.strictEqual((events.find((e) => e.type === 'acp:result') as Json).text, 'Answered on GPT-5, high effort.');
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('compact (not run live): run-node { compact: true } runs thread/compact/start as a turn; the usage it reports drops', async () => {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-s2b', 'compact'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serveAgent(s.store, h, clock);
  try {
    const events = await streamTurn(srv.base, { agentRef: 'codex', prompt: '', compact: true, permissionMode: 'propose', chatId: s.chatId }, h);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.deepStrictEqual(updatesOf(events, 'usage_update').map((u) => [u.used, u.size]), [[12_000, 258_400]]);
    assert.deepStrictEqual(events.filter((e) => e.type === 'acp:turn').map((e) => e.state), ['ended', 'settled']);
    assert.equal(events.find(e => e.type === 'acp:result')?.operation, 'compact');
    sseGolden('sse-s2b', 'compact', events, s.work);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('claude-plan-mode (not run live): Plan maps to set_mode plan; ExitPlanMode is put to the person with its plan; Build answers allow', async () => {
  const s = agentSpecimen({ id: 'claude', command: 'claude-agent-acp' });
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('claude', 'claude-plan-mode'), { clock, values: { '<CWD>': s.work } });
  const srv = await serveAgent(s.store, h, clock);
  try {
    let proposal: Json | null = null;
    const events = await streamTurn(
      srv.base,
      { agentRef: 'claude', prompt: 'Plan adding a ping endpoint.', permissionMode: 'plan', sessionKey: `chat::${s.chatId}::claude`, chatId: s.chatId },
      h,
      async (e) => {
        if (e.type !== 'acp:permission' || e.pending !== true) return;
        proposal = e.proposal as Json;
        await fetch(`${srv.base}/api/acp/permission`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: e.requestId, decision: 'allow' }) });
      },
    );
    assert.deepStrictEqual(h.replay.divergences, []);
    assert.match(String(proposal!.plan), /^## Plan\n\n1\. Add `ping\(\)`/);
    for (const k of ['config_option_update', 'available_commands_update', 'usage_update', 'plan', 'current_mode_update']) assert.ok(updatesOf(events, k).length > 0, k);
    assert.deepStrictEqual(events.filter((e) => e.type === 'acp:turn').map((e) => e.state), ['ended', 'settled']);
    sseGolden('sse-s2b', 'claude-plan-mode', events, s.work);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
