/**
 * Draw languages (patch 0014; d2 and states patch 0020): every language
 * round-trips the model's real charts, names the line of an ungrounded edge,
 * and the numbered map is deterministic and bounded.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import type { ChartItem, ChartLink } from './chart.js';
import {
  DRAW_LANGS,
  type DrawLang,
  type NumberedMap,
  type ScanLike,
  asciiMap,
  compileDrawing,
  drawPrompt,
  groundDrawing,
  hopCoverage,
  instructionFor,
  isPointingLang,
  namedView,
  numberedMap,
  printDrawing,
  roughTokens,
  scanResolver,
} from './drawLanguages.js';

/* The model's three real propose_chart calls from the owner's chat, verbatim
   (extra item fields `kind` and `name` included: the model wrote them). */
const REAL_CHARTS = [
  {
    kind: 'system-architecture',
    title: 'ml-harness-app as a modular Solid.js web app',
    items: [
      { id: 'svc', label: 'Service', detail: 'svc:ml-harness-app', kind: 'service' },
      { id: 'platform', label: 'Platform', detail: 'mod:ml-harness-app/0', kind: 'module' },
      { id: 'panes', label: 'Panes', detail: 'mod:ml-harness-app/1', kind: 'module' },
      { id: 'readers', label: 'Readers', detail: 'mod:ml-harness-app/2', kind: 'module' },
      { id: 'engine', label: 'Engine', detail: 'mod:ml-harness-app/3', kind: 'module' },
      { id: 'ui', label: 'Ui', detail: 'mod:ml-harness-app/4', kind: 'module' },
      { id: 'shims', label: 'shims', detail: 'mod:ml-harness-app/5', kind: 'module' },
    ],
    links: [
      { from: 'svc', to: 'platform', label: 'contains' },
      { from: 'svc', to: 'panes', label: 'contains' },
      { from: 'svc', to: 'readers', label: 'contains' },
      { from: 'svc', to: 'engine', label: 'contains' },
      { from: 'svc', to: 'ui', label: 'contains' },
      { from: 'svc', to: 'shims', label: 'contains' },
    ],
  },
  {
    kind: 'data-flow',
    title: 'How a request reaches the model',
    items: [
      { id: 'ui', label: 'Composer' },
      { id: 'srv', label: 'Ask pipeline' },
      { id: 'llm', label: 'Provider' },
    ],
    links: [
      { from: 'ui', to: 'srv', label: 'POST /api/ask' },
      { from: 'srv', to: 'llm' },
    ],
    focusItemId: 'srv',
  },
  {
    kind: 'system-architecture',
    title: 'ml-harness-app as a modular Solid.js web app',
    items: [
      { id: 'service', label: 'Service', detail: 'svc:ml-harness-app', name: 'ml-harness-app' },
      { id: 'module_platform', label: 'Platform Module', detail: 'mod:ml-harness-app/0' },
      { id: 'module_panes', label: 'Panes Module', detail: 'mod:ml-harness-app/1' },
      { id: 'module_readers', label: 'Readers Module', detail: 'mod:ml-harness-app/2' },
      { id: 'module_engine', label: 'Engine Module', detail: 'mod:ml-harness-app/3' },
      { id: 'module_ui', label: 'Ui Module', detail: 'mod:ml-harness-app/4' },
      { id: 'module_shims', label: 'shims Module', detail: 'mod:ml-harness-app/5' },
    ],
    links: [
      { from: 'service', to: 'module_platform', label: 'contains' },
      { from: 'service', to: 'module_panes', label: 'contains' },
      { from: 'service', to: 'module_readers', label: 'contains' },
      { from: 'service', to: 'module_engine', label: 'contains' },
      { from: 'service', to: 'module_ui', label: 'contains' },
      { from: 'service', to: 'module_shims', label: 'contains' },
    ],
  },
] as const;

/* The shopfront fixture's scan (packages/analyzer/test/fixtures/shopfront),
   files by path, other parts by node id, edges deduplicated. */
