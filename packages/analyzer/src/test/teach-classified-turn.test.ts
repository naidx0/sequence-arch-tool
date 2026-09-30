import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import type { AiConfig } from '../server/provider.js';
import { beginTeachTurn } from '../server/teachTurn.js';
import { startMockProvider } from './mock-provider.js';

/**
 * A "TEACH ME" TURN IS A LESSON WHETHER OR NOT THE TOGGLE IS ON.
 *
 * Owner, 2026-09-22: in an ordinary Plan chat, Teach toggle off, he asked to be
 * taught and got a short plan-shaped answer. The pipeline already classified the
 * question as a teach turn (`isTeachTurn`), but both ask routes handed
 * `beginTeachTurn` only the toggle, so the turn had no lesson, no concept, and
 * the model thought at length about "TEACH MODE" instead of teaching.
 *
 * Driven through the real route with a mock provider on the openai wire,
 * because that is the wire where `reasoning_effort` is visible, and the lesson
 * is observable as the `lesson.json` the turn's `finish` writes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.resolve(here, '..', '..', 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-test-TEACH-CLASSIFIED-7';
const THREAD = 'thread-teach-classified';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-teach-classified-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function askOnce(
  question: string,
  opts: { params?: Record<string, unknown>; toolRoundFirst?: boolean } = {},
): Promise<{ lessonWritten: boolean; firstBody: Record<string, unknown>; bodies: Record<string, unknown>[] }> {
  const repo = plainappRepo();
  let calls = 0;
  const mock = await startMockProvider(
    () =>
      opts.toolRoundFirst && calls++ === 0
        ? {
            text: [
              '```sequence-tool',
              JSON.stringify({ id: 't1', name: 'read_file', args: { path: 'backend/app/main.py' } }),
              '```',
            ].join(`
`),
          }
        : { text: 'The frontend calls the backend, and the backend answers it. What does the frontend send?' },
    'openai',
  );
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai-compatible',
        baseUrl: mock.baseUrl,
        model: 'test-model',
        apiKey: TEST_KEY,
        ...(opts.params ? { params: opts.params } : {}),
      }),
    });
    /* The Plan chat's real body: no `teach` field at all. */
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, threadId: THREAD, permission: 'plan' }),
    });
    assert.strictEqual(res.status, 200, await res.clone().text());
    await res.json();
    assert.ok(mock.requests.length > 0, 'the provider was called');
    return {
      lessonWritten: fs.existsSync(path.join(repo, '.sequence', 'sessions', THREAD, 'lesson.json')),
      firstBody: mock.requests[0]!.body as Record<string, unknown>,
      bodies: mock.requests.map((r) => r.body as Record<string, unknown>),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mock.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
}

test('a "teach me" question with the toggle OFF is a lesson, with thinking off', async () => {
  const { lessonWritten, firstBody } = await askOnce('Teach me how the backend works in this repo.');
  assert.strictEqual(lessonWritten, true, 'a classified teach turn writes its lesson');
  assert.strictEqual(firstBody.reasoning_effort, 'none', 'and does not think out loud');
});

test('THE CONTROL: an ordinary question with the toggle OFF is still not a lesson', async () => {
  const { lessonWritten, firstBody } = await askOnce('What does this app do?');
  assert.strictEqual(lessonWritten, false, 'no lesson for a question that did not ask for one');
  assert.strictEqual('reasoning_effort' in firstBody, false, 'and the reader’s reasoning is untouched');
});

/*
 * THINKING IS OFF ON EVERY ROUND OF A LESSON, WHATEVER THE PROFILE SAYS.
 *
 * Owner's re-measure, 2026-09-22: six runs of the teaching prompt with a 7B
 * thinking model spent 25-38k characters of thinking each, and 5 of 6 hit the
 * 180 s deadline; call 3 of one run thought for 123 s of a 191 s turn. His
 * profile sets `reasoningEffort: "medium"`, and the old rule let an explicit
 * value win, so every round of every lesson went out as "medium".
 */
test('a lesson turn sends reasoning_effort "none" on the tool round AND the answer round, over a "medium" profile', async () => {
  const { bodies } = await askOnce('Teach me how the backend works in this repo.', {
    params: { reasoningEffort: 'medium' },
    toolRoundFirst: true,
  });
  assert.ok(bodies.length >= 2, `a tool round and an answer round were sent (got ${bodies.length})`);
  assert.deepStrictEqual(
    bodies.map((b) => b.reasoning_effort),
    bodies.map(() => 'none'),
    'every round of the lesson went out with thinking off',
  );
});

test('THE CONTROL: a non-lesson turn keeps the profile’s "medium" on every round', async () => {
  const { bodies } = await askOnce('What does this app do?', {
    params: { reasoningEffort: 'medium' },
    toolRoundFirst: true,
  });
  assert.ok(bodies.length >= 2, `a tool round and an answer round were sent (got ${bodies.length})`);
  assert.deepStrictEqual(
    bodies.map((b) => b.reasoning_effort),
    bodies.map(() => 'medium'),
    'the reader’s own setting reaches the wire',
  );
});

test('configFor on a lesson turn is "none" over an explicit "medium"; off a lesson it is the profile', () => {
  const cfg = {
    provider: 'openai-compatible',
    model: 'm',
    baseUrl: 'http://127.0.0.1:1/v1',
    params: { reasoningEffort: 'medium' },
  } as unknown as AiConfig;
  const lesson = beginTeachTurn({
    teach: true,
    question: 'Teach me the backend.',
    threadIdFromRequest: undefined,
    sessionsRoot: null,
  });
  /* One config per round: the tool round and the answer round both go through it. */
  assert.strictEqual(lesson.configFor(cfg).params?.reasoningEffort, 'none', 'the tool round');
  assert.strictEqual(lesson.configFor(cfg).params?.reasoningEffort, 'none', 'the answer round');
  assert.strictEqual(cfg.params?.reasoningEffort, 'medium', 'the profile itself is not mutated');
  const plain = beginTeachTurn({
    teach: false,
    question: 'What does this app do?',
    threadIdFromRequest: undefined,
    sessionsRoot: null,
  });
  assert.strictEqual(plain.configFor(cfg).params?.reasoningEffort, 'medium', 'a non-lesson turn keeps the profile');
});
