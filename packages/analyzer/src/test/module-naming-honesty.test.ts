/**
 * H4 (half two) — WHAT A MODULE IS CALLED, AND WHAT IT SAYS ABOUT ITSELF.
 *
 * Found by `tools/qa-loop` on `gin`: three of four modules described themselves
 * as "A group of N related files.", and the fourth — the whole core of the
 * library, `gin.go` / `context.go` / `tree.go` / `routergroup.go` — was called
 * **Auth**. Two separate defects:
 *
 *  1. the anchor ("the member the rest of the service depends on most") was
 *     taken from a sorted list even when nothing depended on anything, so in a
 *     flat Go package the alphabetically-first file was crowned. `auth.go`.
 *  2. `describeCluster` had already computed a grounded sentence from the real
 *     symbols in those files — "22 go files, defining Abort, AbortWithError,
 *     AbortWithStatus" — and `buildFeatureNode` threw it away for the count.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from '@sequence/schema';
import { buildStructuralTree } from '../explain/explain.js';
import { chooseAnchor, labelCluster, uniqueModuleLabels } from '../cluster/cluster.js';

/** Build a one-service graph with the given modules + their files. */
function graphOf(
  service: string,
  mods: { id: string; label: string; files: string[]; description?: string }[]
): ArchGraph {
  const nodes: unknown[] = [
    { id: `repo:${service}`, kind: 'repo', label: service },
    { id: `svc:${service}`, kind: 'service', label: service, parentId: `repo:${service}` },
  ];
  for (const m of mods) {
    nodes.push({
      id: m.id,
      kind: 'module',
      label: m.label,
      parentId: `svc:${service}`,
      meta: { files: m.files.length, ...(m.description ? { description: m.description } : {}) },
    });
    for (const f of m.files) {
      nodes.push({
        id: `file:${f}`,
        kind: 'file',
        label: f.slice(f.lastIndexOf('/') + 1),
        path: f,
        parentId: m.id,
      });
    }
  }
  return { version: 1, repo: { name: service, root: `/tmp/${service}` }, nodes, edges: [], warnings: [] } as unknown as ArchGraph;
}

/** Every `p:` node's summary, keyed by id. */
function summariesOf(graph: ArchGraph): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (n: { id?: string; summary?: string; children?: unknown[] }): void => {
    if (n.id && typeof n.summary === 'string') out.set(n.id, n.summary);
    for (const k of (n.children ?? []) as { id?: string; summary?: string; children?: unknown[] }[]) walk(k);
  };
  walk(buildStructuralTree(graph) as never);
  return out;
}

test('a tie among equals produces no anchor, so no file gets to name the module', () => {
  // gin's root package: 22 Go files, no import between any of them, so PageRank
  // gives every one the same score. The old rule sorted and took the first, and
  // named the library's core "Auth".
  const flat = ['auth.go', 'context.go', 'gin.go', 'tree.go'];
  const flatRank = () => 0.25;
  assert.strictEqual(
    chooseAnchor(flat, flatRank),
    undefined,
    'nothing depends on anything here — there is no anchor to report'
  );
  assert.strictEqual(labelCluster(flat, '.', chooseAnchor(flat, flatRank)), 'Top level');

  // ...and a REAL anchor still names it — this is not a removal of the feature.
  const ranked = new Map([
    ['auth.go', 0.1],
    ['context.go', 0.2],
    ['gin.go', 0.6],
    ['tree.go', 0.1],
  ]);
  const anchor = chooseAnchor(flat, (f) => ranked.get(f) ?? 0);
  assert.strictEqual(anchor, 'gin.go');
  assert.strictEqual(labelCluster(flat, '.', anchor), 'Gin');

  // A two-way tie at the top is still ambiguous, even though ranks differ below.
  const tied = new Map([
    ['auth.go', 0.4],
    ['context.go', 0.4],
    ['gin.go', 0.1],
    ['tree.go', 0.1],
  ]);
  assert.strictEqual(chooseAnchor(flat, (f) => tied.get(f) ?? 0), undefined);
});

