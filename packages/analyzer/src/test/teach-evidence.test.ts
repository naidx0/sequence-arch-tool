/**
 * THE EVIDENCE A LESSON'S FIRST TURN IS HANDED (Slice 8a, 2026-09-23).
 *
 * The third measurement (`docs/teaching-flow-plan.md`): with thinking off the
 * 7B model stopped digging — "trace_flow 0/6; r5 answered in 3.2 s with no
 * tool call". `gatherTeachEvidence` runs the tools for it before the first
 * call; these tests hold what the section must carry on the shopfront scan.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ArchGraph } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { executeAskTool, type AskToolContext } from '../server/askTools.js';
import {
  gatherTeachEvidence,
  serviceEntryFile,
  TEACH_EVIDENCE_BUDGET_CHARS,
  TEACH_EVIDENCE_TITLE,
} from '../server/teachEvidence.js';
import * as teachEvidence from '../server/teachEvidence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function ctxFor(root: string, extra: Partial<AskToolContext> = {}): AskToolContext {
  return {
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    designMode: false,
    ...extra,
  };
}

async function shopfront(): Promise<{ graph: ArchGraph; ctx: AskToolContext }> {
  const root = fs.realpathSync(SHOPFRONT);
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  return { graph, ctx: ctxFor(root, { graph, digest: buildDigest(graph) }) };
}

/** The `N hops` count each trace header states. */
function traceHopCounts(text: string): number[] {
  return [...text.matchAll(/^Trace from .*?; (\d+) hops? between parts/gm)].map((m) => Number(m[1]));
}

test('teach evidence: every service, a multi-hop trace, the gateway entry, under the budget', async () => {
  const { graph, ctx } = await shopfront();
  const ev = await gatherTeachEvidence(ctx, 'teach me how this works');

  assert.ok(ev.text.includes(TEACH_EVIDENCE_TITLE), 'the section is titled');
  assert.ok(
    ev.text.length <= TEACH_EVIDENCE_BUDGET_CHARS,
    `${ev.text.length} chars is over the ${TEACH_EVIDENCE_BUDGET_CHARS} budget`,
  );
  /* Derived, not hand-listed: a service the scan adds is a service the section owes. */
  const services = graph.nodes.filter((n) => n.kind === 'service');
  assert.ok(services.length >= 2, 'the fixture has services to name');
  for (const s of services) {
    assert.ok(ev.text.includes(`"id":"${s.id}"`), `the services brief names ${s.id}`);
  }
  assert.ok(
    traceHopCounts(ev.text).some((n) => n >= 2),
    `at least one trace with two or more hops: ${traceHopCounts(ev.text).join(', ')}`,
  );
  /* The gateway's entry: `routes/orders.ts` casts two http edges to orders;
     every other gateway file casts one or none. */
  assert.strictEqual(serviceEntryFile(graph, 'svc:gateway'), 'gateway/src/routes/orders.ts');
  assert.ok(
    ev.text.includes('Trace from gateway/src/routes/orders.ts — the entry file of gateway'),
    'the gateway entry file is traced by name',
  );
  /* The deepest hop's file, with numbered lines to cite. */
  assert.match(ev.text, /The file the deepest hop lands in .*its first 40 lines:/);
  assert.match(ev.text, /^\s+1\|/m, 'the file lines are numbered');
  /* Every cited file is a scanned file: nothing in the section is invented. */
  const scanned = new Set(graph.nodes.filter((n) => n.kind === 'file').map((n) => n.path));
  assert.ok(ev.sources.length > 0);
  for (const f of ev.sources) assert.ok(scanned.has(f), `${f} is a scanned file`);
  assert.ok(ev.sources.includes('gateway/src/routes/orders.ts'));
  /* And the calls behind it are the tools' own names and arguments. */
  assert.deepStrictEqual(
    [...new Set(ev.calls.map((c) => c.name))].sort(),
    ['read_file', 'read_topology', 'trace_flow'],
  );
});

test('teach evidence: a part the question names gets its own trace', async () => {
  const { ctx } = await shopfront();
  const named = await gatherTeachEvidence(ctx, 'teach me how payments works');
  assert.ok(
    named.text.includes('Trace from payments — payments, named in the question'),
    named.text.slice(0, 600),
  );
  const unnamed = await gatherTeachEvidence(ctx, 'teach me how this works');
  assert.ok(!unnamed.text.includes('named in the question'), 'no named trace without a name');
});

