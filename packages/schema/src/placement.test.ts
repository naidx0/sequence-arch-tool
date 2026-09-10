import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from './index.js';
import {
  checkPlacement,
  inferPlacement,
  normalizeLanguage,
  extForLanguage,
  type PlacementProposal,
  type PlacementWarning,
} from './placement.js';

/**
 * Unit lock for the pure placement checker (v8 Phase C). Hand-built graphs only —
 * schema has no scanner dependency, and the point is to pin the deterministic
 * structural advice. Each warning category is proven to FIRE on a crafted graph
 * and to stay SILENT on a correct placement, and inference is proven byte-stable.
 */

/**
 * A mixed graph exercising both graph modes' language conventions:
 *  - svc:web  : DESIGN-style service carrying meta.language 'ts', with a .ts file.
 *  - svc:api  : SCAN-style service (meta.language undefined) whose language must be
 *               inferred from its .py file children.
 *  - ds:pg    : a postgres datastore (a suspicious place for a file/service).
 *  - ds:redis : a redis broker parenting topic:orders.
 */
function graph(): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'shop',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'shop' },
      { id: 'svc:web', kind: 'service', label: 'web', parentId: 'repo', path: 'web', meta: { language: 'ts' } },
      { id: 'file:web/index.ts', kind: 'file', label: 'index.ts', parentId: 'svc:web', path: 'web/index.ts', meta: { language: 'ts' } },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'api', meta: { framework: undefined } },
      { id: 'file:api/main.py', kind: 'file', label: 'main.py', parentId: 'svc:api', path: 'api/main.py', meta: { language: 'py' } },
      { id: 'file:api/util.py', kind: 'file', label: 'util.py', parentId: 'svc:api', path: 'api/util.py', meta: { language: 'py' } },
      { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo', meta: { tech: 'postgres' } },
      { id: 'ds:redis', kind: 'datastore', label: 'redis', parentId: 'repo', meta: { tech: 'redis' } },
      { id: 'topic:orders', kind: 'topic', label: 'orders', parentId: 'ds:redis' },
    ],
    edges: [],
    warnings: [],
  };
}

/** Convenience: the set of warning codes returned. */
function codes(ws: PlacementWarning[]): string[] {
  return ws.map((w) => w.code);
}

/* ------------------------------------------------------------ inferPlacement */

test('inferPlacement: a child of a ts service is a .ts file in that service dir', () => {
  const p = inferPlacement(graph(), 'svc:web', 'User Card');
  assert.strictEqual(p.kind, 'file');
  assert.strictEqual(p.language, 'ts');
  assert.strictEqual(p.suggestedPath, 'web/user-card.ts');
});

test('inferPlacement: a scan-mode service (no meta.language) infers language from its .py files', () => {
  const p = inferPlacement(graph(), 'svc:api', 'Worker');
  assert.strictEqual(p.language, 'py', 'dominant child-file extension wins when meta.language is absent');
  assert.strictEqual(p.suggestedPath, 'api/worker.py');
});

test('inferPlacement: an explicit extension in the label wins over the container language', () => {
  const p = inferPlacement(graph(), 'svc:web', 'background worker.py');
  assert.strictEqual(p.language, 'py');
  assert.strictEqual(p.suggestedPath, 'web/background-worker.py');
});

test('inferPlacement: drawing off a FILE places a sibling in the file own container', () => {
  const p = inferPlacement(graph(), 'file:api/main.py', 'helpers');
  assert.strictEqual(p.suggestedPath, 'api/helpers.py', 'sibling lands in api/, not under the file');
});

test('inferPlacement: a repo-root child is root-relative and takes the repo dominant language', () => {
  // The repo has 2 .py files and 1 .ts file → py is the dominant language.
  const p = inferPlacement(graph(), 'repo', 'Readme notes');
  assert.strictEqual(p.suggestedPath, 'readme-notes.py');
  assert.strictEqual(p.language, 'py');
});

test('inferPlacement: an empty/unknown container defaults to ts', () => {
  const empty: ArchGraph = {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: [{ id: 'repo', kind: 'repo', label: 'x' }],
    edges: [],
    warnings: [],
  };
  const p = inferPlacement(empty, 'repo', 'notes');
  assert.strictEqual(p.language, 'ts');
  assert.strictEqual(p.suggestedPath, 'notes.ts');
});

test('inferPlacement is byte-stable across calls', () => {
  assert.deepStrictEqual(inferPlacement(graph(), 'svc:api', 'Thing'), inferPlacement(graph(), 'svc:api', 'Thing'));
});

test('normalizeLanguage / extForLanguage canonicalise aliases', () => {
  assert.strictEqual(normalizeLanguage('TypeScript'), 'ts');
  assert.strictEqual(normalizeLanguage('python'), 'py');
  assert.strictEqual(normalizeLanguage(undefined), undefined);
  assert.strictEqual(extForLanguage('python'), '.py');
  assert.strictEqual(extForLanguage(undefined), '.ts');
});

/* --------------------------------------------------- checkPlacement: silent */

test('checkPlacement: a matching ts file under the ts service is silent', () => {
  const ws = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'Profile Card' });
  assert.deepStrictEqual(ws, [], 'a correct placement yields no warnings');
});

