import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';

/**
 * A RE-EXPORT IS A DEPENDENCY AND THE SCANNER SAW NONE OF THEM.
 *
 * `export { renderBrief } from './brief.js'` makes the exporting file depend on
 * the exported one exactly as an import does: the module is loaded, its code
 * runs, and a change to it changes this file's surface. Only `import_statement`
 * was handled, so every one of these edges was missing from the graph.
 *
 * FOUND FROM A PICTURE. A derived chart of `brief.ts` drew four importers and
 * omitted `index.ts`, which reaches it by re-export. The chart was right about
 * the scan and the scan was wrong about the repository — and a barrel
 * `index.ts` is exactly where a codebase concentrates these.
 *
 * MEASURED on this repository: **2,600 edges to 2,851, +251**, with 185 of
 * 1,023 files changing their inbound count and 22 files going from "nothing
 * depends on this" to having dependents. Roughly one edge in eleven was
 * missing from every dependency claim the product made.
 */
function repoWith(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-reexport-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'r', version: '1.0.0' }));
  for (const [rel, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(repo, rel), body);
  }
  return repo;
}

const edgeKeys = (edges: readonly { srcId: string; dstId: string }[]): Set<string> =>
  new Set(edges.map((e) => `${e.srcId}>${e.dstId}`));

test('a named re-export makes an edge, exactly as an import does', async () => {
  const repo = repoWith({
    'src/leaf.ts': 'export const a = 1;\n',
    'src/barrel.ts': "export { a } from './leaf.js';\n",
    'src/plain.ts': "import { a } from './leaf.js';\nconsole.log(a);\n",
  });
  try {
    const graph = await scanRepo(repo, {});
    const keys = edgeKeys(graph.edges);
    assert.ok(keys.has('file:src/plain.ts>file:src/leaf.ts'), 'the import, as always');
    assert.ok(
      keys.has('file:src/barrel.ts>file:src/leaf.ts'),
      'and the re-export, which produced nothing at all before',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a star re-export makes an edge too', async () => {
  /* `export * from` names nothing in particular, so it is module-granular the
     way a side-effect import is — but it is no less a dependency. */
  const repo = repoWith({
    'src/leaf.ts': 'export const a = 1;\n',
    'src/star.ts': "export * from './leaf.js';\n",
  });
  try {
    const graph = await scanRepo(repo, {});
    assert.ok(edgeKeys(graph.edges).has('file:src/star.ts>file:src/leaf.ts'));
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a local export is not an edge to anywhere', async () => {
  /* The half that keeps this honest: only an export WITH A SOURCE is a
     dependency. `export const a = 1` depends on nothing, and a rule that
     counted it would invent an edge out of every file in the repository. */
  const repo = repoWith({
    'src/leaf.ts': 'export const a = 1;\nexport function f() { return a; }\n',
  });
  try {
    const graph = await scanRepo(repo, {});
    assert.deepStrictEqual(
      graph.edges.filter((e) => e.srcId === 'file:src/leaf.ts'),
      [],
      'a file that re-exports nothing depends on nothing',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

/* ═══ Python: measured, not assumed ══════════════════════════════════════ */

function pyRepoWith(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-pyre-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'pyproject.toml'), '[project]\nname = "p"\nversion = "0.1.0"\n');
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(repo, rel), body);
  return repo;
}

test('Python re-export shapes already make edges — the gap was JS syntax, not the idea', async () => {
  /*
   * MEASURED RATHER THAN ASSUMED, because "the same gap probably exists in
   * Python" is exactly the kind of claim that gets repeated until someone
   * builds on it.
   *
   * It does not. A JavaScript re-export is `export … from`, a node type with no
   * import counterpart and no branch in the parser. A PYTHON re-export is
   * literally an import statement — `from .leaf import A` in an `__init__.py`
   * is the same syntax as any other import — so it was always handled.
   *
   * All three shapes below produced edges before the JS/TS change and produce
   * them after it. This test exists so that stays true.
   */
  const repo = pyRepoWith({
    'pkg/leaf.py': 'A = 1\n',
    'pkg/named.py': 'from .leaf import A\n',
    'pkg/star.py': 'from .leaf import *\n',
    'pkg/__init__.py': 'from .leaf import A\n__all__ = ["A"]\n',
  });
  try {
    const graph = await scanRepo(repo, {});
    const keys = edgeKeys(graph.edges);
    for (const src of ['named', 'star', '__init__']) {
      assert.ok(
        keys.has(`file:pkg/${src}.py>file:pkg/leaf.py`),
        `${src}.py re-exports leaf.py and must depend on it`,
      );
    }
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
