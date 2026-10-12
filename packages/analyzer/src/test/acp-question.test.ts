import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { resetCodexExperimentalCache } from '@sequence/acp/dist/codexAppServer.js';
import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn, type ReplayHandle } from '@sequence/acp/dist/replay/codexReplay.js';
import { LIVE_QUESTION, OPTION_ANSWERS } from '@sequence/acp/dist/replay/codexQuestionFixtures.js';
import { readFixture, type Fixture, type Json } from '@sequence/acp/dist/replay/fixture.js';

import { addAgent } from '../server/agentsStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { REPLAY_FIXTURES, normalizeEvents } from './support/replayRunNode.js';

/**
 * CODEX'S QUESTION REACHES THE PERSON, THROUGH run-node (the server relay).
 *
 * The agent is a replay of codex-question/* (built around the request codex
 * sent live in the gate's Plan turn), spawned in-process on a ManualClock the
 * server's idle watchdog shares. On an interactive stream the question is
 * announced as `acp:question` { pending, requestId, questions } and the turn
 * waits for POST /api/acp/question; whatever settles it is named on the
 * settling event. Nothing sleeps: the replay is drained, the clock is moved.
 */

const IDLE = 60_000;

function specimen(): { dir: string; store: string; work: string; chatId: string } {
  /* Each test's codex is asked afresh whether it offers plan mode (the fixtures record the probe). */
  resetCodexExperimentalCache();
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-question-')));
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  const work = path.join(dir, 'work');
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  addAgent(store, { id: 'codex', command: 'codex', cwd: work });
  return { dir, store, work, chatId };
}

async function serve(store: string, h: ReplayHandle, clock: ManualClock, timeoutMs = 24 * 60 * 60_000): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: store,
    acpTurn: { clock, idleMs: IDLE, spawn: h.spawn, killGraceMs: 0 },
    acpApprovalTimeoutMs: timeoutMs,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

async function turn(base: string, body: Json, h: ReplayHandle, onEvent: (e: Json) => Promise<void> | void = () => {}): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ agentRef: 'codex', ...body }),
  });
  assert.strictEqual(res.status, 200);
  const events: Json[] = [];
  let done = false;
  const pump = (async () => {
    while (!done) {
      await h.drain();
      await new Promise((r) => setImmediate(r));
    }
  })();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const e = JSON.parse(line.slice(6)) as Json;
          events.push(e);
          await onEvent(e);
        }
      }
    }
  } finally {
    done = true;
    await pump;
  }
  return events;
}

