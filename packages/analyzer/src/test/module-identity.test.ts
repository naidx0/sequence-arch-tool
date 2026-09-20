import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clusterDir, describeCluster, uniqueModuleLabels } from '../cluster/cluster.js';
import { scanRepo } from '../scan.js';

/**
 * A module must say WHICH one it is and WHAT it holds.
 *
 * Reported from real use on a 12-app product repo: the component breakout showed
 * fifteen cards reading `MOD Core`, `MOD Routers`, `MOD Prompts`… with no line of
 * description under any of them, and "Core" appearing TWICE with nothing to tell
 * the two apart — "function desc too general overall".
 *
 * Two grounded properties are locked here:
 *  1. same-named modules of one service are disambiguated by their own REAL
 *     directories, never by a counter;
 *  2. every module carries a description counted from the parse — file count,
 *     language, directory, and the names of the largest things it defines.
 *
 * Both must degrade honestly: nothing is invented when the parse found nothing.
 */

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

// ---------------------------------------------------------------- unit level

test('clusterDir returns the directory the members really share', () => {
  assert.strictEqual(clusterDir(['a/b/x.ts', 'a/b/y.ts']), 'a/b');
  assert.strictEqual(clusterDir(['a/b/x.ts', 'a/c/y.ts']), 'a');
  assert.strictEqual(clusterDir(['x.ts', 'y.ts']), undefined, 'repo root is not a shared dir');
  assert.strictEqual(clusterDir([]), undefined);
});

test('colliding module names are told apart by their own directories', () => {
  const out = uniqueModuleLabels([
    { label: 'Core', dir: 'backend/app/core' },
    { label: 'Core', dir: 'backend/services/core' },
    { label: 'Routers', dir: 'backend/app/routers' },
  ]);
  assert.deepStrictEqual(out, ['App / Core', 'Services / Core', 'Routers']);
  assert.strictEqual(new Set(out).size, 3, 'every label must be distinct');
  assert.ok(!out.some((l) => /\d/.test(l)), 'never a counter — "Core 2" is not a name');
});

test('disambiguation walks up only as far as it must', () => {
  // Three colliding modules that only separate at the THIRD segment from the end.
  const out = uniqueModuleLabels([
    { label: 'Core', dir: 'a/one/app/core' },
    { label: 'Core', dir: 'a/two/app/core' },
  ]);
  assert.deepStrictEqual(out, ['One / App / Core', 'Two / App / Core']);
});

test('root-level modules that share no directory are told apart by their anchor file', () => {
  // Reported from the r94 legibility shot of Sequence scanning ITSELF: the
  // Schema service card listed "Top Level" three times. Every one of those
  // modules sits directly in the service root, so `dir` is undefined and the
  // directory walk has nothing to climb — the old code silently gave up and
  // left three identical rows.
  const out = uniqueModuleLabels([
    { label: 'Top level', anchor: 'packages/schema/src/graph.ts' },
    { label: 'Top level', anchor: 'packages/schema/src/domain.ts' },
    { label: 'Top level', anchor: 'packages/schema/src/program.ts' },
    { label: 'Detectors', dir: 'packages/analyzer/src/detectors' },
  ]);
  assert.deepStrictEqual(out, ['Graph', 'Domain', 'Program', 'Detectors']);
  assert.strictEqual(new Set(out).size, 4, 'every label must be distinct');
  assert.ok(!out.some((l) => /\d/.test(l)), 'never a counter');
});

test('the anchor fallback strips every extension, including double ones', () => {
  const out = uniqueModuleLabels([
    { label: 'Top level', anchor: 'src/client.test.ts' },
    { label: 'Top level', anchor: 'src/executor.d.ts' },
  ]);
  assert.deepStrictEqual(out, ['Client', 'Executor']);
});

