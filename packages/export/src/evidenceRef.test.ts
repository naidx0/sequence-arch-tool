import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchEdge } from '@sequence/schema';
import { archEdgeEvidenceRef, formatScanEvidenceRef } from './evidenceRef.js';

test('formatScanEvidenceRef: file:line', () => {
  assert.strictEqual(
    formatScanEvidenceRef({ file: 'gateway/src/index.ts', line: 4, snippet: 'fetch' }),
    'scan:gateway/src/index.ts:4',
  );
});

test('archEdgeEvidenceRef: compose env var anchor when present', () => {
  const e: ArchEdge = {
    id: 'e1',
    srcId: 'svc:gateway',
    dstId: 'svc:orders',
    kind: 'http',
    confidence: 1,
    origin: 'deterministic',
    evidence: [
      {
        file: 'docker-compose.yml',
        line: 20,
        snippet: 'ORDERS_URL=http://orders:8000',
        note: 'service orders',
      },
    ],
    detail: { envVar: 'ORDERS_URL' },
  };
  assert.strictEqual(archEdgeEvidenceRef(e), 'scan:compose:orders:env.ORDERS_URL');
});
