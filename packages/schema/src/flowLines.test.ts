/**
 * Flow lines: the plain-text way to write a flow chart (canvas plan, Slice 1).
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { validateChart } from './chart.js';
import { chartToFlowLines, compileFlowLines, flowProblemLine } from './flowLines.js';

const HEAD = { kind: 'data-flow' as const, title: 'How a search runs' };

const PLAN_EXAMPLE = [
  'ui "Search page" = web/src/pages/search.tsx',
  'ui -> api: the query | The page sends what was typed to the server',
  'api -> engine: a prompt | The server turns it into a prompt for the engine',
].join('\n');

test('the plan example compiles: parts, hops in order, narration, grounding path', () => {
  const r = compileFlowLines(PLAN_EXAMPLE, HEAD);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepStrictEqual(r.chart.items, [
    { id: 'ui', label: 'Search page', nodeId: 'web/src/pages/search.tsx' },
    { id: 'api', label: 'api' },
    { id: 'engine', label: 'engine' },
  ]);
  assert.deepStrictEqual(r.chart.links, [
    { from: 'ui', to: 'api', label: 'the query' },
    { from: 'api', to: 'engine', label: 'a prompt' },
  ]);
  assert.deepStrictEqual(r.steps.map((s) => s.say), [
    'The page sends what was typed to the server',
    'The server turns it into a prompt for the engine',
  ]);
  assert.strictEqual(r.chart.kind, 'data-flow');
  assert.strictEqual(r.chart.title, 'How a search runs');
  assert.ok(validateChart(r.chart).ok);
});

test('what models write unprompted is tolerated: -->, Mermaid labels, D2 declarations, fences', () => {
  const text = [
    '```mermaid',
    'flowchart LR',
    '%% the request path',
    'gateway[API gateway] -->|order| orders("Orders service")',
    'orders --> db: a row',
    'db: Postgres',
    '```',
  ].join('\n');
  const r = compileFlowLines(text, HEAD);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepStrictEqual(
    r.chart.items.map((i) => [i.id, i.label]),
    [['gateway', 'API gateway'], ['orders', 'Orders service'], ['db', 'Postgres']],
  );
  assert.deepStrictEqual(r.chart.links, [
    { from: 'gateway', to: 'orders', label: 'order' },
    { from: 'orders', to: 'db', label: 'a row' },
  ]);
});

test('a chain on one line is refused with the line number and the fix', () => {
  const r = compileFlowLines('a -> b\nb -> c -> d', HEAD);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ok === false && r.problems[0]!.line, 2);
  assert.match(r.ok === false ? r.problems[0]!.message : '', /one hop per line/);
});

test('an unreadable line names itself and shows both shapes that work', () => {
  const r = compileFlowLines('ui -> api\n  the page talks to the server ', HEAD);
  assert.strictEqual(r.ok, false);
  const msg = r.ok === false ? r.problems[0]!.message : '';
  assert.match(msg, /^line 2: cannot read `the page talks to the server`/);
  assert.match(msg, /a -> b: what moves \| what happens/);
  assert.match(msg, /a "Label" = path\/to\/file/);
});

test('empty text and a part declared twice are refused', () => {
  assert.strictEqual(compileFlowLines('\n# nothing\n', HEAD).ok, false);
  const twice = compileFlowLines('ui = a.ts\nui = b.ts', HEAD);
  assert.strictEqual(twice.ok, false);
  assert.match(twice.ok === false ? twice.problems[0]!.message : '', /already declared on line 1/);
});

test('a grounding refusal from validateChart comes back on the line the author wrote', () => {
  const text = ['ui = file:web/page.tsx', 'db = file:db/schema.sql', 'ui -> db: rows'].join('\n');
  const r = compileFlowLines(text, HEAD);
  assert.ok(r.ok);
  const known = new Set(['file:web/page.tsx', 'file:db/schema.sql']);
  const edges = new Set(['file:db/schema.sql>file:web/page.tsx']);
  const v = validateChart(r.chart, known, edges);
  assert.strictEqual(v.ok, false);
  const lines = v.ok ? [] : v.problems.map((p) => flowProblemLine(r, p));
  assert.match(lines[0]!, /^line 3 \(ui -> db\): no edge file:web\/page.tsx -> file:db\/schema.sql/);
  assert.match(lines[0]!, /The scan has file:db\/schema.sql -> file:web\/page.tsx/);

  const ghost = compileFlowLines('ui = file:web/page.tsx\nx = file:nope.ts\nui -> x', HEAD);
  assert.ok(ghost.ok);
  const g = validateChart(ghost.chart, known, edges);
  assert.strictEqual(g.ok, false);
  assert.match(g.ok ? '' : flowProblemLine(ghost, g.problems[0]!), /^line 2 \(x\): "file:nope.ts" is not a node/);
});

test('printing a chart and compiling it back gives the same items and links', () => {
  const charts = [
    compileFlowLines(PLAN_EXAMPLE, HEAD),
    compileFlowLines('a -> b\nb -> c: x\nc -> a', HEAD),
    compileFlowLines('lonely "A part with no hops" | shown anyway\nz -> y', HEAD),
    compileFlowLines('z -> y\ny -> x\nx "Declared late" = src/x.ts', HEAD),
  ];
  for (const r of charts) {
    assert.ok(r.ok);
    const text = chartToFlowLines(r.chart, r.steps);
    const back = compileFlowLines(text, HEAD);
    assert.ok(back.ok, text);
    assert.deepStrictEqual(back.chart.items, r.chart.items, text);
    assert.deepStrictEqual(back.chart.links, r.chart.links, text);
    assert.deepStrictEqual(back.steps, r.steps, text);
  }
});

test('the plan example is far shorter than the same chart as JSON', () => {
  const r = compileFlowLines(PLAN_EXAMPLE, HEAD);
  assert.ok(r.ok);
  const asJson = JSON.stringify({ items: r.chart.items, links: r.chart.links });
  const bare = PLAN_EXAMPLE.replace(/ \|.*$/gm, '');
  assert.ok(bare.length * 1.5 < asJson.length, `${bare.length} vs ${asJson.length}`);
});
