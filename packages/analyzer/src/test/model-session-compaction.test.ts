/**
 * ADR-013 Phase C — model session service, compaction, and requestModelRequest wiring.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import {
  compactSessionTurns,
  serializeCompactedState,
  hashTurn,
  ContextLimitError,
  CompactionFailedError,
  type SessionTurn,
  type TurnSummarizer,
} from '../llm/compaction.js';
import {
  createModelSessionService,
  SessionCapacityError,
  SessionTurnTimeoutError,
} from '../llm/modelSessionService.js';
import {
  requestModelRequest,
  type ModelRequest,
} from '../server/provider.js';
import type { ApiKeyRoute } from '../llm/modelRoutes.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const apiRoute: ApiKeyRoute = {
  kind: 'api-key',
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: 'sk-SECRET-session-test-key',
};

function makeTurns(count: number, size = 80): SessionTurn[] {
  const turns: SessionTurn[] = [];
  for (let i = 0; i < count; i++) {
    turns.push({
      id: `t${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn-${i}-${'x'.repeat(size)}`,
      pinnedDecisions: i % 4 === 0 ? [`decision-${i}`] : undefined,
      evidenceRefs: i % 5 === 0 ? [`edge:${i}`] : undefined,
    });
  }
  return turns;
}

test('compaction: preserves decisions and evidence with source hashes', async () => {
  const turns = makeTurns(12, 120);
  const result = await compactSessionTurns({
    turns,
    recentTailCount: 2,
    contextThresholdTokens: 300,
    budgets: { summaryInputTokens: 4_000, summaryOutputTokens: 400, compactedStateMaxBytes: 16_384 },
  });
  assert.ok(result.compacted.preservedDecisions.length > 0);
  assert.ok(result.compacted.preservedEvidence.length > 0);
  assert.strictEqual(result.compacted.sourceTurnIds.length, 10);
  assert.strictEqual(result.compacted.sourceTurnHashes.length, 10);
  assert.strictEqual(result.compacted.sourceTurnHashes[0], hashTurn(turns[0]));
  assert.match(serializeCompactedState(result.compacted), /@seq-compaction v1/);
  assert.strictEqual(result.recentTurns.length, 2);
  assert.ok(result.diagnostics.droppedTurnCount > 0);
  assert.ok(result.diagnostics.compactionAttempts >= 1);
});

test('compaction: context overflow stops with ContextLimitError', async () => {
  const turns = makeTurns(3, 2_000);
  await assert.rejects(
    () =>
      compactSessionTurns({
        turns,
        recentTailCount: 3,
        contextThresholdTokens: 50,
        budgets: { summaryOutputTokens: 10, compactedStateMaxBytes: 200 },
      }),
    (e: ContextLimitError) => e.name === 'ContextLimitError',
  );
});

test('compaction: compactor failure after bounded retries', async () => {
  const failingSummarizer: TurnSummarizer = async () => ({ error: 'summarizer down' });
  const turns = makeTurns(8, 60);
  await assert.rejects(
    () =>
      compactSessionTurns({
        turns,
        recentTailCount: 2,
        contextThresholdTokens: 100,
        summarizer: failingSummarizer,
      }),
    (e: CompactionFailedError) => {
      assert.strictEqual(e.name, 'CompactionFailedError');
      assert.strictEqual(e.diagnostics.compactionAttempts, 2);
      return true;
    },
  );
});

test('session: same key reuses state across turns', async () => {
  const service = createModelSessionService({ contextThresholdTokens: 100_000 });
  let calls = 0;
  const execute = async () => {
    calls++;
    return `reply-${calls}`;
  };
  await service.runTurn(
    'chat-1',
    { baseEnvelope: { policy: 'p' }, currentRequest: 'hello' },
    execute,
  );
  await service.runTurn(
    'chat-1',
    { baseEnvelope: { policy: 'p' }, currentRequest: 'follow-up' },
    execute,
  );
  const state = service.getSessionState('chat-1');
  assert.ok(state);
  assert.strictEqual(state.turns.length, 4);
  assert.strictEqual(calls, 2);
  assert.strictEqual(service.size(), 1);
  await service.disposeAll();
});

test('session: exceeding cap LRU-evicts the oldest idle session', async () => {
  const service = createModelSessionService({ maxSessions: 2 });
  await service.runTurn('K1', { baseEnvelope: { policy: 'p' }, currentRequest: 'a' }, async () => 'r1');
  await service.runTurn('K2', { baseEnvelope: { policy: 'p' }, currentRequest: 'b' }, async () => 'r2');
  await service.runTurn('K1', { baseEnvelope: { policy: 'p' }, currentRequest: 'c' }, async () => 'r3');
  await service.runTurn('K3', { baseEnvelope: { policy: 'p' }, currentRequest: 'd' }, async () => 'r4');
  assert.strictEqual(service.size(), 2, 'held to the cap');
  assert.strictEqual(service.getSessionState('K2'), undefined, 'LRU idle session was evicted');
  assert.ok(service.getSessionState('K1'));
  assert.ok(service.getSessionState('K3'));
  assert.ok(service.diagnostics().totalEvictions >= 1);
  await service.disposeAll();
});

test('session: admission at cap rejects when every session is active', async () => {
  const service = createModelSessionService({ maxSessions: 2, admissionWaitMs: 0 });
  const gates: Array<() => void> = [];
  const hold = (key: string) =>
    service.runTurn(key, { baseEnvelope: { policy: 'p' }, currentRequest: 'hold' }, async () => {
      await new Promise<void>((r) => {
        gates.push(r);
      });
      return 'done';
    });
  const p1 = hold('a');
  const p2 = hold('b');
  await delay(20);
  await assert.rejects(
    () => hold('c'),
    (e: SessionCapacityError) => e.retryable === true,
  );
  gates.forEach((g) => g());
  await Promise.all([p1, p2]);
  await service.disposeAll();
});

test('session: shutdown disposeAll then recovery on next turn', async () => {
  const service = createModelSessionService();
  await service.runTurn('recover', { baseEnvelope: { policy: 'p' }, currentRequest: 'first' }, async () => 'a');
  assert.strictEqual(service.size(), 1);
  await service.disposeAll();
  assert.strictEqual(service.size(), 0);
  await service.runTurn('recover', { baseEnvelope: { policy: 'p' }, currentRequest: 'second' }, async () => 'b');
  const state = service.getSessionState('recover');
  assert.ok(state);
  assert.strictEqual(state.turns.length, 2, 'fresh session after shutdown');
  await service.disposeAll();
});

test('session: turn duration bound surfaces SessionTurnTimeoutError', async () => {
  const service = createModelSessionService({ maxTurnDurationMs: 30 });
  await assert.rejects(
    () =>
      service.runTurn('slow', { baseEnvelope: { policy: 'p' }, currentRequest: 'wait' }, async () => {
        await delay(80);
        return 'late';
      }),
    (e: SessionTurnTimeoutError) => e.name === 'SessionTurnTimeoutError',
  );
  await service.disposeAll();
});

test('session: diagnostics are secret-free', async () => {
  const secretKey = 'repo::user-secret-path::session';
  const service = createModelSessionService();
  const { sessionDiagnostics } = await service.runTurn(
    secretKey,
    {
      baseEnvelope: { policy: 'policy-with-secret-token-abc' },
      currentRequest: 'question',
      pinnedDecisions: ['use postgres'],
      evidenceRefs: ['edge:auth→db'],
    },
    async () => 'answer',
  );
  const blob = JSON.stringify(sessionDiagnostics);
  assert.ok(!blob.includes(secretKey));
  assert.ok(!blob.includes('user-secret-path'));
  assert.match(blob, /sessionKeyHash/);
  await service.disposeAll();
});

test('requestModelRequest: session path feeds compactedState into envelope', async () => {
  const prevFetch = globalThis.fetch;
  let capturedPrompt = '';
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    capturedPrompt = body.messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'model-reply' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const service = createModelSessionService({
    contextThresholdTokens: 150,
    recentTailCount: 1,
    compactionBudgets: { summaryOutputTokens: 300, compactedStateMaxBytes: 8_192 },
  });
  const request: ModelRequest = { route: apiRoute };

  try {
    for (let i = 0; i < 8; i++) {
      await requestModelRequest(
        request,
        { policy: 'test-policy', currentRequest: `message-${i}-${'y'.repeat(120)}` },
        {
          sessionKey: 'sess-envelope',
          sessionService: service,
          sessionTurn: i % 2 === 0 ? { pinnedDecisions: [`decision-${i}`] } : undefined,
        },
      );
    }
    assert.match(capturedPrompt, /--- COMPACTED STATE ---/);
    assert.match(capturedPrompt, /@seq-compaction v1/);
    const blob = JSON.stringify(capturedPrompt);
    assert.ok(!blob.includes('SECRET-session'));
  } finally {
    globalThis.fetch = prevFetch;
    await service.disposeAll();
  }
});

test('requestModelRequest: without sessionKey wire bytes unchanged from Phase B', async () => {
  const prevFetch = globalThis.fetch;
  let capturedBody = '';
  globalThis.fetch = (async (_url, init) => {
    capturedBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const request: ModelRequest = { route: apiRoute };
  try {
    await requestModelRequest(request, { policy: 'p', currentRequest: 'q' });
    const body = JSON.parse(capturedBody);
    assert.strictEqual(body.model, 'deepseek-chat');
    assert.ok(Array.isArray(body.messages));
    assert.match(body.messages[0].content, /@seq-envelope v1/);
    assert.match(body.messages[0].content, /--- CURRENT REQUEST ---/);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
