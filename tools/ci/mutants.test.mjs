// The mutation catalogue is only worth what it can still apply.
//
// `tools/ci/mutate.mjs` is slow - it runs a whole test suite per mutant - so it is a command, not a
// gate. This is the gate. It runs in about a second and proves the catalogue has not rotted: every
// mutant names a file that exists, a suite that is defined, and a `find` string that appears in
// that file EXACTLY ONCE.
//
// That last one is the point. A mutant whose find-string has drifted away is not a mutant that
// passes; it is a mutant that no longer asks anything, sitting in the list looking like coverage.
// This repository's dominant defect is a test that passes for the wrong reason, and a catalogue of
// checks against a defect class is not allowed to become an instance of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadCatalogue, applyMutation } from './mutate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catalogue = loadCatalogue();

test('the catalogue is not empty', () => {
  assert.ok(catalogue.mutants.length >= 10, `only ${catalogue.mutants.length} mutants`);
});

test('every mutant id is unique', () => {
  const seen = new Set();
  for (const m of catalogue.mutants) {
    assert.ok(!seen.has(m.id), `duplicate mutant id: ${m.id}`);
    seen.add(m.id);
  }
});

test('every mutant names a suite that is defined', () => {
  for (const m of catalogue.mutants) {
    assert.ok(catalogue.suites[m.suite], `${m.id} names undefined suite "${m.suite}"`);
  }
});

test('every mutant says why it matters', () => {
  for (const m of catalogue.mutants) {
    assert.ok((m.why ?? '').length > 40, `${m.id} has no real explanation`);
  }
});

test('every mutation still applies to exactly one site', () => {
  const broken = [];
  for (const m of catalogue.mutants) {
    const file = path.join(REPO, m.file);
    if (!existsSync(file)) {
      // dist/ is gitignored, so an unbuilt checkout fails here. Say which it is, or the reader
      // spends the next ten minutes looking for a file that was never meant to be committed.
      const why = m.file.includes('/dist/') ? 'build output is missing - run `pnpm -r build`' : 'file is gone';
      broken.push(`${m.id}: ${why} - ${m.file}`);
      continue;
    }
    try {
      const mutated = applyMutation(readFileSync(file, 'utf8'), m);
      assert.notEqual(mutated, readFileSync(file, 'utf8'), `${m.id} changed nothing`);
    } catch (err) {
      broken.push(`${m.id} (${m.file}): ${err.message}`);
    }
  }
  assert.deepEqual(broken, [], `\n  ${broken.join('\n  ')}\n`);
});
