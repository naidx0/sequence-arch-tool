/**
 * THE BELT THE HARNESS ACTUALLY NEEDED — ranged reads, surgical edits, the
 * grounded graph, and a tool call that is never silently thrown away.
 *
 * Every test here is built to a shape a fixture could not produce by accident:
 * a file bigger than the read cap, an `oldString` that occurs twice, a service
 * whose files are not in the prompt. The four defects these lock were all
 * invisible at fixture scale.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { validateChart, type ArchGraph } from '@sequence/schema';
import {
  ASK_TOOL_READ_CAP_BYTES,
  ASK_TOOL_REGISTRY,
  askToolsForJobMode,
  executeAskTool,
  flowHopsForEdges,
  liftedEdgeKeys,
  parseFencedToolRequests,
  renderAskToolHintSection,
  salvageBareToolRequests,
  stripReadFileGutter,
  type AskToolContext,
} from '../server/askTools.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-belt-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  return fs.realpathSync(repo);
}

function ctxFor(root: string, extra: Partial<AskToolContext> = {}): AskToolContext {
  return {
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    designMode: false,
    ...extra,
  };
}

/** A file bigger than the read cap — the shape 22% of this repo's own source has. */
function writeBigFile(root: string, rel: string, lines: number): string[] {
  const body = Array.from({ length: lines }, (_, i) => `const line${i} = ${i}; // padding padding padding`);
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body.join('\n'));
  return body;
}

/* ============================================================== read_file === */

test('READ_FILE CAN REACH PAST ITS OWN CAP — offset, limit, and a way back', async () => {
  /*
   * It used to take exactly `{ path }` and return `raw.slice(0, 12_000)`. The
   * marker said "(truncated)" and there was no follow-up call that got more, so
   * a function below byte 12,000 was unreachable — and the per-turn cache keyed
   * on the arguments, which could not vary, so every later read returned the
   * same head. 201 of this repository's own 912 TypeScript files are over that
   * cap.
   */
  const root = tmpRepo();
  const lines = writeBigFile(root, 'src/big.ts', 900);
  assert.ok(lines.join('\n').length > ASK_TOOL_READ_CAP_BYTES, 'the fixture must exceed the cap');
  const needle = lines[800];

  const head = await executeAskTool('read_file', { path: 'src/big.ts' }, ctxFor(root));
  assert.ok(head.ok);
  assert.ok(!head.content!.includes(needle), 'the head slice cannot reach line 800');
  /* The cut names the exact call that continues it, rather than only that it
     happened — inert advice is the defect this file already records once. */
  assert.match(head.content!, /call read_file again with \{"path":"src\/big\.ts","offset":\d+\}/);

  /* Page until the needle is reached. Each page must name the offset of the
     next one, which is the property that makes the whole file reachable. */
  let page = head;
  let pages = 1;
  while (!page.content!.includes(needle)) {
    const offsetMatch = /"offset":(\d+)\}/.exec(page.content!);
    assert.ok(offsetMatch, `page ${pages} stopped without naming a continuation offset`);
    page = await executeAskTool(
      'read_file',
      { path: 'src/big.ts', offset: Number(offsetMatch![1]) },
      ctxFor(root),
    );
    assert.ok(page.ok, page.evidence);
    pages += 1;
    assert.ok(pages < 20, 'paging must converge');
  }
  assert.ok(pages > 1, "line 800 is past the first page, which is the whole point");

  const window = await executeAskTool(
    'read_file',
    { path: 'src/big.ts', offset: 801, limit: 2 },
    ctxFor(root),
  );
  assert.ok(window.content!.includes(needle));
  assert.ok(!window.content!.includes(lines[810]), 'limit really bounds the window');
  assert.match(window.content!, /lines 801-802 of 900/);
});

test('read_file numbers its lines, and the gutter is reversible', async () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'alpha\nbeta\ngamma\n');
  const r = await executeAskTool('read_file', { path: 'src/a.ts' }, ctxFor(root));
  assert.match(r.content!, /^\s+2\|beta$/m, 'cat -n style gutter so an answer can cite a line');
  assert.strictEqual(stripReadFileGutter('    2|beta\n    3|gamma'), 'beta\ngamma');
});

/* ============================================================== edit_file === */

test('EDIT_FILE CHANGES A LINE WITHOUT REWRITING THE FILE', async () => {
  /*
   * Before this tool the only write path was `propose_files`, whose schema is
   * the WHOLE new body. Changing one line in a 900-line file meant emitting 900
   * lines — from a read that had shown the model the first 12,000 bytes of it.
   * The realistic outcome was a proposal that silently deleted the tail.
   */
  const root = tmpRepo();
  const lines = writeBigFile(root, 'src/big.ts', 900);
  const result = await executeAskTool(
    'edit_file',
    {
      path: 'src/big.ts',
      title: 'Rename line 800',
      edits: [{ oldString: 'const line800 = 800;', newString: 'const line800 = 8000;' }],
    },
    ctxFor(root),
  );
  assert.ok(result.ok, result.evidence);
  assert.ok(result.proposal, 'it stages the same reviewable proposal propose_files does');
  const proposed = result.proposal!.files[0];
  assert.strictEqual(proposed.path, 'src/big.ts');
  assert.ok(proposed.content.includes('const line800 = 8000;'));
  assert.strictEqual(
    proposed.content.split('\n').length,
    lines.length,
    'every other line survives — nothing is reconstructed from what the model could see',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'src/big.ts'), 'utf8'),
    lines.join('\n'),
    'and nothing is written to disk',
  );
});

test('an AMBIGUOUS oldString is refused with its count, never applied to the wrong line', async () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'dup.ts'), 'x = 1;\ny = 2;\nx = 1;\n');
  const ambiguous = await executeAskTool(
    'edit_file',
    { path: 'src/dup.ts', edits: [{ oldString: 'x = 1;', newString: 'x = 3;' }] },
    ctxFor(root),
  );
  assert.ok(!ambiguous.ok);
  assert.match(ambiguous.evidence, /appears 2 times/);
  assert.ok(!ambiguous.proposal, 'an ambiguous edit stages nothing at all');

  const all = await executeAskTool(
    'edit_file',
    { path: 'src/dup.ts', edits: [{ oldString: 'x = 1;', newString: 'x = 3;', replaceAll: true }] },
    ctxFor(root),
  );
  assert.ok(all.ok, all.evidence);
  assert.strictEqual(all.proposal!.files[0].content, 'x = 3;\ny = 2;\nx = 3;\n');
});

