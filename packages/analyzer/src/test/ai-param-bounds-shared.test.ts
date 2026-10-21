import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AI_PARAM_BOUNDS as shared } from '@sequence/api-types';
import { AI_PARAM_BOUNDS as served, parseAiParams } from '../server/provider.js';

/*
 * APP-12. The settings pane validates the Advanced knobs against the SAME table the server refuses
 * with. One table, in @sequence/api-types; the server imports it and stays the authority.
 */
test('the server serves the api-types table itself, not a copy', () => {
  assert.equal(served, shared);
});

test('provider.ts no longer carries a literal bounds table of its own', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'server', 'provider.ts'), 'utf8');
  assert.ok(!/timeoutMs:\s*\{\s*min:/.test(src), 'a second copy of the timeout bounds is a second answer');
});

test('every bound in the shared table is enforced by the server (positive and negative control per knob)', () => {
  for (const [key, b] of Object.entries(shared)) {
    assert.deepEqual(parseAiParams({ [key]: b.min }).error, undefined, `${key} min`);
    assert.deepEqual(parseAiParams({ [key]: b.max }).error, undefined, `${key} max`);
    assert.match(parseAiParams({ [key]: b.min - 1 }).error ?? '', /between/, `${key} below min`);
    assert.match(parseAiParams({ [key]: b.max + 1 }).error ?? '', /between/, `${key} above max`);
  }
  assert.deepEqual(Object.keys(shared).sort(), ['maxRetries', 'maxTokens', 'temperature', 'timeoutMs', 'topP']);
});