test('teach evidence: no graph, no section', async () => {
  const ev = await gatherTeachEvidence(ctxFor(fs.realpathSync(SHOPFRONT)), 'teach me how this works');
  assert.deepStrictEqual(ev, { text: '', sources: [], edges: [], calls: [] });
});

test('teach evidence: a tight budget keeps traces first and says what it cut', async () => {
  const { ctx } = await shopfront();
  const full = await gatherTeachEvidence(ctx, 'teach me how this works');
  const budget = 1_200;
  assert.ok(full.text.length > budget, 'the fixture section is bigger than this budget');
  const ev = await gatherTeachEvidence(ctx, 'teach me how this works', budget);
  assert.ok(ev.text.length <= budget, `${ev.text.length} > ${budget}`);
  assert.ok(ev.text.includes('Trace from gateway/src/routes/orders.ts'), 'the first trace is kept');
  assert.match(ev.text, /Cut to stay within 1200 characters: .*the services brief/);
  assert.ok(!ev.text.includes('"id":"svc:gateway"'), 'the brief itself is not there');
  /* Sources follow what was kept, so the grader credits nothing it cut. */
  assert.ok(ev.sources.length < full.sources.length);
});

/*
 * THE TWO FAULTS THE ML HARNESS SCAN SHOWED (2026-09-23), on a graph small
 * enough to read: a test file with more http edges than the real client was
 * picked as the entry, and a module-level row kept only its first landing
 * file, so `app/main.py → app/providers/__init__.py` hid behind
 * `app/main.py → app/facade/__init__.py` in the same clustered module.
 */
/** The ML Harness shape, small enough to read: see the comment above. */
function mlHarnessShaped(): ArchGraph {
  const ev1 = (file: string, line: number) => [{ file, line, snippet: '' }];
  return {
    version: 1,
    repo: { id: 'r', name: 'r' },
    nodes: [
      { id: 'repo', kind: 'repo', label: 'r' },
      { id: 'svc:ui', kind: 'service', label: 'ui', parentId: 'repo', path: 'ui' },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'app' },
      { id: 'mod:ui/0', kind: 'module', label: 'lib', parentId: 'svc:ui' },
      { id: 'mod:api/0', kind: 'module', label: 'Db', parentId: 'svc:api' },
      { id: 'mod:api/1', kind: 'module', label: 'facade', parentId: 'svc:api' },
      { id: 'mod:api/2', kind: 'module', label: 'tools', parentId: 'svc:api' },
      { id: 'file:ui/client.ts', kind: 'file', label: 'client.ts', parentId: 'mod:ui/0', path: 'ui/client.ts' },
      { id: 'file:ui/client.test.ts', kind: 'file', label: 'client.test.ts', parentId: 'mod:ui/0', path: 'ui/client.test.ts' },
      { id: 'file:app/main.py', kind: 'file', label: 'main.py', parentId: 'mod:api/0', path: 'app/main.py' },
      { id: 'file:app/hwdetect.py', kind: 'file', label: 'hwdetect.py', parentId: 'mod:api/0', path: 'app/hwdetect.py' },
      { id: 'file:app/facade/__init__.py', kind: 'file', label: '__init__.py', parentId: 'mod:api/1', path: 'app/facade/__init__.py' },
      { id: 'file:app/providers/__init__.py', kind: 'file', label: '__init__.py', parentId: 'mod:api/1', path: 'app/providers/__init__.py' },
      { id: 'file:app/providers/ollama.py', kind: 'file', label: 'ollama.py', parentId: 'mod:api/1', path: 'app/providers/ollama.py' },
      { id: 'file:app/diagnosis.py', kind: 'file', label: 'diagnosis.py', parentId: 'mod:api/2', path: 'app/diagnosis.py' },
      { id: 'file:scripts/gate.py', kind: 'file', label: 'gate.py', parentId: 'svc:api', path: 'scripts/gate.py' },
    ],
    edges: [
      { id: 'h0', kind: 'http', srcId: 'file:ui/client.ts', dstId: 'file:app/hwdetect.py', evidence: ev1('ui/client.ts', 292) },
      { id: 'h1', kind: 'http', srcId: 'file:ui/client.ts', dstId: 'file:app/main.py', evidence: ev1('ui/client.ts', 280) },
      { id: 't1', kind: 'http', srcId: 'file:ui/client.test.ts', dstId: 'file:app/main.py', evidence: ev1('ui/client.test.ts', 5), instrument: 'test' },
      { id: 't2', kind: 'http', srcId: 'file:ui/client.test.ts', dstId: 'file:app/main.py', evidence: ev1('ui/client.test.ts', 9), instrument: 'test' },
      { id: 'i1', kind: 'import', srcId: 'file:app/main.py', dstId: 'file:app/facade/__init__.py', evidence: ev1('app/main.py', 182) },
      { id: 'i2', kind: 'import', srcId: 'file:app/main.py', dstId: 'file:app/providers/__init__.py', evidence: ev1('app/main.py', 35) },
      { id: 'i3', kind: 'import', srcId: 'file:app/providers/__init__.py', dstId: 'file:app/providers/ollama.py', evidence: ev1('app/providers/__init__.py', 4) },
      { id: 'i4', kind: 'import', srcId: 'file:app/main.py', dstId: 'file:app/diagnosis.py', evidence: ev1('app/main.py', 27) },
    ],
  } as unknown as ArchGraph;
}

