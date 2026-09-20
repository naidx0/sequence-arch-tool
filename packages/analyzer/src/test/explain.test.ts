import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import {
  buildPlainTree,
  buildStructuralTree,
  buildDigest,
  buildAskPrompt,
  buildDesignAskPrompt,
  parseAiTree,
  isShowOnBoardAsk,
  isFigureItOutAsk,
} from '../explain/explain.js';
import { validSourceRefs, isPureGroup, type PlainNode } from '../explain/plaintree.js';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import type { ArchGraph, ArchNode, ArchEdge, EdgeKind } from '@sequence/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> analyzer
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const CLI = path.join(ANALYZER_ROOT, 'dist', 'cli.js');
const TEST_KEY = 'sk-ant-test-EXPLAIN-SECRET-1234';

/** Every non-group node must carry at least one sourceRef that is a real id/path. */
function assertHonest(node: PlainNode, valid: Set<string>): void {
  if (!isPureGroup(node.kind)) {
    assert.ok(node.sourceRefs.length > 0, `node ${node.id} (${node.kind}) must have a sourceRef`);
    for (const ref of node.sourceRefs) {
      assert.ok(valid.has(ref), `sourceRef ${ref} on ${node.id} must be a real source`);
    }
  }
  for (const c of node.children) assertHonest(c, valid);
}

/** Deep-strip volatile fields for a stable snapshot (there are none, but be safe). */
function stable(node: PlainNode): unknown {
  return JSON.parse(JSON.stringify(node));
}

/* ================================================= deterministic fallback == */

test('structural fallback: readable areas, honest sourceRefs, stable across runs', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);

  const a = buildStructuralTree(graph);
  const b = buildStructuralTree(graph);
  // Deterministic: byte-identical across runs.
  assert.deepStrictEqual(stable(a), stable(b));

  // Root traces to the repo.
  assert.strictEqual(a.kind, 'group');
  assert.deepStrictEqual(a.sourceRefs, ['repo']);

  // Top level is human-readable AREAS, not raw service names.
  const areaTitles = a.children.map((c) => c.title);
  assert.deepStrictEqual(areaTitles, ['Frontend', 'Backend', 'Data']);
  for (const c of a.children) assert.strictEqual(c.kind, 'area');

  // Every non-group node traces back to a real source id/path.
  assertHonest(a, valid);

  // The frontend service is grouped under Frontend and traces to svc:frontend.
  const frontend = a.children.find((c) => c.title === 'Frontend')!;
  assert.ok(frontend.children.some((s) => s.sourceRefs.includes('svc:frontend')));

  // The Data area surfaces the postgres datastore.
  const data = a.children.find((c) => c.title === 'Data')!;
  assert.ok(data.children.some((d) => d.sourceRefs.includes('ds:postgres')));

  // edgeRefs reference only real edges (the frontend->backend http edge crosses).
  const realEdgeIds = new Set(graph.edges.map((e) => e.id));
  const collectEdges = (n: PlainNode): void => {
    for (const id of n.edgeRefs ?? []) assert.ok(realEdgeIds.has(id), `edgeRef ${id} must be real`);
    n.children.forEach(collectEdges);
  };
  collectEdges(a);
  assert.ok((frontend.edgeRefs ?? []).length > 0, 'Frontend area should have a crossing edge');
});

test('buildPlainTree with no provider yields mode:structural', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const result = await buildPlainTree(graph, {});
  assert.strictEqual(result.mode, 'structural');
  assert.strictEqual(result.tree.kind, 'group');
});

/* ==================================== v9 Phase 3b: Recommended vs Best-fit == */

test('LOCK: the recommended profile is byte-identical to the default structural tree', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  // The default (no profile) and the explicit 'recommended' profile must be
  // byte-for-byte identical — Recommended stays exactly today's output.
  const def = buildStructuralTree(graph);
  const rec = buildStructuralTree(graph, 'recommended');
  assert.deepStrictEqual(stable(def), stable(rec));
  // Same through buildPlainTree (keyless): mode structural, recommended profile.
  const viaBuild = await buildPlainTree(graph, {});
  assert.deepStrictEqual(stable(viaBuild.tree), stable(def));
  assert.strictEqual(viaBuild.profile ?? 'recommended', 'recommended');
  // Titles are still the classic Frontend/Backend/Data areas.
  assert.deepStrictEqual(def.children.map((c) => c.title), ['Frontend', 'Backend', 'Data']);
});

/* ============================ v9 Phase 4: Regular vs Advanced detail level == */

test('LOCK: detailLevel "regular" is byte-identical to the default (no detailLevel)', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  // The default (no detailLevel) and the explicit 'regular' level must be
  // byte-for-byte identical — Regular stays exactly today's Phase-3b output.
  const def = buildStructuralTree(graph);
  const reg = buildStructuralTree(graph, 'recommended', 'regular');
  assert.deepStrictEqual(stable(def), stable(reg));
  // Same for best-fit: regular === default best-fit.
  const bfDef = buildStructuralTree(graph, 'bestfit');
  const bfReg = buildStructuralTree(graph, 'bestfit', 'regular');
  assert.deepStrictEqual(stable(bfDef), stable(bfReg));
  // Through buildPlainTree (keyless): explicit regular === default.
  const viaDefault = await buildPlainTree(graph, {});
  const viaRegular = await buildPlainTree(graph, { detailLevel: 'regular' });
  assert.deepStrictEqual(stable(viaRegular.tree), stable(viaDefault.tree));
});

