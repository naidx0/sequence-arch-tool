/**
 * LOCKING TESTS for the digest/tree performance round (H12b).
 *
 * `buildDigest` used to answer "is this file inside this service?" by rebuilding
 * a full id→node Map on EVERY call, once per (service × file): on the real n8n
 * clone that was 67 × 18 282 calls, each rebuilding a 19 145-entry Map — a
 * measured ≈80 minutes, which is why the QA harness killed n8n at its 900 s cap.
 *
 * The fix is a pure performance change, so these tests assert EQUALITY against
 * the original definition, kept exported as `ancestorIsService` — the oracle. If
 * the fast grouping ever disagrees with the obvious walk-up-the-parents rule,
 * on a real repo or on a randomly generated containment forest, this fails.
 *
 * The last test is the one that FAILS ON BASE: a graph the old cost model needs
 * ~10^9 map entries to digest, with a wall-clock bound so generous it can only
 * fail if the quadratic comes back.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph, ArchNode } from '@sequence/schema';
import { scanRepo } from '../scan.js';
import { ancestorIsService, groupFilesByService, buildDigest } from '../explain/explain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const FIXTURES = path.join(ANALYZER_ROOT, 'test', 'fixtures');

/** The non-structural half of an ArchGraph — irrelevant to containment. */
const GRAPH_HEAD: Pick<ArchGraph, 'version' | 'scannedAt' | 'repoRoot' | 'warnings'> = {
  version: 1,
  scannedAt: '',
  repoRoot: '',
  warnings: [],
};

/** The ORIGINAL per-service scan, verbatim — the oracle everything is judged by. */
function oracleFilesOf(graph: ArchGraph, svcId: string): ArchNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  return graph.nodes.filter((n) => n.kind === 'file' && ancestorIsService(byId, n, svcId));
}

function assertGroupingMatchesOracle(graph: ArchGraph, what: string): void {
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const fast = groupFilesByService(graph, { byId }, services);
  for (const svc of services) {
    assert.deepStrictEqual(
      (fast.get(svc.id) ?? []).map((n) => n.id),
      oracleFilesOf(graph, svc.id).map((n) => n.id),
      `${what}: files of service ${svc.id} must match the ancestor oracle exactly`
    );
  }
  assert.strictEqual(fast.size, new Set(services.map((s) => s.id)).size, `${what}: one entry per service`);
}

/* ------------------------------------------------------- real repositories -- */

for (const fixture of ['shopfront', 'monorepo-apps', 'shared-backend', 'plainapp', 'mixed-lang']) {
  test(`digest file grouping matches the ancestor oracle on ${fixture}`, async () => {
    const graph = await scanRepo(path.join(FIXTURES, fixture), { cluster: true });
    assertGroupingMatchesOracle(graph, fixture);
  });
}

/* ------------------------------------------------ generated containment ----- */

/** Deterministic PRNG — a failure here must be reproducible, not "sometimes". */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A containment forest with every shape the real scanner can emit, plus the ones
 * it shouldn't: files directly under a service, files under a module, modules
 * under modules, a service nested INSIDE another service (both must claim the
 * file), files under the repo with no service at all, and a dangling parentId
 * that resolves to nothing.
 */