test('an ABSENT oldString is refused with actionable advice, not silently ignored', async () => {
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'alpha\n');
  const miss = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', edits: [{ oldString: 'omega', newString: 'zeta' }] },
    ctxFor(root),
  );
  assert.ok(!miss.ok);
  assert.match(miss.evidence, /does not appear in src\/a\.ts/);
  assert.match(miss.evidence, /read_file/, 'the refusal names the way out');
});

test("edit_file tolerates read_file's own line gutter — one reversal, never a guess", async () => {
  /* The model copies the tool output it was given. The numbers came from THIS
     module, so stripping them back off is a reversal, not fuzzy matching. */
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'alpha\nbeta\n');
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/a.ts', edits: [{ oldString: '    2|beta', newString: 'BETA' }] },
    ctxFor(root),
  );
  assert.ok(r.ok, r.evidence);
  assert.strictEqual(r.proposal!.files[0].content, 'alpha\nBETA\n');
});

test('edit_file refuses a file that does not exist and says which tool creates one', async () => {
  const root = tmpRepo();
  const r = await executeAskTool(
    'edit_file',
    { path: 'src/nope.ts', edits: [{ oldString: 'a', newString: 'b' }] },
    ctxFor(root),
  );
  assert.ok(!r.ok);
  assert.match(r.evidence, /propose_files/);
});

/* ========================================================== read_topology === */

test('READ_TOPOLOGY GETS BACK WHAT THE INDEX LEFT OUT — and refuses to invent one', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const digest = buildDigest(graph);
  const root = tmpRepo();
  const ctx = ctxFor(root, { digest, graph });

  const list = await executeAskTool('read_topology', {}, ctx);
  assert.ok(list.ok, list.evidence);
  for (const svc of digest.services) {
    assert.ok(list.content!.includes(svc.id), `${svc.id} is named in the index listing`);
  }

  const first = digest.services[0];
  const one = await executeAskTool('read_topology', { service: first.id }, ctx);
  assert.ok(one.ok, one.evidence);
  for (const f of first.files.slice(0, 3)) {
    assert.ok(one.content!.includes(f.path), `${f.path} comes back in full`);
  }

  const unknown = await executeAskTool('read_topology', { service: 'svc:not-a-thing' }, ctx);
  assert.ok(!unknown.ok);
  assert.match(unknown.evidence, /real service ids are/, 'a weak model can recover in-turn');
  assert.ok(unknown.evidence.includes(first.id));

  const noDigest = await executeAskTool('read_topology', {}, ctxFor(root));
  assert.ok(!noDigest.ok, 'with no digest it refuses rather than inventing a service list');
});

test('READ_TOPOLOGY HAS DEPTH: modules with what they do, then one module in full', async () => {
  /*
   * Owner walk on ML Harness, 2026-09-22: the model called read_topology four
   * times on one service and got the same first-50-of-143 page each time. The
   * second level is a module; every module and file is a scanned node.
   */
  const scanned = await scanRepo(SHOPFRONT, { cluster: true });
  /* Three files cannot cluster, so the modules are written here in the shape
     scan.ts writes them (kind, parentId, path, meta.description) and the
     files reparented under them: the test owns its specimen. */
  const svc = scanned.nodes.find((n) => n.kind === 'service' && scanned.nodes.some((f) => f.kind === 'file' && f.parentId === n.id))!;
  const owned = scanned.nodes.filter((f) => f.kind === 'file' && f.parentId === svc.id);
  assert.ok(owned.length >= 2, 'the service has files to split across two modules');
  const modA = { id: `mod:${svc.label}/0`, kind: 'module' as const, label: 'orders', parentId: svc.id, path: 'src/orders', meta: { files: 1, description: 'Takes an order and prices it' } };
  const modB = { id: `mod:${svc.label}/1`, kind: 'module' as const, label: 'rest', parentId: svc.id, path: 'src', meta: { files: owned.length - 1, description: 'Everything else the service does' } };
  const graph = {
    ...scanned,
    nodes: scanned.nodes.map((n) =>
      n.kind === 'file' && n.parentId === svc.id ? { ...n, parentId: n.id === owned[0].id ? modA.id : modB.id } : n,
    ).concat([modA, modB]),
  };
  const digest = buildDigest(graph);
  const ctx = ctxFor(tmpRepo(), { digest, graph });
  const modules = graph.nodes.filter((m) => m.kind === 'module' && m.parentId === svc!.id);

  const one = await executeAskTool('read_topology', { service: svc!.id }, ctx);
  assert.ok(one.ok, one.evidence);
  const page = JSON.parse(one.content!.split('```json')[1].split('```')[0]) as {
    modules: Array<{ id: string; description?: string; files: number; sample: string[] }>;
    filesOutsideModules: { count: number };
    edges: number;
  };
  assert.strictEqual(page.modules.length, modules.length, 'every module of the service, none invented');
  for (const m of modules) {
    const row = page.modules.find((r) => r.id === m.id)!;
    assert.ok(row, `${m.id} is on the page`);
    assert.strictEqual(row.files, graph.nodes.filter((f) => f.kind === 'file' && f.parentId === m.id).length);
    assert.strictEqual(row.description, m.meta?.description, 'the scan wrote what the module does; the page carries it');
  }
  assert.match(one.content!, /`module`/, 'the page says how to go one level down');
  /* Explorer 6 (2026-09-22): 40 of 264 edges with no word that the list is
     partial, and the model concluded "That's the only edge I can verify". */
  assert.match(
    one.content!.split('\n').find((l) => l.startsWith('### topology for'))!,
    new RegExp(`edgeSample is ${Math.min(40, page.edges)} of ${page.edges} edges.*\`trace_flow\``),
    'the header says the edge list is a sample and names the tool for the rest',
  );

  const deep = await executeAskTool('read_topology', { service: svc!.id, module: modules[0].id }, ctx);
  assert.ok(deep.ok, deep.evidence);
  const mod = JSON.parse(deep.content!.split('```json')[1].split('```')[0]) as { files: Array<{ path: string }> };
  const real = graph.nodes.filter((f) => f.kind === 'file' && f.parentId === modules[0].id).map((f) => f.path ?? f.label);
  assert.deepStrictEqual(mod.files.map((f) => f.path).sort(), real.sort(), 'the module page is its full file list');

  const wrong = await executeAskTool('read_topology', { service: svc!.id, module: 'mod:not-here' }, ctx);
  assert.ok(!wrong.ok);
  assert.ok(wrong.evidence.includes(modules[0].id), 'the refusal names the real modules');
});