const post = (base: string, body: Json): Promise<Response> =>
  fetch(`${base}/api/acp/question`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const fixture = (name: string): Fixture => readFixture(path.join(REPLAY_FIXTURES, 'codex-question', `${name}.jsonl`));

/** The fixture with the client's recorded answer replaced. */
function answeredWith(f: Fixture, result: Json): Fixture {
  return { header: f.header, frames: f.frames.map((fr) => (fr.dir === 'c2s' && fr.msg.id === LIVE_QUESTION.id && fr.msg.method === undefined ? { ...fr, msg: { id: fr.msg.id, result } } : fr)) };
}

const questionEvents = (events: Json[]): Json[] => events.filter((e) => e.type === 'acp:question');
const states = (events: Json[]): unknown[] => events.filter((e) => e.type === 'acp:turn').map((e) => e.state);

interface Ran {
  events: Json[];
  h: ReplayHandle;
  statuses: number[];
  work: string;
}

async function run(f: Fixture, answer: (e: Json, clock: ManualClock, base: string) => Promise<Json | null>, opts: { interactive?: boolean; timeoutMs?: number; onSettled?: (e: Json, base: string) => Promise<void> } = {}): Promise<Ran> {
  const s = specimen();
  const clock = new ManualClock();
  const h = replaySpawn(f, { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock, opts.timeoutMs);
  const statuses: number[] = [];
  try {
    const events = await turn(
      srv.base,
      {
        prompt: f.header.prompt,
        permissionMode: 'plan',
        sessionKey: `chat::${s.chatId}::codex`,
        chatId: s.chatId,
        ...(opts.interactive === false ? {} : { interactivePermissions: true }),
      },
      h,
      async (e) => {
        if (e.type === 'acp:question' && e.pending === false) await opts.onSettled?.(e, srv.base);
        if (e.type !== 'acp:question' || e.pending !== true) return;
        const body = await answer(e, clock, srv.base);
        if (body) statuses.push((await post(srv.base, { requestId: e.requestId, ...body })).status);
      },
    );
    return { events, h, statuses, work: s.work };
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
}

test('question relay (live-recorded request): announced with its questions and options; the options chosen reach codex; the plan follows', async () => {
  const r = await run(fixture('plan-question'), async () => ({ answers: OPTION_ANSWERS }));
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.strictEqual(r.h.replay.state.finished, true);
  assert.deepStrictEqual(r.statuses, [200]);
  const [asked, settled] = questionEvents(r.events);
  assert.strictEqual(asked?.pending, true);
  assert.strictEqual(typeof asked?.requestId, 'string');
  assert.strictEqual(asked?.toolCallId, (LIVE_QUESTION.params as Json).itemId);
  const qs = asked?.questions as Json[];
  assert.deepStrictEqual(
    qs.map((q) => [q.id, q.header, q.question, (q.options as Json[]).length, q.isOther, q.isSecret]),
    ((LIVE_QUESTION.params as Json).questions as Json[]).map((q) => [q.id, q.header, q.question, (q.options as Json[]).length, q.isOther, q.isSecret]),
  );
  assert.deepStrictEqual([settled?.pending, settled?.answeredBy, settled?.answers], [false, 'person', OPTION_ANSWERS]);
  assert.deepStrictEqual(states(r.events), ['ended', 'settled']);
  assert.ok(r.events.some((e) => e.type === 'acp:update' && ((e.update as Json).update as Json).sessionUpdate === 'plan_update'), 'the plan arrived after the answer');
  /* The stream as web2 receives it: the golden its question card is tested against. */
  const file = path.join(REPLAY_FIXTURES, 'sse-question', 'plan-question.sse.jsonl');
  const now = normalizeEvents(r.events, r.work).map((e) => JSON.stringify(e)).join('\n') + '\n';
  if (process.env.SEQUENCE_UPDATE_REPLAY === '1' || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, now);
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), now, 'the stream matches sse-question/plan-question.sse.jsonl');
});

test('question relay: an answer in the person\'s own words reaches codex as written', async () => {
  const words = { health_scope: ['Liveness, and check the orders DB'], route_contract: ['Existing convention: match gateway'] };
  const want = { answers: { health_scope: { answers: words.health_scope }, route_contract: { answers: words.route_contract } } };
  const r = await run(answeredWith(fixture('plan-question'), want), async () => ({ answers: words }));
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.strictEqual(r.h.replay.state.finished, true);
  assert.deepStrictEqual(questionEvents(r.events)[1]?.answers, words);
});

test('question relay: Cancel answers codex with none, and the stream says the person cancelled', async () => {
  const r = await run(answeredWith(fixture('plan-question'), { answers: {} }), async () => ({ cancel: true }));
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.strictEqual(r.h.replay.state.finished, true);
  const settled = questionEvents(r.events)[1];
  assert.deepStrictEqual([settled?.answeredBy, settled?.answers], ['cancel', null]);
  assert.deepStrictEqual(states(r.events), ['ended', 'settled']);
});

test('question relay: ten idle periods waiting on the person is not a hang (the watchdog is paused)', async () => {
  let waited = 0;
  const r = await run(fixture('plan-question'), async (_e, clock) => {
    const t0 = clock.now();
    clock.advance(10 * IDLE);
    waited = clock.now() - t0;
    return { answers: OPTION_ANSWERS };
  });
  assert.strictEqual(waited, 10 * IDLE);
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.deepStrictEqual(states(r.events), ['ended', 'settled'], 'never hung');
  assert.strictEqual(questionEvents(r.events)[1]?.answeredBy, 'person');
});

test('question relay: the turn ends while the question waits; it settles as ended, codex is answered with none, a late answer is a 404', async () => {
  let late = 0;
  /* Nobody answers while it waits; an answer that comes once it has settled is refused. */
  const r = await run(fixture('plan-question-turn-ended'), async () => null, {
    onSettled: async (e, base) => {
      late = (await post(base, { requestId: e.requestId, answers: OPTION_ANSWERS })).status;
    },
  });
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.strictEqual(r.h.replay.state.finished, true, 'codex was answered { answers: {} }');
  const settled = questionEvents(r.events)[1];
  assert.deepStrictEqual([settled?.pending, settled?.answeredBy, settled?.answers], [false, 'ended', null]);
  assert.strictEqual(late, 404);
});

test('question relay without the opt-in: nobody is asked, codex is answered with none', async () => {
  const r = await run(answeredWith(fixture('plan-question'), { answers: {} }), async () => null, { interactive: false });
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.strictEqual(r.h.replay.state.finished, true);
  assert.strictEqual(questionEvents(r.events).length, 0);
});

test('POST /api/acp/question: an unknown request is a 404, a malformed answer a 400', async () => {
  const s = specimen();
  const clock = new ManualClock();
  const h = replaySpawn(fixture('plan-question'), { clock });
  const srv = await serve(s.store, h, clock);
  try {
    assert.strictEqual((await post(srv.base, { requestId: 'nope', answers: OPTION_ANSWERS })).status, 404);
    assert.strictEqual((await post(srv.base, { requestId: 'nope', cancel: true })).status, 404);
    assert.strictEqual((await post(srv.base, { requestId: 'nope', answers: { a: 'not a list' } })).status, 400);
    assert.strictEqual((await post(srv.base, { requestId: 'nope' })).status, 400);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

/* The live gate4 Plan turn (codex-question/plan-question-usage-limit): codex
   asked through request_user_input, took the answer, then the account's usage
   limit failed the turn. Literal values so this test reads only the recorded
   file, and fails on a server that still says retry. */
const USAGE_ANSWERS = { limit_strategy: ['Per API key (Recommended)'], counter_store: ['Redis (Recommended)'] };
const USAGE_RESETS_AT_MS = 1791837379 * 1000;

test('question relay then usage limit (live frames): both questions with their options, the answer in the recorded shape, and the turn ends as wait-until-reset, not retry', async () => {
  const f = fixture('plan-question-usage-limit');
  const r = await run(f, async (e) => ({ answers: Object.fromEntries((e.questions as Json[]).map((q) => [q.id, [((q.options as Json[])[0] as Json).label]])) }));
  assert.deepStrictEqual(r.h.replay.state.divergences, []);
  assert.strictEqual(r.h.replay.state.finished, true);
  assert.deepStrictEqual(r.statuses, [200]);
  const [asked, settled] = questionEvents(r.events);
  assert.deepStrictEqual(
    (asked?.questions as Json[]).map((q) => [q.id, (q.options as Json[]).map((o) => o.label)]),
    [
      ['limit_strategy', ['Per API key (Recommended)', 'Per user', 'Per IP']],
      ['counter_store', ['Redis (Recommended)', 'In-memory', 'Database']],
    ],
  );
  assert.deepStrictEqual([settled?.answeredBy, settled?.answers], ['person', USAGE_ANSWERS]);
  /* What reached codex is what Sequence sent live. */
  const sent = r.h.replay.state.received.find((m) => m.id === 0 && m.method === undefined);
  assert.deepStrictEqual(sent?.result, { answers: { limit_strategy: { answers: USAGE_ANSWERS.limit_strategy }, counter_store: { answers: USAGE_ANSWERS.counter_store } } });
  /* The turn ends on the limit: wait until the reset codex reported, no retry. */
  const err = r.events.find((e) => e.type === 'acp:error');
  assert.match(String(err?.error), /usage limit/);
  assert.deepStrictEqual(err?.recovery, { kind: 'wait', cause: 'usageLimit', provider: 'codex', resetsAt: USAGE_RESETS_AT_MS });
  /* The stream as web2 receives it: the golden its recovery line is tested against. */
  const file = path.join(REPLAY_FIXTURES, 'sse-question', 'plan-question-usage-limit.sse.jsonl');
  const now = normalizeEvents(r.events, r.work).map((e) => JSON.stringify(e)).join('\n') + '\n';
  if (process.env.SEQUENCE_UPDATE_REPLAY === '1' || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, now);
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), now, 'the stream matches sse-question/plan-question-usage-limit.sse.jsonl');
});
