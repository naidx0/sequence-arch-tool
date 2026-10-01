import assert from 'node:assert/strict';
import { test } from 'node:test';

import { askMetricsFromTerminal } from '../server/trajectoryStore.js';

test('askMetricsFromTerminal: lifts metrics from a result terminal (A0.3)', () => {
  const m = askMetricsFromTerminal({
    type: 'result',
    text: 'ok',
    metrics: {
      wallMs: 1200,
      rounds: 2,
      stopReason: 'complete',
      designMode: true,
      intent: 'draw',
      inputTokens: 100,
      outputTokens: 40,
    },
  });
  assert.deepEqual(m, {
    wallMs: 1200,
    rounds: 2,
    stopReason: 'complete',
    designMode: true,
    intent: 'draw',
    inputTokens: 100,
    outputTokens: 40,
  });
});

test('askMetricsFromTerminal: absent on error / missing metrics', () => {
  assert.equal(askMetricsFromTerminal({ type: 'error', message: 'nope' }), undefined);
  assert.equal(askMetricsFromTerminal({ type: 'result', text: 'plain' }), undefined);
});