/*
 * THE ML-HARNESS SHAPE, owned here. Owner's re-measure, 2026-09-22:
 * `read_topology` cost 25.6k characters a run; the frontend and ml-harness
 * pages each carried the SAME 40 `client.ts → main.py` HTTP routes (5,640
 * characters apiece), and the service page skipped the 12k cap.
 */
function mlHarnessShape(): { graph: ArchGraph; digest: ReturnType<typeof buildDigest> } {
  const node = (id: string, kind: string, label: string, parentId?: string, path?: string, description?: string) => ({
    id,
    kind,
    label,
    ...(parentId ? { parentId } : {}),
    ...(path ? { path } : {}),
    meta: description ? { description } : {},
  });
  const nodes = [
    node('svc:frontend', 'service', 'frontend', undefined, 'frontend'),
    node('mod:frontend/0', 'module', 'api', 'svc:frontend', 'frontend/src/api', 'Calls the engine over HTTP'),
    node('file:frontend/src/api/client.ts', 'file', 'client.ts', 'mod:frontend/0', 'frontend/src/api/client.ts'),
    node('svc:ml-harness', 'service', 'ml-harness', undefined, 'app'),
    node('mod:ml-harness/0', 'module', 'routes', 'svc:ml-harness', 'app', 'The HTTP routes the UI calls'),
    node('mod:ml-harness/1', 'module', 'providers', 'svc:ml-harness', 'app/providers', 'Routes a request to a model provider'),
    node('mod:ml-harness/2', 'module', 'gates', 'svc:ml-harness', 'app/gates', 'Runs the diagnosis and ledgers'),
    node('file:app/main.py', 'file', 'main.py', 'mod:ml-harness/0', 'app/main.py'),
    node('file:app/providers/router.py', 'file', 'router.py', 'mod:ml-harness/1', 'app/providers/router.py'),
    node('file:app/gates/diagnosis.py', 'file', 'diagnosis.py', 'mod:ml-harness/2', 'app/gates/diagnosis.py'),
  ];
  const edges = Array.from({ length: 40 }, (_, i) => ({
    id: `e${i + 4}`,
    srcId: 'file:frontend/src/api/client.ts',
    dstId: 'file:app/main.py',
    kind: 'http',
    detail: { method: 'GET', pathPattern: `/api/route-${i}` },
  }));
  const graph = { version: 1, scannedAt: '', repoRoot: '', repoName: 'ml-harness', nodes, edges } as unknown as ArchGraph;
  return { graph, digest: buildDigest(graph) };
}

function topologyPage(content: string): Record<string, unknown> {
  return JSON.parse(content.split('```json')[1]!.split('```')[0]!) as Record<string, unknown>;
}

test('READ_TOPOLOGY COLLAPSES 40 EDGES BETWEEN ONE FILE PAIR TO ONE ROW, and the page is small', async () => {
  const { graph, digest } = mlHarnessShape();
  const r = await executeAskTool('read_topology', { service: 'svc:ml-harness' }, ctxFor(tmpRepo(), { digest, graph }));
  assert.ok(r.ok, r.evidence);
  const page = topologyPage(r.content!);
  const rows = page.edgeSample as Array<{ from: string; to: string; kind: string; count: number; examples?: string[] }>;
  assert.strictEqual(rows.length, 1, 'one row for one file pair');
  assert.deepStrictEqual(
    { from: rows[0]!.from, to: rows[0]!.to, kind: rows[0]!.kind, count: rows[0]!.count },
    { from: 'file:frontend/src/api/client.ts', to: 'file:app/main.py', kind: 'http', count: 40 },
  );
  assert.ok((rows[0]!.examples ?? []).length > 0 && rows[0]!.examples!.length <= 3, 'at most three example labels');
  assert.ok(rows[0]!.examples!.includes('GET /api/route-0'), 'the labels are the scanned routes');
  assert.ok(r.content!.includes('edgeSample is 40 of 40 edges'), 'the header counts edges, not rows');
  assert.ok(r.content!.length < 4000, `a 3-module service with 40 same-pair edges is under 4,000 characters (got ${r.content!.length})`);
});

test('READ_TOPOLOGY DOES NOT REPEAT AN EDGE IT SHOWED EARLIER THIS TURN', async () => {
  const { graph, digest } = mlHarnessShape();
  const ctx = ctxFor(tmpRepo(), { digest, graph, seenEdgeKeys: new Set<string>() });
  const first = await executeAskTool('read_topology', { service: 'svc:frontend' }, ctx);
  assert.ok(first.ok, first.evidence);
  assert.strictEqual((topologyPage(first.content!).edgeSample as unknown[]).length, 1, 'the first page shows the pair');
  const second = await executeAskTool('read_topology', { service: 'svc:ml-harness' }, ctx);
  assert.ok(second.ok, second.evidence);
  const page = topologyPage(second.content!);
  assert.deepStrictEqual(page.edgeSample, [], 'the second page does not copy the same 40 edges');
  assert.strictEqual(page.edges, 40, 'the service still counts its edges');
  assert.strictEqual(page.edgesShownEarlier, 40);
  assert.ok(second.content!.includes('(+40 edges shown earlier this turn)'), 'and says where they went');
  /* THE CONTROL: a fresh turn shows them again. */
  const fresh = await executeAskTool(
    'read_topology',
    { service: 'svc:ml-harness' },
    ctxFor(tmpRepo(), { digest, graph, seenEdgeKeys: new Set<string>() }),
  );
  assert.strictEqual((topologyPage(fresh.content!).edgeSample as unknown[]).length, 1);
});