test('advanced detail level: same node SET + real sourceRefs, denser technical text', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);
  const regular = buildStructuralTree(graph, 'recommended', 'regular');
  const advanced = buildStructuralTree(graph, 'recommended', 'advanced');

  // Deterministic.
  assert.deepStrictEqual(stable(advanced), stable(buildStructuralTree(graph, 'recommended', 'advanced')));

  // Honesty holds: every non-group node still traces to a REAL source id/path.
  assertHonest(advanced, valid);

  // The node SET is IDENTICAL — advanced only changes text, never structure.
  const ids = (n: PlainNode, acc: string[]): string[] => {
    acc.push(n.id);
    n.children.forEach((c) => ids(c, acc));
    return acc;
  };
  assert.deepStrictEqual(ids(advanced, []).sort(), ids(regular, []).sort());
  // Same set of real sourceRefs — nothing added or dropped.
  const refs = (n: PlainNode, acc: Set<string>): Set<string> => {
    for (const r of n.sourceRefs) acc.add(r);
    n.children.forEach((c) => refs(c, acc));
    return acc;
  };
  assert.deepStrictEqual([...refs(advanced, new Set())].sort(), [...refs(regular, new Set())].sort());

  // But the TEXT differs: at least one node's title/summary changed (raw technical
  // names instead of humanized ones), so advanced is genuinely denser.
  const byId = (n: PlainNode, m: Map<string, PlainNode>): Map<string, PlainNode> => {
    m.set(n.id, n);
    n.children.forEach((c) => byId(c, m));
    return m;
  };
  const regMap = byId(regular, new Map());
  const advMap = byId(advanced, new Map());
  let changed = false;
  for (const [id, a] of advMap) {
    const r = regMap.get(id)!;
    if (a.title !== r.title || a.summary !== r.summary) changed = true;
  }
  assert.ok(changed, 'advanced must render denser/technical text on at least one node');

  // Concretely: a backend service keeps its RAW label as the title in advanced.
  const svc = graph.nodes.find((n) => n.id === 'svc:backend')!;
  const advSvc = advMap.get('p:svc:backend')!;
  assert.strictEqual(advSvc.title, svc.label, 'advanced service title is the raw label (no humanize)');
});

test('best-fit profile re-buckets the SAME real nodes under type-appropriate areas', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);
  const result = await buildPlainTree(graph, { profile: 'bestfit' });

  assert.strictEqual(result.mode, 'structural');
  assert.strictEqual(result.profile, 'bestfit');
  // plainapp is 2 services → microservices.
  assert.strictEqual(result.projectType, 'microservices');
  assert.match(result.tree.summary ?? '', /^Best-fit: microservices/);

  // Deterministic.
  assert.deepStrictEqual(stable(result.tree), stable(buildStructuralTree(graph, 'bestfit')));

  // Honesty holds: every non-group node still traces to a REAL source id/path.
  assertHonest(result.tree, valid);

  // microservices explodes each service into its own top-level area, all real.
  const realNodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const area of result.tree.children) {
    for (const ref of area.sourceRefs) {
      assert.ok(realNodeIds.has(ref) || valid.has(ref), `area ref ${ref} must be real`);
    }
  }
  // Best-fit references the SAME set of real source ids as recommended (nothing
  // added or dropped — only regrouped/relabeled).
  const collect = (n: PlainNode, acc: Set<string>): void => {
    for (const r of n.sourceRefs) acc.add(r);
    n.children.forEach((c) => collect(c, acc));
  };
  const recRefs = new Set<string>();
  const bfRefs = new Set<string>();
  collect(buildStructuralTree(graph, 'recommended'), recRefs);
  collect(result.tree, bfRefs);
  assert.deepStrictEqual([...bfRefs].sort(), [...recRefs].sort());
});

/* ============================================================ AI path ======= */

/** A hand-authored PlainTree the "model" returns, referencing REAL ids only. */
function goodAiTree(graph: ArchGraph): unknown {
  const svc = graph.nodes.find((n) => n.id === 'svc:backend')!;
  const file = graph.nodes.find((n) => n.kind === 'file' && n.parentId === 'svc:backend')!;
  return {
    tree: {
      id: 'root',
      title: 'Notes App',
      summary: 'A little notes application.',
      kind: 'group',
      sourceRefs: ['repo'],
      children: [
        {
          id: 'a1',
          title: 'Behind the scenes',
          kind: 'area',
          sourceRefs: ['svc:backend'],
          children: [
            {
              id: 's1',
              title: 'Notes API',
              summary: 'Stores and serves notes.',
              kind: 'service',
              sourceRefs: [svc.id],
              children: [
                { id: 'f1', title: 'The notes endpoints', kind: 'file', sourceRefs: [file.id], children: [] },
              ],
            },
          ],
        },
      ],
    },
  };
}

test('AI path: parseAiTree accepts a good tree and keeps only real refs', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);
  const tree = parseAiTree(JSON.stringify(goodAiTree(graph)), graph, valid);
  assert.ok(tree, 'a valid AI tree parses');
  assert.strictEqual(tree!.title, 'Notes App');
  assertHonest(tree!, valid);
});

test('honesty lock: a BOGUS sourceRef (not in the structure) is stripped/repaired', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);
  // A tree that invents a fake service id AND a fake file, but also keeps one real ref.
  const bogus = {
    tree: {
      id: 'root',
      title: 'App',
      kind: 'group',
      sourceRefs: ['repo'],
      children: [
        {
          id: 'a',
          title: 'Made-up area',
          kind: 'area',
          sourceRefs: ['svc:backend'],
          children: [
            // invented service — maps to nothing real, must be DROPPED
            { id: 'ghost', title: 'Ghost service', kind: 'service', sourceRefs: ['svc:DOES_NOT_EXIST'], children: [] },
            // real service, but with one invented + one real ref → invented stripped
            {
              id: 'real',
              title: 'Real service',
              kind: 'service',
              sourceRefs: ['svc:backend', 'file:phantom/nope.py'],
              children: [],
            },
          ],
        },
      ],
    },
  };
  const tree = parseAiTree(JSON.stringify(bogus), graph, valid);
  assert.ok(tree, 'the tree still parses (one real ref survives)');
  // No invented id survives anywhere.
  const allRefs: string[] = [];
  const walk = (n: PlainNode) => {
    allRefs.push(...n.sourceRefs);
    n.children.forEach(walk);
  };
  walk(tree!);
  assert.ok(!allRefs.includes('svc:DOES_NOT_EXIST'), 'invented service id stripped');
  assert.ok(!allRefs.includes('file:phantom/nope.py'), 'invented file id stripped');
  // The ghost service (no real ref, no children) is dropped entirely.
  const area = tree!.children[0];
  assert.ok(!area.children.some((c) => c.title === 'Ghost service'), 'ghost node dropped');
  assert.ok(area.children.some((c) => c.title === 'Real service'), 'real node kept');
  assertHonest(tree!, valid);
});

