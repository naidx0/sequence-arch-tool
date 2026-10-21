/**
 * Auto compact, model sessions (ADR-013): the trigger follows the model's window, counts what the model is sent,
 * folds an earlier summary instead of dropping it, and a failed compaction leaves the history in place.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import { compactSessionTurns, type CompactedSessionRecord, type SessionTurn, type TurnSummarizer } from '../llm/compaction.js';
import { createModelSessionService, type ModelSessionServiceOptions } from '../llm/modelSessionService.js';

/* Options built as a variable so a field a build does not know yet fails the assertion, not the compile. */
const opts = (o: Record<string, unknown>): ModelSessionServiceOptions => ({ recentTailCount: 4, ...o }) as ModelSessionServiceOptions;

const filler = (tokens: number): string => 'w'.repeat(tokens * 4);

/** Adds `exchanges` user/assistant pairs of about `each` tokens per turn to a session. */
async function seeded(service: ReturnType<typeof createModelSessionService>, key: string, exchanges: number, each: number): Promise<void> {
  for (let i = 0; i < exchanges; i++) {
    await service.runTurn(key, { baseEnvelope: { policy: 'p' }, currentRequest: `q${i} ${filler(each)}` }, async () => `a${i} ${filler(each)}`);
  }
}

function countingSummarizer(): { summarizer: TurnSummarizer; calls: () => number } {
  let n = 0;
  return {
    summarizer: async ({ turns }) => {
      n++;
      return { summary: `summary of ${turns.length} turns` };
    },
    calls: () => n,
  };
}

test('threshold: a 200k window does not compact a 20k-token session (the fixed 12k default did)', async () => {
  const s = countingSummarizer();
  const service = createModelSessionService({ ...opts({ contextWindowTokens: 200_000 }), summarizer: s.summarizer });
  await seeded(service, 'k', 5, 2_000); /* 10 turns, about 20k tokens */
  await service.runTurn('k', { baseEnvelope: { policy: 'p' }, currentRequest: 'next' }, async () => 'ok');
  assert.strictEqual(s.calls(), 0, 'nothing to compact at 10% of the window');
  assert.strictEqual(service.getSessionState('k')!.turns.length, 12, 'every turn is still verbatim');
  await service.disposeAll();
});

test('threshold: compaction starts at 80% of the window, not before', async () => {
  const s = countingSummarizer();
  const service = createModelSessionService({ ...opts({ contextWindowTokens: 40_000 }), summarizer: s.summarizer });
  await seeded(service, 'k', 6, 2_000); /* about 24k tokens: 60% of 40k */
  await service.runTurn('k', { baseEnvelope: { policy: 'p' }, currentRequest: 'next' }, async () => 'ok');
  assert.strictEqual(s.calls(), 0, '60% is under the line');
  await seeded(service, 'k', 4, 2_000); /* about 40k tokens before the next send: over 80% */
  await service.runTurn('k', { baseEnvelope: { policy: 'p' }, currentRequest: 'again' }, async () => 'ok');
  assert.ok(s.calls() >= 1, 'over 80% compacts');
  await service.disposeAll();
});

test('threshold: the per-turn window of the model in use wins over the service default', async () => {
  const s = countingSummarizer();
  const service = createModelSessionService({ ...opts({ contextWindowTokens: 1_000_000 }), summarizer: s.summarizer });
  await seeded(service, 'k', 5, 2_000); /* about 20k tokens */
  await service.runTurn('k', { baseEnvelope: { policy: 'p' }, currentRequest: 'next', contextWindowTokens: 16_000 } as never, async () => 'ok');
  assert.strictEqual(s.calls(), 1, 'a small-window model compacts the same session');
  await service.disposeAll();
});

