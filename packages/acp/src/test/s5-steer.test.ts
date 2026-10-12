/**
 * S5: STEERING A RUNNING CODEX TURN, AND THE QUEUE BEHIND IT (not run live).
 *
 * The real CodexAppServerClient against replays of fixtures built from the
 * binary's own protocol types (codex-s5/, `live: false`). The replay checks
 * every message the client sends is the one the fixture expects next, so a
 * steer sent at the wrong moment, or a queued text sent before the turn
 * settled, is a divergence. ManualClock; nothing sleeps.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { AcpClient } from '../client.js';
import { CodexAppServerClient } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn, type ReplayHandle } from '../replay/codexReplay.js';
import { formatFixture, readFixture, type Fixture, type Json } from '../replay/fixture.js';
import { QUEUED, QUEUED_AFTER_REFUSAL, STEER_TEXT } from '../replay/codexS5Fixtures.js';
import { s5Files } from '../replay/bin/make-s5-fixtures.js';
import { canSteer, codexSteer, steerRefusal, type Rpc, type SteerOutcome } from '../steer.js';

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

/** The client's own `steer` (codexAppServer.ts): what POST /api/acp/steer calls. */
function steerOf(client: CodexAppServerClient): (text: string) => Promise<SteerOutcome> {
  assert.ok(canSteer(client), 'CodexAppServerClient carries steer');
  return (t) => client.steer(t);
}

async function rig(fixture: Fixture): Promise<{ h: ReplayHandle; client: CodexAppServerClient; cwd: string }> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s5-'));
  const h = replaySpawn(fixture, { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const client = new CodexAppServerClient({ command: 'codex', cwd, accessMode: 'autoEdit', spawn: h.spawn, killGraceMs: 0 });
  await driven(() => h.drain(), client.start());
  await driven(() => h.drain(), client.newSession(cwd));
  return { h, client, cwd };
}

const sent = (h: ReplayHandle, method: string): Json[] => h.replay.received.filter((m) => m.method === method);
const textOf = (m: Json): string => (((m.params as Json).input as Json[])[0] as Json).text as string;

/** Drain until the replay waits for the client to send `method` next (the moment the person types). */
async function untilClientSends(h: ReplayHandle, method: string): Promise<void> {
  const next = (): Json | undefined => {
    const f = h.replay.fixture.frames[h.replay.state.cursor];
    return f && f.dir === 'c2s' ? f.msg : undefined;
  };
  for (let i = 0; i < 1000 && !(h.replay.waitingOnClient && next()?.method === method); i++) await h.drain();
  assert.equal(next()?.method, method, `the replay is waiting for the client to send ${method}`);
}

const S5_FIXTURE = (name: string): Fixture => readFixture(s5Files().find((f) => f.fixture.header.scenario === name)!.file);

test('the checked-in codex-s5 fixtures are what codexS5Fixtures.ts builds, and say "not run live"', () => {
  for (const { file, fixture } of s5Files()) {
    assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), formatFixture(fixture), path.basename(file));
    assert.equal(fixture.header.live, false);
    assert.match(fixture.header.covers, /not run live/);
    assert.ok(fixture.header.notRunLive);
  }
});

