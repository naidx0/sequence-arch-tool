/**
 * G13 — TWO ROWS THAT NAME THE SAME DIRECTORY AND CANNOT BE TOLD APART.
 *
 * Reported on the real django clone: `mod:Django/21` and `mod:Django/22` both
 * read "Filepathfield Test Dir" and both sat in
 * `tests/forms_tests/field_tests/filepathfield_test_dir` — one holding the four
 * files directly in that directory, the other the five in its `c/`, `h/` and
 * `j/` subdirectories. G8/G11/G12 fixed labels overwritten by a WORSE
 * candidate; here there is no candidate at all: the two clusters' `clusterDir`
 * is byte-identical so the upward walk climbs the same segments on both sides,
 * and the nine files are empty `__init__.py` stubs that import nothing, so
 * neither cluster has an anchor.
 *
 * The fixture below is that shape, file for file.
 *
 * The negative test is the load-bearing one: sharing a directory is NOT enough.
 * The corpus is full of same-directory cluster pairs that read differently
 * because a later naming stage separated them, and merging those would destroy
 * a distinction the reader can use.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeIndistinguishableModules } from '../cluster/cluster.js';
import { scanRepo } from '../scan.js';

test('two modules with the same label AND the same directory become one', () => {
  const dir = 'tests/forms_tests/field_tests/filepathfield_test_dir';
  const { drafts, labels } = mergeIndistinguishableModules(
    [
      { members: [`${dir}/__init__.py`, `${dir}/a.py`, `${dir}/ab.py`, `${dir}/b.py`], dir },
      { members: [`${dir}/c/__init__.py`, `${dir}/c/d.py`, `${dir}/c/e.py`, `${dir}/h/__init__.py`, `${dir}/j/__init__.py`], dir },
    ],
    ['filepathfield_test_dir', 'filepathfield_test_dir']
  );
  assert.strictEqual(drafts.length, 1, 'nine files, one directory, one module');
  assert.deepStrictEqual(labels, ['filepathfield_test_dir']);
  assert.strictEqual(drafts[0].members.length, 9, 'no file is dropped by the merge');
  assert.deepStrictEqual(
    drafts[0].members,
    [...drafts[0].members].sort(),
    'the merged member list stays deterministically ordered'
  );
});

test('a distinction the reader CAN use is never merged away', () => {
  const dir = 'module/spring-boot-jetty/src/main/java/org/springframework/boot/jetty';
  // The real spring-boot pair: same directory, but a later naming stage gave
  // each its own anchor file, so the two rows read differently.
  const before = [
    { members: [`${dir}/ConfigurableJettyWebServerFactory.java`, `${dir}/JettyWebServer.java`], dir },
    { members: [`${dir}/JettyReactiveWebServerFactory.java`, `${dir}/JettyServletWebServerFactory.java`], dir },
  ];
  const { drafts, labels } = mergeIndistinguishableModules(before, [
    'ConfigurableJettyWebServerFactory',
    'JettyReactiveWebServerFactory',
  ]);
  assert.strictEqual(drafts.length, 2, 'same directory is NOT sufficient — the labels differ');
  assert.deepStrictEqual(labels, ['ConfigurableJettyWebServerFactory', 'JettyReactiveWebServerFactory']);
});

test('the same label in DIFFERENT directories stays two modules', () => {
  const { drafts } = mergeIndistinguishableModules(
    [
      { members: ['backend/app/core/a.py'], dir: 'backend/app/core' },
      { members: ['backend/services/core/b.py'], dir: 'backend/services/core' },
    ],
    ['Core', 'Core']
  );
  assert.strictEqual(drafts.length, 2, 'these are two real directories — the walk can tell them apart');
});

test('a module with no shared directory is left alone', () => {
  // No `dir` means the module makes no claim about naming a directory; those
  // root-level collisions are what the anchor fallback exists for.
  const { drafts } = mergeIndistinguishableModules(
    [
      { members: ['a.ts', 'b.ts'] },
      { members: ['c.ts', 'd.ts'] },
    ],
    ['Top level', 'Top level']
  );
  assert.strictEqual(drafts.length, 2);
});

test('END TO END — the reported django shape scans to ONE module, with all nine files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g13-'));
  const write = (p: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), body);
  };
  // A real, importing package, so the service has something else to cluster.
  write('pyproject.toml', '[project]\nname = "forms"\n');
  for (const n of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']) {
    write(`forms/${n}.py`, `from forms.core import run\n\n\ndef ${n}():\n    return run()\n`);
  }
  write('forms/core.py', 'def run():\n    return 1\n');
  /*
   * The reported shape, verbatim: empty stubs, directly in the dir and below it.
   *
   * MOVED OUT OF `tests/` on 2026-08-21, and the move is the point of the extra
   * assertion at the end of this test. django reported this shape from a
   * directory under `tests/`, but test files no longer shape the architecture
   * view at all (see `testFiles.ts`) — so left where it was, this fixture would
   * produce no module and quietly stop exercising G13. The property under test
   * is "two module rows a reader cannot tell apart are merged into one", which
   * has nothing to do with where the files sit, so the shape is preserved and
   * the location is not.
   */
  const fx = 'forms/field_shapes/filepathfield_test_dir';
  for (const p of ['__init__.py', 'a.py', 'ab.py', 'b.py', 'c/__init__.py', 'c/d.py', 'c/e.py', 'h/__init__.py', 'j/__init__.py']) {
    write(`${fx}/${p}`, '');
  }

  const graph = await scanRepo(root, {});
  const named = graph.nodes.filter(
    (n) => n.kind === 'module' && (n.path ?? '').endsWith('filepathfield_test_dir')
  );
  assert.strictEqual(
    named.length,
    1,
    `the fixture directory must produce exactly one module row: ${JSON.stringify(named.map((n) => [n.label, n.meta?.files]))}`
  );
  assert.strictEqual(named[0].meta?.files, 9, 'and it must hold every file, not four of them');

  // The general property the report is an instance of: no two modules of one
  // service may read the same AND name the same directory.
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind !== 'module' || !n.path) continue;
    const key = `${n.parentId}|${String(n.label).toLowerCase()}|${n.path}`;
    assert.ok(!seen.has(key), `two module rows are indistinguishable: ${key}`);
    seen.add(key);
  }

  /*
   * AND THE RULE THAT MOVED THE FIXTURE, LOCKED IN ITS OWN RIGHT.
   *
   * A test directory must not become an architecture module. This is what the
   * relocation above is standing on, so it is asserted rather than assumed: put
   * the same nine files under `tests/` and no module row may appear for them.
   */
  const inTests = 'tests/field_tests/filepathfield_test_dir';
  for (const f of ['__init__.py', 'a.py', 'ab.py', 'b.py', 'c/__init__.py']) {
    write(`${inTests}/${f}`, '');
  }
  const withTests = await scanRepo(root, {});
  const testModules = withTests.nodes.filter(
    (n) => n.kind === 'module' && (n.path ?? '').includes('field_tests')
  );
  assert.deepStrictEqual(
    testModules.map((n) => n.label),
    [],
    'a test directory is not architecture and must not become a module row'
  );
});