test('READ_TOPOLOGY HOLDS THE 12K CAP ON THE SERVICE PAGE and says it trimmed', async () => {
  const long = (i: number) => `web/src/harness/${'deeply-nested-directory/'.repeat(5)}component-number-${i}.tsx`;
  const nodes: Array<Record<string, unknown>> = [
    { id: 'svc:web', kind: 'service', label: 'web', path: 'web', meta: {} },
    { id: 'mod:web/0', kind: 'module', label: 'ui', parentId: 'svc:web', path: 'web/src', meta: { description: 'The panes' } },
  ];
  for (let i = 0; i < 60; i++) {
    nodes.push({ id: `file:${long(i)}`, kind: 'file', label: `c${i}.tsx`, parentId: 'mod:web/0', path: long(i), meta: {} });
  }
  const edges = Array.from({ length: 59 }, (_, i) => ({
    id: `imp${i}`,
    srcId: `file:${long(i)}`,
    dstId: `file:${long(i + 1)}`,
    kind: 'import',
  }));
  const graph = { version: 1, scannedAt: '', repoRoot: '', repoName: 'web', nodes, edges } as unknown as ArchGraph;
  const digest = buildDigest(graph);
  const ctx = ctxFor(tmpRepo(), { digest, graph, seenEdgeKeys: new Set<string>() });
  const r = await executeAskTool('read_topology', { service: 'svc:web' }, ctx);
  assert.ok(r.ok, r.evidence);
  const body = r.content!.split('```json')[1]!.split('```')[0]!.trim();
  assert.ok(body.length <= 12_000, `the page is within the cap (got ${body.length})`);
  const header = r.content!.split('\n').find((l) => l.startsWith('### topology for'))!;
  assert.match(header, /page trimmed to 12000 characters: [1-9][0-9]* edge rows omitted/, 'the header says what went');
  const shown = (topologyPage(r.content!).edgeSample as unknown[]).length;
  assert.ok(shown > 0 && shown < 40, `some rows kept, some cut (kept ${shown})`);
  assert.strictEqual(ctx.seenEdgeKeys!.size, shown, 'only the rows on the page count as shown');
});

test('READ_TOPOLOGY `services` RETURNS ONE SHORT BRIEF PER SERVICE, NO EDGES', async () => {
  const { graph, digest } = mlHarnessShape();
  const r = await executeAskTool(
    'read_topology',
    { services: ['svc:frontend', 'svc:ml-harness'] },
    ctxFor(tmpRepo(), { digest, graph }),
  );
  assert.ok(r.ok, r.evidence);
  const page = topologyPage(r.content!) as {
    services: Array<{ id: string; modules: Array<{ id: string; description?: string; files: number }> }>;
  };
  assert.deepStrictEqual(page.services.map((s) => s.id), ['svc:frontend', 'svc:ml-harness']);
  const ml = page.services[1]!;
  assert.strictEqual(ml.modules.length, 3);
  assert.deepStrictEqual(ml.modules.map((m) => m.description), [
    'The HTTP routes the UI calls',
    'Routes a request to a model provider',
    'Runs the diagnosis and ledgers',
  ]);
  assert.deepStrictEqual(ml.modules.map((m) => m.files), [1, 1, 1]);
  assert.ok(!r.content!.includes('edgeSample') && !r.content!.includes('GET /api/route'), 'no edges in a brief');
  assert.ok(r.content!.includes('`service`'), 'the header says how to get one service’s edges');
  /* An unknown name is named with the real ones; a list of only unknowns is refused. */
  const refused = await executeAskTool('read_topology', { services: ['svc:nope'] }, ctxFor(tmpRepo(), { digest, graph }));
  assert.ok(!refused.ok);
  assert.ok(refused.evidence.includes('svc:ml-harness'));
});

/* ============================================================== who_calls === */

test('WHO_CALLS ANSWERS FROM THE SCANNED GRAPH, NOT FROM A SUBSTRING WALK', async () => {
  /*
   * Sequence exports twelve grounded graph tools to OTHER agents over MCP and
   * gave its own model none of them: asked what breaks if a file changes, the
   * in-app agent grepped. Every row here is a real scanned edge.
   */
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const root = tmpRepo();
  const ctx = ctxFor(root, { graph, digest: buildDigest(graph) });

  const fileNode = graph.nodes.find(
    (n) => n.kind === 'file' && graph.edges.some((e) => e.dstId === n.id),
  );
  assert.ok(fileNode, 'the fixture must have at least one file with an inbound edge');

  const r = await executeAskTool('who_calls', { target: fileNode!.path ?? fileNode!.id }, ctx);
  assert.ok(r.ok, r.evidence);
  assert.match(r.content!, /INCOMING \(\d+\)/);
  assert.match(r.content!, /OUTGOING \(\d+\)/);
  assert.match(r.content!, /BLAST RADIUS: \d+ nodes?/);

  const expectedIn = graph.edges.filter((e) => e.dstId === fileNode!.id).length;
  assert.match(
    r.evidence,
    new RegExp(`${expectedIn} in\\b`),
    'the count is the real edge count, not an estimate',
  );

  /*
   * THE REFERENTS ARE THE REAL CALLERS, not a re-parse of the prose above.
   *
   * The fourth carry slot hands this list to the next turn so a follow-up
   * saying "of those, which one first" has an antecedent. If it were scraped
   * back out of `content` it would be a guess about what the tool said; this
   * asserts it is the same set the scanned edges produced.
   */
  assert.ok(r.referents, 'who_calls must expose what its answer was about');
  assert.equal(r.referents!.tool, 'who_calls');
  /*
   * DISTINCT callers, not edges: two imports from one file are one file to
   * change, and the next turn is being asked which FILE to change first.
   */
  const callerIds = new Set(
    graph.edges.filter((e) => e.dstId === fileNode!.id).map((e) => e.srcId),
  );
  const callerNames = new Set(
    [...callerIds].map((id) => {
      const n = graph.nodes.find((x) => x.id === id);
      return ((n?.path ?? n?.label ?? id) as string).split('\\').join('/');
    }),
  );
  assert.equal(r.referents!.total, callerNames.size, 'the referent count is the distinct callers');
  assert.ok(r.referents!.total <= expectedIn, 'distinct callers cannot exceed edges');
  for (const item of r.referents!.items) {
    assert.ok(callerNames.has(item), `referent ${item} is not one of the scanned callers`);
  }
  assert.equal(
    new Set(r.referents!.items).size,
    r.referents!.items.length,
    'a caller must not be listed twice',
  );

  const missing = await executeAskTool('who_calls', { target: 'nothing/like/this.ts' }, ctx);
  assert.ok(!missing.ok);
  assert.match(missing.evidence, /found no node matching/);

  const noGraph = await executeAskTool('who_calls', { target: 'a.ts' }, ctxFor(root));
  assert.ok(!noGraph.ok, 'with no graph it refuses rather than guessing');
  assert.equal(missing.referents, undefined, 'a refusal carries no referents');
  assert.equal(noGraph.referents, undefined, 'a refusal carries no referents');
});

