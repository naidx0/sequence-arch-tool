/**
 * THREE SCANNER BUGS THE find_files / closure BENCHMARK EXPOSED (docs/plans/0.1.9/BENCH-PROGRAM.md, A2).
 *
 * Measured on the pinned held-out repos, scanner vs an independent regex resolver (tools/bench/lib/importgraph.mjs):
 *
 *   flask      edges onto an `__init__.py`: 11 of 78 found. `from flask import Flask` in tests/ and examples/
 *              never landed, because the package lives at `src/flask` and imports were resolved only against the
 *              service directory; `from . import typing as ft` looked for `ft.py`.
 *   sqlfluff   12 of 476 Python files read. A compose file that only builds a dev image folded sibling manifest
 *              roots in, which hid that the manifest names no code, so the repo root (`src/sqlfluff`) was never mapped.
 *   vite       per-target closure recall 0.63. `import('./x')` made no edge, `.mts`/`.cts` files were not read,
 *              workspace packages nested inside a scanned package (imported by name) were never indexed, and
 *              workspace entries resolved only to TypeScript files.
 *
 * Fixtures are the reported shapes (`test/fixtures/{py-src-layout,library-dev-compose,js-dynamic-nested-pkg}`).
 * Every edge asserted here is one a person can point to in the source.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImportAll, scanRepo } from '../scan.js';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';

type Graph = Awaited<ReturnType<typeof scanRepo>>;

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => path.resolve(here, '..', '..', 'test', 'fixtures', name);
const importPairs = (g: Graph): Set<string> =>
  new Set(g.edges.filter((e) => e.kind === 'import').map((e) => `${e.srcId.slice(5)} -> ${e.dstId.slice(5)}`));
const filePaths = (g: Graph): string[] => g.nodes.filter((n) => n.kind === 'file').map((n) => n.path ?? '');

/* ---- bug 1: Python package imports (flask) ---- */

test('flask: `from pkg import X` and `import pkg` land on a src-layout package __init__.py', async () => {
  const pairs = importPairs(await scanRepo(fx('py-src-layout'), { cluster: true }));
  for (const want of [
    'tests/test_app.py -> src/mylib/__init__.py',
    'tests/test_app.py -> src/mylib/app.py',
    'examples/demo/main.py -> src/mylib/__init__.py',
    'examples/demo/main.py -> src/mylib/helpers.py',
  ]) {
    assert.ok(pairs.has(want), `missing ${want}; got ${[...pairs].join(' | ')}`);
  }
});

test('flask: `from . import typing as ft` is an edge onto typing.py, not a lookup of ft.py', async () => {
  const pairs = importPairs(await scanRepo(fx('py-src-layout'), { cluster: true }));
  assert.ok(pairs.has('src/mylib/app.py -> src/mylib/typing.py'), [...pairs].join(' | '));
  await initParser();
  const facts = extractFacts('from . import typing as ft\nfrom .x import a as b, c\n', 'p/m.py', 'py');
  assert.deepEqual(facts.imports[0].names, ['ft'], 'call attribution still reads the alias');
  assert.deepEqual(facts.imports[0].sources, ['typing'], 'resolution reads the original name');
  assert.deepEqual(facts.imports[1].sources, ['a', 'c']);
  assert.equal(extractFacts('from . import x\n', 'p/m.py', 'py').imports[0].sources, undefined, 'no alias, no extra field');
});

test('flask: absolute resolution tries the service directory first, then the nearest import root', () => {
  const both = new Set(['src/mylib/__init__.py', 'src/mylib/app.py', 'tests/test_app.py', 'mylib/__init__.py']);
  // `mylib` exists at the service root AND under src/: the service directory wins, as before.
  assert.deepEqual(resolveImportAll('tests/test_app.py', 'mylib', 'py', '.', both, undefined, ['Thing']), ['mylib/__init__.py']);
  const srcOnly = new Set(['src/mylib/__init__.py', 'src/mylib/app.py', 'tests/test_app.py']);
  assert.deepEqual(resolveImportAll('tests/test_app.py', 'mylib', 'py', '.', srcOnly, undefined, ['Thing']), ['src/mylib/__init__.py']);
  assert.deepEqual(resolveImportAll('tests/test_app.py', 'mylib.app', 'py', '.', srcOnly), ['src/mylib/app.py']);
  // a name no root spells resolves to nothing: no guess
  assert.deepEqual(resolveImportAll('tests/test_app.py', 'nosuch', 'py', '.', srcOnly, undefined, ['x']), []);
  assert.deepEqual(resolveImportAll('tests/test_app.py', 'app', 'py', '.', srcOnly), [], 'a module below the package root is not importable as `app`');
});

/* ---- bug 2: a library behind a dev-image compose file (sqlfluff) ---- */

test('sqlfluff: a compose file that builds only a dev image still maps the library at the repo root', async () => {
  const g = await scanRepo(fx('library-dev-compose'), { cluster: true });
  const files = filePaths(g);
  for (const want of ['src/linter/__init__.py', 'src/linter/core.py', 'src/linter/rules.py']) {
    assert.ok(files.includes(want), `${want} was not read; read: ${files.join(', ')}`);
  }
  assert.ok(importPairs(g).has('src/linter/core.py -> src/linter/rules.py'));
  assert.ok(importPairs(g).has('src/linter/__init__.py -> src/linter/core.py'));
  assert.ok(g.warnings.some((w) => w.includes('hold no code this scanner can read')), g.warnings.join(' | '));
  assert.ok(g.nodes.some((n) => n.kind === 'datastore'), 'the datastore compose declares survives');
});

/* ---- bug 3: JS / TS closure (vite) ---- */

test('vite: a literal `import()` is an import edge; a computed one is not guessed', async () => {
  const pairs = importPairs(await scanRepo(fx('js-dynamic-nested-pkg'), { cluster: true }));
  assert.ok(pairs.has('packages/app/src/cli.ts -> packages/app/src/optimizer.ts'), [...pairs].join(' | '));
  assert.ok(pairs.has('packages/app/src/cli.ts -> packages/app/src/preview.ts'), 'a template literal with no substitution is a literal');
  assert.equal([...pairs].filter((p) => p.startsWith('packages/app/src/cli.ts')).length, 2, 'import("./" + cmd) names nothing');
});

test('vite: .mts / .cts files are read and their imports resolve', async () => {
  const g = await scanRepo(fx('js-dynamic-nested-pkg'), { cluster: true });
  assert.ok(filePaths(g).includes('packages/app/src/config.mts') && filePaths(g).includes('packages/app/src/helper.mts'));
  assert.ok(importPairs(g).has('packages/app/src/config.mts -> packages/app/src/helper.mts'));
});

test('vite: a package nested inside a scanned package resolves by name, to a JavaScript entry', async () => {
  const pairs = importPairs(await scanRepo(fx('js-dynamic-nested-pkg'), { cluster: true }));
  assert.ok(pairs.has('packages/app/src/main.js -> packages/app/nested-dep/index.js'), `index.js by convention: ${[...pairs].join(' | ')}`);
  assert.ok(pairs.has('packages/app/src/main.js -> packages/app/other-dep/entry.cjs'), 'declared "main": "./entry.cjs"');
});
