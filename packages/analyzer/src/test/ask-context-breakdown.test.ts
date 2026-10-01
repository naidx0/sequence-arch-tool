import assert from 'node:assert';
import { test } from 'node:test';

import { buildAskContextBreakdown } from '../server/askPipeline.js';

/**
 * B3.4 — ContextRing breakdown is measured from named prompt slices, never
 * invented client-side and never a relabel of coverage edges.
 */

test('buildAskContextBreakdown: empty texts yield no sections', () => {
  const b = buildAskContextBreakdown({
    groundingText: '',
    instructionsText: '   ',
    toolsText: '',
  });
  assert.deepStrictEqual(b.sections, []);
  assert.strictEqual(b.totalApprox, 0);
  assert.strictEqual(b.totalMeasured, undefined);
});

test('buildAskContextBreakdown: counts approxTokens per named slice', () => {
  const grounding = 'x'.repeat(400); // 100 approx tokens
  const tools = 'y'.repeat(80); // 20 approx tokens
  const b = buildAskContextBreakdown({
    groundingText: grounding,
    instructionsText: '',
    toolsText: tools,
    measuredInput: 150,
  });
  assert.strictEqual(b.sections.length, 2);
  assert.strictEqual(b.sections[0]?.id, 'grounding');
  assert.strictEqual(b.sections[0]?.tokens, 100);
  assert.strictEqual(b.sections[0]?.estimated, true);
  assert.strictEqual(b.sections[1]?.id, 'tools');
  assert.strictEqual(b.sections[1]?.tokens, 20);
  assert.strictEqual(b.totalApprox, 120);
  assert.strictEqual(b.totalMeasured, 150);
});