test('teach evidence: tests are never the entry, and a row keeps every file it lands in', async () => {
  const graph = mlHarnessShaped();
  assert.strictEqual(serviceEntryFile(graph, 'svc:ui'), 'ui/client.ts', 'the test file is not the entry');
  const ev = await gatherTeachEvidence(ctxFor(fs.realpathSync(SHOPFRONT), { graph }), 'teach me how this works');
  assert.ok(ev.text.includes('Trace from ui/client.ts — the entry file of ui'), ev.text);
  const row = ev.text.split('\n').find((l) => l.includes('(module Db → facade'));
  assert.ok(row, ev.text);
  assert.ok(row.includes('app/main.py:35 → app/providers/__init__.py'), row);
  assert.ok(row.includes('app/main.py:182 → app/facade/__init__.py'), row);
  assert.ok(ev.sources.includes('app/providers/__init__.py'));
});

/*
 * FILES FIRST, MODULES AS A SUFFIX (Slice 9, 2026-09-23). The fourth
 * measurement's row was `7. Db --import--> facade: app/main.py:182 →
 * app/facade/__init__.py; app/main.py:35 → app/providers/__init__.py` — led by
 * two module labels, with the model hop second. The row now leads with the
 * file hop that goes furthest on (providers/__init__.py imports ollama.py),
 * and the modules follow it.
 */
test('teach evidence: a module-level row leads with the file hop that goes deepest, modules as a suffix', async () => {
  const graph = mlHarnessShaped();
  const ctx = ctxFor(fs.realpathSync(SHOPFRONT), { graph });
  const ev = await gatherTeachEvidence(ctx, 'teach me how this works');
  const row = ev.text.split('\n').find((l) => l.includes('(module Db → facade'));
  assert.ok(row, ev.text);
  assert.match(row, /^\d+\. app\/main\.py:35 → app\/providers\/__init__\.py; /, row);
  assert.ok(!/^\d+\. Db --/.test(row), `a row does not open on module labels: ${row}`);

  /* The tool's own text at the level of parts names the concrete files too. */
  const r = await executeAskTool('trace_flow', { from: 'mod:api/0' }, ctx);
  assert.ok(r.ok, r.evidence);
  const line = r.content!.split('\n').find((l) => l.includes('(module Db → facade)'));
  assert.ok(line, r.content);
  assert.match(line, /^\d+\. app\/main\.py:\d+ → app\/(facade|providers)\/__init__\.py \(module Db → facade\)/, line);
});

/*
 * THE QUESTION'S OWN WORDS AIM THE TRACE (Slice 9, 2026-09-23). Fourth
 * measurement: the model hop sat in the evidence under two module labels and
 * no answer reached `app/providers` or `app/diagnosis.py`; the question said
 * "model", "provider", "gates" and nothing used those words.
 */