test('estimate: the snapshot the model is sent counts toward the window', async () => {
  const s = countingSummarizer();
  const service = createModelSessionService({ ...opts({ contextWindowTokens: 20_000 }), summarizer: s.summarizer });
  await seeded(service, 'k', 3, 1_000); /* about 6k tokens of dialog: well under 16k */
  await service.runTurn('k', { baseEnvelope: { policy: 'p', snapshotContent: filler(11_000) }, currentRequest: 'next' }, async () => 'ok');
  assert.strictEqual(s.calls(), 1, '6k of dialog plus an 11k snapshot is 85% of 20k');
  await service.disposeAll();
});

test('fold: a second compaction keeps the first summary, its decisions and its source turns', async () => {
  const first: CompactedSessionRecord = {
    version: 1,
    sourceTurnIds: ['old1', 'old2'],
    sourceTurnHashes: ['h1', 'h2'],
    preservedDecisions: ['use postgres'],
    preservedEvidence: ['edge:a->b'],
    unresolvedActions: ['write the migration'],
    summary: 'FIRST-SUMMARY-MARKER the team chose postgres',
  };
  const turns: SessionTurn[] = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i} ${filler(100)}` }));
  let seen = '';
  const result = await compactSessionTurns({
    turns,
    existingCompacted: first,
    recentTailCount: 2,
    contextThresholdTokens: 300,
    summarizer: async ({ turns: t }) => {
      seen = t.map((x) => x.content).join('\n');
      return { summary: 'SECOND' };
    },
  });
  assert.match(seen, /FIRST-SUMMARY-MARKER/, 'the summarizer is handed the earlier summary');
  assert.ok(result.compacted.preservedDecisions.includes('use postgres'), 'a decision from before the first compaction survives');
  assert.ok(result.compacted.preservedEvidence.includes('edge:a->b'));
  assert.ok(result.compacted.unresolvedActions.includes('write the migration'));
  assert.deepStrictEqual(result.compacted.sourceTurnIds.slice(0, 2), ['old1', 'old2'], 'the record still names what it covers');
  assert.ok(result.compacted.sourceTurnIds.includes('n0'));
});

test('failure: a summarizer that fails leaves the whole history in place and the error honest', async () => {
  let failing = false;
  const service = createModelSessionService({
    ...opts({ contextThresholdTokens: 1_000 }),
    summarizer: async () => (failing ? { error: 'provider down' } : { summary: 's' }),
  });
  /* Under the line the summarizer never runs; seed without compaction by keeping the turns few. */
  const big = (i: number) => ({ baseEnvelope: { policy: 'p' }, currentRequest: `q${i} ${filler(200)}` });
  await service.runTurn('k', big(0), async () => `a0 ${filler(200)}`);
  await service.runTurn('k', big(1), async () => `a1 ${filler(200)}`);
  await service.runTurn('k', big(2), async () => `a2 ${filler(200)}`);
  const count = service.getSessionState('k')!.turns.length;
  failing = true;
  await assert.rejects(
    () => service.runTurn('k', big(9), async () => 'x'),
    (e: Error) => e.name === 'CompactionFailedError' && /provider down/.test(JSON.stringify((e as { diagnostics?: unknown }).diagnostics)),
  );
  const after = service.getSessionState('k');
  assert.ok(after, 'the session is still there');
  assert.strictEqual(after!.turns.length, count, 'no turn was lost');
  await service.disposeAll();
});

test('race: two sends on one session compact once, not twice', async () => {
  const s = countingSummarizer();
  const service = createModelSessionService({ ...opts({ contextThresholdTokens: 1_000 }), summarizer: s.summarizer });
  await seeded(service, 'k', 2, 200);
  const before = s.calls();
  const gate = new Promise<void>((r) => setTimeout(r, 20));
  const a = service.runTurn('k', { baseEnvelope: { policy: 'p' }, currentRequest: `one ${filler(400)}` }, async () => (await gate, 'r1'));
  const b = service.runTurn('k', { baseEnvelope: { policy: 'p' }, currentRequest: 'two' }, async () => 'r2');
  await Promise.all([a, b]);
  assert.ok(s.calls() - before <= 1, 'the second send finds the history already compacted');
  await service.disposeAll();
});