function generatedGraph(seed: number): ArchGraph {
  const r = rng(seed);
  const nodes: ArchNode[] = [{ id: 'repo', kind: 'repo', label: 'repo' }];
  const containers: string[] = ['repo'];
  const nSvc = 1 + Math.floor(r() * 6);
  for (let s = 0; s < nSvc; s += 1) {
    const parent = r() < 0.25 ? containers[Math.floor(r() * containers.length)] : 'repo';
    const id = `svc${s}`;
    nodes.push({ id, kind: 'service', label: id, parentId: parent });
    containers.push(id);
    const nMod = Math.floor(r() * 4);
    for (let m = 0; m < nMod; m += 1) {
      const mid = `${id}:mod${m}`;
      const mparent = r() < 0.3 ? containers[Math.floor(r() * containers.length)] : id;
      nodes.push({ id: mid, kind: 'module', label: mid, parentId: mparent });
      containers.push(mid);
    }
  }
  const nFiles = 5 + Math.floor(r() * 40);
  for (let f = 0; f < nFiles; f += 1) {
    const roll = r();
    const parent =
      roll < 0.05 ? 'ghost-parent-that-does-not-exist' : containers[Math.floor(r() * containers.length)];
    nodes.push({ id: `f${f}`, kind: 'file', label: `f${f}.ts`, path: `src/f${f}.ts`, parentId: parent });
  }
  return { ...GRAPH_HEAD, repoName: 'generated', nodes, edges: [] };
}

test('digest file grouping matches the ancestor oracle on generated containment forests', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    assertGroupingMatchesOracle(generatedGraph(seed), `seed ${seed}`);
  }
});

test('a file inside a service nested in another service belongs to BOTH', () => {
  const graph: ArchGraph = {
    ...GRAPH_HEAD,
    repoName: 'nested',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'repo' },
      { id: 'outer', kind: 'service', label: 'outer', parentId: 'repo' },
      { id: 'inner', kind: 'service', label: 'inner', parentId: 'outer' },
      { id: 'm', kind: 'module', label: 'm', parentId: 'inner' },
      { id: 'f', kind: 'file', label: 'f.ts', path: 'a/f.ts', parentId: 'm' },
    ],
    edges: [],
  };
  assertGroupingMatchesOracle(graph, 'nested services');
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const services = graph.nodes.filter((n) => n.kind === 'service');
  const g = groupFilesByService(graph, { byId }, services);
  assert.deepStrictEqual(g.get('outer')?.map((n) => n.id), ['f']);
  assert.deepStrictEqual(g.get('inner')?.map((n) => n.id), ['f']);
});

/* ------------------------------------------------------------ the quadratic - */

/**
 * FAILS ON BASE. 40 services × 6 000 files over a 6 041-node graph is
 * 40 × 6 000 = 240 000 ancestor calls, each of which used to rebuild a
 * 6 041-entry Map — ≈1.5×10^9 Map insertions, minutes of wall clock. The bound
 * below is ~100× what the indexed version needs, so it can only trip if the
 * per-call rebuild (or any other services×files×nodes shape) returns.
 */
test('buildDigest stays linear: a 40-service / 6 000-file graph digests in seconds', () => {
  const nodes: ArchNode[] = [{ id: 'repo', kind: 'repo', label: 'repo' }];
  const nSvc = 40;
  for (let s = 0; s < nSvc; s += 1) {
    nodes.push({ id: `svc${s}`, kind: 'service', label: `svc${s}`, parentId: 'repo', path: `svc${s}` });
    nodes.push({ id: `svc${s}:mod`, kind: 'module', label: `mod${s}`, parentId: `svc${s}` });
  }
  for (let f = 0; f < 6000; f += 1) {
    const s = f % nSvc;
    nodes.push({
      id: `f${f}`,
      kind: 'file',
      label: `f${f}.ts`,
      path: `svc${s}/f${f}.ts`,
      parentId: `svc${s}:mod`,
      meta: { language: 'ts', loc: 10 },
    });
  }
  const graph: ArchGraph = { ...GRAPH_HEAD, repoName: 'big', nodes, edges: [] };

  const started = Date.now();
  const digest = buildDigest(graph);
  const elapsed = Date.now() - started;

  assert.strictEqual(digest.services.length, nSvc);
  // Every service sees all 150 of its files: 50 shown, 100 counted as truncated.
  for (const s of digest.services) {
    assert.strictEqual(s.files.length, 50);
    assert.strictEqual(s.truncatedFiles, 100);
  }
  assert.ok(elapsed < 20_000, `buildDigest took ${elapsed}ms — the quadratic is back`);
});