test('honesty lock: an all-invented tree falls back (coverage 0 → undefined)', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);
  const allFake = {
    tree: {
      id: 'root',
      title: 'Fabricated',
      kind: 'group',
      sourceRefs: ['repo'],
      children: [
        { id: 'x', title: 'Invented', kind: 'area', sourceRefs: ['svc:NOPE'], children: [] },
      ],
    },
  };
  const tree = parseAiTree(JSON.stringify(allFake), graph, valid);
  assert.strictEqual(tree, undefined, 'a tree covering no real structure is rejected');
});

test('honesty lock: a no-sourceRef bucket that claims a DETECTED kind is coerced to a grouping kind', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const valid = validSourceRefs(graph);
  const svcFile = graph.nodes.find((n) => n.kind === 'file' && n.parentId === 'svc:backend')!;
  // The model groups a real file under an intermediate node that claims kind
  // 'service' (a DETECTED kind) but carries NO real sourceRef of its own — it is a
  // pure grouping bucket. It must survive (it has a real child) but must NOT keep a
  // detected kind, or it would render a "detected"-looking service marker for
  // something the scanner never found (honesty review F2).
  const tree = parseAiTree(
    JSON.stringify({
      tree: {
        id: 'root',
        title: 'App',
        kind: 'group',
        sourceRefs: ['repo'],
        children: [
          {
            id: 'bucket',
            title: 'Invented Service',
            kind: 'service', // detected-sounding, but…
            sourceRefs: [], // …no real backing of its own
            children: [
              { id: 'f', title: 'A real file', kind: 'file', sourceRefs: [svcFile.id], children: [] },
            ],
          },
        ],
      },
    }),
    graph,
    valid
  );
  assert.ok(tree, 'the tree survives (its bucket has a real child)');
  const bucket = tree!.children.find((c) => c.title === 'Invented Service')!;
  assert.ok(bucket, 'the grouping bucket is kept');
  assert.strictEqual(bucket.sourceRefs.length, 0, 'the bucket still has no real sourceRef');
  assert.strictEqual(bucket.kind, 'area', 'a no-ref bucket is coerced to the grouping kind "area", never a detected kind');
  // The real child keeps its real kind + ref.
  assert.strictEqual(bucket.children[0].kind, 'file');
  assert.deepStrictEqual(bucket.children[0].sourceRefs, [svcFile.id]);
});

test('buildPlainTree AI path uses the injected provider and returns mode:ai', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  let sawDigest = false;
  const result = await buildPlainTree(graph, {
    provider: { provider: 'anthropic', model: 'x', apiKey: 'k' },
    callProvider: async (_cfg, prompt) => {
      // The prompt carries the compact digest with real ids.
      if (prompt.includes('svc:backend') && prompt.includes('STRUCTURE DIGEST')) sawDigest = true;
      return JSON.stringify(goodAiTree(graph));
    },
  });
  assert.ok(sawDigest, 'the provider prompt included the structure digest');
  assert.strictEqual(result.mode, 'ai');
  assert.strictEqual(result.provider, 'anthropic');
  assert.strictEqual(result.tree.title, 'Notes App');
});

test('buildPlainTree falls back to structural when the provider throws', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const result = await buildPlainTree(graph, {
    provider: { provider: 'anthropic', model: 'x', apiKey: 'k' },
    callProvider: async () => {
      throw new Error('boom');
    },
  });
  assert.strictEqual(result.mode, 'structural');
});

test('buildDigest is bounded and carries real ids only', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const digest = buildDigest(graph);
  const realIds = new Set(graph.nodes.map((n) => n.id));
  for (const s of digest.services) assert.ok(realIds.has(s.id));
  for (const e of digest.edges) {
    assert.ok(realIds.has(e.from) || e.from === 'repo');
  }
});

/* ============================================================ endpoint ====== */

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-explain-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

test('/api/explain: 409 with no repo attached', async () => {
  const { base, close } = await startServer(null as unknown as string);
  try {
    const res = await fetch(`${base}/api/explain`, { method: 'POST' });
    assert.strictEqual(res.status, 409);
  } finally {
    await close();
  }
});

test('/api/explain: no provider → mode:structural', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    const res = await fetch(`${base}/api/explain`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { mode: string; tree: PlainNode };
    assert.strictEqual(body.mode, 'structural');
    assert.deepStrictEqual(body.tree.children.map((c) => c.title), ['Frontend', 'Backend', 'Data']);
    // cached to .sequence/explain.json
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'explain.json')), 'explain cached to disk');
  } finally {
    await close();
  }
});