const SHOP_NODES = [
  'svc:gateway', 'svc:orders', 'svc:payments', 'svc:notifications', 'svc:inventory', 'svc:shipping',
  'svc:invoices', 'svc:edge', 'ds:postgres', 'ds:redis', 'topic:order.created',
  'gateway/src/index.ts', 'gateway/src/lib/http.ts', 'gateway/src/routes/invoices.ts',
  'gateway/src/routes/orders.ts', 'gateway/src/routes/payments.ts', 'gateway/src/routes/shipments.ts',
  'orders/app/db.py', 'orders/app/events.py', 'orders/app/inventory_client.py', 'orders/app/main.py',
  'orders/app/models.py', 'orders/app/payments_client.py', 'orders/app/routes.py', 'payments/src/db.js',
  'payments/src/index.js', 'payments/src/stripe.js', 'notifications/worker.py', 'inventory/server.py',
  'shipping/main.go', 'shipping/subscriber.go',
  'invoices/src/main/java/shop/invoices/InvoiceController.java',
  'invoices/src/main/java/shop/invoices/PaymentClient.java',
  'invoices/src/main/resources/application.properties', 'edge/default.conf',
];
const SHOP_EDGES = [
  'gateway/src/routes/invoices.ts > invoices/src/main/java/shop/invoices/InvoiceController.java',
  'gateway/src/routes/orders.ts > orders/app/routes.py',
  'gateway/src/routes/payments.ts > payments/src/index.js',
  'gateway/src/routes/shipments.ts > shipping/main.go',
  'orders/app/payments_client.py > payments/src/index.js',
  'invoices/src/main/java/shop/invoices/PaymentClient.java > payments/src/index.js',
  'edge/default.conf > gateway/src/routes/invoices.ts',
  'orders/app/inventory_client.py > inventory/server.py',
  'orders/app/events.py > topic:order.created',
  'notifications/worker.py > topic:order.created',
  'shipping/subscriber.go > topic:order.created',
  'orders/app/db.py > ds:postgres',
  'orders/app/models.py > ds:postgres',
  'payments/src/db.js > ds:postgres',
  'shipping/main.go > ds:postgres',
  'invoices/src/main/java/shop/invoices/InvoiceController.java > ds:postgres',
  'invoices/src/main/resources/application.properties > ds:postgres',
  'gateway/src/index.ts > gateway/src/routes/invoices.ts',
  'gateway/src/index.ts > gateway/src/routes/orders.ts',
  'gateway/src/index.ts > gateway/src/routes/payments.ts',
  'gateway/src/index.ts > gateway/src/routes/shipments.ts',
  'gateway/src/routes/invoices.ts > gateway/src/lib/http.ts',
  'gateway/src/routes/orders.ts > gateway/src/lib/http.ts',
  'gateway/src/routes/shipments.ts > gateway/src/lib/http.ts',
  'orders/app/main.py > orders/app/routes.py',
  'orders/app/routes.py > orders/app/db.py',
  'orders/app/routes.py > orders/app/events.py',
  'orders/app/routes.py > orders/app/inventory_client.py',
  'orders/app/routes.py > orders/app/payments_client.py',
  'payments/src/index.js > payments/src/db.js',
  'payments/src/index.js > payments/src/stripe.js',
];
const fid = (s: string): string => (s.includes('/') ? `file:${s}` : s);
const SHOP: ScanLike = {
  nodes: SHOP_NODES.map((s) =>
    s.includes('/')
      ? { id: fid(s), kind: 'file', label: s.slice(s.lastIndexOf('/') + 1), path: s }
      : { id: s, kind: s.split(':')[0] === 'svc' ? 'service' : s.startsWith('ds:') ? 'datastore' : 'topic', label: s.split(':')[1]! },
  ),
  edges: SHOP_EDGES.map((e) => {
    const [a, z] = e.split(' > ');
    return { srcId: fid(a!), dstId: fid(z!) };
  }),
};
const FOCUS = ['orders/app/main.py', 'orders/app/routes.py', 'orders/app/payments_client.py', 'payments/src/index.js'];
const HEAD = { kind: 'data-flow' as const, title: 'How an order is paid' };

type Norm = { items: unknown[]; links: unknown[] };
const pick = (it: ChartItem, keys: readonly (keyof ChartItem)[]): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  for (const k of keys) if (it[k] !== undefined) o[k] = it[k];
  return o;
};
const CARRIES: Record<DrawLang, readonly (keyof ChartItem)[]> = {
  json: ['id', 'label', 'nodeId', 'detail'],
  flow: ['id', 'label', 'nodeId', 'detail'],
  mermaid: ['id', 'label'],
  dot: ['id', 'label', 'nodeId', 'detail'],
  path: ['id', 'label'],
  ascii: ['id', 'label'],
  d2: ['id', 'label'],
  states: ['id', 'label'],
};
const norm = (lang: DrawLang, items: readonly ChartItem[], links: readonly ChartLink[]): Norm => ({
  items: items.map((it) => pick(it, CARRIES[lang])),
  links: links.map((l) => ({ from: l.from, to: l.to, ...(l.label !== undefined ? { label: l.label } : {}) })),
});

/** A chart about ideas has no scan; for the pointing languages its own parts are the map. */
function scanOfChart(items: readonly ChartItem[], links: readonly ChartLink[]): ScanLike {
  return {
    nodes: items.map((it) => ({ id: it.id, label: it.label })),
    edges: links.map((l) => ({ srcId: l.from, dstId: l.to })),
  };
}
function mapFor(lang: DrawLang, scan: ScanLike, focus: string[]): NumberedMap | undefined {
  if (!isPointingLang(lang)) return undefined;
  return lang === 'path' ? numberedMap(scan, focus, { maxNodes: 40 }) : asciiMap(scan, focus, { maxNodes: 40 });
}

