/**
 * ADR-013 Phase B — prompt envelope hash stability and cache-key diagnostics.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import {
  assemblePromptEnvelope,
  buildStablePrefix,
  computeSnapshotHash,
  normalizeEnvelopeText,
  stablePrefixHash,
  PROMPT_ENVELOPE_VERSION,
} from '../llm/promptEnvelope.js';

const POLICY = 'You are Sequence. Return grounded answers only.';
const SNAPSHOT = '{"services":["api","web"]}';

test('envelope: stable prefix hash is stable across volatile metadata changes', () => {
  const base = {
    policy: POLICY,
    snapshotContent: SNAPSHOT,
    currentRequest: 'explain the api service',
  };
  const withMeta = assemblePromptEnvelope({
    ...base,
    volatileMetadata: { requestId: 'req-abc', date: '2026-08-05' },
  });
  const withoutMeta = assemblePromptEnvelope({ ...base });
  assert.strictEqual(withMeta.diagnostics.stablePrefixHash, withoutMeta.diagnostics.stablePrefixHash);
  assert.notStrictEqual(withMeta.prompt, withoutMeta.prompt);
});

test('envelope: stable prefix hash ignores recent turns and current request', () => {
  const a = stablePrefixHash({
    policy: POLICY,
    snapshotContent: SNAPSHOT,
  });
  const b = stablePrefixHash({
    policy: POLICY,
    snapshotContent: SNAPSHOT,
    compactedState: 'prior summary v1',
  });
  assert.notStrictEqual(a, b);
  const c = stablePrefixHash({
    policy: POLICY,
    snapshotContent: SNAPSHOT,
  });
  assert.strictEqual(a, c);
});

test('envelope: tool schemas are sorted deterministically', () => {
  const one = buildStablePrefix({
    policy: POLICY,
    toolSchemas: ['schema-b', 'schema-a'],
  });
  const two = buildStablePrefix({
    policy: POLICY,
    toolSchemas: ['schema-a', 'schema-b'],
  });
  assert.strictEqual(one, two);
});

test('envelope: snapshot hash is content-addressed', () => {
  const h1 = computeSnapshotHash(SNAPSHOT);
  const h2 = computeSnapshotHash(SNAPSHOT + '\n');
  assert.strictEqual(h1, h2, 'normalized whitespace should not change hash');
  assert.notStrictEqual(h1, computeSnapshotHash('{"services":["web"]}'));
});

test('envelope: version marker is present in stable prefix', () => {
  const stable = buildStablePrefix({ policy: POLICY });
  assert.match(stable, new RegExp(`@seq-envelope v${PROMPT_ENVELOPE_VERSION}`));
});

test('envelope: normalizeEnvelopeText trims trailing line whitespace', () => {
  assert.strictEqual(normalizeEnvelopeText('a  \nb\t'), 'a\nb');
});