test('/api/explain: detailLevel folds into the cache key (4 combos never collide)', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  const dir = path.join(repo, '.sequence');
  const call = async (body?: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    assert.strictEqual(res.status, 200);
    return (await res.json()) as { tree: PlainNode; detailLevel?: string; profile?: string };
  };
  try {
    // Body-less / regular stays in explain.json (pre-Phase-4 filename unchanged).
    const reg = await call();
    assert.ok(fs.existsSync(path.join(dir, 'explain.json')), 'recommended+regular → explain.json');
    // Advanced lands in its own sibling file, NOT explain.json.
    const adv = await call({ detailLevel: 'advanced' });
    assert.strictEqual(adv.detailLevel, 'advanced');
    assert.ok(fs.existsSync(path.join(dir, 'explain.advanced.json')), 'recommended+advanced → explain.advanced.json');
    // Best-fit × both levels each get their own file.
    await call({ profile: 'bestfit' });
    assert.ok(fs.existsSync(path.join(dir, 'explain.bestfit.json')), 'bestfit+regular → explain.bestfit.json');
    await call({ profile: 'bestfit', detailLevel: 'advanced' });
    assert.ok(
      fs.existsSync(path.join(dir, 'explain.bestfit.advanced.json')),
      'bestfit+advanced → explain.bestfit.advanced.json'
    );
    // Advanced differs from regular (raw service label as title) — no collision.
    const advSvc = (function find(n: PlainNode): PlainNode | undefined {
      if (n.id === 'p:svc:backend') return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return undefined;
    })(adv.tree);
    const regSvc = (function find(n: PlainNode): PlainNode | undefined {
      if (n.id === 'p:svc:backend') return n;
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return undefined;
    })(reg.tree);
    assert.ok(advSvc && regSvc, 'both trees carry the backend service node');
    assert.notStrictEqual(advSvc!.title, regSvc!.title, 'advanced/regular titles differ (cache did not collide)');
  } finally {
    await close();
  }
});

test('/api/explain: with the mock provider → mode:ai, cached; bogus refs stripped over HTTP', async () => {
  const repo = plainappRepo();
  const graph = await scanRepo(repo, { cluster: true });
  // Mock returns a tree that references real ids PLUS an invented one.
  const svcFile = graph.nodes.find((n) => n.kind === 'file' && n.parentId === 'svc:backend')!;
  const aiTree = {
    tree: {
      id: 'root',
      title: 'Notes App',
      summary: 'A notes app.',
      kind: 'group',
      sourceRefs: ['repo'],
      children: [
        {
          id: 'a',
          title: 'The server side',
          kind: 'area',
          sourceRefs: ['svc:backend'],
          children: [
            {
              id: 's',
              title: 'Notes service',
              kind: 'service',
              sourceRefs: ['svc:backend'],
              children: [
                { id: 'f', title: 'Notes endpoints', kind: 'file', sourceRefs: [svcFile.id], children: [] },
                // invented — must be stripped, node dropped
                { id: 'ghost', title: 'Phantom', kind: 'file', sourceRefs: ['file:ghost.py'], children: [] },
              ],
            },
          ],
        },
      ],
    },
  };
  const mock = await startMockProvider(() => ({ text: JSON.stringify(aiTree) }));
  const { base, close } = await startServer(repo);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const res = await fetch(`${base}/api/explain`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { mode: string; provider?: string; tree: PlainNode };
    assert.strictEqual(body.mode, 'ai');
    assert.strictEqual(body.provider, 'anthropic');
    assert.strictEqual(body.tree.title, 'Notes App');
    assert.strictEqual(mock.requests.length, 1, 'the provider was called over real HTTP');

    // The invented "Phantom" file was stripped out.
    const allTitles: string[] = [];
    const walk = (n: PlainNode) => {
      allTitles.push(n.title);
      n.children.forEach(walk);
    };
    walk(body.tree);
    assert.ok(!allTitles.includes('Phantom'), 'invented node stripped end-to-end');
    assert.ok(allTitles.includes('Notes endpoints'), 'real relabeled node kept');

    // Cached with mode ai.
    const cached = JSON.parse(fs.readFileSync(path.join(repo, '.sequence', 'explain.json'), 'utf8'));
    assert.strictEqual(cached.mode, 'ai');

    // Second call serves from cache — no new provider hop.
    const res2 = await fetch(`${base}/api/explain`, { method: 'POST' });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(mock.requests.length, 1, 'cached: provider not called again');

    // A rescan invalidates the cache (new scannedAt) → provider called again.
    await fetch(`${base}/api/scan`, { method: 'POST' });
    const res3 = await fetch(`${base}/api/explain`, { method: 'POST' });
    assert.strictEqual(res3.status, 200);
    assert.strictEqual(mock.requests.length, 2, 'rescan invalidated the cache');
  } finally {
    await close();
    await mock.close();
  }
});

/* ================================================================ CLI ======= */

