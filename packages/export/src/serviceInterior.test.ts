import assert from 'node:assert';
import { test } from 'node:test';

import { moduleRole, serviceInterior } from './serviceInterior.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * OPENING A SERVICE.
 *
 * The owner's ruling was SYSTEMS LAYER ONLY, no nesting — "but a service must
 * still be openable". Those are not in tension: opening REPLACES the view
 * rather than nesting inside it, so one level is on screen at a time and the
 * level changes.
 *
 * It is deliberately NOT `archGraphToBreakoutSeqDiagram`. Measured on
 * shopfront, that function places the focus service and its service-level
 * NEIGHBOURS and returned none of the gateway's six file children, despite its
 * `breakout-interior` kind. It answers "what does this talk to"; this answers
 * "what is in it".
 */

function graph(): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'shop',
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service' },
      { id: 'svc:orders', label: 'orders', kind: 'service' },
      { id: 'file:gw/app.ts', label: 'app.ts', kind: 'file', path: 'gw/app.ts', parentId: 'svc:gateway' },
      { id: 'file:gw/routes.ts', label: 'routes.ts', kind: 'file', path: 'gw/routes.ts', parentId: 'svc:gateway' },
      { id: 'file:gw/util.ts', label: 'util.ts', kind: 'file', path: 'gw/util.ts', parentId: 'svc:gateway' },
      { id: 'file:or/place.ts', label: 'place.ts', kind: 'file', path: 'or/place.ts', parentId: 'svc:orders' },
    ],
    edges: [
      { id: 'i1', srcId: 'file:gw/app.ts', dstId: 'file:gw/routes.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
      { id: 'i2', srcId: 'file:gw/routes.ts', dstId: 'file:gw/util.ts', kind: 'import', confidence: 1, origin: 'deterministic' },
      /* Leaves the service — a fact about the systems layer. */
      { id: 'h1', srcId: 'file:gw/routes.ts', dstId: 'file:or/place.ts', kind: 'http', confidence: 1, origin: 'deterministic' },
    ],
    warnings: [],
  } as unknown as ArchGraph;
}

test('opening a service shows what is INSIDE it', () => {
  const { doc, total } = serviceInterior(graph(), 'svc:gateway');
  assert.strictEqual(total, 3);
  assert.deepStrictEqual(
    doc.nodes.map((n) => n.label).sort(),
    ['app.ts', 'routes.ts', 'util.ts'],
  );
  /* And nothing from a sibling service: `place.ts` belongs to orders. */
  assert.ok(!doc.nodes.some((n) => n.label === 'place.ts'));
});

test('membership is `parentId`, the scan’s own containment — not a path prefix', () => {
  const g = graph();
  /* A file whose PATH looks like it belongs to the gateway but whose parent
     says otherwise. Re-deriving membership from directory names would disagree
     with the graph the moment a build context is narrowed, which
     `discovery/compose.ts` already warns about. */
  g.nodes.push({
    id: 'file:gw/imposter.ts',
    label: 'imposter.ts',
    kind: 'file',
    path: 'gw/imposter.ts',
    parentId: 'svc:orders',
  } as never);
  const { doc } = serviceInterior(g, 'svc:gateway');
  assert.ok(!doc.nodes.some((n) => n.label === 'imposter.ts'));
});

test('only edges with BOTH ends inside are drawn', () => {
  const { doc } = serviceInterior(graph(), 'svc:gateway');
  /*
   * The http edge leaves the service. Drawing half of it would put a line into
   * empty space, and the reader would be looking for a card that is one level
   * up.
   */
  assert.strictEqual(doc.edges.length, 2);
  for (const e of doc.edges) {
    assert.ok(doc.nodes.some((n) => n.id === e.from));
    assert.ok(doc.nodes.some((n) => n.id === e.to));
  }
});

test('a service with nothing inside is an EMPTY answer, not an error', () => {
  const { doc, total } = serviceInterior(graph(), 'svc:orders');
  assert.strictEqual(total, 1);
  assert.strictEqual(doc.nodes.length, 1);

  const { doc: none, total: zero } = serviceInterior(graph(), 'svc:nope');
  /* A view that errored on a single-file service would refuse the simplest
     repository there is. */
  assert.deepStrictEqual(none.nodes, []);
  assert.strictEqual(zero, 0);
});

