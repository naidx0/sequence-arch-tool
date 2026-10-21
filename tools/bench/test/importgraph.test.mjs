import assert from 'node:assert/strict';
import test from 'node:test';
import { bfsByDepth, cumulative, importGrepPattern, jsEdges, jsSpecs, moduleStem, pyEdges, pyImports, reverseAdj } from '../lib/importgraph.mjs';

const mem = (obj) => ({ files: Object.keys(obj), read: (p) => obj[p] });
const key = (edges) => [...new Set(edges.map(([s, d]) => `${s}>${d}`))].sort(); // callers build sets; duplicates are harmless

test('bfsByDepth: new files per depth, cycles and the start excluded', () => {
  const rev = reverseAdj([['b', 'a'], ['c', 'b'], ['d', 'c'], ['a', 'd'], ['e', 'a'], ['x', 'x']]);
  const lv = bfsByDepth(rev, 'a', 4);
  assert.deepEqual(lv.map((s) => [...s].sort()), [['b', 'e'], ['c'], ['d'], []]);
  assert.deepEqual(cumulative(lv).map((s) => s.size), [2, 3, 4, 4]);
  assert.equal(bfsByDepth(rev, 'zzz', 2)[0].size, 0);
});

test('jsSpecs finds import, export-from, dynamic import and require', () => {
  const t = `import a from './a';\nimport {b,\n c} from "../b.js";\nexport * from './c';\nconst d = require('./d');\nconst e = await import('./e');\nimport './side';\nimport type { T } from './t';`;
  assert.deepEqual(jsSpecs(t).sort(), ['../b.js', './a', './c', './d', './e', './side', './t'].sort());
});

test('jsEdges: relative, index, TS ".js" specs, workspace packages and tsconfig paths', () => {
  const files = {
    'src/a.ts': "import { b } from './b.js'; import u from './util'; import w from '@ws/core'; import z from '@app/zed/deep';",
    'src/b.ts': 'export const b = 1',
    'src/util/index.ts': 'export default 1',
    'packages/core/package.json': '{"name":"@ws/core","main":"src/index.ts"}',
    'packages/core/src/index.ts': "import q from '../../../src/b'",
    'libs/zed/deep.ts': 'export {}',
    'tsconfig.json': '{ /* c */ "compilerOptions": { "baseUrl": ".", "paths": { "@app/zed/*": ["libs/zed/*"] } } }',
  };
  assert.deepEqual(key(jsEdges(mem(files))), ['packages/core/src/index.ts>src/b.ts', 'src/a.ts>libs/zed/deep.ts', 'src/a.ts>packages/core/src/index.ts', 'src/a.ts>src/b.ts', 'src/a.ts>src/util/index.ts']);
});

test('pyImports handles from/import forms, parentheses, aliases and comments', () => {
  const t = `import os, a.b as c\nfrom . import x\nfrom ..p.q import (r,\n  s as t)\n# import nope\nfrom __future__ import annotations\n`;
  const got = pyImports(t);
  assert.deepEqual(got.filter((i) => i.kind === 'import').map((i) => i.mod), ['os', 'a.b']);
  const rel = got.find((i) => i.dots === 2);
  assert.equal(rel.mod, 'p.q');
  assert.deepEqual(rel.names, ['r', 's']);
  assert.ok(!got.some((i) => i.mod === 'nope'));
});

test('pyEdges resolves absolute, relative and submodule-by-name imports', () => {
  const files = {
    'src/pkg/__init__.py': 'from .core import run\nfrom . import helpers',
    'src/pkg/core.py': 'import pkg.helpers',
    'src/pkg/helpers.py': '',
    'src/pkg/sub/__init__.py': '',
    'src/pkg/sub/m.py': 'from ..core import run\nfrom pkg.sub import m2',
    'src/pkg/sub/m2.py': '',
    'tests/test_x.py': 'from pkg import core\nimport pkg',
  };
  assert.deepEqual(key(pyEdges(mem(files))), [
    'src/pkg/__init__.py>src/pkg/core.py', 'src/pkg/__init__.py>src/pkg/helpers.py',
    'src/pkg/core.py>src/pkg/__init__.py', 'src/pkg/core.py>src/pkg/helpers.py',
    'src/pkg/sub/m.py>src/pkg/__init__.py', 'src/pkg/sub/m.py>src/pkg/core.py', 'src/pkg/sub/m.py>src/pkg/sub/__init__.py', 'src/pkg/sub/m.py>src/pkg/sub/m2.py',
    'tests/test_x.py>src/pkg/__init__.py', 'tests/test_x.py>src/pkg/core.py',
  ].sort());
});

test('moduleStem and grep patterns', () => {
  assert.equal(moduleStem('src/a/scan.ts'), 'scan');
  assert.equal(moduleStem('src/a/index.ts'), 'a');
  assert.equal(moduleStem('src/pkg/__init__.py'), 'pkg');
  const js = new RegExp(importGrepPattern('js', 'scan'));
  assert.ok(js.test(`import x from './scan.js'`));
  assert.ok(js.test(`const x = require("../lib/scan")`));
  assert.ok(!js.test(`import x from './scanner'`));
  const py = new RegExp(importGrepPattern('python', 'helpers'), 'm');
  assert.ok(py.test('from pkg import helpers'));
  assert.ok(py.test('from pkg.helpers import f'));
  assert.ok(py.test('import pkg.helpers'));
  assert.ok(!py.test('from pkg import helpers_extra'));
});