test('teach evidence: the question names payments and the database — an aimed path to each, first', async () => {
  const { graph, ctx } = await shopfront();
  const ev = await gatherTeachEvidence(
    ctx,
    'teach me how payments reach the database, and where invoices come from',
  );
  const blocks = ev.text.split('\n\n');
  const hopsOf = (block: string) =>
    block.split('\n').slice(1).map((l) => {
      const m = /^\d+\. (\S+):(\d+) → (\S+)/.exec(l);
      assert.ok(m, `a hop line with its file:line: ${l}`);
      return { file: m[1]!, line: Number(m[2]), to: m[3]! };
    });
  const scanned = new Set(graph.nodes.filter((n) => n.kind === 'file').map((n) => n.path));

  const payments = blocks.find((b) => b.startsWith('The path to payments: '));
  assert.ok(payments, ev.text.slice(0, 2000));
  const ph = hopsOf(payments);
  assert.ok(ph.length >= 2, payments);
  assert.strictEqual(ph[0]!.file, 'gateway/src/routes/orders.ts', 'it starts at the entry file');
  assert.match(ph.at(-1)!.to, /^payments\//, 'and ends at a payments file');
  for (const h of ph) assert.ok(scanned.has(h.file) && h.line > 0, `${h.file}:${h.line} is a scanned line`);

  const database = blocks.find((b) => b.startsWith('The path to the database: '));
  assert.ok(database, ev.text.slice(0, 2000));
  const dh = hopsOf(database);
  assert.strictEqual(dh.at(-1)!.to, 'postgres', database);
  for (const h of dh) assert.ok(scanned.has(h.file) && h.line > 0, `${h.file}:${h.line} is a scanned line`);

  /* Nothing from the entry reaches invoices: one line says so, and where it is reached from. */
  const invoices = blocks.find((b) => b.startsWith('The path to invoices: '));
  assert.ok(invoices, ev.text.slice(0, 2000));
  assert.ok(!invoices.includes('\n'), `one line: ${invoices}`);
  assert.match(invoices, /no scanned path from gateway\/src\/routes\/orders\.ts to invoices/);
  assert.match(invoices, /reached from gateway\/src\/routes\/invoices\.ts:9/);

  /* The aimed blocks come before every entry trace. */
  const firstTrace = ev.text.indexOf('\nTrace from ');
  assert.ok(firstTrace > 0, 'the entry traces are still there');
  for (const b of [payments, database, invoices]) assert.ok(ev.text.indexOf(b) < firstTrace, b.slice(0, 80));
  assert.ok(ev.text.length <= TEACH_EVIDENCE_BUDGET_CHARS);
  for (const f of ev.sources) assert.ok(scanned.has(f), `${f} is a scanned file`);
});

test('teach evidence: "model provider" and "gates" aim at the provider file and the diagnosis file', async () => {
  const graph = mlHarnessShaped();
  const ev = await gatherTeachEvidence(
    ctxFor(fs.realpathSync(SHOPFRONT), { graph }),
    'Teach me how the engine sends token requests to the model provider, and how the gates fit around it.',
  );
  const blocks = ev.text.split('\n\n');
  const model = blocks.find((b) => b.startsWith('The hop to the model provider: '));
  assert.ok(model, ev.text);
  /* CONTRACT CHANGED 2026-09-23 (Slice 11): the title's file:line says it is an import. */
  assert.ok(
    model.startsWith(
      'The hop to the model provider: ui/client.ts → app/main.py → app/providers/__init__.py ' +
        '(reached by an import from app/main.py:35, not by a request)',
    ),
    model,
  );
  assert.ok(model.includes('\n2. app/main.py:35 → app/providers/__init__.py'), model);
  const gates = blocks.find((b) => b.startsWith('The path to the gates: '));
  assert.ok(gates, ev.text);
  assert.ok(
    gates.includes(
      'ui/client.ts → app/main.py → app/diagnosis.py (reached by an import from app/main.py:27, not by a request)',
    ),
    gates,
  );
  assert.ok(ev.text.indexOf(model) < ev.text.indexOf('Trace from ui/client.ts'), 'aimed first');
});

/*
 * WHAT THE TARGET FILE IS, IN ITS OWN WORDS (Slice 10, 2026-09-23). Fifth
 * measurement: `app/diagnosis.py` was named 4/6 and called "gateway logic",
 * "error gates", "run validation" — its docstring says "the five-gate honesty
 * test, executed instead of asserted". The files below are the ML Harness
 * shape's own, with the real docstrings' opening lines.
 */
const DIAGNOSIS_DOC = '"""The diagnosis engine: the five-gate honesty test, executed instead of asserted.';
const PROVIDERS_DOC = '"""The provider protocol, and the two adapters v1 ships.';

function mlHarnessShapedRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-teach-evidence-'));
  const write = (rel: string, lines: string[]) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `${lines.join('\n')}\n`);
  };
  write('app/diagnosis.py', [
    DIAGNOSIS_DOC,
    '',
    '`docs/diagnosis_engine.yaml` states an invariant in prose: no user is ever told',
    'to train unless all five gates have been passed on the path that reached the',
    'recommendation. Prose cannot fail a build. This module is the',
    'mechanical form of that sentence, so the test suite can.',
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'GATES = 5',
  ]);
  write('app/providers/__init__.py', [
    PROVIDERS_DOC,
    '',
    'We ship no AI. The user lends us theirs. Everything in this package exists to',
    'make "your model" a replaceable part rather than an assumption baked through',
    'the codebase.',
    '"""',
    '',
    'from dataclasses import dataclass',
  ]);
  /* No docstring: the engine's first lines are imports, as `app/main.py`'s are. */
  write('app/main.py', [
    'from __future__ import annotations',
    '',
    ...Array.from({ length: 20 }, (_, i) => `from app import part_${String(i + 1).padStart(2, '0')}`),
  ]);
  write('ui/client.ts', ['export const ask = () => fetch("/health");']);
  return fs.realpathSync(root);
}