test('when it does not all fit, the CONNECTED ones are kept and the rest are counted', () => {
  const g = graph();
  for (let i = 0; i < 40; i += 1) {
    g.nodes.push({
      id: `file:gw/lonely${i}.ts`,
      label: `lonely${i}.ts`,
      kind: 'file',
      path: `gw/lonely${i}.ts`,
      parentId: 'svc:gateway',
    } as never);
  }
  const { doc, total, omitted } = serviceInterior(g, 'svc:gateway', { limit: 3 });

  assert.strictEqual(total, 43);
  assert.strictEqual(doc.nodes.length, 3);
  /*
   * RANKED BY CONNECTEDNESS. An alphabetical cut would keep `lonely0.ts` and
   * drop `routes.ts`, which every other file goes through — the one card the
   * reader opened the service to find.
   */
  assert.ok(doc.nodes.some((n) => n.label === 'routes.ts'));
  /* And what was left out is COUNTED, so the surface can say so rather than
     imply the service has three files. */
  assert.strictEqual(omitted, 40);
});

test('placed nodes keep their evidence, so an interior card is still grounded', () => {
  const { doc } = serviceInterior(graph(), 'svc:gateway');
  for (const n of doc.nodes) {
    assert.ok(n.evidenceRef, `${n.label} lost its evidence`);
  }
});

test('the title says which service was opened', () => {
  assert.strictEqual(serviceInterior(graph(), 'svc:gateway').doc.title, 'Inside gateway');
});

test('is deterministic', () => {
  const a = serviceInterior(graph(), 'svc:gateway');
  const b = serviceInterior(graph(), 'svc:gateway');
  assert.deepStrictEqual(
    a.doc.nodes.map((n) => n.id),
    b.doc.nodes.map((n) => n.id),
  );
});

/* ═══ three zooms: the system, a service's MODULES, a module's FILES ═════════

   Owner, 2026-09-22, walking ML Harness: "Click on the ML service — there's 55
   nodes in here. It'd be much cooler if we could turn these micro file
   services into macro services." Measured on ml-harness's own scan:
   `svc:ml-harness-app` has 55 children, 6 of them modules (17, 19, 17, 18, 20
   and 3 files each, every one carrying `meta.description`) and 49 files the
   clustering left outside any module. Opening it placed all 55, and the six
   cards that say what the service is made of were drowned in the 49 that do
   not. This fixture is that shape. */

function mlHarness(): ArchGraph {
  const g = {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-09-22T00:00:00.000Z',
    repoRoot: '/ml-harness',
    repoName: 'ml-harness',
    nodes: [{ id: 'svc:ml-harness-app', label: 'ml-harness-app', kind: 'service' }],
    edges: [],
    warnings: [],
  } as unknown as ArchGraph;
  const modules: Array<[string, number]> = [
    ['platform', 17],
    ['Panes', 19],
    ['Readers', 17],
    ['Engine', 18],
    ['Ui', 20],
    ['shims', 3],
  ];
  modules.forEach(([label, files], i) => {
    const id = `mod:ml-harness-app/${i}`;
    g.nodes.push({
      id,
      kind: 'module',
      label,
      parentId: 'svc:ml-harness-app',
      path: `web/src/${label.toLowerCase()}`,
      meta: { files, description: `${label} does its own job.` },
    } as never);
    for (let f = 0; f < files; f += 1) {
      g.nodes.push({
        id: `file:web/src/${label.toLowerCase()}/f${f}.ts`,
        kind: 'file',
        label: `f${f}.ts`,
        parentId: id,
        path: `web/src/${label.toLowerCase()}/f${f}.ts`,
      } as never);
    }
  });
  for (let f = 0; f < 49; f += 1) {
    g.nodes.push({
      id: `file:web/tests/t${f}.test.ts`,
      kind: 'file',
      label: `t${f}.test.ts`,
      parentId: 'svc:ml-harness-app',
      path: `web/tests/t${f}.test.ts`,
    } as never);
  }
  /* The loose files are the most CONNECTED children here, so a ranking by
     degree alone would put them first. The modules must win on level, not on
     luck. */
  for (let f = 0; f < 49; f += 1) {
    g.edges.push({
      id: `t${f}`,
      srcId: `file:web/tests/t${f}.test.ts`,
      dstId: `file:web/tests/t${(f + 1) % 49}.test.ts`,
      kind: 'import',
      confidence: 1,
      origin: 'deterministic',
    } as never);
  }
  return g;
}