for (const lang of DRAW_LANGS) {
  test(`${lang}: the three real propose_chart calls round-trip to the same parts and hops`, () => {
    for (const real of REAL_CHARTS) {
      const items = real.items as unknown as ChartItem[];
      const links = real.links as unknown as ChartLink[];
      const scan = scanOfChart(items, links);
      const map = mapFor(lang, scan, items.map((i) => i.id));
      const text = printDrawing(lang, { items, links }, map ? { map } : {});
      const back = compileDrawing(lang, text, { head: { kind: real.kind, title: real.title }, ...(map ? { map } : {}) });
      assert.ok(back.ok, `${lang} did not compile its own print:\n${text}\n${JSON.stringify(!back.ok && back.problems)}`);
      if (lang === 'json') {
        /* Identity: every field the model wrote comes back, extra ones too. */
        assert.deepStrictEqual(back.chart.items, items);
        assert.deepStrictEqual(back.chart.links, links);
      }
      assert.deepStrictEqual(norm(lang, back.chart.items, back.chart.links ?? []), norm(lang, items, links), text);
      if (map !== undefined) {
        /* Every part came through the map, so it is grounded by construction. */
        const g = groundDrawing(lang, text, scan, { head: HEAD, map });
        assert.ok(g.grounded, g.problems.join('\n'));
      }
    }
  });
}

test('the prints are what a model would write (one shopfront chart, every language)', () => {
  const items: ChartItem[] = [
    { id: 'main', label: 'orders/app/main.py', nodeId: 'orders/app/main.py' },
    { id: 'routes', label: 'orders/app/routes.py', nodeId: 'orders/app/routes.py' },
  ];
  const links: ChartLink[] = [{ from: 'main', to: 'routes', label: 'mounts' }];
  assert.strictEqual(
    printDrawing('mermaid', { items, links }),
    'flowchart LR\n  main[orders/app/main.py]\n  routes[orders/app/routes.py]\n  main -->|mounts| routes',
  );
  assert.strictEqual(
    printDrawing('dot', { items, links }),
    'digraph G {\n  main [label="orders/app/main.py", path="orders/app/main.py"];\n' +
      '  routes [label="orders/app/routes.py", path="orders/app/routes.py"];\n  main -> routes [label="mounts"];\n}',
  );
  assert.strictEqual(
    printDrawing('d2', { items, links }),
    'main: orders/app/main.py\nroutes: orders/app/routes.py\nmain -> routes: mounts',
  );
  assert.strictEqual(
    printDrawing('states', { items: [...items, { id: '(start)', label: 'start' }], links: [{ from: '(start)', to: 'main' }, ...links] }),
    'stateDiagram-v2\n  state "orders/app/main.py" as main\n  state "orders/app/routes.py" as routes\n  [*] --> main\n  main --> routes : mounts',
  );
  const map = numberedMap(SHOP, FOCUS);
  const grounded = items.map((it) => ({ ...it, nodeId: `file:${it.nodeId}` }));
  assert.strictEqual(
    printDrawing('path', { items: grounded, links }, { map, steps: [{ from: 'main', to: 'routes', say: 'the app mounts the routes' }] }),
    `${map.numberOf('file:orders/app/main.py')} > ${map.numberOf('file:orders/app/routes.py')}: mounts | the app mounts the routes`,
  );
});

/* ---- grounding: one real hop, one invented hop, the invented one on line 3 ---- */

const REAL = ['orders/app/main.py', 'orders/app/routes.py'] as const;
const FAKE = ['orders/app/main.py', 'orders/app/db.py'] as const; /* both real files, no such edge */

function answerWithFakeEdge(lang: DrawLang, map: NumberedMap): string {
  const n = (p: string): number => map.numberOf(`file:${p}`)!;
  switch (lang) {
    case 'json':
      return [
        '{"items":[{"id":"main","label":"Main","nodeId":"orders/app/main.py"},{"id":"routes","label":"Routes","nodeId":"orders/app/routes.py"},{"id":"db","label":"DB","nodeId":"orders/app/db.py"}],"links":[',
        '{"from":"main","to":"routes"},',
        '{"from":"main","to":"db","label":"reads"}',
        ']}',
      ].join('\n');
    case 'flow':
      return `main "Main" = ${REAL[0]}\nmain -> routes: mounts | x\nmain -> db: reads | y\nroutes = ${REAL[1]}\ndb = ${FAKE[1]}`;
    case 'mermaid':
      return `flowchart LR\n  main[${REAL[0]}] -->|mounts| routes[${REAL[1]}]\n  main -->|reads| db[${FAKE[1]}]`;
    case 'dot':
      return `digraph G {\n  "${REAL[0]}" -> "${REAL[1]}" [label="mounts"];\n  "${FAKE[0]}" -> "${FAKE[1]}" [label="reads"];\n}`;
    case 'path':
    case 'ascii':
      return `${n(REAL[0])} > ${n(REAL[1])} | the app mounts the routes\n\n${n(FAKE[0])} > ${n(FAKE[1])} | the app reads the db`;
    case 'd2':
      return `direction: right\n"${REAL[0]}" -> "${REAL[1]}": mounts\n"${FAKE[0]}" -> "${FAKE[1]}": reads\n"${FAKE[1]}".shape: cylinder`;
    case 'states':
      /* The [*] transitions are concepts: not parts, not hops, never refused. */
      return [
        'stateDiagram-v2',
        'main --> routes : mounts',
        'main --> db : reads',
        '[*] --> main',
        'db --> [*]',
        `state "${REAL[0]}" as main`,
        `state "${REAL[1]}" as routes`,
        `state "${FAKE[1]}" as db`,
      ].join('\n');
  }
}