test('teach evidence: under each aimed path, what its target file is, in its own words', async () => {
  const graph = mlHarnessShaped();
  const root = mlHarnessShapedRepo();
  const ev = await gatherTeachEvidence(
    ctxFor(root, { graph }),
    'Teach me how the engine sends token requests to the model provider, and how the gates fit around it.',
  );
  const blocks = ev.text.split('\n\n');
  const after = (title: string): string => {
    const i = blocks.findIndex((b) => b.startsWith(title));
    assert.ok(i >= 0, `${title}\n${ev.text}`);
    return blocks[i + 1] ?? '';
  };
  /* Right under its aimed block, titled, and the file's own sentence verbatim. */
  const gates = after('The path to the gates: ');
  assert.ok(gates.startsWith('What `app/diagnosis.py` is, in its own words:\n'), gates);
  assert.ok(gates.includes(`1| ${DIAGNOSIS_DOC}`), gates);
  assert.ok(gates.includes('mechanical form of that sentence, so the test suite can.'), gates);
  assert.ok(!gates.includes('GATES = 5'), `the docstring, not the code after it: ${gates}`);
  const model = after('The hop to the model provider: ');
  assert.ok(model.startsWith('What `app/providers/__init__.py` is, in its own words:\n'), model);
  assert.ok(model.includes(`1| ${PROVIDERS_DOC}`), model);
  assert.ok(!model.includes('dataclass'), model);
  /* A file with no docstring shows its first 12 non-blank lines. */
  const engine = after('The path into the engine: ');
  assert.ok(engine.startsWith('What `app/main.py` is, in its own words:\n'), engine);
  const quoted = engine.split('\n').slice(1).filter((l) => /^\d+\| /.test(l));
  assert.strictEqual(quoted.length, 12, engine);
  assert.ok(engine.includes('13| from app import part_11') && !engine.includes('part_12'), engine);
  /* Before every entry trace, within the budget, and counted as read. */
  const firstTrace = ev.text.indexOf('\nTrace from ');
  assert.ok(firstTrace < 0 || ev.text.indexOf(gates) < firstTrace, 'before the entry traces');
  assert.ok(ev.text.length <= TEACH_EVIDENCE_BUDGET_CHARS, `${ev.text.length}`);
  assert.ok(ev.sources.includes('app/diagnosis.py') && ev.sources.includes('app/providers/__init__.py'));
});

