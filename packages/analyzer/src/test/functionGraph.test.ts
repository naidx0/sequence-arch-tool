import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFunctionGraph, MODULE_GRANULAR_CALL_LABEL } from '../functions/buildFunctionGraph.js';
import { functionNodeId } from '@sequence/schema';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';
import { scanRepo } from '../scan.js';

const TS_FIXTURE = `
function helper() {
  return 1;
}

function outer() {
  function inner() {
    helper();
    unknownCallee();
  }
  inner();
  helper();
}

const namedArrow = () => {
  helper();
};

class Foo {
  bar() {
    helper();
  }
}
`;

const PY_FIXTURE = `
def top_level():
    pass

class Widget:
    def method(self):
        pass
`;

test('extractFacts: TS functions with correct names and spans', async () => {
  await initParser();
  const facts = extractFacts(TS_FIXTURE, 'sample.ts', 'ts');

  const byName = (name: string) => facts.functions.filter((f) => f.name === name);

  const helper = byName('helper');
  assert.strictEqual(helper.length, 1);
  assert.strictEqual(helper[0].startLine, 2);
  assert.ok(helper[0].endLine >= helper[0].startLine);

  const outer = byName('outer');
  assert.strictEqual(outer.length, 1);
  assert.strictEqual(outer[0].startLine, 6);

  const inner = byName('inner');
  assert.strictEqual(inner.length, 1);
  assert.ok(inner[0].startLine > outer[0].startLine);

  const namedArrow = byName('namedArrow');
  assert.strictEqual(namedArrow.length, 1);

  const bar = byName('bar');
  assert.strictEqual(bar.length, 1);
});

test('extractFacts: Python def functions extracted', async () => {
  await initParser();
  const facts = extractFacts(PY_FIXTURE, 'widget.py', 'py');

  const names = facts.functions.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['method', 'top_level']);
  assert.ok(facts.functions.every((f) => f.startLine > 0 && f.endLine >= f.startLine));
});