test('a module falls back to its counted symbols before it falls back to a count', () => {
  const graph: ArchGraph = {
    version: 1,
    repo: { name: 'lib', root: '/tmp/lib' },
    nodes: [
      { id: 'repo:lib', kind: 'repo', label: 'lib' },
      { id: 'svc:lib', kind: 'service', label: 'lib', parentId: 'repo:lib' },
      {
        id: 'mod:lib/0',
        kind: 'module',
        label: 'render',
        parentId: 'svc:lib',
        meta: { files: 3, description: '3 go files in render, defining JSON, XML, HTML.' },
      },
      { id: 'file:render/json.go', kind: 'file', label: 'json.go', path: 'render/json.go', parentId: 'mod:lib/0' },
      { id: 'file:render/xml.go', kind: 'file', label: 'xml.go', path: 'render/xml.go', parentId: 'mod:lib/0' },
      { id: 'file:render/html.go', kind: 'file', label: 'html.go', path: 'render/html.go', parentId: 'mod:lib/0' },
    ],
    edges: [],
    warnings: [],
  } as unknown as ArchGraph;

  const tree = buildStructuralTree(graph);
  const summaries = new Map<string, string>();
  const walk = (n: { id?: string; summary?: string; children?: unknown[] }): void => {
    if (n.id && typeof n.summary === 'string') summaries.set(n.id, n.summary);
    for (const k of (n.children ?? []) as { id?: string; summary?: string; children?: unknown[] }[]) walk(k);
  };
  walk(tree as never);

  const summary = summaries.get('p:mod:lib/0');
  assert.ok(summary, 'module should appear in the structural tree');
  assert.ok(
    !/^A group of \d+ related files?\.$/.test(summary!),
    `the counted-symbol description exists and must be used, got: ${summary}`
  );
  assert.ok(summary!.includes('JSON'), `expected the real symbols in the summary, got: ${summary}`);
});

/**
 * r187 / G11 — TWO GROUNDED FACTS MUST COMPLEMENT, NOT COMPETE.
 *
 * The filename-domain pattern used to OUTRANK the counted-symbol sentence, so
 * a module that matched the dictionary got VAGUER, not richer. Measured on the
 * real gin clone: `binding/` (17 go files, listed below verbatim from
 * `/tmp/sequence-qa-cache/gin/binding`) matches `form`, `query` and `validator`,
 * and reading it replaced "17 go files in binding, defining Bind, BindBody,
 * BindUri." with "Form and validation and search modules." — the counted names
 * you could go and open, gone.
 */
/**
 * r187 / G11 (gin/render) — the exact QA directory named in `fileSignals.ts`.
 *
 * Measured before the precedence fix: adding a serialization token turned
 * "14 go files in render, defining Instance, loadTemplate, Render." into the
 * vaguer "Serialization format modules." alone. The counted names must survive
 * verbatim; when a domain line is present it follows them (G14: symbols lead).
 */
test('G11 (gin/render): counted symbols survive and domain context complements, never replaces', () => {
  const RENDER = [
    'render/data.go',
    'render/html.go',
    'render/json.go',
    'render/msgpack.go',
    'render/protobuf.go',
    'render/redirect.go',
    'render/render.go',
    'render/text.go',
    'render/xml.go',
    'render/yaml.go',
    'render/reader.go',
    'render/writer.go',
    'render/reader_test.go',
    'render/render_test.go',
  ];
  const counted = '14 go files in render, defining Instance, loadTemplate, Render.';
  const summary = summariesOf(
    graphOf('gin', [{ id: 'mod:gin/2', label: 'render', files: RENDER, description: counted }])
  ).get('p:mod:gin/2');

  assert.ok(summary, 'the module must appear in the structural tree');
  assert.ok(
    summary!.includes(counted),
    `the counted sentence must survive verbatim, got: ${summary}`
  );
  assert.ok(summary!.includes('Instance'), `expected the real symbols, got: ${summary}`);
  assert.notStrictEqual(
    summary,
    'Serialization format modules.',
    'domain-only replacement is the defect G11 fixes'
  );
  if (/serialization/i.test(summary!)) {
    assert.ok(
      summary!.startsWith(counted),
      `counted detail must lead so ellipsis keeps symbols (G14), got: ${summary}`
    );
    assert.ok(
      summary!.includes('—'),
      `domain context must follow the counted detail, got: ${summary}`
    );
  }
});