for (const lang of DRAW_LANGS) {
  test(`${lang}: an invented edge between real parts is refused on the line that drew it`, () => {
    const map = lang === 'ascii' ? asciiMap(SHOP, FOCUS) : numberedMap(SHOP, FOCUS);
    const text = answerWithFakeEdge(lang, map);
    const g = groundDrawing(lang, text, SHOP, { head: HEAD, map });
    assert.ok(g.parsed, g.problems.join('\n'));
    assert.strictEqual(g.grounded, false);
    assert.strictEqual(g.nodesGrounded, g.nodes, 'every part is real');
    assert.strictEqual(g.edges, 2);
    assert.strictEqual(g.edgesGrounded, 1);
    assert.strictEqual(g.problems.length, 1, g.problems.join('\n'));
    assert.match(g.problems[0]!, /^line 3 \(.+\): no edge file:orders\/app\/main\.py -> file:orders\/app\/db\.py/);
    if (isPointingLang(lang)) {
      const pair = `${map.numberOf('file:orders/app/main.py')} > ${map.numberOf('file:orders/app/db.py')}`;
      assert.ok(g.problems[0]!.startsWith(`line 3 (${pair}):`), g.problems[0]);
    }
  });
}

for (const lang of ['json', 'flow', 'mermaid', 'dot', 'd2', 'states'] as const) {
  test(`${lang}: an invented part is refused on its line, with the nearest real one`, () => {
    const text = {
      json: '{"items":[\n{"id":"a","label":"A","nodeId":"orders/app/main.py"},\n{"id":"b","label":"B","nodeId":"orders/app/rotes.py"}\n],"links":[{"from":"a","to":"b"}]}',
      flow: 'a = orders/app/main.py\na -> b\nb = orders/app/rotes.py',
      mermaid: 'flowchart LR\n  a[orders/app/main.py]\n  b[orders/app/rotes.py]\n  a --> b',
      dot: 'digraph G {\n  "orders/app/main.py";\n  "orders/app/rotes.py";\n  "orders/app/main.py" -> "orders/app/rotes.py";\n}',
      d2: 'a: orders/app/main.py\n# the part below does not exist\nb: "orders/app/rotes.py"\na -> b',
      states: 'stateDiagram-v2\n  state "orders/app/main.py" as a\n  state "orders/app/rotes.py" as b\n  a --> b',
    }[lang];
    const g = groundDrawing(lang, text, SHOP, { head: HEAD });
    assert.ok(g.parsed);
    assert.strictEqual(g.grounded, false);
    assert.strictEqual(g.nodesGrounded, 1);
    const p = g.problems.find((x) => /rotes/.test(x));
    assert.ok(p, g.problems.join('\n'));
    assert.match(p!, /^line 3 \(/);
    assert.match(p!, /Did you mean "file:orders\/app\/routes\.py"\?/);
  });
}

test('a grounded answer in every language grounds, and covers the expected route', () => {
  const map = numberedMap(SHOP, FOCUS);
  const amap = asciiMap(SHOP, FOCUS);
  const n = (m: NumberedMap, p: string): number => m.numberOf(`file:${p}`)!;
  const route = ['orders/app/main.py', 'orders/app/routes.py', 'orders/app/payments_client.py', 'payments/src/index.js'];
  const answers: Record<DrawLang, string> = {
    json: JSON.stringify({
      items: route.map((p, i) => ({ id: `p${i}`, label: p, nodeId: p })),
      links: [0, 1, 2].map((i) => ({ from: `p${i}`, to: `p${i + 1}` })),
    }),
    flow: `m = orders/app/main.py\nr = orders/app/routes.py\nc = orders/app/payments_client.py\np = payments/src/index.js\nm -> r | a\nr -> c | b\nc -> p | c`,
    mermaid: '```mermaid\nflowchart LR\n  m[orders/app/main.py] --> r[orders/app/routes.py] -- pays --> c[orders/app/payments_client.py]\n  c -->|POST /charge| p[payments/src/index.js]\n```',
    dot: 'digraph { "app/main.py" -> "app/routes.py" -> "payments_client.py" -> "payments/src/index.js" [label="calls"] }',
    path: `${route.map((p) => n(map, p)).join(' > ')}`,
    ascii: `${n(amap, route[0]!)} > ${n(amap, route[1]!)} | one\n> ${n(amap, route[2]!)} | two\n> ${n(amap, route[3]!)} | three`,
    d2: 'Here it is:\n```d2\n"app/main.py" -> "app/routes.py" -> "payments_client.py": calls\n"payments/src/index.js" <- "payments_client.py": POST /charge\n```\nDone.',
    states: [
      'stateDiagram-v2',
      '  state "orders/app/main.py" as m',
      '  state "orders/app/routes.py" as r',
      '  state "orders/app/payments_client.py" as c',
      '  state "payments/src/index.js" as p',
      '  [*] --> m',
      '  m --> r : mounts',
      '  r --> c',
      '  c --> p : POST /charge',
      '  p --> [*]',
    ].join('\n'),
  };
  for (const lang of DRAW_LANGS) {
    const m = lang === 'ascii' ? amap : map;
    const g = groundDrawing(lang, answers[lang], SHOP, { head: HEAD, map: m });
    assert.ok(g.grounded, `${lang}: ${g.problems.join('\n')}`);
    assert.strictEqual(g.edges, 3, lang);
    assert.strictEqual(g.edgesGrounded, 3, lang);
    assert.strictEqual(hopCoverage(SHOP, g.nodePairs, route), 1, lang);
    assert.strictEqual(hopCoverage(SHOP, g.nodePairs.slice(0, 1), route), 1 / 3, lang);
  }
});

/* ---- compile problems name lines ---- */

test('compile problems name the line the author wrote, in every language', () => {
  const map = numberedMap(SHOP, FOCUS);
  const cases: [DrawLang, string, RegExp][] = [
    ['json', '{"items":[\n{"id":"a",\n"label" "A"}\n]}', /^line 3: not valid JSON/],
    ['json', '{"nodes":[]}', /^line 1: the JSON has no "items" list/],
    ['flow', 'a -> b\na -> b -> c', /^line 2: .*chains 2 hops/],
    ['mermaid', 'flowchart LR\n  a --> b\n  a --> ???', /^line 3: cannot read `a --> \?\?\?`/],
    ['dot', 'digraph G {\n  a -> b;\n  a -> [label="x"];\n}', /^line 3: cannot read/],
    ['dot', 'digraph G {\n  a -> "b;\n}', /^line 2: cannot read .*unclosed quote/],
    ['dot', 'digraph G {\n  a -> b;\n}\nThis shows a call.', /^line 4: `This shows a call\.` is outside the graph block/],
    ['path', '3 > 7\n3 > 99', /^line 2: 99 is not on the map; its numbers run 1-24/],
    ['path', '1 > orders/app/main.py', /^line 1: `orders\/app\/main\.py` is not a number from the map\. "orders\/app\/main\.py" is \d+ on the map/],
    ['path', '> 3', /^line 1: `> 3` continues a path that has not started/],
    ['path', '', /the drawing has no parts/],
    ['d2', '"a" -> "b"\n"b" -- "c"', /^line 2: `"b" -- "c"` has no direction: .*Write `a -> b`/],
    ['d2', 'a -> b\nb <-> c', /^line 2: `b <-> c` claims both directions/],
    ['d2', 'a -> b\na -> "b', /^line 2: cannot read .*unclosed quote/],
    ['d2', 'a -> b\na -> : x', /^line 2: cannot read `a -> : x`/],
    ['d2', 'a: {\n  shape: circle\n', /^line 1: the `\{` opened after `a` is never closed/],
    ['states', 'stateDiagram-v2\n  a --> b\n  a <-- b', /^line 3: cannot read `a <-- b`/],
    ['states', 'a --> [*] --> b', /^line 1: `\[\*\]` in the middle/],
    ['states', 'stateDiagram-v2', /the drawing has no parts/],
  ];
  for (const [lang, text, want] of cases) {
    const r = compileDrawing(lang, text, { head: HEAD, map });
    assert.ok(!r.ok, `${lang} accepted:\n${text}`);
    assert.match(r.problems[0]!.message, want, `${lang}: ${r.problems[0]!.message}`);
  }
});

test('mermaid: the syntax models write is read, and the noise is skipped', () => {
  const text = [
    '```mermaid',
    'graph TD',
    '%% a comment',
    'subgraph orders',
    '  A["Orders API"] -- creates --> B(Queue)',
    '  B -.-> C{{Worker}} & D[(Postgres)]',
    'end',
    'classDef hot fill:#f00',
    'style A fill:#fff',
    'C ==>|writes| D;',
    '```',
  ].join('\n');
  const r = compileDrawing('mermaid', text, { head: HEAD });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepStrictEqual(r.chart.items.map((i) => [i.id, i.label]), [
    ['A', 'Orders API'], ['B', 'Queue'], ['C', 'Worker'], ['D', 'Postgres'],
  ]);
  assert.deepStrictEqual(r.chart.links, [
    { from: 'A', to: 'B', label: 'creates' },
    { from: 'B', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D', label: 'writes' },
  ]);
  assert.deepStrictEqual(r.linkLine, [5, 6, 6, 10]);
});

test('dot: headers, attributes, quoted ids, comments and one-line graphs', () => {
  const text = [
    '```dot',
    'strict digraph "orders" {',
    '  rankdir=LR; // left to right',
    '  node [shape=box];',
    '  # a comment',
    '  "app/main.py" [label="Main", tooltip="entry"];',
    '  "app/main.py" -> "app/routes.py" [label="mounts"];',
    '  subgraph cluster_a { "app/routes.py" -> db }',
    '  /* a',
    '     block */ db -> "app/main.py";',
    '}',
    '```',
  ].join('\n');
  const r = compileDrawing('dot', text, { head: HEAD });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepStrictEqual(r.chart.items, [
    { id: 'app/main.py', label: 'Main', detail: 'entry' },
    { id: 'app/routes.py', label: 'app/routes.py' },
    { id: 'db', label: 'db' },
  ]);
  assert.deepStrictEqual(r.chart.links, [
    { from: 'app/main.py', to: 'app/routes.py', label: 'mounts' },
    { from: 'app/routes.py', to: 'db' },
    { from: 'db', to: 'app/main.py' },
  ]);
  assert.deepStrictEqual(r.linkLine, [7, 8, 10]);
});

test('path: prefixes, bullets, arrows, continuations and trailing names are tolerated', () => {
  const map = numberedMap(SHOP, FOCUS);
  const n = (p: string): number => map.numberOf(`file:${p}`)!;
  const [m, r, c] = [n('orders/app/main.py'), n('orders/app/routes.py'), n('orders/app/payments_client.py')];
  const text = `Answer: ${m} (main.py) -> ${r}: mounts | the app mounts the routes\n- > ${c} | routes pays.\n`;
  const out = compileDrawing('path', text, { head: HEAD, map });
  assert.ok(out.ok, JSON.stringify(!out.ok && out.problems));
  assert.deepStrictEqual(out.chart.links, [
    { from: 'file:orders/app/main.py', to: 'file:orders/app/routes.py', label: 'mounts' },
    { from: 'file:orders/app/routes.py', to: 'file:orders/app/payments_client.py' },
  ]);
  assert.deepStrictEqual(out.steps.map((s) => s.say), ['the app mounts the routes', 'routes pays']);
  assert.deepStrictEqual(out.linkText, [`${m} > ${r}`, `${r} > ${c}`]);
  assert.strictEqual(out.chart.items[0]!.label, 'orders/app/main.py');
});

test('d2: quotes, chains, back arrows, declarations, blocks and style are read; the rest skipped', () => {
  const text = [
    'Here is the diagram:',
    '```d2',
    'direction: right',
    '# the entry',
    'app: "Web app" {',
    '  shape: rectangle',
    '  style.fill: "#fff"',
    '}',
    'vars: { d2-config: { layout-engine: elk } }',
    'api: API server',
    'db.shape: cylinder',
    'app -> api -> "db": query {style.stroke: red}',
    'cache <- api: warms; api.style: { opacity: 0.5 }',
    'orders: {',
    '  "x.py" -> "y.py"',
    '}',
    '(app -> api)[0].style.stroke-dash: 3',
    '```',
    'That is all.',
  ].join('\n');
  const r = compileDrawing('d2', text, { head: HEAD });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepStrictEqual(r.chart.items.map((i) => [i.id, i.label]), [
    ['app', 'Web app'], ['api', 'API server'], ['db', 'db'], ['cache', 'cache'], ['x.py', 'x.py'], ['y.py', 'y.py'],
  ]);
  assert.deepStrictEqual(r.chart.links, [
    { from: 'app', to: 'api', label: 'query' },
    { from: 'api', to: 'db', label: 'query' },
    { from: 'api', to: 'cache', label: 'warms' },
    { from: 'x.py', to: 'y.py' },
  ]);
  assert.deepStrictEqual(r.linkLine, [12, 12, 13, 15]);
  assert.strictEqual(r.itemLine.get('app'), 5, 'a part declared by its block is on the line that opened it');
  /* The container box `orders` holds parts, so it is a grouping, not a part. */
  assert.ok(!r.chart.items.some((i) => i.id === 'orders'));
});

test('states: declarations, [*], labels and noise; [*] is a concept that claims no scan node', () => {
  const text = [
    '```mermaid',
    'stateDiagram-v2',
    '  direction LR',
    '  %% a comment',
    '  state "orders/app/main.py" as main',
    '  state Orders {',
    '    [*] --> main',
    '    main --> orders/app/routes.py : mounts',
    '  }',
    '  note right of main',
    '    the entry',
    '  end note',
    '  orders/app/routes.py --> [*]',
    '```',
  ].join('\n');
  const r = compileDrawing('states', text, { head: HEAD });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepStrictEqual(r.chart.items, [
    { id: 'main', label: 'orders/app/main.py' },
    { id: '(start)', label: 'start' },
    { id: 'orders/app/routes.py', label: 'orders/app/routes.py' },
    { id: '(end)', label: 'end' },
  ]);
  assert.deepStrictEqual(r.chart.links, [
    { from: '(start)', to: 'main' },
    { from: 'main', to: 'orders/app/routes.py', label: 'mounts' },
    { from: 'orders/app/routes.py', to: '(end)' },
  ]);
  assert.deepStrictEqual(r.linkLine, [7, 8, 13]);
  assert.deepStrictEqual([...r.concepts!], ['(start)', '(end)']);
  const g = groundDrawing('states', text, SHOP, { head: HEAD });
  assert.ok(g.grounded, g.problems.join('\n'));
  assert.deepStrictEqual([g.nodes, g.nodesGrounded, g.edges, g.edgesGrounded], [2, 2, 1, 1]);
  assert.strictEqual(g.chart!.items.find((i) => i.id === '(start)')!.nodeId, undefined);
  /* A state named for no part is still refused: only [*] is a concept. */
  const bad = groundDrawing('states', 'stateDiagram-v2\n[*] --> checkout\ncheckout --> main.py', SHOP, { head: HEAD });
  assert.strictEqual(bad.grounded, false);
  assert.match(bad.problems.join('\n'), /^line 2 \(checkout\): "checkout" is not a node/m);
});

for (const lang of ['d2', 'states'] as const) {
  test(`${lang}: print and compile are a fixpoint on a grounded answer, [*] included`, () => {
    const map = numberedMap(SHOP, FOCUS);
    const route = ['orders/app/main.py', 'orders/app/routes.py', 'orders/app/payments_client.py'];
    const text =
      lang === 'd2'
        ? `m: ${route[0]}\nr: "${route[1]}"\nc: '${route[2]}'\nm -> r: mounts\nr -> c: "pays \\"now\\""`
        : `stateDiagram-v2\nstate "${route[0]}" as m\nstate "${route[1]}" as r\nstate "${route[2]}" as c\n[*] --> m\nm --> r : mounts\nr --> c : pays "now"\nc --> [*]`;
    const g = groundDrawing(lang, text, SHOP, { head: HEAD, map });
    assert.ok(g.grounded, g.problems.join('\n'));
    const printed = printDrawing(lang, g.chart!);
    const again = groundDrawing(lang, printed, SHOP, { head: HEAD });
    assert.ok(again.grounded, `${again.problems.join('\n')}\n${printed}`);
    assert.deepStrictEqual(again.chart!.items, g.chart!.items, printed);
    assert.deepStrictEqual(again.chart!.links, g.chart!.links, printed);
    assert.strictEqual(printDrawing(lang, again.chart!), printed);
  });
}

/* ---- the numbered map ---- */

test('numberedMap is deterministic: same text whatever order the scan lists things in', () => {
  const a = numberedMap(SHOP, FOCUS);
  const shuffled: ScanLike = { nodes: [...SHOP.nodes].reverse(), edges: [...SHOP.edges].reverse() };
  const b = numberedMap(shuffled, FOCUS);
  assert.strictEqual(a.text, b.text);
  assert.strictEqual(asciiMap(SHOP, FOCUS).text, asciiMap(shuffled, FOCUS).text);
  assert.strictEqual(namedView(SHOP, FOCUS), namedView(shuffled, FOCUS));
  assert.strictEqual(numberedMap(SHOP, FOCUS).text, a.text);
});

test('numberedMap: focus first, neighbours up to maxNodes, numbered by name, arrows inside the map only', () => {
  const m = numberedMap(SHOP, FOCUS, { maxNodes: 6 });
  assert.strictEqual(m.size, 6);
  const lines = m.text.split('\n');
  assert.strictEqual(lines.length, 6);
  const ids = lines.map((_, i) => m.idOf(i + 1)!);
  for (const f of FOCUS) assert.ok(ids.includes(`file:${f}`), f);
  const names = lines.map((l) => l.split(' ')[1]!);
  assert.deepStrictEqual(names, [...names].sort(), 'numbered by name, so the order leaks no answer');
  for (const [i, l] of lines.entries()) {
    assert.ok(l.startsWith(`${i + 1} `));
    const outs = /→ (.*)$/.exec(l)?.[1]?.split(', ').map(Number) ?? [];
    for (const o of outs) {
      assert.ok(o >= 1 && o <= 6);
      assert.ok(SHOP.edges.some((e) => e.srcId === m.idOf(i + 1) && e.dstId === m.idOf(o)), l);
    }
  }
  assert.strictEqual(m.idOf(0), undefined);
  assert.strictEqual(m.idOf(7), undefined);
  assert.strictEqual(m.idOf(1.5), undefined);
  for (let k = 1; k <= 6; k += 1) assert.strictEqual(m.numberOf(m.idOf(k)!), k);
  /* The default bound, and a map never grows past the scan. */
  assert.strictEqual(numberedMap(SHOP, FOCUS).size, 24);
  assert.ok(numberedMap(SHOP, FOCUS, { maxNodes: 999 }).size <= SHOP.nodes.length);
  /* Focus beyond the bound is cut in the order given; a bound of 1 is one line. */
  assert.strictEqual(numberedMap(SHOP, FOCUS, { maxNodes: 1 }).text, `1 ${FOCUS[0]} `.trim());
});

test('numberedMap: unknown and ambiguous focus is reported, not guessed', () => {
  const m = numberedMap(SHOP, ['orders/app/main.py', 'nope.py', 'db']);
  assert.deepStrictEqual(m.missing, ['nope.py', 'db']);
  assert.ok(m.size > 1);
  const r = scanResolver(SHOP);
  assert.deepStrictEqual(r('app/main.py'), { id: 'file:orders/app/main.py' });
  assert.deepStrictEqual(r('main'), { ambiguous: ['file:orders/app/main.py', 'file:shipping/main.go'] });
  assert.deepStrictEqual(r('ds:postgres'), { id: 'ds:postgres' });
  assert.strictEqual(r('nope'), undefined);
});

test('numberedMap: a focus with no edges (a service) opens onto its children', () => {
  const scan: ScanLike = {
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'a' },
      { id: 'file:a/x.py', kind: 'file', path: 'a/x.py', parentId: 'svc:a' },
      { id: 'file:a/y.py', kind: 'file', path: 'a/y.py', parentId: 'svc:a' },
    ],
    edges: [{ srcId: 'file:a/x.py', dstId: 'file:a/y.py' }],
  };
  assert.strictEqual(numberedMap(scan, ['svc:a']).text, '1 a/x.py → 2\n2 a/y.py\n3 svc:a');
});

