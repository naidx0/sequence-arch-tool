import assert from 'node:assert/strict';
import test from 'node:test';

import { isTestFile } from '../testFiles.js';

/**
 * The predicate that keeps a test suite from deciding what a system IS.
 *
 * Both halves are load-bearing and each was measured on ml-harness: 152 of its
 * 157 test files are identifiable by FILENAME, and the last five are ordinary
 * module names inside `tests/` that only the DIRECTORY rule catches. One of
 * those five, `tests/support.py`, is 882 lines imported by 88 test files — by
 * import degree it looks like one of the most important files in the repo.
 */

test('filename conventions, across the languages this scanner parses', () => {
  for (const f of [
    'tests/test_the_http_door.py',
    'app/db_test.py',
    'pkg/thing_test.go',
    'src/canvas/camera.test.ts',
    'src/boot/boot.test.tsx',
    'src/state/store.spec.js',
    'tests/conftest.py',
  ]) {
    assert.equal(isTestFile(f), true, `${f} should read as a test file`);
  }
});

test('a test DIRECTORY catches the support modules a filename rule cannot', () => {
  // The five ml-harness files that carry no test-ish name.
  for (const f of [
    'tests/support.py',
    'tests/diagnosis_fixtures.py',
    'tests/corpus_of_harvested_honest_turns.py',
    'src/__tests__/helpers.ts',
    'spec/factories.rb',
  ]) {
    assert.equal(isTestFile(f), true, `${f} sits in a test directory`);
  }
});

test('product code is never mistaken for a test', () => {
  for (const f of [
    'app/main.py',
    'app/db.py',
    'app/tools/evidence.py',
    'frontend/src/App.tsx',
    'packages/analyzer/src/scan.ts',
    // A product file whose name merely CONTAINS the word — the rule is anchored,
    // so `latest_run.py` and `contest.py` are not swept up.
    'app/latest_run.py',
    'app/contest.py',
    'app/protest/handler.py',
    'src/attestation.ts',
  ]) {
    assert.equal(isTestFile(f), false, `${f} is product code`);
  }
});

test('a directory merely CONTAINING the word is not a test directory', () => {
  // `testing` is a test dir by convention; `latest/` and `contests/` are not.
  assert.equal(isTestFile('app/latest/report.py'), false);
  assert.equal(isTestFile('app/contests/rules.py'), false);
  assert.equal(isTestFile('app/testing/harness.py'), true);
});

test('empty and odd input never throws', () => {
  assert.equal(isTestFile(''), false);
  assert.equal(isTestFile('main.py'), false);
  // Native separators are normalised, so a Windows path answers the same.
  assert.equal(isTestFile('tests\\test_thing.py'), true);
});