test('G11: a domain pattern ADDS to the counted symbols, it never replaces them', () => {
  const BINDING = [
    'binding/binding.go', 'binding/binding_nomsgpack.go', 'binding/bson.go',
    'binding/default_validator.go', 'binding/form.go', 'binding/form_mapping.go',
    'binding/header.go', 'binding/json.go', 'binding/msgpack.go',
    'binding/multipart_form_mapping.go', 'binding/plain.go', 'binding/protobuf.go',
    'binding/query.go', 'binding/toml.go', 'binding/uri.go', 'binding/xml.go',
    'binding/yaml.go',
  ];
  const counted = '17 go files in binding, defining Bind, BindBody, BindUri.';
  const summary = summariesOf(
    graphOf('gin', [{ id: 'mod:gin/1', label: 'binding', files: BINDING, description: counted }])
  ).get('p:mod:gin/1');

  assert.ok(summary, 'the module must appear in the structural tree');
  assert.ok(
    summary!.includes(counted),
    `the counted sentence must survive the domain pattern verbatim, got: ${summary}`
  );
  assert.ok(
    /form and validation/i.test(summary!),
    `...and the domain pattern must still be said after the counted detail, got: ${summary}`
  );
  // Terse: one line, not a paragraph. The row renders on a single nowrap line.
  assert.ok(summary!.split('. ').length <= 3, `too many sentences for a card row: ${summary}`);
});

/**
 * r187 / G11 (half two) — ...but a phrase the ROW'S OWN TITLE already says adds
 * nothing, and now it would add nothing IN FRONT of the real detail.
 *
 * Measured in r186 on the real corpus: the only two modules a `plugin` signal
 * hit were already titled "Plugins", so the summary just repeated the row's own
 * name — the settled dislike in HANDOFF §6.
 */
test('G11: the domain phrase is dropped when it only repeats the row title', () => {
  const files = ['tests/test_a.py', 'tests/test_b.py', 'tests/test_c.py', 'tests/conftest.py'];
  const counted = '4 py files in tests, defining test_a, test_b, test_c.';
  const summary = summariesOf(
    graphOf('lib', [{ id: 'mod:lib/0', label: 'tests', files, description: counted }])
  ).get('p:mod:lib/0');

  assert.strictEqual(
    summary,
    counted,
    `"Tests" titling a row that reads "Test modules — ..." repeats itself, got: ${summary}`
  );
});

/**
 * G12 — A ROW THAT READS AS NOTHING.
 *
 * On the real flask clone `p:mod:flask/5` (35 py files spread across `docs/`,
 * `examples/` and `tests/`, sharing NO directory) came back with an EMPTY
 * label. Cause: with no `dir` its segment list is empty, `renderSegments([])`
 * returns `''`, and the collision walk only ever checked that the candidates
 * were DISTINCT — an empty string is distinct from everything, so it shipped.
 */
test('G12: the collision walk never produces an empty label', () => {
  const out = uniqueModuleLabels(
    [
      { label: 'tests', dir: 'examples/tutorial/tests', anchor: 'examples/tutorial/tests/conftest.py' },
      { label: 'tests', anchor: 'tests/conftest.py' },
    ],
    'flask'
  );
  assert.ok(!out.some((l) => l.trim() === ''), `no module may be nameless, got: ${JSON.stringify(out)}`);
  assert.strictEqual(new Set(out).size, out.length, 'and they must still tell themselves apart');
  assert.deepStrictEqual(out, ['Tutorial / Tests', 'tests']);
});

/**
 * G8 — A MODULE NAMED AFTER ITS OWN SERVICE.
 *
 * The walk broke a tie using each module's own directory and never compared the
 * result with the PARENT SERVICE's name, so the module whose directory IS the
 * service root rendered as the service: `svc:api` → "Api" and `mod:api/0` →
 * "Api". Two rows reading the same in one breakout — the `module-desc` e2e was
 * red on exactly this.
 */
test('G8: a module is never named after the service that contains it', () => {
  const out = uniqueModuleLabels(
    [
      { label: 'core', dir: 'api', anchor: 'api/main.py' },
      { label: 'core', dir: 'api/services/core', anchor: 'api/services/core/worker0.py' },
    ],
    'api'
  );
  assert.ok(
    !out.some((l) => l.toLowerCase() === 'api'),
    `a module must not repeat its service's name, got: ${JSON.stringify(out)}`
  );
  // The sibling keeps the good name it earned — the veto is per module.
  assert.deepStrictEqual(out, ['Main', 'Services / Core']);
});

test('G8: vetoing one anchor does not cost the others their real names', () => {
  // The real express clone: three modules collide on "test" and their anchors
  // are `test/index.js`, `lib/express.js` and `test/utils.js`. Only the middle
  // one repeats the service; the other two must still be told apart.
  const out = uniqueModuleLabels(
    [
      { label: 'test', anchor: 'test/index.js' },
      { label: 'test', anchor: 'lib/express.js' },
      { label: 'test', dir: 'test', anchor: 'test/utils.js' },
    ],
    'express'
  );
  assert.deepStrictEqual(out, ['Index', 'test', 'Utils']);
  assert.strictEqual(new Set(out).size, 3, 'three rows, three names');
});
