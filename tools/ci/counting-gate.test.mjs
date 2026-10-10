import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

/**
 * THE COUNTING GATE'S OWN PLANTED CASES.
 *
 * Designed in `docs/research/design-the-counting-gate-for-strangers.md` before
 * they were written. Until now **this gate had no test of its own**: the
 * empty-file proof — the case that made it able to fail at all — lived in a
 * commit message. A gate that cannot be shown to fail is exactly what this
 * repository's first law was written about, and it binds an instrument as much
 * as a product.
 *
 * Every case builds a throwaway repository in a temp directory and runs the gate
 * against it with `--root`. Nothing here reads Sequence, so these are also the
 * cases that say whether a stranger can use it.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'counting-gate.mjs');

/**
 * A repository with one package and whatever test files are given.
 *
 * `type: 'module'` IS LOAD-BEARING AND WAS MISSING, and its absence made these
 * cases pass or fail according to which Node built the runner rather than
 * according to the gate.
 *
 * Every fixture file below is written with `import`/`export` into a `.js` file.
 * With no `type` here, Node resolves that to CommonJS and the file is a
 * SyntaxError — except that since v22.7 Node SNIFFS the source and silently
 * treats it as ESM anyway. So on the Node 24 this is developed against all
 * seven cases passed, and on the Node 20 CI pins every fixture file failed to
 * import: `discovered 2  ran 0`, which is the exact symptom the `run()` comment
 * below already documents from a different cause.
 *
 * Declared rather than sniffed, because a fixture that means ESM should say so.
 * Relying on the inference put a Node-version dependency inside the one
 * instrument this repository uses to decide whether tests ran at all.
 */
function repo(
  files,
  pkg = { name: 'fixture', version: '1.0.0', type: 'module', scripts: { test: 'node --test test/*.test.js' } },
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fixture-'));
  /* A caller that supplies its own manifest still gets the module type: the
     files it is paired with are the same ESM ones. */
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', ...pkg }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

const run = (root) => {
  /*
   * THE TEST RUNNER'S OWN ENVIRONMENT MUST NOT REACH THE GATE.
   *
   * These cases run under `node --test`, which sets NODE_TEST_CONTEXT for its
   * children; the gate drives node:test's `run()` itself, and inheriting that
   * variable made every file report `discovered 2  ran 0` — the harness's
   * environment silently changing the answer the harness was measuring. The same
   * fixture run from a shell reported `ran 1` correctly.
   *
   * Stripped rather than worked around: a gate that behaves differently inside a
   * test than outside one cannot be tested at all.
   */
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const REAL = "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('a', () => assert.ok(true));\n";
const EMPTY = '/* a test file with no test in it */\nexport {};\n';

/* ── case 1: the planted empty file ──────────────────────────────────────── */

test('case 1: a discovered file that contributes NO test is counted as not run', () => {
  /*
   * THE CASE THE GATE WAS REBUILT AROUND, and it has never been a test. Node
   * emits a wrapper event per file, so a file containing nothing once reported
   * as ran and the gate printed "discovered 18, ran 18, exit 0" — a counting
   * gate that could not fail.
   */
  const root = repo({ 'test/real.test.js': REAL, 'test/empty.test.js': EMPTY });
  try {
    const { code, out } = run(root);
    assert.match(out, /discovered files\s+2/);
    assert.match(out, /files that ran\s+1/);
    assert.match(out, /empty\.test\.js/, 'the file is named, not just counted');
    assert.strictEqual(code, 2, 'a counting failure is exit 2, not 1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 2: the file no glob reaches ────────────────────────────────────── */

test('case 2: a built test file no glob reaches is named as unreached', () => {
  /*
   * The half `ran === discovered` can NEVER catch: a file outside the glob is
   * absent from both numbers, so they agree perfectly. That is why the walk sits
   * beside the count rather than inside it — and it is the shape that hid a
   * shipped template in this repository for as long as it existed.
   */
  const root = repo({ 'test/real.test.js': REAL, 'test/deep/hidden.test.js': REAL });
  try {
    const { code, out } = run(root);
    assert.match(out, /hidden\.test\.js/, 'the unreached file is named');
    assert.match(out, /NO GLOB REACHES IT/);
    assert.strictEqual(code, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 3: the ran-against-discovered line on a healthy tree ───────────── */

test('case 3: a healthy tree prints both numbers and exits 0', () => {
  /* A gate whose happy path is untested is a gate whose happy path can quietly
     stop printing. */
  const root = repo({ 'test/a.test.js': REAL, 'test/b.test.js': REAL });
  try {
    const { code, out } = run(root);
    assert.match(out, /discovered files\s+2/);
    assert.match(out, /files that ran\s+2/);
    assert.match(out, /every discovered file ran/);
    assert.strictEqual(code, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 4: a repository with no packages/ directory ────────────────────── */

test('case 4: a flat repository is counted as one package, not thrown at', () => {
  /*
   * THE CASE THAT DECIDES WHETHER A STRANGER CAN USE IT AT ALL. The gate used to
   * do `readdirSync(ROOT/'packages')`, which throws outright on a flat repo, a
   * src/ repo, or a Python repo — which is most repositories.
   */
  const root = repo({ 'test/a.test.js': REAL });
  try {
    const { code, out } = run(root);
    assert.doesNotMatch(out, /ENOENT/, 'no throw about a missing packages/ directory');
    assert.match(out, /packages with a node --test script\s+1/);
    assert.strictEqual(code, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 5: a count of nothing is not a pass ────────────────────────────── */

test('case 5: a repository this gate cannot count exits 2 rather than printing green', () => {
  /*
   * THE SECOND CASE A STRANGER MEETS, and the one that makes the tool safe to
   * hand over. A vitest monorepo or a Python repo used to print "every
   * discovered file ran" over a count of NOTHING — this gate's own defect one
   * layer up: a green that describes no tree.
   */
  const root = repo({ 'test/a.test.js': REAL }, {
    name: 'fixture',
    version: '1.0.0',
    scripts: { test: 'vitest run' },
  });
  try {
    const { code, out } = run(root);
    assert.match(out, /NOT COUNTED/, 'the uncountable package is named as a number');
    assert.match(out, /NONE could be counted/);
    assert.strictEqual(code, 2, 'nothing measured means nothing green');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('case 5b: no package at all is refused with what was searched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-empty-'));
  try {
    const { code, out } = run(root);
    assert.match(out, /no package was found/);
    assert.match(out, /pnpm-workspace\.yaml/, 'it says where it looked');
    assert.strictEqual(code, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── case 6: the exit code is the interface ──────────────────────────────── */

test('case 6: a failing test is exit 1, and a counting failure is exit 2 — never conflated', () => {
  /*
   * The brief's "lying runner" case belongs to the PUSH script, which reads this
   * gate's code and never its text; what belongs HERE is that the two failures
   * are distinguishable, because a caller that conflates them cannot act
   * differently. A red test is not a broken count.
   */
  const failing = "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('a', () => assert.ok(false));\n";
  const root = repo({ 'test/a.test.js': failing });
  try {
    const { code, out } = run(root);
    assert.match(out, /1 fail/);
    assert.strictEqual(code, 1, 'a failing test is 1, not 2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ── the record must not be written into the tree under test ─────────────── */

test('the gate writes its record beside itself, never into somebody else’s repo', () => {
  const root = repo({ 'test/a.test.js': REAL });
  try {
    run(root);
    assert.ok(!fs.existsSync(path.join(root, 'tools')), 'no directory was created in the tree under test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