test('a service WITH modules opens to its modules only — the macro level', () => {
  const inside = serviceInterior(mlHarness(), 'svc:ml-harness-app');
  assert.strictEqual(inside.level, 'modules');
  assert.deepStrictEqual(
    inside.doc.nodes.map((n) => n.label).sort(),
    ['Engine', 'Panes', 'Readers', 'Ui', 'platform', 'shims'],
  );
  assert.ok(inside.doc.nodes.every((n) => n.kind === 'module'));
  /* The 49 are COUNTED, not placed. A synthetic "loose files" card would be a
     node the scan never produced, and `assertSeqdGroundedInGraph` refuses
     exactly that. */
  assert.strictEqual(inside.total, 6);
  assert.strictEqual(inside.looseFiles, 49);
  assert.strictEqual(inside.omitted, 0);
  assert.deepStrictEqual(
    [...(inside.doc.grounded.scopeNodeIds ?? [])].sort(),
    inside.doc.nodes.map((n) => n.id).sort(),
  );
});

test('each module card says what the module DOES, in the scan’s own words', () => {
  const { doc } = serviceInterior(mlHarness(), 'svc:ml-harness-app');
  for (const n of doc.nodes) {
    /* `detail.whatItDoes` is the field the card paints as its one English line
       (`project.ts`, `boardNodeFrom`). */
    assert.strictEqual(n.detail?.whatItDoes, `${n.label} does its own job.`);
  }
});

test('the server’s nodeDetail wins over meta.description when it has a sentence', () => {
  const { doc } = serviceInterior(mlHarness(), 'svc:ml-harness-app', {
    nodeDetail: { 'mod:ml-harness-app/1': { whatItDoes: 'Draws the panes.' } },
  });
  assert.strictEqual(
    doc.nodes.find((n) => n.id === 'mod:ml-harness-app/1')?.detail?.whatItDoes,
    'Draws the panes.',
  );
  assert.strictEqual(
    doc.nodes.find((n) => n.id === 'mod:ml-harness-app/4')?.detail?.whatItDoes,
    'Ui does its own job.',
  );
});

test('a module with no description gets none — nothing is written to fill the line', () => {
  const g = mlHarness();
  const shims = g.nodes.find((n) => n.id === 'mod:ml-harness-app/5')!;
  shims.meta = { files: 3 };
  const { doc } = serviceInterior(g, 'svc:ml-harness-app');
  assert.strictEqual(doc.nodes.find((n) => n.id === shims.id)?.detail?.whatItDoes, undefined);
});

test('opening a MODULE shows its files — the micro level', () => {
  const inside = serviceInterior(mlHarness(), 'mod:ml-harness-app/1');
  assert.strictEqual(inside.level, 'members');
  assert.strictEqual(inside.total, 19);
  assert.strictEqual(inside.doc.nodes.length, 19);
  assert.ok(inside.doc.nodes.every((n) => n.kind === 'file'));
  assert.strictEqual(inside.looseFiles, 0);
  assert.strictEqual(inside.doc.title, 'Inside Panes');
});

test('a service with NO modules keeps the file view exactly as it was', () => {
  const inside = serviceInterior(graph(), 'svc:gateway');
  assert.strictEqual(inside.level, 'members');
  assert.strictEqual(inside.looseFiles, 0);
  assert.deepStrictEqual(inside.doc.nodes.map((n) => n.label).sort(), ['app.ts', 'routes.ts', 'util.ts']);
  /* And no description is invented for a file. */
  assert.ok(inside.doc.nodes.every((n) => n.detail === undefined));
});

