import assert from 'node:assert';
import { test } from 'node:test';

import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';

/**
 * A PYTHON ENV NAME IS THE NAME, NOT THE NAME WITH ITS FIRST LETTERS EATEN.
 *
 * `os.environ["X"]` unquoted the literal and THEN stripped Python string-prefix
 * letters from the result — but the prefix sits outside the quotes, so the strip
 * only ever hit real characters of the name. Measured on the shopfront fixture:
 *
 *     REDIS_URL     -> EDIS_URL
 *     MY_VAR        -> Y_VAR
 *     API_KEY       -> PI_KEY
 *     b"REDIS_URL"  -> "REDIS_URL     (the case the strip existed for)
 *
 * The damage was not cosmetic. A Python service reading REDIS_URL, declared
 * REDIS_URL in compose, produced BOTH a declared input with no reader and an
 * undeclared read — two false findings from one bug, in the exact pair of lines
 * an input card would headline.
 */

test('a python env name survives extraction intact', async () => {
  await initParser();
  const names = (src: string): string[] => {
    const ff = extractFacts(src, 'x.py', 'py');
    const out: string[] = [];
    for (const [, parts] of ff.assignments) {
      for (const p of parts ?? []) if ((p as { t?: string }).t === 'env') out.push((p as { name: string }).name);
    }
    return out;
  };

  /* Every one of these begins with a letter the old strip removed. */
  assert.deepStrictEqual(names('import os\nx = os.environ["REDIS_URL"]'), ['REDIS_URL']);
  assert.deepStrictEqual(names('import os\nx = os.environ["MY_VAR"]'), ['MY_VAR']);
  assert.deepStrictEqual(names('import os\nx = os.environ["API_KEY"]'), ['API_KEY']);
  assert.deepStrictEqual(names('import os\nx = os.environ["FOO"]'), ['FOO']);
  assert.deepStrictEqual(names('import os\nx = os.environ["BAR"]'), ['BAR']);
  /* And one that never was affected, so the fix is not just deleting the strip. */
  assert.deepStrictEqual(names('import os\nx = os.environ["DATABASE_URL"]'), ['DATABASE_URL']);
});

test('a PREFIXED python literal is unquoted properly — the case the old strip was for', async () => {
  await initParser();
  const names = (src: string): string[] => {
    const ff = extractFacts(src, 'x.py', 'py');
    const out: string[] = [];
    for (const [, parts] of ff.assignments) {
      for (const p of parts ?? []) if ((p as { t?: string }).t === 'env') out.push((p as { name: string }).name);
    }
    return out;
  };
  for (const src of [
    'import os\nx = os.environ[b"REDIS_URL"]',
    "import os\nx = os.environ[r'REDIS_URL']",
    'import os\nx = os.environ[rb"REDIS_URL"]',
  ]) {
    assert.deepStrictEqual(names(src), ['REDIS_URL'], src);
  }
});

test('os.getenv is unquoted the same way as os.environ', async () => {
  await initParser();
  const ff = extractFacts('import os\nx = os.getenv(b"REDIS_URL", "d")', 'x.py', 'py');
  const found: string[] = [];
  for (const [, parts] of ff.assignments) {
    for (const p of parts ?? []) if ((p as { t?: string }).t === 'env') found.push((p as { name: string }).name);
  }
  assert.deepStrictEqual(found, ['REDIS_URL'], 'the two python env paths must agree');
});