test('the anchor fallback stays silent rather than guessing', () => {
  // No anchor at all → the labels are left alone. An honest duplicate beats an
  // invented distinction.
  assert.deepStrictEqual(
    uniqueModuleLabels([{ label: 'Top level' }, { label: 'Top level' }]),
    ['Top level', 'Top level'],
  );
  // Anchors that would themselves collide → also left alone, for the same reason.
  assert.deepStrictEqual(
    uniqueModuleLabels([
      { label: 'Top level', anchor: 'a/index.ts' },
      { label: 'Top level', anchor: 'b/index.ts' },
    ]),
    ['Top level', 'Top level'],
  );
});

test('the directory walk still wins when a directory exists', () => {
  // The anchor is a FALLBACK. When modules can be separated by their real
  // directories, that is the better name and must not be overridden.
  const out = uniqueModuleLabels([
    { label: 'Core', dir: 'backend/app/core', anchor: 'backend/app/core/zzz.ts' },
    { label: 'Core', dir: 'backend/services/core', anchor: 'backend/services/core/aaa.ts' },
  ]);
  assert.deepStrictEqual(out, ['App / Core', 'Services / Core']);
});

test('disambiguation is order-independent', () => {
  const a = uniqueModuleLabels([
    { label: 'Core', dir: 'x/core' },
    { label: 'Core', dir: 'y/core' },
  ]);
  const b = uniqueModuleLabels([
    { label: 'Core', dir: 'y/core' },
    { label: 'Core', dir: 'x/core' },
  ]);
  assert.deepStrictEqual([...a].sort(), [...b].sort());
});

test('a module with no distinguishing directory keeps its plain name', () => {
  // Honest failure: two clusters that genuinely share a directory cannot be told
  // apart by path, so neither is given a fake distinguishing name.
  const out = uniqueModuleLabels([
    { label: 'Core', dir: 'app/core' },
    { label: 'Core', dir: 'app/core' },
  ]);
  assert.deepStrictEqual(out, ['Core', 'Core']);
});

/**
 * U36 — ONE COLLISION AT DEPTH MUST NOT DISCARD EVERY SIBLING'S NAME.
 *
 * Measured on spring-boot: 177 modules all label "autoconfigure", and one pair
 * under main vs test (`.../mongodb/autoconfigure`) still collides at the depth
 * that already separates web, data, redis, and the rest. The old all-or-nothing
 * rule rejected the whole rendered set and every row fell back to "autoconfigure".
 */
test('U36: a depth collision only blocks the colliding pair, not every sibling', () => {
  const modules = [
    { label: 'autoconfigure', dir: 'src/main/java/org/springframework/boot/autoconfigure/web/autoconfigure' },
    { label: 'autoconfigure', dir: 'src/main/java/org/springframework/boot/autoconfigure/data/autoconfigure' },
    { label: 'autoconfigure', dir: 'src/main/java/org/springframework/boot/autoconfigure/redis/autoconfigure' },
    { label: 'autoconfigure', dir: 'src/main/java/org/springframework/boot/autoconfigure/mongodb/autoconfigure' },
    { label: 'autoconfigure', dir: 'src/test/java/org/springframework/boot/autoconfigure/mongodb/autoconfigure' },
  ];
  const out = uniqueModuleLabels(modules);
  assert.strictEqual(new Set(out).size, out.length, `every row must be distinct, got: ${JSON.stringify(out)}`);
  assert.ok(
    !out.some((l) => l === 'autoconfigure'),
    `no row should fall back to the plain collision label, got: ${JSON.stringify(out)}`
  );
  assert.deepStrictEqual(out.slice(0, 3), ['Web / Autoconfigure', 'Data / Autoconfigure', 'Redis / Autoconfigure']);
  assert.ok(out[3].toLowerCase().includes('main'), `main mongodb path must say main, got: ${out[3]}`);
  assert.ok(out[4].toLowerCase().includes('test'), `test mongodb path must say test, got: ${out[4]}`);
});

