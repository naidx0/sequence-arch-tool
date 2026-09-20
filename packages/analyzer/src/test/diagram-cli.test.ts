import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSeqDiagram } from '@sequence/schema';
import {
  renderDiagramExport,
  runDiagramValidate,
} from '../diagramCli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');
const VALID = path.join(FIXTURES, 'minimal.seqd');
const INVALID = path.join(FIXTURES, 'invalid.seqd');
const SPEC = path.resolve(here, '..', '..', '..', '..', 'examples', 'ticketing.spec.json');

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-diagram-'));
}

test('runDiagramValidate: valid fixture passes', () => {
  assert.strictEqual(runDiagramValidate(VALID), 0);
});

test('runDiagramValidate: invalid fixture fails with exit 2', () => {
  assert.strictEqual(runDiagramValidate(INVALID), 2);
});

test('runDiagramValidate: missing file fails with exit 2', () => {
  assert.strictEqual(runDiagramValidate(path.join(tmp(), 'missing.seqd')), 2);
});

test('renderDiagramExport: seqd output validates', () => {
  const graph = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  const text = renderDiagramExport(graph, 'seqd');
  const doc = JSON.parse(text);
  assert.deepEqual(validateSeqDiagram(doc), { ok: true, errors: [] });
});

test('sequence diagram validate: CLI happy path', () => {
  const out = execFileSync('node', [CLI, 'diagram', 'validate', VALID], { encoding: 'utf8' });
  assert.match(out, /valid \(2 nodes, 1 edges, kind: service-sequence\)/);
});

test('sequence diagram validate: CLI sad path exit 2', () => {
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'diagram', 'validate', INVALID], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.strictEqual(code, 2);
  assert.match(stderr, /grounded\.graphId/);
});

test('sequence diagram export: stdout by default (seqd)', () => {
  const out = execFileSync('node', [CLI, 'diagram', 'export', SPEC, '--format', 'seqd'], {
    encoding: 'utf8',
  });
  const doc = JSON.parse(out);
  assert.strictEqual(doc.version, 1);
  assert.ok(Array.isArray(doc.nodes));
});

test('sequence diagram export: --out writes file, stdout stays clean', () => {
  const outPath = path.join(tmp(), 'out.seqd');
  const stdout = execFileSync(
    'node',
    [CLI, 'diagram', 'export', SPEC, '--format', 'seqd', '--out', outPath],
    { encoding: 'utf8' }
  );
  assert.strictEqual(stdout, '');
  assert.deepEqual(validateSeqDiagram(JSON.parse(fs.readFileSync(outPath, 'utf8'))), {
    ok: true,
    errors: [],
  });
});

test('sequence diagram export: svg and mermaid smoke', () => {
  for (const fmt of ['svg', 'mermaid'] as const) {
    const out = execFileSync('node', [CLI, 'diagram', 'export', SPEC, '--format', fmt], {
      encoding: 'utf8',
    });
    assert.ok(out.length > 0, `${fmt} produced output`);
    if (fmt === 'svg') assert.match(out, /^<\?xml|<svg/);
    if (fmt === 'mermaid') assert.match(out, /^(flowchart|sequenceDiagram)/);
  }
});

test('sequence diagram export: unknown format exit 2', () => {
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'diagram', 'export', SPEC, '--format', 'bogus'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e: any) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.strictEqual(code, 2);
  assert.match(stderr, /unknown format 'bogus'/);
  assert.match(stderr, /seqd, svg, mermaid/);
});

test('sequence diagram export: does not auto-write into repo .sequence/diagrams/', () => {
  const repoRoot = tmp();
  const diagramsDir = path.join(repoRoot, '.sequence', 'diagrams');
  fs.mkdirSync(diagramsDir, { recursive: true });
  const before = fs.readdirSync(diagramsDir);
  execFileSync('node', [CLI, 'diagram', 'export', SPEC, '--format', 'seqd'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.deepEqual(fs.readdirSync(diagramsDir), before);
});