test('teach evidence: one file\'s own words are capped, and say that they go on', async () => {
  const graph = mlHarnessShaped();
  const root = mlHarnessShapedRepo();
  const long = Array.from({ length: 25 }, (_, i) => `Gate ${i + 1} is checked on the path that reached the answer.`);
  fs.writeFileSync(path.join(root, 'app/diagnosis.py'), `${[DIAGNOSIS_DOC, '', ...long, '"""'].join('\n')}\n`);
  const ev = await gatherTeachEvidence(ctxFor(root, { graph }), 'how do the gates work?');
  const own = ev.text.split('\n\n').find((b) => b.startsWith('What `app/diagnosis.py` is'));
  assert.ok(own, ev.text);
  const body = own.split('\n').filter((l) => /^\d+\| /.test(l)).join('\n');
  assert.ok(body.length <= teachEvidence.TEACH_EVIDENCE_OWN_WORDS_CHARS, `${body.length} chars of quoted lines`);
  assert.ok(body.startsWith(`1| ${DIAGNOSIS_DOC}`), body);
  assert.match(own, /\(it goes on; read_file app\/diagnosis\.py for the rest\)$/);
});

/*
 * THE PROSE FIRST HOP USES THE CHART'S LABELLER (Slice 11, 2026-09-23). Sixth
 * measurement: the chart's first step said `POST /api/threads/*` + `/run`, and
 * the section under it still said "calls main.py over HTTP (GET /health)" three
 * times (`ev-r1.txt:7/24/38`). Two http edges join the same two files here; the
 * shortest proof rides the health check, as the measured one did.
 */
function healthAndRunGraph(): ArchGraph {
  const file = (p: string, svc: string) => ({ id: `file:${p}`, kind: 'file', label: p.split('/').pop(), path: p, parentId: svc });
  return {
    version: 1,
    repo: { id: 'r', name: 'r' },
    nodes: [
      { id: 'svc:ui', kind: 'service', label: 'ui', path: 'ui' },
      { id: 'svc:api', kind: 'service', label: 'api', path: 'app' },
      file('ui/client.ts', 'svc:ui'),
      file('app/main.py', 'svc:api'),
      file('app/providers/__init__.py', 'svc:api'),
    ],
    edges: [
      { id: 'h-health', kind: 'http', srcId: 'file:ui/client.ts', dstId: 'file:app/main.py', evidence: [{ file: 'ui/client.ts', line: 280, snippet: '' }], detail: { method: 'GET', pathPattern: '/health' } },
      { id: 'h-run', kind: 'http', srcId: 'file:ui/client.ts', dstId: 'file:app/main.py', evidence: [{ file: 'ui/client.ts', line: 310, snippet: '' }], detail: { method: 'POST', pathPattern: '/api/threads/*/run' } },
      { id: 'i-prov', kind: 'import', srcId: 'file:app/main.py', dstId: 'file:app/providers/__init__.py', evidence: [{ file: 'app/main.py', line: 35, snippet: '' }] },
    ],
  } as unknown as ArchGraph;
}

test('teach evidence: the section\'s first hop carries the run route, and says what the chart\'s step says', async () => {
  const { buildAnswerFlowChart } = await import('../server/conceptChart.js');
  const graph = healthAndRunGraph();
  const question = 'Teach me how a run reaches the model provider.';
  const ev = await gatherTeachEvidence(ctxFor(fs.realpathSync(SHOPFRONT), { graph }), question);
  const model = ev.text.split('\n\n').find((b) => b.startsWith('The hop to the model provider: '));
  assert.ok(model, ev.text);
  const first = model.split('\n').find((l) => l.startsWith('1. '));
  assert.ok(first, model);
  assert.ok(first.startsWith('1. ui/client.ts:310 → app/main.py ('), `the run edge's own line: ${first}`);
  assert.ok(first.includes('POST /api/threads/*/run'), first);
  assert.ok(!ev.text.includes('GET /health'), `the health check is not the hop the question asked about: ${ev.text}`);
  const said = first.slice(first.indexOf(' (') + 2, -1);

  /* The chart the floor draws from the same gathered path. */
  const traces = ev.calls
    .filter((c) => c.name === 'trace_flow' && c.args.to !== undefined && c.result.flow !== undefined)
    .map((c) => ({ ...c.result.flow!, gathered: true }));
  const chart = buildAnswerFlowChart(graph, 'The UI sends it to app/main.py.', traces, question);
  assert.ok(chart?.steps, 'the floor drew the aimed path');
  assert.strictEqual(chart!.steps![0]!.from, 'file:ui/client.ts');
  assert.strictEqual(chart!.steps![0]!.says, said, 'the chart and the prose name the first hop alike');
});