test('a module description counts what is really there', () => {
  const facts = new Map([
    [
      'backend/app/core/config.py',
      { file: '', language: 'py', functions: [{ name: 'get_settings' }], classes: [{ name: 'Settings' }] },
    ],
    [
      'backend/app/core/db.py',
      { file: '', language: 'py', functions: [{ name: 'get_session' }, { name: '_private' }], classes: [] },
    ],
  ]);
  const d = describeCluster(['backend/app/core/config.py', 'backend/app/core/db.py'], facts);
  assert.ok(d, 'a described module must produce a sentence');
  assert.match(d!, /^2 py files in backend\/app\/core, defining /);
  assert.ok(d!.includes('Settings'), 'classes lead — a class names a thing');
  assert.ok(d!.includes('get_session') || d!.includes('get_settings'), 'real symbols only');
  assert.ok(!d!.includes('_private'), 'private helpers are not what a module is for');
});

test('a description with nothing to add stops early rather than padding', () => {
  const facts = new Map([
    ['a/x.ts', { file: '', language: 'ts', functions: [], classes: [] }],
    ['a/y.ts', { file: '', language: 'ts', functions: [], classes: [] }],
  ]);
  const d = describeCluster(['a/x.ts', 'a/y.ts'], facts);
  assert.strictEqual(d, '2 ts files in a.');
  assert.ok(!d!.includes('defining'), 'no empty "defining" clause');
});

test('a description never invents when the parse produced nothing', () => {
  const d = describeCluster(['a/x.ts'], new Map());
  assert.strictEqual(d, '1 file in a.', 'file count is still a counted fact');
  assert.strictEqual(describeCluster([], new Map()), undefined);
});

// ------------------------------------------------------------ scan level

/** A service big enough to cluster, with TWO directories that both end in `core`. */
function repoWithTwinCoreModules(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mod-id-'));
  write(path.join(root, 'api', 'requirements.txt'), 'fastapi\n');
  write(path.join(root, 'api', 'Dockerfile'), 'FROM python:3.11\n');
  const mk = (rel: string, body: string) => write(path.join(root, 'api', rel), body);
  for (let i = 0; i < 5; i++) {
    mk(`app/core/mod${i}.py`, `class AppCore${i}:\n    pass\n\ndef app_core_${i}():\n    return ${i}\n`);
  }
  for (let i = 0; i < 5; i++) {
    mk(
      `services/core/mod${i}.py`,
      `class SvcCore${i}:\n    pass\n\ndef svc_core_${i}():\n    return ${i}\n`,
    );
  }
  mk('main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
  write(
    path.join(root, 'docker-compose.yml'),
    ['services:', '  api:', '    build: ./api', ''].join('\n'),
  );
  return root;
}

test('a scanned repo never shows two identically-named modules in one service', async () => {
  const root = repoWithTwinCoreModules();
  const g = await scanRepo(root);
  const mods = g.nodes.filter((n) => n.kind === 'module' && n.parentId === 'svc:api');
  assert.ok(mods.length >= 2, `expected clustering to fire, got ${mods.length} modules`);
  const labels = mods.map((m) => m.label);
  assert.strictEqual(
    new Set(labels).size,
    labels.length,
    `duplicate module labels in one service: ${labels.join(', ')}`,
  );
});

test('every scanned module carries a grounded description and its own path', async () => {
  const root = repoWithTwinCoreModules();
  const g = await scanRepo(root);
  const mods = g.nodes.filter((n) => n.kind === 'module');
  assert.ok(mods.length > 0);
  for (const m of mods) {
    const d = m.meta?.description;
    assert.ok(typeof d === 'string' && d.trim() !== '', `${m.label} has no description`);
    assert.match(d as string, /^\d+ /, 'a description opens with a counted fact');
    assert.ok(m.path, `${m.label} must record the directory it describes`);
    // The claim must be checkable: the directory it names really exists.
    assert.ok(
      fs.existsSync(path.join(root, m.path as string)),
      `${m.label} names a directory that does not exist: ${m.path}`,
    );
  }
});

test('module identity is deterministic across runs', async () => {
  const root = repoWithTwinCoreModules();
  const a = await scanRepo(root);
  const b = await scanRepo(root);
  const shape = (g: typeof a) =>
    g.nodes
      .filter((n) => n.kind === 'module')
      .map((n) => `${n.id}|${n.label}|${n.meta?.description ?? ''}`);
  assert.deepStrictEqual(shape(a), shape(b));
});
