/**
 * P4 — catalogue of built-in programs validates and lists uniquely.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { validateProgram } from '../program.js';
import { BUILTIN_PROGRAMS, buildBuiltinProgram, builtinProgramById } from './catalogue.js';

/*
 * THIS FILE HAD NEVER RUN. It compiles to `dist/programs/`, and schema's test
 * script globs `dist/*.test.js dist/moat/*.test.js` — so nothing matched it, and
 * `pnpm -r test` was green over it for as long as it has existed.
 *
 * When it was finally run (by counting declarations on disk against tests
 * actually run) two of its three tests failed: this one, because the catalogue
 * had grown from five templates to seven and nothing said so; and the validation
 * one, because `build-architecture-full` emitted duplicate ids — a shipped
 * template that `validateProgram` rejects.
 *
 * The list below is asserted in full rather than by count, so the next template
 * added has to come past this line deliberately.
 */
test('BUILTIN_PROGRAMS lists the curated templates, in order', () => {
  const ids = BUILTIN_PROGRAMS.map((e) => e.id);
  assert.deepEqual(ids, [
    'pr-triage',
    'review-loop',
    'council-against-risks',
    'route-by-blast-radius',
    'dogfood-loop',
    'build-architecture',
    'build-architecture-full',
  ]);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});

test('every catalogue build() is validateProgram-clean and id-stable', () => {
  for (const entry of BUILTIN_PROGRAMS) {
    const program = entry.build();
    const result = validateProgram(program);
    assert.ok(result.ok, `${entry.id}: ${result.errors?.join('; ') ?? 'invalid'}`);
    assert.equal(program.id, entry.id);
    assert.equal(buildBuiltinProgram(entry.id)?.id, entry.id);
    assert.equal(builtinProgramById(entry.id)?.title, entry.title);
  }
});

test('unknown builtin id returns null', () => {
  assert.equal(buildBuiltinProgram('not-a-real-workflow'), null);
});