test('buildFunctionGraph: intra-file calls, unknown callee omitted, nested attribution', async () => {
  await initParser();
  const facts = extractFacts(TS_FIXTURE, 'sample.ts', 'ts');
  const graph = buildFunctionGraph([
    { file: facts.file, lang: facts.language, functions: facts.functions, calls: facts.calls },
  ]);

  assert.ok(graph.nodes.length >= 5, `expected function nodes, got ${graph.nodes.length}`);

  const nodeId = (name: string, startLine: number) => `fn:sample.ts#${name}@${startLine}`;

  const helper = facts.functions.find((f) => f.name === 'helper')!;
  const outer = facts.functions.find((f) => f.name === 'outer')!;
  const inner = facts.functions.find((f) => f.name === 'inner')!;

  const edgeKey = (src: string, dst: string) => `${src}->${dst}`;
  const edges = new Set(graph.edges.map((e) => edgeKey(e.srcId, e.dstId)));

  // inner calls helper — attributed to inner, not outer
  assert.ok(
    edges.has(edgeKey(nodeId('inner', inner.startLine), nodeId('helper', helper.startLine))),
    'inner -> helper calls edge expected'
  );

  // outer calls helper directly
  assert.ok(
    edges.has(edgeKey(nodeId('outer', outer.startLine), nodeId('helper', helper.startLine))),
    'outer -> helper calls edge expected'
  );

  // unknownCallee() must not produce an edge
  for (const e of graph.edges) {
    assert.ok(!e.dstId.includes('unknownCallee'), 'no edge to unknown callee');
  }

  // no duplicate edges
  const ids = graph.edges.map((e) => e.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('buildFunctionGraph: pure — empty input and malformed never throw', () => {
  assert.deepStrictEqual(buildFunctionGraph([]), { nodes: [], edges: [] });
  assert.deepStrictEqual(buildFunctionGraph(null as unknown as []), { nodes: [], edges: [] });
  assert.deepStrictEqual(
    buildFunctionGraph([{ file: 'x.ts', lang: 'ts', functions: null as unknown as [], calls: [null as unknown as never] }]),
    { nodes: [], edges: [] }
  );
});

test('buildFunctionGraph: cross-file call via resolved import', () => {
  const graph = buildFunctionGraph([
    {
      file: 'src/main.ts',
      lang: 'ts',
      functions: [{ name: 'main', startLine: 2, endLine: 5 }],
      calls: [{ callee: 'shared', line: 3, args: [], kwargs: {} }],
      imports: [{ raw: './shared', line: 1, resolved: 'src/shared.ts' }],
    },
    {
      file: 'src/shared.ts',
      lang: 'ts',
      functions: [{ name: 'shared', startLine: 1, endLine: 3 }],
      calls: [],
    },
  ]);

  assert.strictEqual(graph.edges.length, 1);
  assert.strictEqual(graph.edges[0].kind, 'call');
  assert.ok(graph.edges[0].dstId.startsWith('fn:src/shared.ts#shared@'));
});

test('buildFunctionGraph: unresolved import path → no cross-file edge', () => {
  const graph = buildFunctionGraph([
    {
      file: 'src/main.ts',
      lang: 'ts',
      functions: [{ name: 'main', startLine: 1, endLine: 4 }],
      calls: [{ callee: 'external', line: 2, args: [], kwargs: {} }],
      imports: [{ raw: '@/external', line: 1 }],
    },
    {
      file: 'src/external.ts',
      lang: 'ts',
      functions: [{ name: 'external', startLine: 1, endLine: 2 }],
      calls: [],
    },
  ]);

  assert.strictEqual(graph.edges.length, 0);
});

test('LOCK: scanRepo shopfront ArchGraph node/edge counts unchanged by function extraction', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
  const graph = await scanRepo(fixture);

  assert.strictEqual(graph.nodes.length, 36, 'ArchGraph node count must stay byte-identical');
  /*
   * 39 -> 40 on 2026-09-04, and the lock did its job: it forced this edge to be
   * identified before the number moved.
   *
   * The new edge is `payments -> postgres [db_access]`, evidenced at
   * payments/src/db.js:3 — `new Pool({ connectionString: process.env.DATABASE_URL })`.
   * A new_expression was not collected as a call, so that line produced no fact
   * at all. orders (create_engine), shipping (sql.Open) and invoices
   * (application.properties) each already had their db_access edge; payments is
   * the only service in the fixture whose connection is CONSTRUCTED, and it was
   * the only one missing. The exported diagram showed it reading and writing a
   * database it never connected to.
   *
   * Node count is deliberately unchanged: the fix adds call facts, not nodes.
   * If a later change moves 36, that is a different question and needs its own
   * answer.
   */
  assert.strictEqual(graph.edges.length, 40, 'ArchGraph edge count must stay byte-identical');
  assert.ok(!graph.nodes.some((n) => (n as { kind: string }).kind === 'function'), 'no function nodes in ArchGraph');
});

// ---------------------------------------------------------------------------
// fn-comm precision follow-up (HANDOFF §8.3): symbol-granular imports.
// ---------------------------------------------------------------------------

test('extractFacts: named JS import captures only its named symbols; namespace/default stay module-granular', async () => {
  await initParser();
  const src = `
import { x, y } from './b';
import * as ns from './c';
import def from './d';
import './e';
x();
`;
  const facts = extractFacts(src, 'a.ts', 'ts');
  const byRaw = (raw: string) => facts.imports.find((i) => i.raw === raw)!;

  const b = byRaw('./b');
  assert.deepStrictEqual(b.names, ['x', 'y'], 'named clause must list exactly its local bindings');
  assert.ok(!b.moduleGranular, 'a purely named import is symbol-granular, not module-granular');

  const c = byRaw('./c');
  assert.strictEqual(c.names, undefined, 'a namespace import has no single symbol to name');
  assert.strictEqual(c.moduleGranular, true, 'import * as ns must be marked module-granular');

  const d = byRaw('./d');
  assert.strictEqual(d.names, undefined, 'a default import has no single symbol to name');
  assert.strictEqual(d.moduleGranular, true, 'a default import must be marked module-granular');

  const e = byRaw('./e');
  assert.strictEqual(e.moduleGranular, true, 'a side-effect-only import has no clause to narrow');
});

test('extractFacts: Python from-import captures named symbols; wildcard stays module-granular', async () => {
  await initParser();
  const src = `
from app.db import get_order, insert_order
from app.db import get_order as go
from app.db import *
`;
  const facts = extractFacts(src, 'routes.py', 'py');
  const byRaw = (raw: string, idx: number) => facts.imports.filter((i) => i.raw === raw)[idx];

  const named = byRaw('app.db', 0);
  assert.deepStrictEqual(named.names, ['get_order', 'insert_order']);
  assert.ok(!named.moduleGranular);

  const aliased = byRaw('app.db', 1);
  assert.deepStrictEqual(aliased.names, ['go'], 'the alias is the local binding calls actually use');

  const wildcard = byRaw('app.db', 2);
  assert.strictEqual(wildcard.moduleGranular, true, 'from x import * has no single symbol to name');
});

test('buildFunctionGraph: import naming two symbols, only one called → edge for the called one only, unrelated same-named function elsewhere is not pulled in', () => {
  // Before the fix, cross-file resolution matched a callee against every
  // function in every file the caller happened to import, regardless of
  // which names that import statement actually named. That let an unrelated
  // file's same-named function collide with the real one and make the match
  // ambiguous — silently dropping a true edge. b.ts's `x` is genuinely
  // imported by name; c.ts's `x` is not (a.ts only imports `z` from c.ts) —
  // it must not be considered a candidate at all.
  const graph = buildFunctionGraph([
    {
      file: 'a.ts',
      lang: 'ts',
      functions: [{ name: 'main', startLine: 1, endLine: 5 }],
      calls: [{ callee: 'x', line: 3, args: [], kwargs: {} }],
      imports: [
        { raw: './b', line: 1, resolved: 'b.ts', names: ['x', 'y'] },
        { raw: './c', line: 2, resolved: 'c.ts', names: ['z'] },
      ],
    },
    {
      file: 'b.ts',
      lang: 'ts',
      functions: [
        { name: 'x', startLine: 1, endLine: 2 },
        { name: 'y', startLine: 4, endLine: 5 },
      ],
      calls: [],
    },
    {
      file: 'c.ts',
      lang: 'ts',
      functions: [{ name: 'z', startLine: 1, endLine: 2 }, { name: 'x', startLine: 4, endLine: 6 }],
      calls: [],
    },
  ]);

  assert.strictEqual(graph.edges.length, 1, 'exactly one call edge — no false ambiguity from c.ts');
  const [edge] = graph.edges;
  const bx = functionNodeId('b.ts', 'x', 1);
  const cx = functionNodeId('c.ts', 'x', 4);
  assert.strictEqual(edge.dstId, bx, 'must resolve to the imported b.ts#x');
  assert.notStrictEqual(edge.dstId, cx, 'must not resolve to the unimported, unrelated c.ts#x');
  assert.strictEqual(edge.label, undefined, 'a symbol-confirmed match is not module-granular');

  // evidence survives: the destination node's file/line are the real definition site.
  const dstNode = graph.nodes.find((n) => n.id === bx)!;
  assert.strictEqual(dstNode.file, 'b.ts');
  assert.strictEqual(dstNode.startLine, 1);
});

test('buildFunctionGraph: namespace/default import resolves module-granular and the edge is marked as such', () => {
  const graph = buildFunctionGraph([
    {
      file: 'a.ts',
      lang: 'ts',
      functions: [{ name: 'main', startLine: 1, endLine: 4 }],
      calls: [{ callee: 'helper', line: 2, args: [], kwargs: {} }],
      imports: [{ raw: './ns', line: 1, resolved: 'ns.ts', moduleGranular: true }],
    },
    {
      file: 'ns.ts',
      lang: 'ts',
      functions: [{ name: 'helper', startLine: 3, endLine: 6 }],
      calls: [],
    },
  ]);

  assert.strictEqual(graph.edges.length, 1);
  const [edge] = graph.edges;
  assert.strictEqual(edge.dstId, functionNodeId('ns.ts', 'helper', 3));
  assert.strictEqual(
    edge.label,
    MODULE_GRANULAR_CALL_LABEL,
    'a namespace/default-derived match must say it is not symbol-confirmed'
  );

  const dstNode = graph.nodes.find((n) => n.id === edge.dstId)!;
  assert.strictEqual(dstNode.file, 'ns.ts');
  assert.strictEqual(dstNode.startLine, 3);
});