/*
 * AN IMPORT HOP SAYS IT IS ONE (Slice 11, 2026-09-23). Sixth measurement: the
 * chart drew `main.py → diagnosis.py` as a step after the HTTP hop and three
 * answers put the honesty test "on the token path" ("runs a five-gate diagnosis
 * check before any model answer is returned"). The edge is `app/main.py:27`, an
 * import, and nothing said so.
 */
test('teach evidence: an import hop says it is one, in the section and on the chart; the HTTP hop reads as a request', async () => {
  const { buildAnswerFlowChart } = await import('../server/conceptChart.js');
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  const graph = mlHarnessShaped();
  const question =
    'Teach me how the engine sends token requests to the model provider, and how the gates fit around it.';
  const ev = await gatherTeachEvidence(ctxFor(fs.realpathSync(SHOPFRONT), { graph }), question);
  const blocks = ev.text.split('\n\n');
  const gates = blocks.find((b) => b.startsWith('The path to the gates: '));
  assert.ok(gates, ev.text);
  assert.ok(gates.includes('(reached by an import from app/main.py:27, not by a request)'), gates);
  assert.ok(
    gates.includes('\n2. app/main.py:27 → app/diagnosis.py (imports diagnosis.py — a module main.py loads, not a request hop)'),
    gates,
  );
  const model = blocks.find((b) => b.startsWith('The hop to the model provider: '));
  assert.ok(model, ev.text);
  assert.ok(
    model.includes('\n2. app/main.py:35 → app/providers/__init__.py (imports __init__.py — a module main.py loads, not a request hop)'),
    model,
  );
  /* The HTTP hop is a request, and reads as one. */
  for (const b of [gates, model]) {
    const first = b.split('\n').find((l) => l.startsWith('1. '));
    assert.ok(first?.startsWith('1. ui/client.ts:280 → app/main.py (calls main.py over HTTP'), b);
    assert.ok(!first!.includes('not a request hop'), first);
  }

  /* The chart the floor draws from the same paths says the same, step by step. */
  const traces = ev.calls
    .filter((c) => c.name === 'trace_flow' && c.args.to !== undefined && c.result.flow !== undefined)
    .map((c) => ({ ...c.result.flow!, gathered: true }));
  const chart = buildAnswerFlowChart(graph, 'The UI sends it to app/main.py.', traces, question);
  assert.ok(chart?.steps, 'the floor drew the aimed paths');
  const step = (to: string) => chart!.steps!.find((s) => s.to === to);
  assert.strictEqual(step('file:app/diagnosis.py')?.says, 'imports diagnosis.py — a module main.py loads, not a request hop');
  assert.strictEqual(step('file:app/providers/__init__.py')?.says, 'imports __init__.py — a module main.py loads, not a request hop');
  const http = step('file:app/main.py');
  assert.ok(http?.says.startsWith('calls main.py over HTTP') && !http.says.includes('not a request hop'), http?.says);
  /* Every step says what the section's hop line says. */
  const said = new Set(
    [gates, model].flatMap((b) => b.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.slice(l.indexOf(' (') + 2, -1))),
  );
  for (const s of chart!.steps!) assert.ok(said.has(s.says), `${s.says} is a hop the section names`);

  /* And the teach rule says what each kind names. */
  assert.ok(
    renderTeachModeInstructions({ evidence: true } as never).includes(
      'An import hop names what a file loads; a request hop names what it calls.',
    ),
  );
});

