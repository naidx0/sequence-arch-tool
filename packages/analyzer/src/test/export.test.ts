import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import { mermaidSequence, mermaidFlow, dependencyMatrix } from '@sequence/export';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');
const SPEC = path.resolve(here, '..', '..', '..', '..', 'examples', 'ticketing.spec.json');
const FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
// Snapshots live in the source tree (tsc compiles only .ts into dist/).
const SNAP = path.resolve(here, '..', '..', 'src', 'test', 'snapshots');

/** Compare against a committed snapshot; regenerate with UPDATE_SNAPSHOTS=1. */
function assertSnap(name: string, actual: string): void {
  const p = path.join(SNAP, name);
  if (process.env.UPDATE_SNAPSHOTS) {
    fs.writeFileSync(p, actual);
    return;
  }
  /*
   * CRLF ON READ. `core.autocrlf=true` rewrites every committed snapshot to CRLF
   * on checkout, while the exporters always emit LF. Comparing raw asserts the
   * CHECKOUT CONVENTION rather than the export: red on every Windows clone,
   * green on every POSIX one. Normalising the read side leaves the comparison
   * exactly as byte-strict about the content itself.
   */
  const expected = fs
    .readFileSync(p, 'utf8')
    .split(String.fromCharCode(13, 10))
    .join(String.fromCharCode(10));
  assert.strictEqual(actual, expected, `snapshot mismatch: ${name}`);
}

function loadSpec(): ArchGraph {
  return JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
}

test('export snapshots: ticketing design spec (all four formats, byte-exact)', () => {
  const g = loadSpec();
  assertSnap('export-ticketing.seq.mmd', mermaidSequence(g));
  assertSnap('export-ticketing.flow.mmd', mermaidFlow(g));
  assertSnap('export-ticketing.matrix.md', dependencyMatrix(g).markdown);
  assertSnap('export-ticketing.matrix.csv', dependencyMatrix(g).csv);
});

test('export snapshots: shopfront scan (all four formats, byte-exact)', async () => {
  const g = await scanRepo(FIXTURE);
  assertSnap('export-shopfront.seq.mmd', mermaidSequence(g));
  assertSnap('export-shopfront.flow.mmd', mermaidFlow(g));
  assertSnap('export-shopfront.matrix.md', dependencyMatrix(g).markdown);
  assertSnap('export-shopfront.matrix.csv', dependencyMatrix(g).csv);
});

test('export is deterministic — two renders are byte-identical', () => {
  const g = loadSpec();
  assert.strictEqual(mermaidSequence(g), mermaidSequence(g));
  assert.strictEqual(dependencyMatrix(g).csv, dependencyMatrix(g).csv);
});

// ---- CLI ----

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-export-'));
}

test('sequence export: stdout by default (mermaid-seq)', () => {
  const out = execFileSync('node', [CLI, 'export', SPEC, '--format', 'mermaid-seq'], { encoding: 'utf8' });
  assert.match(out, /^sequenceDiagram\n/);
  assert.match(out, /gateway->>api/);
});

test('sequence export: --out writes the file, stdout stays clean', () => {
  const outPath = path.join(tmp(), 'seq.mmd');
  const stdout = execFileSync('node', [CLI, 'export', SPEC, '--format', 'matrix-csv', '--out', outPath], {
    encoding: 'utf8',
  });
  assert.strictEqual(stdout, '', 'file mode writes nothing to stdout');
  assert.strictEqual(fs.readFileSync(outPath, 'utf8'), dependencyMatrix(loadSpec()).csv);
});

test('sequence export: exit 2 on an unknown format, listing the valid ones', () => {
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'export', SPEC, '--format', 'bogus'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.strictEqual(code, 2);
  assert.match(stderr, /unknown format 'bogus'/);
  assert.match(stderr, /mermaid-seq, mermaid-flow, matrix-md, matrix-csv/);
});

test('sequence export: each format smoke-runs through the CLI', () => {
  for (const fmt of ['mermaid-seq', 'mermaid-flow', 'matrix-md', 'matrix-csv']) {
    const out = execFileSync('node', [CLI, 'export', SPEC, '--format', fmt], { encoding: 'utf8' });
    assert.ok(out.length > 0, `${fmt} produced output`);
  }
});