test('CLI explain prints a non-empty indented outline, exit 0', () => {
  const out = execFileSync('node', [CLI, 'explain', PLAINAPP], { encoding: 'utf8' });
  assert.match(out, /# Plainapp/);
  assert.match(out, /Frontend/);
  assert.match(out, /Backend/);
  assert.match(out, /structural translation/);
  // indentation present (nested lines start with spaces)
  assert.ok(out.split('\n').some((l) => /^ {2,}/.test(l)), 'outline is indented');
});

/* ==================================================== buildAskPrompt (U2) === */

test('buildAskPrompt: register-matching adaptivity clause is present', () => {
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'be terse and technical');
  // U2: mirror the user's register/length/format instead of one canned voice.
  assert.match(prompt, /Match the user's register, length, and format/i);
  assert.match(prompt, /mirror their level/i);
  // Default-to-terse (output economy) rather than a fixed "plain English" voice.
  assert.match(prompt, /default to concise, structured notes/i);
});

test('buildAskPrompt: THE PROMPT AND THE TRANSCRIPT AGREE ON WHAT IS FORMATTING', () => {
  /*
   * They did not. The register clause asked for "short BULLETS over prose
   * walls" while web2/src/chat/proseBlocks.ts refuses bullets - and headings,
   * bold, quotes and tables - deliberately, because a markdown bullet is "- "
   * and a diff removal line is "- " just as often, and this product's answers
   * are full of diffs.
   *
   * Neither half was wrong on its own. Together they put screens of literal
   * #### and ** in front of the owner on 2026-08-24. This test holds the pair
   * together: the prompt must ask for the two constructs the surface actually
   * renders, and must not ask for any of the ones it refuses.
   */
  const digest = { services: [], datastores: [], topics: [], files: [], edges: [] } as never;
  const prompt = buildAskPrompt(digest, 'explain the gateway');

  assert.match(prompt, /FORMAT FOR THE SURFACE YOU ARE ON/);
  assert.match(prompt, /fenced code blocks and inline code spans, and NOTHING ELSE/);
  assert.match(prompt, /Never write a bullet/i);
  assert.match(prompt, /Never wrap text in double asterisks/i);
  assert.match(prompt, /Never open a line with a # heading marker/i);

  /*
   * THE CONTRADICTION MUST NOT COME BACK. Asserting the new clause is present
   * would still pass if somebody re-added "short bullets" three lines above it,
   * which is exactly how this defect was born.
   */
  assert.doesNotMatch(
    prompt,
    /short bullets/i,
    'the prompt is asking for bullets again, and the transcript still renders them literally',
  );
});

test('buildDesignAskPrompt: the format clause reaches the DESIGN prompt too', () => {
  /*
   * Same transcript, same renderer. A rule covering only one of the two ask
   * paths leaves the other free to emit markdown nothing will render - and the
   * design path is the half the owner actually hit, since "design me a system
   * from scratch" is what he asked.
   *
   * The first version of this test called buildAskPrompt with a design-shaped
   * QUESTION, which routes nowhere near buildDesignAskPrompt: it asserted the
   * ask path twice and passed while the design path had no rule at all. The
   * mutant that strips the clause from the design builder is what caught it.
   */
  const outline = ['Recipe Box', '  Frontend', '  Data'].join(String.fromCharCode(10));
  const design = buildDesignAskPrompt({ title: 'Recipe Box', outline }, 'design me a system');
  assert.match(design, /FORMAT FOR THE SURFACE YOU ARE ON/);
  assert.doesNotMatch(design, /short bullets/i);
});

test('buildAskPrompt: grounding/no-invention honesty clause is STILL intact', () => {
  // This locks the intent: adaptivity must NOT be added by dropping the honesty
  // clause — both must coexist. If a future edit removes the grounding rule to make
  // room for register-matching, this fails.
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'anything');
  assert.match(prompt, /using ONLY that real structure/);
  assert.match(prompt, /Do NOT invent/);
  assert.match(prompt, /if the answer is not[\s\S]*determinable[\s\S]*say so plainly/i);
});

/* ============================== precomputed risk facts in the digest (moat) === */

function riskNode(id: string, kind: ArchNode['kind'], label: string, parentId?: string): ArchNode {
  return { id, kind, label, ...(parentId ? { parentId } : {}) };
}

function riskEdge(srcId: string, dstId: string, kind: EdgeKind = 'http'): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'f', line: 1, snippet: 's' }],
  };
}

function riskGraph(nodes: ArchNode[], edges: ArchEdge[]): ArchGraph {
  return { version: 1, scannedAt: '', repoRoot: '', repoName: 'shop', nodes, edges, warnings: [] };
}

test('buildDigest: carries a precomputed SPOF with the correct GROUNDED blast radius', () => {
  // 4 services each write one shared datastore → postgres is the classic shared-DB
  // SPOF: its service-level blast radius is 4 of 5 rankable components (critical).
  // File→file edges lift to service→datastore edges; the count must be verbatim.
  const nodes: ArchNode[] = [
    riskNode('repo', 'repo', 'shop'),
    riskNode('ds:pg', 'datastore', 'postgres', 'repo'),
    riskNode('svc:orders', 'service', 'orders', 'repo'),
    riskNode('f:orders', 'file', 'main.py', 'svc:orders'),
    riskNode('svc:payments', 'service', 'payments', 'repo'),
    riskNode('f:payments', 'file', 'index.js', 'svc:payments'),
    riskNode('svc:shipping', 'service', 'shipping', 'repo'),
    riskNode('f:shipping', 'file', 'main.go', 'svc:shipping'),
    riskNode('svc:invoices', 'service', 'invoices', 'repo'),
    riskNode('f:invoices', 'file', 'Invoice.java', 'svc:invoices'),
  ];
  const edges: ArchEdge[] = [
    riskEdge('f:orders', 'ds:pg', 'db_access'),
    riskEdge('f:payments', 'ds:pg', 'db_access'),
    riskEdge('f:shipping', 'ds:pg', 'db_access'),
    riskEdge('f:invoices', 'ds:pg', 'db_access'),
  ];
  const digest = buildDigest(riskGraph(nodes, edges));
  assert.ok(digest.risks, 'digest carries a risks section');
  assert.strictEqual(digest.risks!.total, 5); // 4 services + 1 datastore (repo excluded)
  const pg = digest.risks!.spofs.find((s) => s.node === 'postgres');
  assert.ok(pg, 'postgres is a precomputed SPOF');
  assert.strictEqual(pg!.kind, 'datastore');
  assert.strictEqual(pg!.breaks, 4); // GROUNDED: exactly the 4 dependents, verbatim
  assert.strictEqual(pg!.of, 5);
});

test('buildDigest: a clean DAG has an empty precomputed cycles list', () => {
  // Linear a → b → c at the service level: no strongly-connected component.
  const nodes: ArchNode[] = [
    riskNode('repo', 'repo', 'shop'),
    riskNode('svc:a', 'service', 'a', 'repo'),
    riskNode('f:a', 'file', 'a.ts', 'svc:a'),
    riskNode('svc:b', 'service', 'b', 'repo'),
    riskNode('f:b', 'file', 'b.ts', 'svc:b'),
    riskNode('svc:c', 'service', 'c', 'repo'),
    riskNode('f:c', 'file', 'c.ts', 'svc:c'),
  ];
  const edges: ArchEdge[] = [riskEdge('f:a', 'f:b'), riskEdge('f:b', 'f:c')];
  const digest = buildDigest(riskGraph(nodes, edges));
  assert.ok(digest.risks);
  assert.deepStrictEqual(digest.risks!.cycles, []);
});

