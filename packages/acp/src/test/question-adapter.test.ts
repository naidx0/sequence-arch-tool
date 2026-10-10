/**
 * CODEX ASKS THE PERSON (item/tool/requestUserInput), IN THE ADAPTER.
 *
 * Played against codex-question/*, built around the request frame codex sent
 * live in the gate's Plan turn (2026-10-06): two questions, three options
 * each. Live, Sequence answered -32601 and codex went on with its own guess.
 *
 *   answer by option   the person's options go back as
 *                      { answers: { id: { answers: [label] } } }
 *   answer by text     the person's own words go back the same way
 *   cancel             null goes back as { answers: {} }
 *   turn ended         turn/completed while it waits: the question's signal
 *                      aborts and the adapter answers { answers: {} } itself
 *   no surface         no onQuestion: answered { answers: {} }, never -32601
 *
 * Variants of the fixture differ only in the client's recorded answer; the
 * replay checks the answer the adapter sent against it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DRAW_INSTRUCTION } from '../accessMode.js';
import { CodexAppServerClient, resetCodexExperimentalCache } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { LIVE_QUESTION, OPTION_ANSWERS, QUESTION_ITEM, QUESTION_PLAN_TEXT } from '../replay/codexQuestionFixtures.js';
import { readFixture, type Fixture, type Json } from '../replay/fixture.js';
import { codexQuestionResponse, codexQuestionsOf, type AgentQuestionAnswers, type AgentQuestionRequest } from '../questions.js';
import { PLAN_ASK_INSTRUCTION } from '../accessMode.js';
import { AGENT_MODES } from '../planMode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'replay', 'codex-question');
const fixture = (name: string): Fixture => readFixture(path.join(DIR, `${name}.jsonl`));

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

/** The fixture with the client's recorded answer to the question replaced. */
function answeredWith(f: Fixture, result: Json): Fixture {
  return { header: f.header, frames: f.frames.map((fr) => (fr.dir === 'c2s' && fr.msg.id === LIVE_QUESTION.id && fr.msg.method === undefined ? { ...fr, msg: { id: fr.msg.id, result } } : fr)) };
}

interface Played {
  divergences: string[];
  finished: boolean;
  /** What the adapter answered codex's question with. */
  sent: Json | undefined;
  asked: AgentQuestionRequest[];
  aborted: boolean[];
  stopReason: string;
  plan: Json | undefined;
}

