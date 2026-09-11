import assert from 'node:assert';
import { test } from 'node:test';

import { scanCoverage, canRefuteExtension } from './scanCoverage.js';

/**
 * ABSENCE OF A SIGNAL IS NOT EVIDENCE OF ABSENCE.
 *
 * This helper exists because two features derived the same question separately
 * in one night — the question-premise check ("this repo has no Python") and W3's
 * `graph-gap` verdict ("no such edge exists"). Both are reasoning from something
 * MISSING, and both are one question away from stating a gap in our knowledge as
 * a fact about the world.
 */

const g = (over: Record<string, unknown>) =>
  ({ warnings: [], ...over }) as Parameters<typeof scanCoverage>[0];

test('absent coverage is UNKNOWN, empty coverage is COMPLETE — they are not the same answer', () => {
  /*
   * `[]` means "looked, and everything was readable". `undefined` means "not
   * recorded" — an older persisted graph or a hand-authored design spec. Reading
   * absent as complete is this defect in its purest form.
   */
  assert.equal(scanCoverage(g({})).verdict, 'unknown');
  assert.equal(scanCoverage(g({ unfollowed: [], unscanned: [] })).verdict, 'complete');
  assert.equal(canRefuteExtension(scanCoverage(g({})), '.py'), false);
  assert.equal(
    canRefuteExtension(scanCoverage(g({ unfollowed: [], unscanned: [] })), '.py'),
    true,
  );
});

test('a truncated walk refutes NOTHING, whatever else it recorded', () => {
  /* The walk stops at maxFiles and says so; past that point nothing about
     absence is knowable, including for extensions no gap mentions. */
  const capped = scanCoverage(
    g({
      unfollowed: [],
      unscanned: [],
      warnings: ['file limit 20000 reached — remaining files skipped'],
    }),
  );
  assert.equal(capped.verdict, 'partial');
  assert.equal(capped.truncated, true);
  assert.equal(canRefuteExtension(capped, '.py'), false);
  assert.equal(canRefuteExtension(capped, '.rb'), false);
});

test('a gap is scoped to ITS extensions — partial coverage does not disable every question', () => {
  /*
   * The reason this is asked per-extension rather than as one boolean. A scan
   * that never entered a directory full of Ruby still knows perfectly well
   * whether it saw Python in what it did walk. The live shape from this
   * repository's own scan: tools/ holds 68 files including .py.
   */
  const cov = scanCoverage(
    g({
      unfollowed: [],
      unscanned: [{ dir: 'tools', files: 68, extensions: ['.mjs', '.py'] }],
    }),
  );
  assert.equal(cov.verdict, 'partial');
  assert.equal(canRefuteExtension(cov, '.py'), false, 'tools/ was never entered');
  assert.equal(canRefuteExtension(cov, '.rb'), true, 'no gap mentions Ruby');
  assert.match(cov.reasons.join(' '), /tools: 68 source files never visited/);
});

test('opened-but-unparseable is a gap too, and it is a different one', () => {
  /* The C# payment service: the walk opened it and could not read it, so the
     graph came out looking like a system with no payment service in it. */
  const cov = scanCoverage(
    g({
      unscanned: [],
      unfollowed: [{ language: 'C#', extensions: ['.cs'], files: 12, services: ['billing'] }],
    }),
  );
  assert.equal(cov.verdict, 'partial');
  assert.equal(canRefuteExtension(cov, '.cs'), false);
  assert.equal(canRefuteExtension(cov, '.ts'), true);
  assert.match(cov.reasons.join(' '), /C#: 12 files opened but not parsed/);
});

test('an extension is matched however it is written', () => {
  const cov = scanCoverage(
    g({ unfollowed: [], unscanned: [{ dir: 'tools', files: 1, extensions: ['PY'] }] }),
  );
  assert.equal(canRefuteExtension(cov, '.py'), false);
  assert.equal(canRefuteExtension(cov, 'py'), false);
});