test('buildAskPrompt: risks-citation instruction is present AND the r19 grounding + register clauses are STILL intact', () => {
  // Lock all three together so a future edit can't drop grounding to make room for
  // the new risks clause: the moat clause ADDS to, never replaces, r19.
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'what is fragile?');
  // NEW risks-citation instruction (cite the precomputed section, don't recompute).
  assert.match(prompt, /precomputed `risks` section/);
  assert.match(prompt, /single points of failure/i);
  assert.match(prompt, /do NOT derive, estimate, or recompute blast[\s\S]*radius or cycles yourself/);
  // r19 GROUNDING clause — byte-preserved.
  assert.match(prompt, /Answer the question using ONLY that real structure\. Do NOT invent/);
  // r19 REGISTER clause — byte-preserved.
  assert.match(prompt, /Match the user's register, length, and format/);
});

test('buildAskPrompt: r-E3 file-list summary clause is present AND the r19/risks clauses are STILL intact', () => {
  // Owner screenshots: an answer enumerated ~15 full file paths as a flat
  // bullet list. Lock the new clause alongside the ones it must not crowd
  // out — same discipline as the risks-citation test above.
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'what files handle payments?');
  // NEW file-list summary instruction: summarise a homogeneous group instead
  // of enumerating, but still cite real, grounded evidence for it.
  assert.match(prompt, /more than about four files of the same kind/);
  assert.match(prompt, /do NOT enumerate them as a flat bullet list/);
  assert.match(prompt, /Summarise the group instead/);
  assert.match(prompt, /Never invent a folder or a count that is not actually in the digest/);
  // …a short, heterogeneous list is still named individually — the clause
  // must not push the model toward summarising everything.
  assert.match(prompt, /A short, heterogeneous list[\s\S]*should still be named individually/);
  // The clauses it must not crowd out.
  assert.match(prompt, /precomputed `risks` section/);
  assert.match(prompt, /Answer the question using ONLY that real structure\. Do NOT invent/);
  assert.match(prompt, /Match the user's register, length, and format/);
});

test('buildAskPrompt: additive requests teach the propose_topology TOOL, not a fence nothing reads', () => {
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'add a frontend service');

  /*
   * ── REDIRECTED, AND THIS ONE PINNED A REAL DEFECT IN PLACE ──────────────
   *
   * These assertions used to require the prompt to teach a ```seqd FENCE —
   * "MUST be valid JSON only", "as a NUMBER", the inline example object. Every
   * one of them passed, and NO CODE ANYWHERE PARSED THAT FENCE. The board's
   * ghost layer sat behind `canvas/proposal`, which was dispatched by nothing,
   * so the product spent tokens every single additive turn asking models to
   * produce architecture in a format it could not read.
   *
   * MEASURED rather than reasoned about: `tools/bench/weak-model.mjs` ran a
   * local 6.9B model against the old instruction and it complied perfectly —
   * a fenced SeqDiagram with "origin":"design" and two invented services,
   * sitting in the prose where nothing would ever pick it up. The model was
   * not the problem. The instruction was.
   *
   * The channel is `propose_topology` now, and these assert THAT — plus the
   * honesty rules, which are unchanged and which the tool additionally
   * enforces by refusing a proposed node that carries evidence.
   */
  assert.match(prompt, /propose_topology/);
  assert.match(prompt, /CALL THE/);
  assert.match(prompt, /Accept\/Deny/);
  assert.match(prompt, /design:…|proposal:…/);
  assert.match(prompt, /Never refuse with "provide the JSON"/);

  /* Honest scope: this payload can only add nodes and edges. Restoring the old
     remove/rename/rewire promise must make this test red. */
  assert.match(prompt, /ADDITIONS ONLY/);
  assert.match(prompt, /cannot remove or rename nodes/i);
  assert.match(prompt, /cannot delete, replace, or rewire existing edges/i);
  assert.doesNotMatch(prompt, /asks to add, remove, rename, or rewire topology/);

  /* AND IT NO LONGER ASKS FOR THE FORMAT NOTHING READS. An absence assertion,
     so re-adding the fence instruction turns this red rather than passing
     alongside the tool. */
  assert.doesNotMatch(
    prompt.replace(/^.*propose_topology.*$/gm, ''),
    /emit .{0,20}```seqd fence with valid SeqDiagram/,
  );

  // STILL: do-not-invent-as-scanned honesty.
  assert.match(prompt, /Do NOT invent/);
  assert.match(prompt, /never describe proposal or design nodes as if they were scanned/);
  assert.match(prompt, /not in the digest/);
});

test('buildAskPrompt: whiteboard directive teaches proposal fences for sticky-wall asks', () => {
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'brainstorm on stickies');
  assert.match(prompt, /```whiteboard/);
  assert.match(prompt, /proposal:…/);
  assert.match(prompt, /Accept\/Deny/);
});

test('buildAskPrompt: skips whiteboard directive on ordinary attached Q&A', () => {
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as Parameters<typeof buildAskPrompt>[0];
  const prompt = buildAskPrompt(digest, 'what talks to the API?');
  assert.ok(!prompt.includes('```whiteboard'), 'ordinary Q&A must not pay whiteboard directive tokens');
});

/* ================================================== buildDesignAskPrompt === */

