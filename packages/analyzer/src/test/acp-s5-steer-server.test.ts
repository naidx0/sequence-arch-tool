import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn, type ReplayHandle } from '@sequence/acp/dist/replay/codexReplay.js';
import type { Json } from '@sequence/acp/dist/replay/fixture.js';

import { readAgentRuns } from '../server/agentChatStore.js';
import { agentSpecimen, replayFixture, serveAgent, streamTurn } from './support/agentServer.js';

/**
 * S5 THROUGH THE REAL SERVER: POST /api/acp/steer reaches the turn the chat's
 * agent is running (the run-node session cache's live client, `peek`), and
 * every "no" is an answer the page can queue on. The agent is a replay of the
 * codex-s5 fixtures (not run live, built from the protocol types).
 */

const CODEX = { id: 'codex', command: 'codex' };

/** Wait (without sleeping) until the replay expects the client to send `method`. */
async function untilClientSends(h: ReplayHandle, method: string): Promise<void> {
  for (let i = 0; i < 20_000; i++) {
    const f = h.replay.fixture.frames[h.replay.state.cursor];
    if (h.replay.waitingOnClient && f?.dir === 'c2s' && f.msg.method === method) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`the replay never waited for ${method}`);
}

const steer = (base: string, body: Json) =>
  fetch(`${base}/api/acp/steer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: (await r.json()) as Json }));

async function midTurn(scenario: string, text: string): Promise<{ answer: { status: number; body: Json }; events: Json[]; h: ReplayHandle; saved: ReturnType<typeof readAgentRuns> }> {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-s5', scenario), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serveAgent(s.store, h, clock);
  const sessionKey = `chat::${s.chatId}::codex`;
  try {
    const turn = streamTurn(srv.base, { agentRef: 'codex', prompt: 'Fix the failing parser test.', permissionMode: 'autoEdit', sessionKey, chatId: s.chatId }, h);
    await untilClientSends(h, 'turn/steer');
    const answer = await steer(srv.base, { sessionKey, text });
    const events = await turn;
    return { answer, events, h, saved: readAgentRuns(s.root, s.chatId) };
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
}

test('steer-mid-turn (not run live): POST /api/acp/steer puts the words into the running turn (turn/steer, expectedTurnId); the same turn answers both', async () => {
  const { answer, events, h } = await midTurn('steer-mid-turn', 'Also update the README when you are done.');
  assert.deepStrictEqual(answer, { status: 200, body: { steered: true, turnId: 'turn-steer-1' } });
  assert.deepStrictEqual(h.replay.state.divergences, []);
  const sent = h.replay.received.filter((m) => m.method === 'turn/steer');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual((sent[0]!.params as Json).expectedTurnId, 'turn-steer-1');
  const result = events.find((e) => e.type === 'acp:result') as Json;
  assert.match(String(result.text), /Fixed the parser test\. README updated too\./);
});

test('steer-refused-then-queued (not run live): a review turn refuses; the route answers steered:false with the reason, so the page queues it', async () => {
  const { answer, h } = await midTurn('steer-refused-then-queued', 'Then summarise what the review found.');
  assert.strictEqual(answer.status, 200);
  assert.strictEqual(answer.body.steered, false);
  assert.strictEqual(answer.body.reason, 'not-steerable');
  assert.deepStrictEqual(h.replay.state.divergences, []);
});

test('no live agent session for the key: 409 { steered: false, reason: "no-steer" }; a bad body is a 400', async () => {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-s5', 'steer-mid-turn'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serveAgent(s.store, h, clock);
  try {
    assert.deepStrictEqual(await steer(srv.base, { sessionKey: 'chat::none::codex', text: 'hello' }), { status: 409, body: { steered: false, reason: 'no-steer' } });
    assert.strictEqual((await steer(srv.base, { sessionKey: 7 })).status, 400);
    assert.strictEqual(h.spawned.length, 0, 'asking to steer never starts an agent');
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a steer is saved with the turn it joined: the server record carries it, so a reload draws it (not the page alone)', async () => {
  const { answer, saved } = await midTurn('steer-mid-turn', 'Also update the README when you are done.');
  assert.strictEqual(answer.body.steered, true);
  const run = saved.at(-1)!;
  assert.strictEqual(run.status, 'done');
  assert.deepStrictEqual(run.steers?.map((x) => x.text), ['Also update the README when you are done.'], 'kept through the turn own later writes');
  assert.ok(typeof run.steers![0]!.at === 'number' && run.steers![0]!.at > 0);
});

test('a steer the agent refused is not saved as part of the turn', async () => {
  const { saved } = await midTurn('steer-refused-then-queued', 'Then summarise what the review found.');
  assert.strictEqual(saved.at(-1)?.steers, undefined);
});