async function play(f: Fixture, onQuestion?: (q: AgentQuestionRequest, signal: AbortSignal) => Promise<AgentQuestionAnswers | null>): Promise<Played> {
  resetCodexExperimentalCache();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-question-'));
  const h = replaySpawn(f, { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const asked: AgentQuestionRequest[] = [];
  const aborted: boolean[] = [];
  const updates: Json[] = [];
  const client = new CodexAppServerClient({
    command: 'codex',
    cwd,
    accessMode: 'plan',
    spawn: h.spawn,
    onUpdate: (n) => updates.push(n.update as unknown as Json),
    ...(onQuestion
      ? {
          onQuestion: (q: AgentQuestionRequest, signal: AbortSignal) => {
            asked.push(q);
            signal.addEventListener('abort', () => aborted.push(true), { once: true });
            return onQuestion(q, signal);
          },
        }
      : {}),
  });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(cwd));
    const res = await driven(() => h.drain(), client.prompt('Plan how to add a health check endpoint to the orders service. Do not change files.'));
    for (let i = 0; i < 5; i++) await h.drain();
    const sent = h.replay.received.find((m) => m.id === LIVE_QUESTION.id && m.method === undefined);
    return {
      divergences: h.replay.divergences,
      finished: h.replay.state.finished,
      sent,
      asked,
      aborted,
      stopReason: res.stopReason,
      plan: updates.find((u) => u.sessionUpdate === 'plan_update'),
    };
  } finally {
    await client.dispose();
    resetCodexExperimentalCache();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('plan-question (live-recorded request): the question reaches onQuestion whole, and the options chosen go back in codex\'s shape', async () => {
  const p = await play(fixture('plan-question'), async () => OPTION_ANSWERS);
  assert.deepEqual(p.divergences, []);
  assert.equal(p.finished, true, 'every frame played: codex got its answer and finished the plan');
  assert.equal(p.asked.length, 1);
  const q = p.asked[0]!;
  assert.equal(q.itemId, QUESTION_ITEM);
  assert.deepEqual(q.questions, codexQuestionsOf(LIVE_QUESTION.params as Json), 'every question, header, option and flag the live frame carried');
  assert.deepEqual(
    q.questions.map((x) => [x.id, x.header, x.options.map((o) => o.label), x.isOther]),
    [
      ['health_scope', 'Endpoint scope', ['Liveness only (Recommended)', 'Readiness', 'Both endpoints'], true],
      ['route_contract', 'Route contract', ['GET /health JSON (Recommended)', 'GET /healthz text', 'Existing convention'], true],
    ],
  );
  assert.deepEqual(p.sent?.result, { answers: { health_scope: { answers: ['Liveness only (Recommended)'] }, route_contract: { answers: ['GET /health JSON (Recommended)'] } } });
  assert.equal(p.sent?.error, undefined, 'never -32601 again');
  assert.equal(p.stopReason, 'end_turn');
  assert.equal((p.plan?.plan as Json | undefined)?.content, QUESTION_PLAN_TEXT);
});

test('plan-question: an answer in the person\'s own words goes back as written (trimmed); an unasked id is dropped', async () => {
  const words: AgentQuestionAnswers = { health_scope: ['  Liveness, but also check the orders DB  '], route_contract: ['GET /health JSON (Recommended)'], not_asked: ['x'] };
  const want = { answers: { health_scope: { answers: ['Liveness, but also check the orders DB'] }, route_contract: { answers: ['GET /health JSON (Recommended)'] } } };
  const p = await play(answeredWith(fixture('plan-question'), want), async () => words);
  assert.deepEqual(p.divergences, []);
  assert.deepEqual(p.sent?.result, want);
});

test('plan-question: Cancel (null) answers { answers: {} }, and codex goes on', async () => {
  const p = await play(answeredWith(fixture('plan-question'), { answers: {} }), async () => null);
  assert.deepEqual(p.divergences, []);
  assert.equal(p.finished, true);
  assert.deepEqual(p.sent?.result, { answers: {} });
  assert.equal(p.stopReason, 'end_turn');
});

test('plan-question-turn-ended: the turn ends while the question waits; its signal aborts and codex is answered with none', async () => {
  let waiting = 0;
  const p = await play(fixture('plan-question-turn-ended'), () => {
    waiting += 1;
    return new Promise(() => {}); // the person never answers
  });
  assert.equal(waiting, 1);
  assert.deepEqual(p.aborted, [true], 'the caller is told the question is over');
  assert.deepEqual(p.divergences, []);
  assert.equal(p.finished, true, 'the answer the recording expects after the turn ended was sent');
  assert.deepEqual(p.sent?.result, { answers: {} });
  assert.equal(p.stopReason, 'cancelled');
});

test('plan-question with no onQuestion: answered { answers: {} } at once, never refused with -32601', async () => {
  const p = await play(answeredWith(fixture('plan-question'), { answers: {} }));
  assert.deepEqual(p.divergences, []);
  assert.equal(p.finished, true);
  assert.deepEqual(p.sent?.result, { answers: {} });
  assert.equal(p.sent?.error, undefined);
});

test('codexQuestionResponse: only asked ids, only non-empty strings; null is no answer', () => {
  const asked = codexQuestionsOf(LIVE_QUESTION.params as Json);
  assert.deepEqual(codexQuestionResponse(null, asked), { answers: {} });
  assert.deepEqual(codexQuestionResponse({ health_scope: ['', '  '], route_contract: ['Readiness'] }, asked), { answers: { route_contract: { answers: ['Readiness'] } } });
});

test('Plan alone opens and resumes the codex thread with the request_user_input line; every other mode in AGENT_MODES with none', async () => {
  const opening = fixture('plan-question').frames.slice(0, 5); // initialize .. thread/start and its answer
  for (const mode of AGENT_MODES) {
    for (const method of ['thread/start', 'thread/resume']) {
      const frames = opening.map((f) => (f.msg.method === 'thread/start' ? { ...f, msg: { ...f.msg, method } } : f));
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-question-'));
      const h = replaySpawn({ header: fixture('plan-question').header, frames }, { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
      const client = new CodexAppServerClient({ command: 'codex', cwd, accessMode: mode, spawn: h.spawn });
      try {
        await driven(() => h.drain(), client.start());
        await driven(() => h.drain(), method === 'thread/start' ? client.newSession(cwd) : client.resumeSession('01a1116e-9a96-7992-a206-779672b0be65', cwd));
        assert.deepEqual(h.replay.divergences, []);
        const sent = h.replay.received.find((m) => m.method === method)!.params as Json;
        assert.equal(sent.developerInstructions, mode === 'plan' ? `${PLAN_ASK_INSTRUCTION}\n\n${DRAW_INSTRUCTION}` : DRAW_INSTRUCTION, `${mode} ${method}`);
      } finally {
        await client.dispose();
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    }
  }
  assert.match(PLAN_ASK_INSTRUCTION, /request_user_input tool, giving 2 to 4 options, instead of asking in plain text/);
});