test('buildDesignAskPrompt: frames a DESIGN (not a scan) and allows English design description without NEVER cite', () => {
  const outline = ['Recipe Box', '  Frontend', '    Recipe list page', '  Data', '    Recipes database'].join('\n');
  const prompt = buildDesignAskPrompt({ title: 'Recipe Box', outline }, 'what is missing?');
  // The design outline IS the grounding context.
  assert.ok(prompt.includes(outline), 'the user design outline is carried verbatim');
  assert.match(prompt, /--- DESIGN: Recipe Box ---/);
  assert.match(prompt, /--- QUESTION ---\nwhat is missing\?$/);
  // DESIGN framing — nothing here was scanned.
  assert.match(prompt, /DESIGNING/);
  assert.match(prompt, /not a scan of real code/);
  // HONESTY: no fabricated scan evidence, no invented blocks.
  assert.match(prompt, /Never claim anything is implemented, detected, or verified/);
  assert.doesNotMatch(prompt, /NEVER cite a file path/);
  assert.match(prompt, /do not invent file paths/);
  assert.match(prompt, /Never tell the user you cannot read files/);
  assert.match(prompt, /not in the\s+design/);
  // The repo-grounded path's structure digest must NOT appear repo-less.
  assert.ok(!prompt.includes('STRUCTURE DIGEST'), 'no scan digest is fabricated for a design');
  // Register clause is shared with buildAskPrompt.
  assert.match(prompt, /Match the user's register, length, and format/);
  // Design mode may emit seqd proposals with English labels + Accept/Deny.
  assert.match(prompt, /```seqd/);
  assert.match(prompt, /Accept\/Deny/);
  assert.match(prompt, /design:…|proposal:…/);
});

test('buildDesignAskPrompt: breakdown directive prefers deep board trees — expand detail.parts', () => {
  const prompt = buildDesignAskPrompt(
    { title: 'Agent', outline: '- break down a Hermes agent', proposeArchitecture: true },
    'break down a Hermes agent',
  );
  assert.match(prompt, /prefer ≥8/);
  assert.doesNotMatch(prompt, /do not expand every submodule as a top-level node/);
  assert.match(prompt, /expand those parts onto the board/);
  assert.match(prompt, /detail\.parts/);
});

test('buildDesignAskPrompt: an untitled design and a huge outline stay safe', () => {
  const huge = 'block\n'.repeat(20_000);
  const prompt = buildDesignAskPrompt({ title: '   ', outline: huge }, 'ok?');
  assert.match(prompt, /--- DESIGN: Untitled design ---/);
  assert.ok(prompt.length < 40_000, 'the outline is capped so a huge tree cannot blow the prompt');
});

test('ask directive source contract: shared host gate + breakdown correctness sentences', () => {
  const src = fs.readFileSync(path.join(ANALYZER_ROOT, 'src', 'explain', 'explain.ts'), 'utf8');
  assert.match(src, /const ASK_HOST_PROPOSAL_GATE/);
  assert.match(src, /detail\.whatItDoes/);
  assert.match(src, /detail\.parts/);
  assert.match(src, /meta\.diagramFamily/);
  assert.match(src, /layout\.direction "TD"/);
  assert.match(src, /explanatory top-down flowchart/);
  assert.match(src, /## Execution order/);
  assert.match(src, /NEVER markdown pipe tables/);
  // Tier-1: role-set examples moved to outline scaffold — not repeated in system directive.
  assert.doesNotMatch(src, /Storefront\/Orders\/Payments\/Inventory/);
  const breakdownPrompt = buildDesignAskPrompt(
    { title: 'Agent', outline: '- break down a Hermes agent', proposeArchitecture: true },
    'break down a Hermes agent',
  );
  assert.match(breakdownPrompt, /Host owns Accept\/Deny UI/);
  assert.match(breakdownPrompt, /Match modules to the domain hinted in the outline/);
});

test('buildDesignAskPrompt: financial-analysis ask gets clarifying questions + cost honesty before seqd', () => {
  const q =
    'Design a financial analysis program: 10 tickers, geo/news/financials, 9am and 12:30';
  const prompt = buildDesignAskPrompt(
    { title: 'Finance', outline: q, proposeArchitecture: true },
    q,
  );
  assert.match(prompt, /PREPARE BEFORE YOU PROPOSE/);
  assert.match(prompt, /tickers/);
  assert.match(prompt, /data sources|sources/i);
  assert.match(prompt, /which model/);
  assert.match(prompt, /Never invent a dollar cost/);
  assert.match(prompt, /Electricity for a local model is not a model-API bill/);
  assert.match(prompt, /do not emit a ```seqd/);
  assert.match(prompt, /MEMORY\.md/);
  assert.match(prompt, /Do not claim session MEMORY\.md/);
  const attached = buildAskPrompt(
    {
      repo: { id: 'repo', name: 'demo' },
      folders: [],
      services: [],
      datastores: [],
      topics: [],
      edges: [],
    } as Parameters<typeof buildAskPrompt>[0],
    q,
  );
  assert.match(attached, /PREPARE BEFORE YOU PROPOSE/);
  assert.match(attached, /Never invent a dollar cost/);
});

test('buildDesignAskPrompt: figure-it-out / map-it-out dumps seqd with assumptions, no second clarify round', () => {
  const q = 'Map it out — a coffee shop POS. Figure it out.';
  const prompt = buildDesignAskPrompt(
    { title: 'POS', outline: q, proposeArchitecture: true },
    q,
  );
  /*
   * ASSERTS THE CONTRACT THIS TEST IS NAMED FOR, NOT THE CONSTANT THAT USED TO
   * CARRY IT — and the change is declared because it was made to accommodate a
   * change in the source, which is the case where that must be said out loud.
   *
   * The contract is the test's own title: assumptions, then draw, and no second
   * clarify round. It was previously met by `ASK_FIGURE_IT_OUT_CLAUSE`, whose
   * text opens "If the user says figure it out, map it out, …". On 2026-09-08
   * that self-gating turned out to be why `--mode design` still interrogated the
   * owner: pushing the clause from the design path left the model reading a
   * condition it could see was unmet, and correctly skipping it. Design asks now
   * get `ASK_DESIGN_PROPOSE_NOW_CLAUSE`, which states the same three
   * requirements with no condition to evaluate away.
   *
   * So the three behavioural assertions below are UNCHANGED and still binding.
   * What is no longer asserted is the label, which was never the contract. The
   * ordering check is kept, keyed on the do-not-clarify sentence itself: it must
   * still follow PREPARE BEFORE YOU PROPOSE, because whichever clause carries it
   * only wins by coming after.
   */
  assert.match(prompt, /Do NOT ask clarifying questions/);
  assert.match(prompt, /3–5 numbered assumptions/);
  assert.match(prompt, /"label" \(never "name"\)/);
  assert.match(prompt, /PROPOSE NOW/, 'a propose-architecture ask gets the unconditional clause');
  assert.doesNotMatch(
    prompt,
    /FIGURE IT OUT: If the user says/,
    'and NOT the self-gating one, which is the defect this replaced',
  );
  const prepIdx = prompt.indexOf('PREPARE BEFORE YOU PROPOSE');
  const noClarifyIdx = prompt.indexOf('Do NOT ask clarifying questions');
  assert.ok(noClarifyIdx > prepIdx, 'the do-not-clarify clause must follow PREPARE so it wins');
  const attached = buildAskPrompt(
    {
      repo: { id: 'repo', name: 'demo' },
      folders: [],
      services: [],
      datastores: [],
      topics: [],
      edges: [],
    } as Parameters<typeof buildAskPrompt>[0],
    q,
  );
  assert.match(attached, /FIGURE IT OUT/);
  const ordinary = buildDesignAskPrompt({ title: 'D', outline: 'Frontend' }, 'what is missing?');
  assert.doesNotMatch(ordinary, /FIGURE IT OUT/);
});

test('buildAskPrompt: A REQUEST TO SEE A CHANGE IS A TOOL CALL, not an essay', () => {
  /*
   * MEASURED TWICE. tools/bench/weak-model.mjs on a hard task:
   *
   *     TOOLS      0 calls, 0 REFUSED
   *     TOPOLOGY   0 proposal(s) reached the board
   *
   * and in the owner's own run, asked "show me a change on the board you might
   * offer", the model wrote an essay proposing a node type and drew nothing.
   *
   * The old directive fired only "when the user asks to add topology nodes or
   * edges" — which is not how anybody phrases it, and certainly not how a weak
   * model classifies "show me on the board". The board is the thing this
   * product is for; an assistant that never puts anything on it is the single
   * largest functional gap it has.
   */
  const digest = {
    repo: { id: 'r', name: 'shop' },
    folders: [],
    services: [{ id: 'svc:gateway', name: 'gateway', modules: [], files: [] }],
    datastores: [{ id: 'ds:orders-db', name: 'orders-db' }],
    topics: [],
    edges: [],
  } as never;
  const prompt = buildAskPrompt(digest, 'show me a change on the board you might offer');

  assert.match(prompt, /show me on the board/i, 'the phrasing a reader actually uses is named');
  assert.match(prompt, /CALL TO `propose_topology`/);
  assert.match(
    prompt,
    /Describing the change in prose puts nothing on the board/,
    'prose alone must be stated as insufficient, not merely discouraged',
  );
});

test('buildAskPrompt: the model is TOLD the ids before it can invent one', () => {
  /*
   * The other half. When it does call the tool it invents endpoints — `svc:api`
   * on a repo with no such node — and the guard refuses them, correctly. But a
   * refusal arrives after the attempt, and a naming scheme cannot be inferred
   * from prose. Naming the real ids costs a few dozen tokens.
   */
  const digest = {
    repo: { id: 'r', name: 'shop' },
    folders: [],
    services: [{ id: 'svc:gateway', name: 'gateway', modules: [], files: [] }],
    datastores: [{ id: 'ds:orders-db', name: 'orders-db' }],
    topics: [{ id: 'top:events', name: 'events' }],
    edges: [],
  } as never;
  const prompt = buildAskPrompt(digest, 'add a rate limiter');

  assert.match(prompt, /svc:gateway/);
  assert.match(prompt, /ds:orders-db/);
  assert.match(prompt, /top:events/);
  assert.match(prompt, /Every edge endpoint must be one of those/);
});

test('buildAskPrompt: an empty graph names no ids rather than an empty list', () => {
  /* "The ids that exist include: ." would be the product inventing a sentence
     about nothing — the same class of noise the search truncation clause exists
     to avoid. */
  const digest = {
    repo: { id: 'r', name: 'empty' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as never;
  const prompt = buildAskPrompt(digest, 'add a rate limiter');
  assert.doesNotMatch(prompt, /The ids that exist in this repository include/);
});

test('isShowOnBoardAsk: owner seat-walk phrasings', () => {
  assert.ok(isShowOnBoardAsk('show me how Hardbe\'s Agent works on the board'));
  assert.ok(isShowOnBoardAsk('interesting can you show me on the board as well please'));
  assert.ok(isShowOnBoardAsk('draw it on the architecture'));
  assert.ok(isShowOnBoardAsk('map it out'));
  assert.ok(isShowOnBoardAsk('just show me'));
  assert.ok(isShowOnBoardAsk('draw it'));
  assert.ok(!isShowOnBoardAsk('what is missing?'));
  assert.ok(isFigureItOutAsk('figure it out'));
  assert.ok(isFigureItOutAsk('I want to see a visual example'));
  assert.ok(isFigureItOutAsk("I don't want you to ask any more questions"));
  assert.ok(isFigureItOutAsk('just draw the architecture'));
  assert.ok(isFigureItOutAsk('no more questions — show the services'));
  /* Owner P2.7: clarifying loops yield when the user says stop asking. */
  assert.ok(isFigureItOutAsk('stop asking and draw it'));
  assert.ok(isFigureItOutAsk('please quit asking — just map the services'));
  assert.ok(!isFigureItOutAsk('what does orders do?'));
});

test('buildDesignAskPrompt: show-on-board without proposeArchitecture flag still proposes', () => {
  const q = 'show me a Hermes agent on the board';
  const prompt = buildDesignAskPrompt({ title: 'Blank', outline: q }, q);
  assert.match(prompt, /SHOW ON THE BOARD/);
  assert.match(prompt, /Do NOT refuse with "the outline is blank"/);
  assert.match(prompt, /propose_topology|```seqd/);
  assert.doesNotMatch(prompt, /rather than inventing it/);
  assert.match(prompt, /PROPOSE a typical architecture|propose a concrete architecture/i);
});