/* ============================================================= trace_flow === */

/*
 * Slice 2 of docs/teaching-flow-plan.md (2026-09-22). In the live baseline the
 * model had one hop (`who_calls`) and a 40-edge sample (`read_topology`) and
 * wrote "That's the only edge I can verify". `trace_flow` returns the flow the
 * scan can prove, in order, each hop with its line.
 */

type TraceHop = { from: string; to: string; kind: string; evidence: { file: string; line: number }; label: string; edge: string };

/** Every ```json block of a tool result, in order: the hops, then the chart. */
function jsonBlocks(content: string): unknown[] {
  return content
    .split('```json')
    .slice(1)
    .map((s) => JSON.parse(s.split('```')[0]!) as unknown);
}

function hopsOf(content: string): TraceHop[] {
  return (jsonBlocks(content)[0] as { hops: TraceHop[] }).hops;
}

/** The shortest number of scanned edges from one node to another, by plain BFS. */
function shortestEdgeCount(graph: { edges: Array<{ srcId: string; dstId: string }> }, from: string, to: string): number {
  const dist = new Map<string, number>([[from, 0]]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of graph.edges) {
        if (e.srcId !== id || dist.has(e.dstId)) continue;
        dist.set(e.dstId, dist.get(id)! + 1);
        next.push(e.dstId);
      }
    }
    frontier = next;
  }
  return dist.get(to) ?? -1;
}

test('TRACE_FLOW FOLLOWS THE SCAN OUT OF A FILE, IN ORDER, WITH THE LINE THAT PROVES EACH HOP', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const ctx = ctxFor(tmpRepo(), { graph, digest: buildDigest(graph) });

  const r = await executeAskTool('trace_flow', { from: 'gateway/src/routes/orders.ts' }, ctx);
  assert.ok(r.ok, r.evidence);
  const hops = hopsOf(r.content!);
  assert.ok(hops.length >= 2, `a flow is more than one hop (got ${hops.length})`);
  assert.equal(hops[0]!.from, 'file:gateway/src/routes/orders.ts', 'the flow starts where it was asked to');

  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  const reached = new Set([hops[0]!.from]);
  for (const [i, h] of hops.entries()) {
    const edge = byId.get(h.edge);
    assert.ok(edge, `hop ${i} rides scanned edge ${h.edge}`);
    assert.equal(edge!.srcId, h.from, `hop ${i} is that edge, not a neighbour of it`);
    assert.equal(edge!.dstId, h.to);
    assert.equal(edge!.kind, h.kind);
    assert.equal(edge!.evidence[0]!.file.split('\\').join('/'), h.evidence.file, `hop ${i} cites the edge's own file`);
    assert.equal(edge!.evidence[0]!.line, h.evidence.line, `hop ${i} cites the edge's own line`);
    assert.ok(h.label.length > 0 && h.label.length <= 80, 'a hop label fits a chart step');
    /* Breadth-first: a hop leaves a part the flow has already reached. */
    assert.ok(reached.has(h.from), `hop ${i} leaves ${h.from}, which the flow had not reached yet`);
    reached.add(h.to);
  }
  const pairs = hops.map((h) => `${h.from}>${h.to}`);
  assert.equal(new Set(pairs).size, pairs.length, 'a pair is one hop, however many edges join it');
  assert.ok(r.content!.includes('gateway/src/routes/orders.ts:9'), 'the reader sees file:line, not only ids');

  const again = await executeAskTool('trace_flow', { from: 'gateway/src/routes/orders.ts' }, ctx);
  assert.deepStrictEqual(hopsOf(again.content!), hops, 'the same question traces the same flow');

  const shallow = await executeAskTool('trace_flow', { from: 'gateway/src/routes/orders.ts', depth: 1 }, ctx);
  const one = hopsOf(shallow.content!);
  assert.deepStrictEqual(
    one.map((h) => h.to).sort(),
    [...new Set(graph.edges.filter((e) => e.srcId === 'file:gateway/src/routes/orders.ts').map((e) => e.dstId))].sort(),
    'depth 1 is exactly the scanned edges out of the file',
  );
});

test('TRACE_FLOW WITH `to` RETURNS THE SHORTEST PROVEN PATH, and refuses honestly when there is none', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const ctx = ctxFor(tmpRepo(), { graph });

  const from = 'file:gateway/src/routes/orders.ts';
  const to = 'file:payments/src/index.js';
  const r = await executeAskTool('trace_flow', { from: 'gateway/src/routes/orders.ts', to: 'payments/src/index.js' }, ctx);
  assert.ok(r.ok, r.evidence);
  const path = hopsOf(r.content!);
  const shortest = shortestEdgeCount(graph, from, to);
  assert.ok(shortest > 1, 'the fixture has a multi-hop path to trace');
  assert.equal(path.length, shortest, 'the path is the shortest the scan proves');
  assert.match(r.evidence, new RegExp(`${shortest} hops`), 'the evidence says how long it is');
  assert.equal(path[0]!.from, from);
  assert.equal(path[path.length - 1]!.to, to);
  for (let i = 1; i < path.length; i += 1) assert.equal(path[i]!.from, path[i - 1]!.to, 'each hop starts where the last ended');

  const none = await executeAskTool('trace_flow', { from: 'payments/src/index.js', to: 'gateway/src/index.ts' }, ctx);
  assert.ok(!none.ok, 'no path is a refusal, never a guessed one');
  assert.match(none.evidence, /no scanned path from payments\/src\/index\.js to gateway\/src\/index\.ts/);
  assert.match(none.evidence, /the scan reaches: .*payments\/src\/db\.js/, 'it names what IS reachable');
});