/*
 * A LINE THAT ENDS IN A COLON PROMISES WHAT FOLLOWS (Slice 11, 2026-09-23).
 * Sixth measurement: the providers docstring was quoted to "Two adapters, and
 * this is decided (`ARCHITECTURE.md` §4.3):" and cut before the adapters were
 * named. The fixture is that docstring's shape: two paragraphs, the colon line,
 * a two-item list with continuation lines, and more prose after it.
 */
const PROVIDERS_DOCSTRING = [
  PROVIDERS_DOC,
  '',
  'We ship no AI. The user lends us theirs. Everything in this package exists to',
  'make "your model" a replaceable part rather than an assumption baked through',
  'the codebase.',
  '',
  'Two adapters, and this is decided (`ARCHITECTURE.md` §4.3):',
  '',
  '- **`openai_compatible`** - one code path driven by a base URL, covering',
  "  OpenAI, OpenRouter, vLLM, LM Studio and llama.cpp's server. The reason to",
  '  prefer it is that it is one adapter, not five.',
  "- **`ollama`** - Ollama's own `/api/chat`, because it is the local default and",
  '  its native envelope reports tool calls more reliably than its',
  '  OpenAI-compatible shim does.',
  '',
  "A native Anthropic adapter is post-v1. Anthropic's API is a different endpoint,",
  'a different streaming envelope and a different tool-call shape, so it is a',
  'second adapter and not a base URL. Until then, Anthropic models are reachable',
  'through OpenRouter, which is OpenAI-compatible.',
  '',
  '## `locality` is not cosmetic',
  '',
  '`classify()` decides it and the egress guard reads it. Unknown is `remote`,',
  'always, because the safe default is the restrictive one.',
  '"""',
  '',
  'from dataclasses import dataclass',
];

test('teach evidence: a quote that reaches a line ending in a colon runs to the end of the list after it, within the cap', async () => {
  const graph = mlHarnessShaped();
  const root = mlHarnessShapedRepo();
  fs.writeFileSync(path.join(root, 'app/providers/__init__.py'), `${PROVIDERS_DOCSTRING.join('\n')}\n`);
  const question = 'Teach me how the engine sends token requests to the model provider, and how the gates fit around it.';
  const ev = await gatherTeachEvidence(ctxFor(root, { graph }), question);
  const own = ev.text.split('\n\n').find((b) => b.startsWith('What `app/providers/__init__.py` is'));
  assert.ok(own, ev.text);
  const body = own.split('\n').filter((l) => /^\d+\| /.test(l)).join('\n');
  /* Precondition: the 700-char quote would have stopped before the list closed. */
  assert.ok(body.length > teachEvidence.TEACH_EVIDENCE_OWN_WORDS_CHARS, `${body.length} chars: the specimen needs the longer cap`);
  assert.ok(body.includes('7| Two adapters, and this is decided'), own);
  assert.ok(body.includes("9| - **`openai_compatible`** - one code path"), `the first adapter: ${own}`);
  assert.ok(body.includes("12| - **`ollama`** - Ollama's own"), `the second adapter: ${own}`);
  assert.ok(body.includes('14|   OpenAI-compatible shim does.'), `the list to its end: ${own}`);
  assert.ok(!body.includes('A native Anthropic adapter'), `and no further: ${own}`);
  assert.ok(body.length <= teachEvidence.TEACH_EVIDENCE_OWN_WORDS_LIST_CHARS, `${body.length} chars`);
  assert.match(own, /\(it goes on; read_file app\/providers\/__init__\.py for the rest\)$/);
  assert.ok(ev.text.length <= TEACH_EVIDENCE_BUDGET_CHARS, `${ev.text.length}`);

  /* A tight section keeps the quote whole and cuts the entry traces, and says so. */
  const aimedEnd = ev.text.indexOf('\n\nTrace from ');
  assert.ok(aimedEnd > 0, ev.text);
  const tight = await gatherTeachEvidence(ctxFor(root, { graph }), question, aimedEnd + 200);
  assert.ok(tight.text.length <= aimedEnd + 200, `${tight.text.length} > ${aimedEnd + 200}`);
  assert.ok(tight.text.includes("12| - **`ollama`** - Ollama's own"), tight.text);
  assert.match(tight.text, /Cut to stay within \d+ characters: [^\n]*trace from ui\/client\.ts/, tight.text);
});
