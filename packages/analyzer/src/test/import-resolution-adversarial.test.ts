/**
 * Adversarial import-resolution cases, end to end through `scanRepo`.
 *
 * The TypeScript ESM fix took this repo's graph from 87 edges to 2307 — a 26x change
 * to the thing the whole product is built on. `ts-esm-import-resolution.test.ts` locks
 * the RULE at the `resolveImport` unit level; this file runs the hostile cases through
 * a real scan, because a resolver that is correct in isolation can still hang, invent
 * edges, or drop them once it is inside the walk.
 *
 * Every case below was run manually against the corpus first and the behaviour
 * confirmed before being written down — these assert observed behaviour, not hoped-for
 * behaviour.
 *
 * One honest note: the first draft of the "deep climb" case was a BAD FIXTURE. From
 * `src/a/top.ts`, `../../a/b/c/leaf.js` resolves to `a/b/c/leaf.ts` at the repo root,
 * which does not exist — so the zero edges it produced were correct and my test was
 * wrong. The corrected case below climbs from `src/a/b/c/leaf.ts` to `src/shared.ts`,
 * which is a real climb. Worth recording: an adversarial corpus finds bugs in the
 * corpus at least as often as in the code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../scan.js';

/** Build a throwaway repo from a {relativePath: contents} map. */
function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-imports-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

const base = (name: string) => path.basename(String(name).replace(/^file:/, ''));

/** Import edges as `from->to` basenames, which is what these cases are about. */
async function importEdges(dir: string): Promise<string[]> {
  const graph = await scanRepo(dir);
  return graph.edges
    .filter((e) => e.kind === 'import')
    .map((e) => `${base(e.srcId)}->${base(e.dstId)}`)
    .sort();
}

test('a circular import terminates and records both directions', async () => {
  // The resolver walks per-file, so a cycle cannot recurse — but asserting it means a
  // future memoised or graph-walking rewrite cannot reintroduce a hang here.
  const dir = repo({
    'package.json': '{"name":"cycle"}\n',
    'src/a.ts': "import { b } from './b.js';\nexport const a = b;\n",
    'src/b.ts': "import { a } from './a.js';\nexport const b = a;\n",
  });
  try {
    assert.deepEqual(await importEdges(dir), ['a.ts->b.ts', 'b.ts->a.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a self-import produces no edge', async () => {
  // A node pointing at itself is noise on the board and tells a reader nothing.
  const dir = repo({
    'package.json': '{"name":"self"}\n',
    'src/me.ts': "import { x } from './me.js';\nexport const x = 1;\n",
  });
  try {
    assert.deepEqual(await importEdges(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a REAL .js file wins over the TypeScript rewrite', async () => {
  // The guard that matters most in the ESM fix, proven on a real scan rather than a
  // unit call. `plain.js` and `plain.ts` both exist; `./plain.js` must mean the
  // JavaScript one. Getting this wrong would silently redirect every import in a
  // mixed JS/TS codebase to the wrong file, and the graph would look plausible.
  const dir = repo({
    'package.json': '{"name":"ambig"}\n',
    'src/plain.js': "export const real = 'javascript';\n",
    'src/plain.ts': "export const shadow = 'typescript';\n",
    'src/main.ts': "import { real } from './plain.js';\nexport const v = real;\n",
  });
  try {
    assert.deepEqual(await importEdges(dir), ['main.ts->plain.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a case-mismatched specifier does NOT resolve', async () => {
  // `./foo.js` against `Foo.ts` on disk. Windows would resolve it and Linux would not,
  // so resolving it here would mean the graph disagrees with itself across machines
  // and hides a real portability bug in the scanned repo. Matching TypeScript's
  // case-sensitive semantics is the stricter and more useful answer.
  const dir = repo({
    'package.json': '{"name":"case"}\n',
    'src/Foo.ts': 'export const f = 1;\n',
    'src/bar.ts': "import { f } from './foo.js';\nexport const g = f;\n",
  });
  try {
    assert.deepEqual(await importEdges(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory import with no index resolves to nothing', async () => {
  const dir = repo({
    'package.json': '{"name":"dironly"}\n',
    'src/thing/notindex.ts': 'export const q = 1;\n',
    'src/main.ts': "import { q } from './thing.js';\nexport const r = q;\n",
  });
  try {
    assert.deepEqual(await importEdges(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a deep relative climb resolves', async () => {
  // src/a/b/c/leaf.ts -> ../../../shared.js == src/shared.ts
  const dir = repo({
    'package.json': '{"name":"climb"}\n',
    'src/shared.ts': 'export const shared = 1;\n',
    'src/a/b/c/leaf.ts': "import { shared } from '../../../shared.js';\nexport const leaf = shared;\n",
  });
  try {
    assert.deepEqual(await importEdges(dir), ['leaf.ts->shared.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
