import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';
import { defaultPoolSize } from '../parse/parsePool.js';

/**
 * The parse pool is the scan's ONLY parallelism: the tree-sitter parse of every
 * source file is the largest single cost of a scan on a big repository, and it
 * runs on these workers. A hard ceiling of four meant a 16-core machine used a
 * quarter of itself for the whole parse, which is the difference between a
 * launch that takes 90 s and one that takes 65 s on the same repository.
 *
 * The core count is passed in rather than read from the machine, so the
 * ceiling is checkable anywhere. The cast is what lets this file compile
 * against a build that has no such parameter: the call then answers for the
 * machine's own cores, and the assertion below is what fails.
 */
const sizeFor = (cores: number): number => (defaultPoolSize as (c?: number) => number)(cores);

/** The ceiling the pool is allowed to grow to. */
const CEILING = 8;

test('the parse pool uses the cores the machine has, up to the ceiling', () => {
  // A four-core laptop: unchanged (two workers; the scan thread and the
  // server get the rest).
  assert.equal(sizeFor(4), 2);
  assert.equal(sizeFor(3), 1);
  // A machine with no core to spare parses on the scan thread itself.
  assert.equal(sizeFor(2), 0);
  assert.equal(sizeFor(1), 0);
  // A big desktop: the pool grows with it, up to the ceiling and no further.
  assert.equal(sizeFor(16), CEILING);
  assert.equal(sizeFor(64), CEILING);
  assert.equal(sizeFor(10), 8);
  assert.equal(sizeFor(6), 4);
  for (const cores of [1, 2, 3, 4, 5, 8, 12, 16, 32, 64]) {
    const size = sizeFor(cores);
    assert.ok(size >= 0 && size <= CEILING, `${cores} cores gave ${size} workers`);
  }
});

test('this machine runs as many parse workers as it has cores for', () => {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const size = defaultPoolSize();
  assert.equal(size, Math.max(0, Math.min(CEILING, cores - 2)), `${cores} cores must give ${Math.max(0, Math.min(CEILING, cores - 2))} parse workers, not ${size}`);
  if (cores > 6) {
    assert.ok(size > 4, `a machine with ${cores} cores must not be held to four parse workers`);
  }
});

test('the environment override still wins over the machine', () => {
  const before = process.env.SEQUENCE_PARSE_POOL;
  try {
    process.env.SEQUENCE_PARSE_POOL = '3';
    assert.equal(defaultPoolSize(), 3);
    process.env.SEQUENCE_PARSE_POOL = '0';
    assert.equal(defaultPoolSize(), 0);
    process.env.SEQUENCE_PARSE_POOL = 'not-a-number';
    assert.equal(defaultPoolSize(), 0);
  } finally {
    if (before === undefined) delete process.env.SEQUENCE_PARSE_POOL;
    else process.env.SEQUENCE_PARSE_POOL = before;
  }
});
