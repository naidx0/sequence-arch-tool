/**
 * The prompt-size metric: how big the assembled ask prompt is per repo, and
 * whether a per-site token budget had to cut anything.
 *
 * The marker string is LOAD-BEARING (same discipline as the fallback labels in
 * metrics.test.mjs): the metric is worthless if the analyzer renames it, so the
 * test builds the marker with the ANALYZER'S own exported helper and asserts
 * this file still recognises it.
 */

import assert from 'node:assert';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { promptSizeStats, BUDGET_OMISSION_MARKER } from '../lib/metrics.mjs';
import { REPO_ROOT } from '../lib/manifest.mjs';

test('promptSizeStats: sizes in chars + the documented chars/4 approximation', () => {
  const s = promptSizeStats('{"a":1}', 'x'.repeat(400));
  assert.strictEqual(s.digestChars, 7);
  assert.strictEqual(s.promptChars, 400);
  assert.strictEqual(s.approxPromptTokens, 100);
  assert.strictEqual(s.budgetCut, false);
});

test('promptSizeStats: a missing/failed prompt degrades to zeroes, never to a guess', () => {
  const s = promptSizeStats(null, undefined);
  assert.deepStrictEqual(s, {
    digestChars: 0,
    promptChars: 0,
    approxPromptTokens: 0,
    budgetCut: false,
  });
});

test('promptSizeStats: budgetCut is TRUE only when the analyzer actually cut', async () => {
  const dist = path.join(REPO_ROOT, 'packages/analyzer/dist/llm/tokenBudget.js');
  if (!fs.existsSync(dist)) {
    // The engine is not built — the marker cannot be verified against source.
    // Fail loudly rather than passing a check that measured nothing.
    assert.fail('run `pnpm -r build` first: packages/analyzer/dist/llm/tokenBudget.js is missing');
  }
  const { omissionMarker } = await import(pathToFileURL(dist).href);
  const real = omissionMarker(12, 'digest edges');
  assert.ok(BUDGET_OMISSION_MARKER.test(real), 'the analyzer marker is still recognised');
  assert.strictEqual(promptSizeStats('{}', `prompt text\n${real}`).budgetCut, true);
  assert.strictEqual(promptSizeStats('{}', 'prompt text with no cut').budgetCut, false);
});
