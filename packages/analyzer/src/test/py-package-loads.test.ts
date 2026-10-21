/**
 * PYTHON IMPORTS EXECUTE PACKAGE MARKERS, AND SERVICES CAN IMPORT EACH OTHER'S PACKAGES.
 *
 * The A2 closure bench (docs/bench/RESULTS-0.1.9.md) measured depth<=4 importer-closure recall against an
 * independent regex resolver: sqlfluff 62.4 %, flask 87.6 %. Sequence's python edges were a strict subset of the
 * independent graph (0 extra edges on both repos); every missing edge was one of
 *
 *   package load   `import pkg.sub.mod` / `from pkg import mod` / `from . import x` run `pkg/__init__.py` (and
 *                  `pkg/sub/__init__.py`) even though the statement names the leaf. Changing a package marker changes
 *                  every importer, so a "what breaks if I change X" closure has to follow it: sqlfluff 1051 of 1107
 *                  missing edges, flask 10 of 19.
 *   mixed name     `from pkg import submodule, Symbol`: the submodule won and the package itself was dropped, as was
 *                  `from .. import typing` onto `pkg/__init__.py`: flask 9.
 *   cross service  sqlfluff's `docsv/scripts` ships its own manifest, so it is its own service whose file set holds
 *                  no `src/sqlfluff`: 56 explicit imports (`from sqlfluff.core import Linter`) went nowhere.
 *
 * Package loads are `kind: 'import'` edges with `actor: 'import-package-load'` and the real import line as evidence.
 * They are kept out of PageRank and clustering (a two-line marker must not anchor a cluster again: see
 * py-import-resolution.test.ts).
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_LOAD_ACTOR, pythonPackageLoads, scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => path.resolve(here, '..', '..', 'test', 'fixtures', name);
type Graph = Awaited<ReturnType<typeof scanRepo>>;
const pairs = (g: Graph, loadsOnly?: boolean): Set<string> =>
  new Set(
    g.edges
      .filter((e) => e.kind === 'import' && (loadsOnly === undefined || (e.actor === PACKAGE_LOAD_ACTOR) === loadsOnly))
      .map((e) => `${e.srcId.slice(5)} -> ${e.dstId.slice(5)}`),
  );

test('`import pkg.sub.mod` names the leaf and loads every package marker above it', async () => {
  const g = await scanRepo(fx('py-package-loads'), { cluster: true });
  assert.ok(pairs(g, false).has('tools/run.py -> src/app/core/engine.py'), 'the named module stays an ordinary import edge');
  for (const want of ['tools/run.py -> src/app/core/__init__.py', 'tools/run.py -> src/app/__init__.py']) {
    assert.ok(pairs(g, true).has(want), `${want} missing from package loads: ${[...pairs(g)].join(' | ')}`);
  }
});

test('`from pkg import submodule` loads the package; `from . import x` loads the importer\'s own package', async () => {
  const g = await scanRepo(fx('py-package-loads'), { cluster: true });
  assert.ok(pairs(g, false).has('tools/other.py -> src/app/core/util.py'));
  assert.ok(pairs(g, true).has('tools/other.py -> src/app/core/__init__.py'));
  assert.ok(pairs(g, true).has('src/app/core/engine.py -> src/app/core/__init__.py'));
  assert.ok(!pairs(g).has('src/app/core/engine.py -> src/app/core/engine.py'), 'never a self edge');
});

test('every package load cites a real import line and no pair is emitted twice', async () => {
  const root = fx('py-package-loads');
  const g = await scanRepo(root, { cluster: true });
  const loads = g.edges.filter((e) => e.actor === PACKAGE_LOAD_ACTOR);
  assert.ok(loads.length >= 6, `expected package loads, got ${loads.length}`);
  for (const e of loads) {
    const ev = e.evidence[0];
    const line = fs.readFileSync(path.join(root, ev.file), 'utf8').split(/\r?\n/)[ev.line - 1] ?? '';
    assert.match(line, /^\s*(from|import)\s/, `${e.srcId} -> ${e.dstId} cites ${ev.file}:${ev.line} = ${JSON.stringify(line)}`);
    assert.equal(ev.snippet, line.trim());
    assert.equal(e.confidence, 1);
  }
  const all = g.edges.filter((e) => e.kind === 'import').map((e) => `${e.srcId} -> ${e.dstId}`);
  assert.equal(new Set(all).size, all.length, 'duplicate import edge');
});

test('package loads do not feed PageRank: a package marker no file names does not outrank the module that does the work', async () => {
  const g = await scanRepo(fx('py-package-loads'), { cluster: true });
  const rank = (p: string): number => g.nodes.find((n) => n.path === p)?.meta?.pageRank ?? NaN;
  assert.ok(rank('src/app/core/util.py') > rank('src/app/__init__.py'), `${rank('src/app/core/util.py')} vs ${rank('src/app/__init__.py')}`);
});

test('a service importing another service\'s package reaches it (sqlfluff docsv/scripts shape)', async () => {
  const g = await scanRepo(fx('py-cross-service'), { cluster: true });
  assert.ok(g.nodes.filter((n) => n.kind === 'service').length >= 2, 'fixture must be two services');
  assert.ok(pairs(g, false).has('scripts/gen.py -> lib/src/shared/core.py'), [...pairs(g)].join(' | '));
  // `from shared import NAME` NAMES the package, so that edge is an ordinary import, not a load
  assert.ok(pairs(g, false).has('scripts/gen.py -> lib/src/shared/__init__.py'), [...pairs(g)].join(' | '));
  assert.ok(![...pairs(g)].some((p) => p.includes('os')), 'stdlib stays out');
});

test('pythonPackageLoads: the marker chain stops at a namespace directory and never lists the target', () => {
  const files = new Set(['a/__init__.py', 'a/b/__init__.py', 'a/b/c.py', 'ns/x/__init__.py', 'ns/x/y.py', 'solo.py']);
  assert.deepEqual(pythonPackageLoads('a/b/c.py', files), ['a/b/__init__.py', 'a/__init__.py']);
  assert.deepEqual(pythonPackageLoads('a/b/__init__.py', files), ['a/__init__.py'], 'the marker itself is the named target');
  assert.deepEqual(pythonPackageLoads('ns/x/y.py', files), ['ns/x/__init__.py'], 'ns/ has no marker, so the chain ends');
  assert.deepEqual(pythonPackageLoads('solo.py', files), []);
});
