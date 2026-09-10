/**
 * Living docs must be indexed, in one place, with no dangling links.
 *
 * Root `docs/*.md` (except README) must appear as same-directory links in
 * `docs/README.md`. Living `docs/research/*.md` must appear in
 * `docs/research/README.md`. Adding a file without listing it — or listing a
 * file that was archived — fails CI instead of leaving agents to glob a random
 * order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogDiff } from './lib/docs-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function assertCatalog(readmePath, dir, label) {
  const { missing, extra } = catalogDiff(readmePath, dir);
  assert.equal(
    missing.length,
    0,
    `${label}: living files not indexed in ${path.relative(ROOT, readmePath)}: ${missing.join(', ') || '(none)'}`,
  );
  assert.equal(
    extra.length,
    0,
    `${label}: index points at missing files: ${extra.join(', ') || '(none)'}`,
  );
}

test('docs/README.md indexes every living docs/*.md (read order = table order)', () => {
  assertCatalog(path.join(ROOT, 'docs/README.md'), path.join(ROOT, 'docs'), 'docs root');
});

test('docs/research/README.md indexes every living research note', () => {
  assertCatalog(
    path.join(ROOT, 'docs/research/README.md'),
    path.join(ROOT, 'docs/research'),
    'docs/research',
  );
});
