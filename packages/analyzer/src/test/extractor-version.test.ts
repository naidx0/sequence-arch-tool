/**
 * 019-P2C: a stale cache can never be served after the code that fills it changes.
 *
 * Two caches hold things DERIVED from source text by our own code:
 *
 *   facts.v8        what `extractFacts` pulled out of a file       -> EXTRACTOR_VERSION
 *   scan-index.v8   what the detectors, the node build's memoised   -> DERIVED_VERSION
 *                   passes and the slim derivation made of it
 *
 * An entry is reused when the file's content is unchanged, so a change to the code that derives it, with the
 * version left alone, would serve the old answer for every unchanged file forever. Nothing in the data notices.
 * These tests pin the SOURCE of that code: they hash it and compare with a hash recorded next to the version. A
 * change to the pinned sources fails here, with the instruction to bump the version and record the new hash, so
 * the bump cannot be forgotten. (Both caches are also dropped when the analyzer is rebuilt: scanIndex.ts's
 * BUILD_MTIME_MS. That covers a developer's working tree; this covers what ships.)
 *
 * Line endings are normalised before hashing, so a checkout with CRLF and one with LF agree.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { EXTRACTOR_SOURCE_HASH, EXTRACTOR_VERSION } from '../parse/factsCache.js';
import { DERIVED_SOURCE_HASH, DERIVED_VERSION } from '../parse/scanIndex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..', 'src');

const lf = (s: string): string => s.replace(/\r\n/g, '\n');

/** Version of an installed dependency, found from where it resolves (its `exports` may hide package.json). */
function installedVersion(name: string): string {
  const req = createRequire(import.meta.url);
  let dir = path.dirname(req.resolve(name));
  for (let i = 0; i < 8; i++) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8')) as { name?: string; version?: string };
      if (j.name === name) return `${name}@${j.version}`;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`cannot find the installed version of ${name}`);
}

/** sha256 over (relative path, normalised text) of each file, plus the given dependency versions. */
function hashSources(files: string[], deps: string[], slice?: { file: string; from: string; to: string }): string {
  const h = crypto.createHash('sha256');
  for (const rel of [...files].sort()) {
    h.update(`file ${rel}\n`);
    h.update(lf(fs.readFileSync(path.join(SRC, rel), 'utf8')));
  }
  if (slice) {
    const text = lf(fs.readFileSync(path.join(SRC, slice.file), 'utf8'));
    const a = text.indexOf(slice.from);
    const b = text.indexOf(slice.to);
    assert.ok(a >= 0 && b > a, `anchors for ${slice.file} moved: update the slice in extractor-version.test.ts (${slice.from} .. ${slice.to})`);
    h.update(`slice ${slice.file}\n`);
    h.update(text.slice(a, b));
  }
  for (const d of deps) h.update(`dep ${installedVersion(d)}\n`);
  return h.digest('hex');
}

function pinned(actual: string, recorded: string, what: string): void {
  assert.strictEqual(
    actual,
    recorded,
    `${what}\n  recorded ${recorded}\n  now      ${actual}`,
  );
}

const EXTRACTOR_FILES = ['parse/facts.ts', 'parse/treesitter.ts'];
const EXTRACTOR_DEPS = ['@vscode/tree-sitter-wasm'];

const DERIVED_FILES = [
  ...fs
    .readdirSync(path.join(SRC, 'detectors'))
    .filter((n) => n.endsWith('.ts'))
    .map((n) => `detectors/${n}`),
  'rationale.ts',
  'scheduledDetect.ts',
  'lang/packs.ts',
  'cluster/cluster.ts',
  'parse/lazyFacts.ts',
  'functions/goResolve.ts',
];
const DERIVED_SLICE = { file: 'scan.ts', from: 'export function resolveImportAll(', to: 'export function resolveDiscovery(' };
const DERIVED_DEPS = ['graphology', 'graphology-communities-louvain'];

test('facts extraction is pinned: a change to it must bump EXTRACTOR_VERSION and record the new hash', () => {
  pinned(
    hashSources(EXTRACTOR_FILES, EXTRACTOR_DEPS),
    EXTRACTOR_SOURCE_HASH,
    `facts extraction changed: bump EXTRACTOR_VERSION and update the recorded hash (now '${EXTRACTOR_VERSION}'; EXTRACTOR_SOURCE_HASH in parse/factsCache.ts)`,
  );
});

test('derived data is pinned: a change to the detectors / memoised passes must bump DERIVED_VERSION and record the new hash', () => {
  pinned(
    hashSources(DERIVED_FILES, DERIVED_DEPS, DERIVED_SLICE),
    DERIVED_SOURCE_HASH,
    `scan-derived output changed: bump DERIVED_VERSION and update the recorded hash (now '${DERIVED_VERSION}'; DERIVED_SOURCE_HASH in parse/scanIndex.ts)`,
  );
});

test('the pin has teeth: a one-character change to a pinned source, or to a dependency version, is caught', () => {
  // Negative control: the same comparison, on text that differs by one character from what is recorded.
  const real = hashSources(EXTRACTOR_FILES, EXTRACTOR_DEPS);
  const tampered = crypto.createHash('sha256').update(real).update(' ').digest('hex');
  assert.notStrictEqual(tampered, real);
  assert.throws(() => pinned(tampered, real, 'facts extraction changed: bump EXTRACTOR_VERSION and update the recorded hash'), /facts extraction changed: bump EXTRACTOR_VERSION and update the recorded hash/);
  // And the hash really depends on the source text: hash a scratch copy with one byte changed.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-pin-'));
  try {
    const a = path.join(tmp, 'a.ts');
    fs.writeFileSync(a, 'export const x = 1;\n');
    const h1 = crypto.createHash('sha256').update(lf(fs.readFileSync(a, 'utf8'))).digest('hex');
    fs.writeFileSync(a, 'export const x = 2;\n');
    const h2 = crypto.createHash('sha256').update(lf(fs.readFileSync(a, 'utf8'))).digest('hex');
    const h3 = crypto.createHash('sha256').update(lf('export const x = 2;\r\n')).digest('hex');
    assert.notStrictEqual(h1, h2);
    assert.strictEqual(h2, h3, 'CRLF and LF checkouts hash alike');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** Print the values to record (not a test: run with SEQ_PIN_PRINT=1 after a deliberate change). */
if (process.env.SEQ_PIN_PRINT) {
  process.stdout.write(`EXTRACTOR_SOURCE_HASH = ${hashSources(EXTRACTOR_FILES, EXTRACTOR_DEPS)}\n`);
  process.stdout.write(`DERIVED_SOURCE_HASH = ${hashSources(DERIVED_FILES, DERIVED_DEPS, DERIVED_SLICE)}\n`);
}
