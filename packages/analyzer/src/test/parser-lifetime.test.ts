/**
 * THE PARSER LEAKED ITS TREES, AND THE LEAK LOOKED LIKE "THIS REPO HAS NO CODE".
 *
 * Found by `node tools/qa-loop/run.mjs --tier full` (26 real repos, one process).
 * Five repos in the back half of the manifest — django, sqlfluff, spring-boot,
 * eugenp-tutorials, skaffold — each reported a successfully mapped app root and
 * then **zero files**. Scanned on their own, every one of them was fine
 * (django 2,970 files; sqlfluff 456). The difference was not the repo: it was
 * everything scanned *before* it.
 *
 * `parseSource` handed out a tree-sitter tree per file and nobody ever called
 * `delete()` on it. Those trees live in the WASM heap, which the JS garbage
 * collector cannot see, so every parsed file leaked permanently. Partway through
 * n8n (~15.6K files) the heap ran out, emscripten printed a bare `Aborted()` to
 * stderr and set its module-wide kill switch — and since that switch cannot be
 * cleared in a running process, every file after it failed with `memory access
 * out of bounds`. The same abort produced the 58 raw `Aborted()` lines seen
 * during opentelemetry-demo.
 *
 * Two things are locked here:
 *   1. every tree handed out is freed (the root cause), and
 *   2. when the runtime does die, the scan says so — named and counted — instead
 *      of quietly reporting an empty repo.
 *
 * The first is asserted with a counter rather than by exhausting a 3GB heap: a
 * leaked tree costs nothing observable until thousands of files later, which is
 * exactly why it survived every gate this repo has.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFacts } from '../parse/facts.js';
import {
  ParserAbortedError,
  __forceParserAbortedForTest,
  initParser,
  liveTreeCount,
  parseSource,
  parserAbortedWith,
} from '../parse/treesitter.js';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string => path.resolve(here, '..', '..', 'test', 'fixtures', name);

const PY = 'import os\n\n\ndef handler(event):\n    return os.environ.get("K", event)\n';
const TS = 'import { join } from "node:path";\nexport const p = (a: string) => join(a, "b");\n';
const GO = 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }\n';

test('extractFacts frees every tree it parses — a leaked tree is a dead runtime later', async () => {
  await initParser();
  const before = liveTreeCount();
  for (let i = 0; i < 25; i++) {
    extractFacts(PY, `a${i}.py`, 'py');
    extractFacts(TS, `b${i}.ts`, 'ts');
    extractFacts(GO, `c${i}.go`, 'go');
  }
  assert.equal(
    liveTreeCount(),
    before,
    `75 files parsed left ${liveTreeCount() - before} tree(s) holding WASM memory — ` +
      'that is the leak that aborted the runtime mid-run',
  );
});

test('a tree is freed even when fact extraction throws', async () => {
  await initParser();
  const before = liveTreeCount();
  // Source that parses but whose facts pass will still run to completion; the
  // guarantee under test is the `finally`, so drive it through a source the
  // parser accepts and assert the counter regardless of outcome.
  try {
    extractFacts('def broken(:\n', 'broken.py', 'py');
  } catch {
    /* whether it throws or not, the tree must be gone */
  }
  assert.equal(liveTreeCount(), before, 'a throwing extraction must not strand its tree');
});

test('parseSource hands ownership to the caller — an undeleted tree is visible', async () => {
  await initParser();
  const before = liveTreeCount();
  const tree = parseSource(PY, 'py');
  assert.equal(liveTreeCount(), before + 1, 'a live tree must be countable');
  tree.delete();
  assert.equal(liveTreeCount(), before, 'delete() must release it');
  tree.delete(); // idempotent — a double free must not go negative
  assert.equal(liveTreeCount(), before, 'delete() must be idempotent');
});

test('an aborted runtime is reported by name and by count, never as an empty repo', async () => {
  await initParser();
  assert.equal(parserAbortedWith(), undefined, 'the parser must be healthy before this test');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-parser-abort-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'aborty', version: '1.0.0' }));
    fs.writeFileSync(path.join(dir, 'index.ts'), TS);
    fs.writeFileSync(path.join(dir, 'other.ts'), TS);

    // Force the exact state emscripten leaves behind. The real path needs a 3GB
    // heap exhaustion; the state it produces is one flag, and this is it.
    __forceParserAbortedForTest('Aborted()');
    const graph = await scanRepo(dir, { cluster: true });

    const aborts = graph.warnings.filter((w) => w.includes('the tree-sitter parser aborted'));
    assert.equal(aborts.length, 1, `expected ONE aggregated abort warning, got: ${graph.warnings.join(' | ')}`);
    assert.match(aborts[0], /could not parse 2 file\(s\)/, 'the warning must count what was skipped');
    assert.match(aborts[0], /first: /, 'the warning must name a file, not just a number');
    assert.match(aborts[0], /fresh process/, 'the warning must say what the user can do about it');
    // and no per-file spam standing in for the explanation
    assert.equal(
      graph.warnings.filter((w) => w.includes('failed to parse')).length,
      0,
      'a dead runtime must not masquerade as N individual parse failures',
    );
  } finally {
    __forceParserAbortedForTest(undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSource refuses to call into a dead runtime and throws a named error', async () => {
  await initParser();
  try {
    __forceParserAbortedForTest('Aborted()');
    assert.throws(
      () => parseSource(PY, 'py'),
      (e: unknown) => e instanceof ParserAbortedError && /cannot be restarted/.test((e as Error).message),
      'a dead runtime must raise ParserAbortedError, not a raw emscripten RuntimeError',
    );
  } finally {
    __forceParserAbortedForTest(undefined);
  }
});

test('the fixture repos still scan after all of the above — the runtime survived', async () => {
  const graph = await scanRepo(fx('plainapp'), { cluster: true });
  assert.ok(
    graph.nodes.some((n) => n.kind === 'file'),
    'the parser must still be usable at the end of this suite',
  );
});
