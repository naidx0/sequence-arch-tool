/**
 * H4 (half one) — GO FILES IN ONE DIRECTORY ARE ONE PACKAGE.
 *
 * Found by `tools/qa-loop` on `gin`: 58 Go files, 501 functions, 114 resolved
 * call edges — and CROSS-FILE call edges: zero. Every other language in this
 * scanner reaches another file through an import, so cross-file resolution was
 * import-driven only; Go files in one directory share a namespace with no
 * import between them, so a whole Go library resolved as 58 islands and
 * `detectStemCandidates` had no flow to find.
 *
 * The rule is Go's own, and it stays as strict as the import path beside it:
 * bare identifiers only, same directory only, methods excluded, unique or
 * nothing.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser } from '../parse/treesitter.js';
import { extractFacts } from '../parse/facts.js';
import { buildFunctionGraph, type FunctionGraphFileInput } from '../functions/buildFunctionGraph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.resolve(here, '..', '..', 'test', 'fixtures', 'go-package');

async function inputs(): Promise<FunctionGraphFileInput[]> {
  await initParser();
  const files = ['engine.go', 'router.go', 'handlers/health.go'];
  return files.map((rel) => {
    const facts = extractFacts(fs.readFileSync(path.join(FX, rel), 'utf8'), rel, 'go');
    return { file: rel, lang: 'go', functions: facts.functions, calls: facts.calls, imports: [] };
  });
}

test('a bare call resolves to the package-mate that declares it', async () => {
  const g = buildFunctionGraph(await inputs());
  const byFile = new Map(g.nodes.map((n) => [n.id, n.file]));
  const cross = g.edges
    .map((e) => `${byFile.get(e.srcId)} -> ${byFile.get(e.dstId)}`)
    .filter((s) => {
      const [a, b] = s.split(' -> ');
      return a !== b;
    });
  assert.ok(
    cross.includes('engine.go -> router.go'),
    `Run() calls normalizePath()/debugPrint() in the same package: ${JSON.stringify(cross)}`
  );
});

test('package scope stops at the directory, and never resolves a method', async () => {
  const g = buildFunctionGraph(await inputs());
  const fileOf = new Map(g.nodes.map((n) => [n.id, n.file]));

  // handlers/ is a different package: its `normalizePath` call resolves to
  // nothing rather than reaching into the parent directory.
  for (const e of g.edges) {
    const src = fileOf.get(e.srcId);
    const dst = fileOf.get(e.dstId);
    assert.ok(
      !(src === 'handlers/health.go' && dst === 'router.go'),
      'a call must not cross a package (directory) boundary without an import'
    );
  }

  // `Reset` exists only as a method — no bare call may ever land on it.
  const resetNodes = g.nodes.filter((n) => n.name === 'Reset').map((n) => n.id);
  assert.strictEqual(resetNodes.length, 1, 'fixture should declare exactly one Reset');
  assert.ok(
    !g.edges.some((e) => resetNodes.includes(e.dstId)),
    'a Go method is only reachable through its receiver'
  );
});

test('the parser records which Go declarations are methods', async () => {
  await initParser();
  const facts = extractFacts(fs.readFileSync(path.join(FX, 'engine.go'), 'utf8'), 'engine.go', 'go');
  const run = facts.functions.find((f) => f.name === 'Run');
  const reset = facts.functions.find((f) => f.name === 'Reset');
  assert.ok(run && reset, 'fixture should declare Run and Reset');
  assert.notStrictEqual(run!.method, true, 'Run is a package-level func');
  assert.strictEqual(reset!.method, true, 'Reset is a method');
});
