/**
 * Review finding: every fold appended all earlier provenance with no cap, so the compacted state grew
 * until ContextLimitError threw on every compaction (about round 63).
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { compactSessionTurns, type CompactedSessionRecord, type SessionTurn } from '../llm/compaction.js';

test('200 folds never throw, stay under the byte budget, and keep the newest decisions', async () => {
  const summarizer = async () => ({ summary: 'short summary' });
  const budget = 32768;
  let existing: CompactedSessionRecord | undefined;
  let n = 0;
  for (let round = 1; round <= 200; round++) {
    const turns: SessionTurn[] = [];
    for (let i = 0; i < 24; i++) {
      n++;
      turns.push({
        id: `turn-${n}`,
        role: i % 2 ? 'assistant' : 'user',
        content: 'x'.repeat(2400),
        pinnedDecisions: i === 0 ? [`decision-for-round-${round}`] : undefined,
        evidenceRefs: i === 1 ? [`src/file-${round}.ts`] : undefined,
        unresolvedActions: i === 2 ? [`action-${round}`] : undefined,
      });
    }
    const r = await compactSessionTurns({
      turns, existingCompacted: existing, recentTailCount: 4, contextThresholdTokens: 12000,
      budgets: { compactedStateMaxBytes: budget }, summarizer,
    });
    assert.ok(r.compactedState.length <= budget, `round ${round}: ${r.compactedState.length} bytes`);
    existing = r.compacted;
  }
  assert.ok(existing);
  assert.ok(existing.preservedDecisions.includes('decision-for-round-200'), 'newest decision survives');
  assert.ok(existing.preservedDecisions.includes('decision-for-round-199'));
  assert.ok(existing.sourceTurnIds.includes(`turn-${n - 4}`), 'newest source turn survives');
  assert.strictEqual(existing.sourceTurnIds.length, existing.sourceTurnHashes.length);
  assert.ok(existing.sourceTurnIds.length < 500, 'source turn ids are capped');
  assert.ok((existing.sourceTurnTotal ?? 0) >= 200 * 20, 'the rolled-up count is kept');
});