test('TRACE_FLOW REFUSES what it cannot ground: no scan, no match, several matches', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const ctx = ctxFor(tmpRepo(), { graph });

  const noGraph = await executeAskTool('trace_flow', { from: 'gateway/src/routes/orders.ts' }, ctxFor(tmpRepo()));
  assert.ok(!noGraph.ok);
  assert.match(noGraph.evidence, /no scan; attach a repository/);

  const several = await executeAskTool('trace_flow', { from: 'db' }, ctx);
  assert.ok(!several.ok, 'two readings are not one flow');
  assert.ok(several.evidence.includes('orders/app/db.py'), several.evidence);
  assert.ok(several.evidence.includes('payments/src/db.js'), several.evidence);

  const nothing = await executeAskTool('trace_flow', { from: 'qqqq-zzzz' }, ctx);
  assert.ok(!nothing.ok);
  const near = /nearest: (.*?)\. /.exec(nothing.evidence);
  assert.ok(near, `the refusal names the nearest labels: ${nothing.evidence}`);
  assert.equal(near![1]!.split(', ').length, 3, 'three of them');
});

test('TRACE_FLOW STARTS FROM A SYMBOL, and a service traces as a flow of parts', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  /* The repo root is the fixture itself, so a bare function name can be located. */
  const ctx = ctxFor(SHOPFRONT, { graph });

  const hashed = await executeAskTool('trace_flow', { from: 'orders/app/payments_client.py#charge_order' }, ctx);
  assert.ok(hashed.ok, hashed.evidence);
  assert.equal(hopsOf(hashed.content!)[0]!.from, 'file:orders/app/payments_client.py');

  /* `ordersRouter` is declared in gateway/src/routes/orders.ts; no node carries its name. */
  const bare = await executeAskTool('trace_flow', { from: 'ordersRouter' }, ctx);
  assert.ok(bare.ok, bare.evidence);
  assert.equal(hopsOf(bare.content!)[0]!.from, 'file:gateway/src/routes/orders.ts', 'located like locate_symbol does');
  assert.match(bare.content!, /ordersRouter is declared at gateway\/src\/routes\/orders\.ts:\d+/, 'and it says where it found it');

  const svc = await executeAskTool('trace_flow', { from: 'orders' }, ctx);
  assert.ok(svc.ok, svc.evidence);
  const hops = hopsOf(svc.content!);
  assert.equal(hops[0]!.from, 'svc:orders');
  const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  for (const h of hops) {
    assert.notEqual(kinds.get(h.from), 'file', `a service trace is a flow of parts, not files: ${h.from}`);
    assert.notEqual(kinds.get(h.to), 'file', `a service trace is a flow of parts, not files: ${h.to}`);
  }
  const lifted = liftedEdgeKeys(graph);
  for (const h of hops) assert.ok(lifted.has(`${h.from}>${h.to}`), `${h.from}>${h.to} is a roll-up the board draws`);
});

test('TRACE_FLOW ENDS WITH A propose_chart DATA-FLOW THAT VALIDATES against the same graph', async () => {
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const ctx = ctxFor(tmpRepo(), { graph });
  for (const from of ['gateway/src/routes/orders.ts', 'orders']) {
    const r = await executeAskTool('trace_flow', { from }, ctx);
    assert.ok(r.ok, r.evidence);
    const hops = hopsOf(r.content!);
    const chart = jsonBlocks(r.content!)[1] as {
      kind: string;
      items: Array<{ id: string; nodeId?: string }>;
      links: Array<{ from: string; to: string }>;
      steps: Array<{ from: string; to: string; says: string }>;
    };
    assert.equal(chart.kind, 'data-flow');
    const checked = validateChart(chart, new Set(graph.nodes.map((n) => n.id)), liftedEdgeKeys(graph));
    assert.ok(checked.ok, JSON.stringify(checked.ok ? null : checked.problems));
    const nodeOf = new Map(chart.items.map((it) => [it.id, it.nodeId]));
    assert.equal(chart.steps.length, hops.length, 'one step per hop');
    for (const [i, s] of chart.steps.entries()) {
      assert.equal(nodeOf.get(s.from), hops[i]!.from, `step ${i} leaves where hop ${i} leaves`);
      assert.equal(nodeOf.get(s.to), hops[i]!.to, `step ${i} arrives where hop ${i} arrives`);
      assert.equal(s.says, hops[i]!.label, `step ${i} says the hop's label`);
    }
    assert.deepStrictEqual(
      chart.links.map((l) => [nodeOf.get(l.from), nodeOf.get(l.to)]),
      hops.map((h) => [h.from, h.to]),
      'links in hop order',
    );
    const drawn = await executeAskTool('propose_chart', chart as unknown as Record<string, unknown>, ctx);
    assert.ok(drawn.ok, `the skeleton draws in one call: ${drawn.evidence}`);
  }
});