test('a module card leads with what the module DEFINES, not with its file count', () => {
  /* On the real ML Harness scan every module description was the scan's
     inventory line, and the card's glance filter drops lines that start with
     a count — so no module showed a description (builder, 2026-09-22). */
  assert.strictEqual(
    moduleRole('17 ts files in web, defining abort, run, ready. Grouped by directory.'),
    'Defines abort, run, ready (17 ts files in web)',
  );
  assert.strictEqual(moduleRole('2 py files, defining Router.'), 'Defines Router (2 py files)');
  assert.strictEqual(moduleRole('2 ts files in a.'), '2 ts files in a.', 'nothing defined: the line is left as it was');
  assert.strictEqual(moduleRole('Draws the panes.'), 'Draws the panes.');

  const g = mlHarness();
  const mod = g.nodes.find((n) => n.id === 'mod:ml-harness-app/1')!;
  mod.meta = { ...(mod.meta ?? {}), description: '19 ts files in panes, defining Pane, mount. Grouped by directory.' };
  const { doc } = serviceInterior(g, 'svc:ml-harness-app');
  assert.strictEqual(
    doc.nodes.find((n) => n.id === 'mod:ml-harness-app/1')?.detail?.whatItDoes,
    'Defines Pane, mount (19 ts files in panes)',
  );
});

/* ═══ the modules level is a FLOW, not six floating cards ═══════════════════

   Owner, 2026-09-22: "when I click on that service I want a macro diagram of
   how everything comes together". Every import the scan records is file→file,
   so the modules level kept none of them and ELK, given no edges, rectpacked
   six unconnected cards. The counts below are the real module-level roll-up of
   ml-harness's own scan (docs/teaching-flow-plan.md, Explorer 3). The near-tie
   is Engine↔Readers because the fixture's six modules are the scan's six; a
   seventh "Models" card would break the count this file already locks. */

const MOD = { platform: 0, Panes: 1, Readers: 2, Engine: 3, Ui: 4, shims: 5 } as const;
type ModName = keyof typeof MOD;
const FILES: Record<ModName, number> = { platform: 17, Panes: 19, Readers: 17, Engine: 18, Ui: 20, shims: 3 };

/** `n` file→file imports from files of module `a` to files of module `b`. */
function imports(g: ArchGraph, a: ModName, b: ModName, n: number): void {
  for (let k = 0; k < n; k += 1) {
    const src = `web/src/${a.toLowerCase()}/f${k % FILES[a]}.ts`;
    const dst = `web/src/${b.toLowerCase()}/f${(k + 1) % FILES[b]}.ts`;
    g.edges.push({
      id: `imp:${a}->${b}:${k}`,
      srcId: `file:${src}`,
      dstId: `file:${dst}`,
      kind: 'import',
      confidence: 1,
      origin: 'deterministic',
      evidence: [{ file: src, line: k + 1 }],
    } as never);
  }
}

const FLOW: Array<[ModName, ModName, number]> = [
  ['Readers', 'Ui', 14],
  ['Ui', 'Panes', 14],
  ['Engine', 'Ui', 6],
  ['Panes', 'Engine', 5],
  /* The minority of a mutual pair: 3 against Ui→Panes's 14. */
  ['Panes', 'Ui', 3],
  /* A near-tie: 5 against 4. Neither direction is the minority. */
  ['Engine', 'Readers', 5],
  ['Readers', 'Engine', 4],
  /* Inside one module: the same card at both ends, never a self-loop. */
  ['Ui', 'Ui', 7],
  /* Under the floor of three. */
  ['shims', 'platform', 2],
];

function mlHarnessFlow(): ArchGraph {
  const g = mlHarness();
  for (const [a, b, n] of FLOW) imports(g, a, b, n);
  /* A loose test file importing a module: the test lifts to no placed card,
     so this is not drawn at the modules level. */
  g.edges.push({
    id: 'imp:test->ui',
    srcId: 'file:web/tests/t0.test.ts',
    dstId: 'file:web/src/ui/f0.ts',
    kind: 'import',
    confidence: 1,
    origin: 'deterministic',
  } as never);
  return g;
}

const modId = (m: ModName) => `mod:ml-harness-app/${MOD[m]}`;