test('steer-mid-turn (not run live): Enter mid-turn sends turn/steer with the active turn id, and the same turn answers both', async () => {
  const { h, client, cwd } = await rig(S5_FIXTURE('steer-mid-turn'));
  try {
    const answer = client.prompt('Fix the failing parser test.');
    await untilClientSends(h, 'turn/steer');
    const outcome = await driven(() => h.drain(), steerOf(client)(STEER_TEXT));
    assert.deepEqual(outcome, { steered: true, turnId: 'turn-steer-1' });
    const steer = sent(h, 'turn/steer');
    assert.equal(steer.length, 1);
    assert.equal((steer[0]!.params as Json).expectedTurnId, 'turn-steer-1');
    assert.equal((steer[0]!.params as Json).threadId, 'thread-steer-1');
    assert.equal(textOf(steer[0]!), STEER_TEXT);
    const r = await driven(() => h.drain(), answer);
    assert.equal(r.stopReason, 'end_turn');
    assert.equal(r.text, 'Fixed the parser test. README updated too.');
    assert.equal(sent(h, 'turn/start').length, 1, 'steering started no second turn');
    assert.deepEqual(h.replay.state.divergences, []);
    assert.equal(h.replay.state.finished, true);
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('steer-refused-then-queued (not run live): a review turn refuses the steer, nothing is lost: the text goes as the next turn once this one settles', async () => {
  const { h, client, cwd } = await rig(S5_FIXTURE('steer-refused-then-queued'));
  try {
    const first = client.prompt('Review the parser change.');
    await untilClientSends(h, 'turn/steer');
    const outcome = await driven(() => h.drain(), steerOf(client)(QUEUED_AFTER_REFUSAL));
    assert.equal(outcome.steered, false);
    assert.equal(outcome.steered === false && outcome.reason, 'not-steerable');
    /* The caller's fallback: queue it, and send it when the turn settles. */
    const queue = [QUEUED_AFTER_REFUSAL];
    assert.equal((await driven(() => h.drain(), first)).text, 'Review: two findings.');
    const next = await driven(() => h.drain(), client.prompt(queue.shift()!));
    assert.equal(next.text, 'Summary: both findings are in the parser.');
    const starts = sent(h, 'turn/start');
    assert.equal(starts.length, 2);
    assert.equal(textOf(starts[1]!), QUEUED_AFTER_REFUSAL);
    assert.deepEqual(h.replay.state.divergences, []);
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('queue-two-in-order (not run live): queued texts go only after the running turn settles, first to last, on the same thread', async () => {
  const { h, client, cwd } = await rig(S5_FIXTURE('queue-two-in-order'));
  try {
    const queue: string[] = [...QUEUED];
    const running = client.prompt('Fix the failing parser test.');
    const texts = [(await driven(() => h.drain(), running)).text];
    /* The turn has settled and the replay now waits for the next turn/start:
       nothing queued went while the first turn ran (that would have been a
       divergence: the fixture expects codex to speak then, not the client). */
    await untilClientSends(h, 'turn/start');
    assert.equal(sent(h, 'turn/start').length, 1);
    while (queue.length > 0) texts.push((await driven(() => h.drain(), client.prompt(queue.shift()!))).text);
    assert.deepEqual(texts, ['Fixed it.', 'Tests pass.', 'Committed.']);
    const starts = sent(h, 'turn/start');
    assert.deepEqual(starts.slice(1).map(textOf), [...QUEUED]);
    assert.ok(starts.every((m) => (m.params as Json).threadId === 'thread-queue-1'));
    assert.deepEqual(h.replay.state.divergences, []);
    assert.equal(h.replay.state.finished, true);
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('codexSteer: no active turn is an outcome, never a request; a blank text is refused', async () => {
  let calls = 0;
  const rpc: Rpc = async () => {
    calls += 1;
    return {};
  };
  assert.deepEqual(await codexSteer(rpc, undefined, 'x'), { steered: false, reason: 'no-active-turn' });
  assert.deepEqual(await codexSteer(rpc, { threadId: 't' }, 'x'), { steered: false, reason: 'no-active-turn' });
  assert.equal((await codexSteer(rpc, { threadId: 't', turnId: 'u' }, '  ')).steered, false);
  assert.equal(calls, 0);
});

test('steerRefusal classifies what codex says', () => {
  assert.equal(steerRefusal(new Error('codex app-server: active turn is not steerable (-32600)')).reason, 'not-steerable');
  assert.equal(steerRefusal(new Error('codex app-server: expected turn id does not match (-32600)')).reason, 'turn-changed');
  assert.equal(steerRefusal(new Error('codex app-server: Method not found (-32601)')).reason, 'unsupported');
  assert.equal(steerRefusal(new Error('boom')).reason, 'rejected');
});

test('ACP agents have no steer: canSteer is false, so the composer queues', () => {
  const acp = new AcpClient({ command: process.execPath, args: [] });
  assert.equal(canSteer(acp), false);
});