test('TRACE_FLOW COLLAPSES FILES INTO THEIR MODULES when asked from a service', async () => {
  /* The test owns its specimen: two services, one with two modules, in the
     shape scan.ts writes them (like the propose_chart module test). */
  const ev = (file: string, line: number) => [{ file, line, snippet: 'x' }];
  const edge = (id: string, srcId: string, dstId: string, kind: 'import' | 'http', line: number) => ({
    id, srcId, dstId, kind, confidence: 1, origin: 'deterministic' as const, evidence: ev(srcId.slice(5), line),
  });
  const graph = {
    version: 1 as const,
    repo: { id: 'repo', label: 'r' },
    nodes: [
      { id: 'repo', kind: 'repo' as const, label: 'r' },
      { id: 'svc:app', kind: 'service' as const, label: 'app', parentId: 'repo', path: 'app' },
      { id: 'svc:other', kind: 'service' as const, label: 'other', parentId: 'repo', path: 'other' },
      { id: 'mod:app/0', kind: 'module' as const, label: 'intake', parentId: 'svc:app', path: 'app/intake' },
      { id: 'mod:app/1', kind: 'module' as const, label: 'pricing', parentId: 'svc:app', path: 'app/pricing' },
      { id: 'file:app/intake/a.ts', kind: 'file' as const, label: 'a.ts', parentId: 'mod:app/0', path: 'app/intake/a.ts' },
      { id: 'file:app/intake/b.ts', kind: 'file' as const, label: 'b.ts', parentId: 'mod:app/0', path: 'app/intake/b.ts' },
      { id: 'file:app/pricing/c.ts', kind: 'file' as const, label: 'c.ts', parentId: 'mod:app/1', path: 'app/pricing/c.ts' },
      { id: 'file:other/o.ts', kind: 'file' as const, label: 'o.ts', parentId: 'svc:other', path: 'other/o.ts' },
    ],
    edges: [
      edge('i1', 'file:app/intake/a.ts', 'file:app/intake/b.ts', 'import', 1),
      edge('i2', 'file:app/intake/a.ts', 'file:app/pricing/c.ts', 'import', 2),
      edge('i3', 'file:app/intake/b.ts', 'file:app/pricing/c.ts', 'import', 3),
      edge('h1', 'file:app/pricing/c.ts', 'file:other/o.ts', 'http', 7),
    ],
  } as unknown as import('@sequence/schema').ArchGraph;
  const ctx = ctxFor(tmpRepo(), { graph });

  const r = await executeAskTool('trace_flow', { from: 'svc:app' }, ctx);
  assert.ok(r.ok, r.evidence);
  const hops = hopsOf(r.content!);
  assert.deepStrictEqual(
    hops.map((h) => `${h.from}>${h.to}`),
    ['mod:app/0>mod:app/1', 'mod:app/1>svc:other'],
    'three imports between two modules are one module hop; the file inside one module moves nothing',
  );
  assert.equal(hops[0]!.edge, 'i2', 'the hop cites the first scanned edge between the two modules');
  assert.deepStrictEqual(hops[0]!.evidence, { file: 'app/intake/a.ts', line: 2 });
  const lifted = liftedEdgeKeys(graph);
  for (const h of hops) assert.ok(lifted.has(`${h.from}>${h.to}`), `${h.from}>${h.to} is one liftedEdgeKeys draws`);

  const file = await executeAskTool('trace_flow', { from: 'app/intake/a.ts', depth: 1 }, ctx);
  assert.deepStrictEqual(
    hopsOf(file.content!).map((h) => `${h.from}>${h.to}`),
    ['file:app/intake/a.ts>file:app/intake/b.ts', 'file:app/intake/a.ts>file:app/pricing/c.ts'],
    'asked from a file, the flow stays at files',
  );
});

test('TRACE_FLOW AND THE RAIL AGREE: the hop rule is flowForFunction\'s, on shopfront', async () => {
  /*
   * The analyzer cannot import web2, so the rule is a copy. This runs web2's
   * own `flowForFunction` (packages/web2/src/rail/railModel.ts, transpiled
   * here: it imports types only) on a function index with one function per
   * shopfront file and one call per scanned edge, and holds its hops to
   * `flowHopsForEdges` edge for edge.
   */
  const ts = (await import('typescript')).default;
  const railSrc = fs.readFileSync(path.join(ANALYZER_ROOT, '..', 'web2', 'src', 'rail', 'railModel.ts'), 'utf8');
  const js = ts.transpileModule(railSrc, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  assert.ok(!/^\s*import\s/m.test(js), 'railModel.ts carries no runtime import, so it can run here');
  const rail = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as {
    flowForFunction: (
      id: string,
      fns: unknown,
      g: unknown,
    ) => { hops: Array<{ from: string; to: string; evidence: { file: string; line: number } | null }> };
  };

  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  const files = graph.nodes.filter((n) => n.kind === 'file');
  const fnOf = (fileId: string) => `fn:${fileId}`;
  const byId: Record<string, unknown> = {};
  for (const f of files) byId[fnOf(f.id)] = { id: fnOf(f.id), kind: 'function', name: f.label, file: f.path };
  const isFile = new Set(files.map((f) => f.id));
  const fnEdges = graph.edges.map((e) => ({
    srcId: fnOf(e.srcId),
    dstId: isFile.has(e.dstId) ? fnOf(e.dstId) : e.dstId,
    kind: 'call',
  }));
  const functions = { graph: { nodes: Object.values(byId), edges: fnEdges }, byFile: {}, byId, warnings: [] };

  let compared = 0;
  for (const f of files) {
    const out = graph.edges.filter((e) => e.srcId === f.id);
    if (out.length === 0) continue;
    const railHops = rail.flowForFunction(fnOf(f.id), functions, graph).hops;
    const parts = flowHopsForEdges(graph, out, 'part');
    const fileHops = flowHopsForEdges(graph, out, 'file');
    const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
    for (const h of railHops) {
      const mine = kindOf.get(h.from) === 'file' ? fileHops : parts;
      const hit = mine.find((m) => m.from === h.from && m.to === h.to);
      assert.ok(hit, `${f.id}: the rail's hop ${h.from}>${h.to} is one trace_flow draws`);
      assert.deepStrictEqual(hit!.evidence, { file: h.evidence!.file.split('\\').join('/'), line: h.evidence!.line }, `${h.from}>${h.to} cites the same line`);
      compared += 1;
    }
    for (const m of parts) {
      assert.ok(railHops.some((h) => h.from === m.from && h.to === m.to), `${f.id}: trace_flow's part hop ${m.from}>${m.to} is one the rail plays`);
    }
  }
  assert.ok(compared >= 10, `the two were compared on real hops (${compared})`);
});

test('trace_flow is on the teach, explore and plan belts, and the hints point at it', () => {
  for (const belt of [
    askToolsForJobMode(undefined, 'plan', { teach: true }),
    askToolsForJobMode(undefined, 'plan'),
    askToolsForJobMode(undefined, 'build'),
    askToolsForJobMode('work', 'plan'),
  ]) {
    assert.ok(belt.includes('trace_flow'), `trace_flow on ${belt.join(',')}`);
  }
  const hint = renderAskToolHintSection(undefined, 'plan', { teach: true }).join('\n');
  assert.match(hint, /`trace_flow` args/);
  assert.match(hint, /with the line that proves each hop/);
  const whoCalls = hint.split('\n').find((l) => l.startsWith('`who_calls`'))!;
  assert.match(whoCalls, /trace_flow/, 'who_calls points at trace_flow for how X reaches Y');
  const topo = hint.split('\n').find((l) => l.startsWith('`read_topology`'))!;
  assert.match(topo, /trace_flow/, 'read_topology points at trace_flow for the rest of its edges');
  assert.match(ASK_TOOL_REGISTRY.trace_flow.description, /how one part flows into the next, in order, with the line that proves each hop/i);
});

test('a bare trace_flow call pasted into prose is salvaged like the other read tools', () => {
  const text = 'Tracing it now {"id":"t1","name":"trace_flow","args":{"from":"gateway/src/routes/orders.ts"}} then drawing.';
  const { requests } = salvageBareToolRequests(text);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.name, 'trace_flow');
  assert.deepStrictEqual(requests[0]!.args, { from: 'gateway/src/routes/orders.ts' });
});

