import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateGraph, type ArchGraph } from '@sequence/schema';
import { diffGraphs } from '../diff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');
const SPEC = path.resolve(here, '..', '..', '..', '..', 'examples', 'ticketing.spec.json');

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-design-'));
}

function writeGraph(dir: string, name: string, graph: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(graph));
  return p;
}

/** A minimal, valid design-mode spec: one service, one datastore, one edge. */
function designSpec(): ArchGraph {
  return {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName: 'demo',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'demo' },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', meta: { language: 'ts' } },
      { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo', meta: { tech: 'postgres' } },
    ],
    edges: [
      {
        id: 'e:api->postgres',
        srcId: 'svc:api',
        dstId: 'ds:postgres',
        kind: 'db_access',
        confidence: 1,
        origin: 'design',
        evidence: [],
        detail: { table: 'tickets' },
      },
    ],
    warnings: [],
  };
}

// ---- schema-level validateGraph checks (no schema test suite exists yet) ----

test('validateGraph: design spec with empty evidence is valid', () => {
  assert.deepStrictEqual(validateGraph(designSpec()), []);
});

test('validateGraph: origin deterministic + empty evidence fails even in design mode', () => {
  const g = designSpec();
  g.edges[0].origin = 'deterministic';
  const problems = validateGraph(g);
  assert.ok(problems.some((p) => p.includes('has no evidence')), problems.join('; '));
  assert.ok(problems.some((p) => p.includes("must have origin 'design'")), problems.join('; '));
});

test('validateGraph: design mode requires confidence exactly 1', () => {
  const g = designSpec();
  g.edges[0].confidence = 0.9;
  const problems = validateGraph(g);
  assert.ok(problems.some((p) => p.includes('must have confidence 1')), problems.join('; '));
});

test('validateGraph: mode-absent graph keeps the strict evidence rule (regression)', () => {
  const g = designSpec();
  delete g.mode; // absent ⇒ scan
  g.edges[0].origin = 'deterministic'; // a normal scanned edge with no evidence
  const problems = validateGraph(g);
  assert.ok(problems.some((p) => p.includes('has no evidence')), problems.join('; '));
});

test('validateGraph: a fully-evidenced scan graph is valid (regression)', () => {
  const g = designSpec();
  delete g.mode;
  g.edges[0].origin = 'deterministic';
  g.edges[0].evidence = [{ file: 'api/db.ts', line: 3, snippet: 'query(...)' }];
  assert.deepStrictEqual(validateGraph(g), []);
});

test('validateGraph: design-mode service without language warns (not a problem)', () => {
  const g = designSpec();
  delete g.nodes[1].meta; // svc:api loses its language hint
  const problems = validateGraph(g);
  assert.deepStrictEqual(problems, []);
  assert.ok(g.warnings.some((w) => w.includes('svc:api') && w.includes('language')), g.warnings.join('; '));
});

test('validateGraph: the reference ticketing spec validates', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  assert.deepStrictEqual(validateGraph(g), []);
});

// ---- sequence validate CLI exit codes ----

test('sequence validate: exit 0 and summary line on the reference spec', () => {
  const out = execFileSync('node', [CLI, 'validate', SPEC], { encoding: 'utf8' });
  assert.match(out, /valid \(7 nodes, 5 edges, mode: design\)/);
});

test('sequence validate: exit 2 on a corrupted spec', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  g.edges[0].origin = 'deterministic'; // now empty evidence is illegal
  const dir = tmpdir();
  const bad = writeGraph(dir, 'bad.spec.json', g);
  let code = 0;
  let stderr = '';
  try {
    execFileSync('node', [CLI, 'validate', bad], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status;
    stderr = String(e.stderr);
  }
  assert.strictEqual(code, 2);
  assert.match(stderr, /invalid/);
});

// ---- diff wording: design base → conformance framing ----

test('diffGraphs: design base yields conformance headings, drift base is byte-identical', () => {
  // A scan-mode implementation that is missing the db edge and has an extra one.
  const impl: ArchGraph = {
    version: 1,
    scannedAt: '2026-01-01T00:00:00Z',
    repoRoot: '/x',
    repoName: 'demo',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'demo' },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
      { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo' },
    ],
    edges: [
      {
        id: 'e:web->api',
        srcId: 'svc:web',
        dstId: 'svc:api',
        kind: 'http',
        confidence: 0.9,
        origin: 'deterministic',
        evidence: [{ file: 'web/app.ts', line: 5, snippet: 'fetch(API_URL)' }],
      },
    ],
    warnings: [],
  };

  const spec = designSpec(); // spec expects api -> postgres [db_access]
  const dir = tmpdir();
  const specPath = writeGraph(dir, 'spec.json', spec);
  const implPath = writeGraph(dir, 'impl.json', impl);

  const conf = diffGraphs(specPath, implPath);
  assert.match(conf.markdown, /^## sequence conformance report/);
  assert.match(conf.markdown, /### Missing from implementation/);
  assert.match(conf.markdown, /- `api → postgres` \[db_access\]/);
  assert.match(conf.markdown, /### Not in spec/);
  assert.match(conf.markdown, /- `web → api` \[http\]/);
  assert.doesNotMatch(conf.markdown, /drift report/);

  // Same graphs, but base is scan-mode ⇒ classic drift wording, byte-identical
  // to the pre-v4 output.
  const scanBase: ArchGraph = { ...spec };
  delete scanBase.mode;
  const scanBasePath = writeGraph(dir, 'scanbase.json', scanBase);
  const drift = diffGraphs(scanBasePath, implPath);
  const expected =
    '## sequence drift report\n' +
    '**1 added / 1 removed** service-level interaction edges (base → head)\n' +
    '\n' +
    '### Added\n' +
    '- `web → api` [http] — evidence: web/app.ts:5\n' +
    '### Removed\n' +
    '- `api → postgres` [db_access]\n';
  assert.strictEqual(drift.markdown, expected);
});

test('diffGraphs: design base with zero drift uses the conformance line', () => {
  const spec = designSpec();
  // Implementation that exactly realizes the spec's one edge.
  const impl: ArchGraph = {
    version: 1,
    scannedAt: '2026-01-01T00:00:00Z',
    repoRoot: '/x',
    repoName: 'demo',
    nodes: spec.nodes.map((n) => ({ ...n })),
    edges: [
      {
        id: 'impl:api->postgres',
        srcId: 'svc:api',
        dstId: 'ds:postgres',
        kind: 'db_write',
        confidence: 0.9,
        origin: 'deterministic',
        evidence: [{ file: 'api/db.ts', line: 3, snippet: 'INSERT INTO tickets' }],
      },
    ],
    warnings: [],
  };
  const dir = tmpdir();
  const specPath = writeGraph(dir, 'spec.json', spec);
  const implPath = writeGraph(dir, 'impl.json', impl);
  const conf = diffGraphs(specPath, implPath);
  assert.strictEqual(
    conf.markdown,
    '## sequence conformance report\nImplementation conforms to spec — no drift.\n'
  );
});