test('checkPlacement: a py file under the scan-mode py service is silent', () => {
  const ws = checkPlacement(graph(), { parentId: 'svc:api', kind: 'file', label: 'jobs' });
  assert.deepStrictEqual(ws, []);
});

/* ------------------------------------------ (a) language-mismatch */

test('language-mismatch fires for a py file under a ts service, silent for a ts one', () => {
  const bad = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'worker', language: 'py' });
  assert.ok(codes(bad).includes('language-mismatch'));
  const w = bad.find((x) => x.code === 'language-mismatch')!;
  assert.match(w.suggestion, /web/); // suggests matching the container

  const good = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'worker', language: 'ts' });
  assert.ok(!codes(good).includes('language-mismatch'));
});

test('language-mismatch is inferred from a .py label under a ts service (no explicit language)', () => {
  const ws = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'sync.py' });
  assert.ok(codes(ws).includes('language-mismatch'));
});

/* ------------------------------------------ (b) containment */

test('containment fires: a file under a datastore, silent under a service', () => {
  const bad = checkPlacement(graph(), { parentId: 'ds:pg', kind: 'file', label: 'model' });
  assert.ok(codes(bad).includes('containment'));
  const w = bad.find((x) => x.code === 'containment')!;
  assert.match(w.suggestion, /service|module|repo/);

  const good = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'model' });
  assert.ok(!codes(good).includes('containment'));
});

test('containment fires: a service under a datastore', () => {
  const ws = checkPlacement(graph(), { parentId: 'ds:pg', kind: 'service', label: 'reporting' });
  assert.ok(codes(ws).includes('containment'));
});

test('containment fires: a datastore under a service', () => {
  const ws = checkPlacement(graph(), { parentId: 'svc:web', kind: 'datastore', label: 'cache' });
  assert.ok(codes(ws).includes('containment'));
  // A datastore under the repo is fine.
  const ok = checkPlacement(graph(), { parentId: 'repo', kind: 'datastore', label: 'cache' });
  assert.ok(!codes(ok).includes('containment'));
});

test('containment fires: a topic outside a broker (under a service)', () => {
  const ws = checkPlacement(graph(), { parentId: 'svc:api', kind: 'topic', label: 'events' });
  assert.ok(codes(ws).includes('containment'));
  const ok = checkPlacement(graph(), { parentId: 'ds:redis', kind: 'topic', label: 'events' });
  assert.ok(!codes(ok).includes('containment'));
});

/* ------------------------------------------ (c) illegal-connection */

test('illegal-connection fires: a datastore cannot originate an http edge', () => {
  const proposal: PlacementProposal = {
    parentId: 'repo',
    kind: 'service',
    label: 'reporting',
    edge: { fromId: 'ds:pg', kind: 'http' },
  };
  const ws = checkPlacement(graph(), proposal);
  assert.ok(codes(ws).includes('illegal-connection'));
});

test('illegal-connection fires: an http edge cannot target a datastore', () => {
  const proposal: PlacementProposal = {
    parentId: 'repo',
    kind: 'datastore',
    label: 'cache',
    edge: { fromId: 'svc:web', kind: 'http' },
  };
  const ws = checkPlacement(graph(), proposal);
  assert.ok(codes(ws).includes('illegal-connection'));
});

test('illegal-connection is silent for a legal http service->service edge', () => {
  const proposal: PlacementProposal = {
    parentId: 'repo',
    kind: 'service',
    label: 'reporting',
    edge: { fromId: 'svc:web', kind: 'http' },
  };
  const ws = checkPlacement(graph(), proposal);
  assert.ok(!codes(ws).includes('illegal-connection'));
});

test('illegal-connection is exempt for import edges (as in validateGraph)', () => {
  const proposal: PlacementProposal = {
    parentId: 'svc:web',
    kind: 'file',
    label: 'thing',
    edge: { fromId: 'ds:pg', kind: 'import' },
  };
  const ws = checkPlacement(graph(), proposal);
  assert.ok(!codes(ws).includes('illegal-connection'), 'import is absent from the whitelist, so it never fires');
});

/* ------------------------------------------ (d) path-collision */

test('path-collision fires on an explicit path that already exists, silent otherwise', () => {
  const bad = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'anything', path: 'web/index.ts' });
  assert.ok(codes(bad).includes('path-collision'));

  const good = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'anything', path: 'web/fresh.ts' });
  assert.ok(!codes(good).includes('path-collision'));
});

test('path-collision fires on the INFERRED path when the name collides', () => {
  // Inferred path for "index" under svc:web is web/index.ts — which already exists.
  const ws = checkPlacement(graph(), { parentId: 'svc:web', kind: 'file', label: 'index' });
  assert.ok(codes(ws).includes('path-collision'));
});

/* ------------------------------------------ determinism */

test('checkPlacement is byte-stable across calls', () => {
  const proposal: PlacementProposal = { parentId: 'svc:web', kind: 'file', label: 'worker', language: 'py' };
  assert.deepStrictEqual(checkPlacement(graph(), proposal), checkPlacement(graph(), proposal));
});

test('checkPlacement never throws on a missing parent (returns advice it can still give)', () => {
  const ws = checkPlacement(graph(), { parentId: 'nope', kind: 'file', label: 'x' });
  assert.ok(Array.isArray(ws));
});