test('the modules level is CONNECTED: file imports rolled up to module→module edges', () => {
  const g = mlHarnessFlow();
  const inside = serviceInterior(g, 'svc:ml-harness-app');
  const { doc } = inside;
  const pair = (a: ModName, b: ModName) => doc.edges.find((e) => e.from === modId(a) && e.to === modId(b));

  assert.ok(doc.edges.length > 0, 'the modules level drew no edges, so ELK rectpacks it');
  /* Each count is the sum of its file edges, and the label says so in the
     word the derived connector already uses. */
  for (const [a, b, n] of [
    ['Readers', 'Ui', 14],
    ['Ui', 'Panes', 14],
    ['Engine', 'Ui', 6],
    ['Panes', 'Engine', 5],
    ['Engine', 'Readers', 5],
    ['Readers', 'Engine', 4],
  ] as Array<[ModName, ModName, number]>) {
    const e = pair(a, b);
    assert.ok(e, `${a}→${b} was not drawn`);
    assert.strictEqual(e.label, `${n} imports`);
    assert.strictEqual(e.family, 'import');
    assert.match(e.evidenceRef ?? '', /^scan:web\/src\/.+\.ts:\d+$/, `${a}→${b} carries no evidence`);
  }
  /* The minority direction is dropped at 3:1, which is what lets the layered
     layout read left to right instead of breaking a cycle at random. */
  assert.strictEqual(pair('Panes', 'Ui'), undefined, 'Panes→Ui (3 vs 14) should be dropped');
  assert.strictEqual(pair('shims', 'platform'), undefined, 'a pair under 3 imports is not drawn');
  assert.strictEqual(doc.edges.length, 6);
  /* No self-loops. */
  assert.ok(doc.edges.every((e) => e.from !== e.to));
  /* Grounded: every edge end is a placed card, every placed card a scanned
     node (`assertSeqdGroundedInGraph`, which export cannot import). */
  const placed = new Set(doc.nodes.map((n) => n.id));
  const scanned = new Set(g.nodes.map((n) => n.id));
  for (const n of doc.nodes) assert.ok(scanned.has(n.id), `${n.id} is not a scanned node`);
  for (const e of doc.edges) {
    assert.ok(placed.has(e.from) && placed.has(e.to), `edge ${e.id} ends off the board`);
  }
  /* And the level itself is unchanged: six modules, forty-nine counted. */
  assert.strictEqual(inside.level, 'modules');
  assert.strictEqual(inside.total, 6);
  assert.strictEqual(doc.nodes.length, 6);
  assert.strictEqual(inside.looseFiles, 49);
  assert.strictEqual(inside.omitted, 0);
});

test('the module roll-up keeps the heaviest 12 pairs, in a stable order', () => {
  const g = mlHarness();
  const names = Object.keys(MOD) as ModName[];
  /* Fifteen one-way pairs weighing 3..17: the lightest three fall off. */
  let w = 3;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) imports(g, names[i]!, names[j]!, w++);
  }
  const { doc } = serviceInterior(g, 'svc:ml-harness-app');
  assert.strictEqual(doc.edges.length, 12);
  const weights = doc.edges.map((e) => Number(/^(\d+) imports$/.exec(e.label ?? '')?.[1]));
  assert.deepStrictEqual([...weights].sort((a, b) => a - b), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

  /* The scan's edge order is not the diagram's: reversed input, same doc. */
  const r = mlHarness();
  r.edges.push(...[...g.edges].reverse().filter((e) => e.kind === 'import' && e.id.startsWith('imp:')));
  const again = serviceInterior(r, 'svc:ml-harness-app').doc;
  assert.deepStrictEqual(again.edges, doc.edges);
});

test('the FILES level keeps raw file edges and does not double-count them', () => {
  const g = mlHarnessFlow();
  const inside = serviceInterior(g, modId('Ui'));
  assert.strictEqual(inside.level, 'members');
  /* Ui→Ui's seven imports are file→file inside the module: drawn as they are,
     unlabelled, never rolled into a count. */
  assert.ok(inside.doc.edges.length > 0);
  assert.ok(inside.doc.edges.every((e) => e.label === undefined));
  assert.ok(inside.doc.edges.every((e) => e.from.startsWith('file:web/src/ui/') && e.to.startsWith('file:web/src/ui/')));
});
