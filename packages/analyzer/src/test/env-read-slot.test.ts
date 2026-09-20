/**
 * EVERY ENV READ, WHEREVER IT SITS.
 *
 * The fact model recorded a read only where it happened to look — an
 * assignment's value, a call's arguments. Measured over this repository's
 * product source, 25 of the 27 env names the fact pass missed were reads with
 * nowhere to be recorded:
 *
 *   if (process.env.SEQUENCE_DISABLE_ACP) {                  // a condition
 *   const k = (process.env.DEEPSEEK_API_KEY ?? '').trim();   // chained
 *
 * Each planted case below is a real line from this repository.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Lang } from '../types.js';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';

const reads = (src: string, lang: Lang = 'ts', file = 'x.ts'): string[] =>
  (extractFacts(src, file, lang).envReads ?? []).map((r) => `${r.name}:${r.position}`);

/*
 * Cited by SYMBOL, not by line. This used to pin a line number, and it went
 * stale the moment an endpoint was added above it — the line then pointed
 * at an unrelated auth check, and a reader following the citation would have
 * been sent somewhere the planted read is not. `tools/ci` fails the build on a
 * line pin into this file for exactly that reason.
 */
test('PLANTED: a read in a condition is recorded — the SEQUENCE_DISABLE_ACP kill-switch in repoServer.ts', async () => {
  await initParser();
  assert.deepEqual(reads('if (process.env.SEQUENCE_DISABLE_ACP) { stop(); }'), [
    'SEQUENCE_DISABLE_ACP:condition',
  ]);
});

test('PLANTED: a read behind a call chain is recorded — provider.ts:357', async () => {
  await initParser();
  assert.deepEqual(reads("const k = (process.env.DEEPSEEK_API_KEY ?? '').trim();"), [
    'DEEPSEEK_API_KEY:chained',
  ]);
});

test('the positions the other channels already covered are still labelled', async () => {
  await initParser();
  assert.deepEqual(reads('const a = process.env.DATABASE_URL;'), ['DATABASE_URL:assigned']);
  assert.deepEqual(reads('fetch(process.env.API_URL);'), ['API_URL:argument']);
  assert.deepEqual(reads('const u = `${process.env.BASE_URL}/x`;'), ['BASE_URL:interpolation']);
  assert.deepEqual(reads('function f(){ return process.env.TOKEN; }'), ['TOKEN:returned']);
});

test('only a CONDITION counts as a condition, not the body it guards', async () => {
  /* A read inside the branch is not guarding anything, and labelling it
     `condition` would make the card explain it wrongly. */
  assert.deepEqual(reads('if (ready) { send(process.env.API_URL); }'), ['API_URL:argument']);
});

test('a ternary and a while are conditions too', async () => {
  await initParser();
  assert.deepEqual(reads("const x = process.env.FLAG ? 'a' : 'b';"), ['FLAG:condition']);
  assert.deepEqual(reads('while (process.env.KEEP_GOING) { tick(); }'), ['KEEP_GOING:condition']);
});

test('one entry per name per line, so a card cannot count one read twice', async () => {
  await initParser();
  /* Two nodes can match the same read — a subscript and the member expression
     inside it — and a card counting rows would report one variable twice. */
  assert.deepEqual(reads("const a = process.env['DATABASE_URL'];"), ['DATABASE_URL:assigned']);
});

test('Python and Go reads carry a position too', async () => {
  await initParser();
  assert.deepEqual(reads('X = os.environ["REDIS_URL"]', 'py', 'x.py'), ['REDIS_URL:assigned']);
  assert.deepEqual(reads('v := os.Getenv("PORT")', 'go', 'x.go'), ['PORT:assigned']);
  assert.deepEqual(reads('if os.environ["DEBUG"]:\n    go()\n', 'py', 'x.py'), ['DEBUG:condition']);
});

test('a file with no env read carries an empty list, not undefined', async () => {
  await initParser();
  assert.deepEqual(reads('const a = 1;'), []);
});