test('sizes: the map stays short and the ascii picture stays under 1.5x of it', () => {
  const m = numberedMap(SHOP, FOCUS);
  const a = asciiMap(SHOP, FOCUS);
  const v = namedView(SHOP, FOCUS);
  const [mt, at, vt] = [roughTokens(m.text), roughTokens(a.text), roughTokens(v)];
  assert.ok(mt < 300, `map ${mt}`);
  assert.ok(at < 1.5 * mt, `ascii ${at} vs map ${mt}`);
  assert.ok(mt < vt, `the numbered map (${mt}) is smaller than the named list (${vt})`);
  /* Same parts, same numbers: the two pictures are one slice. */
  for (let k = 1; k <= m.size; k += 1) assert.strictEqual(a.idOf(k), m.idOf(k));
});

/* ---- instructions ---- */

test('every instruction is short, and its worked example compiles and grounds', () => {
  const example: ScanLike = {
    nodes: ['web/app.ts', 'api/server.py', 'api/db.py'].map((p) => ({ id: `file:${p}`, kind: 'file', path: p })),
    edges: [
      { srcId: 'file:web/app.ts', dstId: 'file:api/server.py' },
      { srcId: 'file:api/server.py', dstId: 'file:api/db.py' },
    ],
  };
  for (const lang of DRAW_LANGS) {
    const s = instructionFor(lang);
    assert.ok(roughTokens(s) <= 230, `${lang}: ${roughTokens(s)}`);
    const answer = s.slice(s.indexOf('Example answer:\n') + 'Example answer:\n'.length);
    const map = lang === 'ascii' ? asciiMap(example, ['web/app.ts']) : numberedMap(example, ['web/app.ts']);
    if (lang === 'path') assert.ok(s.includes(map.text), 'the example map is the real map of the example');
    if (lang === 'ascii') assert.ok(s.includes(map.text), 'the example picture is the real picture of the example');
    if (!isPointingLang(lang)) assert.ok(s.includes(namedView(example, ['web/app.ts'])), 'the example list is the real view');
    const g = groundDrawing(lang, answer, example, { head: HEAD, map });
    assert.ok(g.grounded, `${lang}: ${g.problems.join('\n')}\n${answer}`);
    assert.ok(g.edges >= 1);
  }
  assert.throws(() => instructionFor('svg' as DrawLang), /unknown language/);
});

test('drawPrompt: every language sees the same slice, in its own view', () => {
  const q = 'How does an order get paid?';
  const ps = DRAW_LANGS.map((l) => drawPrompt(l, q, SHOP, FOCUS));
  for (const p of ps) assert.ok(p.user.startsWith(q));
  assert.ok(ps[4]!.user.endsWith(numberedMap(SHOP, FOCUS).text));
  assert.ok(ps[5]!.user.endsWith(asciiMap(SHOP, FOCUS).text));
  for (const p of [...ps.slice(0, 4), ...ps.slice(6)]) assert.ok(p.user.endsWith(namedView(SHOP, FOCUS)));
  assert.deepStrictEqual(DRAW_LANGS.slice(6), ['d2', 'states']);
  assert.ok(ps[4]!.map !== undefined && ps[0]!.map === undefined);
  assert.deepStrictEqual(drawPrompt('json', q, SHOP, ['x.py']).missing, ['x.py']);
  assert.throws(() => compileDrawing('path', '1 > 2', { head: HEAD }), /needs the map/);
});