/* ====================================================== malformed fences === */

test('A MALFORMED TOOL BLOCK IS REPORTED, NOT DROPPED', () => {
  /*
   * It used to be stripped from the answer and silently discarded: no request,
   * no error, nothing in the round's results. Weak local models emit
   * slightly-off tool JSON constantly, and every one of those was a turn where
   * the request vanished and the user got a short answer citing a file nothing
   * had read.
   */
  const broken =
    'Let me look.\n\n```sequence-tool\n{"id":"t1","name":"read_file" "args":{"path":"a.ts"}}\n```\n\nDone.';
  const parsed = parseFencedToolRequests(broken);
  assert.strictEqual(parsed.requests.length, 0);
  assert.strictEqual(parsed.malformed.length, 1);
  assert.match(parsed.malformed[0], /not valid JSON/);
  assert.match(parsed.malformed[0], /SINGLE JSON object with keys id, name, args/);
});

test('the two repairs are reversals of known damage, and nothing else is guessed', () => {
  const trailingComma =
    '```sequence-tool\n{"id":"t1","name":"read_file","args":{"path":"a.ts"},}\n```';
  const repaired = parseFencedToolRequests(trailingComma);
  assert.strictEqual(repaired.requests.length, 1, 'a trailing comma is recovered');
  assert.strictEqual(repaired.malformed.length, 0);

  const structural = '```sequence-tool\n{"id":"t1"\n```';
  const notRepaired = parseFencedToolRequests(structural);
  assert.strictEqual(notRepaired.requests.length, 0);
  assert.strictEqual(notRepaired.malformed.length, 1, 'structural damage stays reported');
});

test('a block naming a tool that does not exist is told which tools do', () => {
  const wrong = '```sequence-tool\n{"id":"t1","name":"grep","args":{"q":"x"}}\n```';
  const parsed = parseFencedToolRequests(wrong);
  assert.strictEqual(parsed.requests.length, 0);
  assert.match(parsed.malformed[0], /"grep", which is not a tool/);
  assert.match(parsed.malformed[0], /read_file/);
});

test('THE PIPELINE SPENDS ONE ROUND FIXING A MALFORMED BLOCK', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-belt-repo-'));
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });

  const prompts: string[] = [];
  let call = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    prompts.push(prompt);
    call += 1;
    if (call === 1) {
      return {
        text: 'Reading.\n\n```sequence-tool\n{"id":"t1","name":"read_file" "args":{"path":"gateway/src/routes/orders.ts"}}\n```',
      };
    }
    return { text: 'The orders route is in gateway/src/routes/orders.ts.' };
  };

  const input: AskPipelineInput = {
    question: 'Where is the orders route?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };

  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.strictEqual(prompts.length, 2, 'the malformed block buys exactly one corrective round');
  assert.match(
    prompts[1],
    /### tool \(not executed\)/,
    "the model is told its block was not executed and why",
  );
  assert.match(prompts[1], /not valid JSON/);
  assert.ok(
    !result.text.includes('sequence-tool'),
    'and the broken fence never reaches the reader',
  );
});

/* ======================================================== evidence ledger === */

test('THE SAME FILE IS NOT PAID FOR TWICE — one copy, dated by its latest fetch', async () => {
  /*
   * MEASURED, driving this pipeline against a local ornith:9b on the real
   * Sequence monorepo: the model called `read_file` on the same path with the
   * same arguments in four consecutive rounds. The per-turn cache stopped the
   * disk reads, but each hit still pushed the SAME 12,000-character body onto
   * the evidence ledger, so the prompt grew by that much every round —
   * 53,575 characters at round one, 103,091 by round six, for one file read
   * once. Nothing said "you already ran this", so nothing discouraged it.
   */
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-ledger-'));
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const target = 'gateway/src/routes/orders.ts';
  const marker = fs.readFileSync(path.join(root, target), 'utf8').split('\n')[0];

  const prompts: string[] = [];
  let call = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    prompts.push(prompt);
    call += 1;
    if (call <= 3) {
      return {
        text: 'looking',
        toolRequests: [{ id: `t${call}`, name: 'read_file', args: { path: target } }],
      };
    }
    return { text: 'The orders route handles POST /orders.' };
  };

  const input: AskPipelineInput = {
    question: 'How does the gateway route orders in the source code?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };

  await runAskPipeline(input, () => {});

  assert.ok(prompts.length >= 4, 'the model asked three times and then answered');
  const last = prompts[prompts.length - 1];
  /* Count inside the TOOL RESULTS section only — FILE RESEARCH renders the same
     header for its own opening excerpt, and that copy is not the ledger. */
  const toolSection = last.slice(last.indexOf('TOOL RESULTS'));
  const occurrences = toolSection.split(`### ${target}`).length - 1;
  assert.strictEqual(
    occurrences,
    1,
    `one read must appear once in the ledger, not once per request (found ${occurrences})`,
  );
  assert.ok(last.includes(marker), 'and the body is still there — nothing was dropped');

  /* The ledger stops growing once the model is only re-asking for what it has. */
  const growth = prompts[3].length - prompts[2].length;
  assert.ok(
    growth < 500,
    `a repeated identical read must not re-charge its body (grew ${growth} chars)`,
  );
  assert.match(
    last,
    /you already ran this exact call this turn/,
    'and the model is told that it did, rather than handed identical bytes in silence',
  );
});
