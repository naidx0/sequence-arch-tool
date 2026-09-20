/**
 * H10 — GO CROSS-PACKAGE IMPORT EDGES.
 *
 * H4 fixed same-directory package scope (bare identifiers). Cross-directory
 * calls are always qualified (`shop.Run`) and need import-path resolution via
 * go.mod + the declared `package` name (or an explicit alias).
 *
 * Every negative test is as important as the positive one: a bare call across
 * directories without an import must still resolve to nothing.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser } from '../parse/treesitter.js';
import { extractFacts } from '../parse/facts.js';
import { buildFunctionGraph, type FunctionGraphFileInput } from '../functions/buildFunctionGraph.js';
import {
  buildGoPackageNameByDir,
  readGoModulePath,
  resolveGoCallee,
  resolveGoImportToFile,
} from '../functions/goResolve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.resolve(here, '..', '..', 'test', 'fixtures', 'go-import-cross-pkg');
const MODULE = 'example.com/shop';

const FILES = ['engine.go', 'router.go', 'handlers/health.go'];

async function inputs(): Promise<FunctionGraphFileInput[]> {
  await initParser();
  const fileSet = new Set(FILES);
  return FILES.map((rel) => {
    const facts = extractFacts(fs.readFileSync(path.join(FX, rel), 'utf8'), rel, 'go');
    return {
      file: rel,
      lang: 'go' as const,
      functions: facts.functions,
      calls: facts.calls,
      imports: facts.imports.map((imp) => ({
        raw: imp.raw,
        line: imp.line,
        names: imp.names,
        moduleGranular: imp.moduleGranular,
        resolved: resolveGoImportToFile(imp.raw, MODULE, '.', fileSet),
      })),
      goPackageName: facts.goPackageName,
    };
  });
}

test('resolveGoImportToFile maps a module import path to a file in the scan', () => {
  const fileSet = new Set(FILES);
  assert.strictEqual(
    resolveGoImportToFile('example.com/shop', MODULE, '.', fileSet),
    'engine.go'
  );
  assert.strictEqual(
    resolveGoImportToFile('example.com/shop/handlers', MODULE, '.', fileSet),
    'handlers/health.go'
  );
  assert.strictEqual(resolveGoImportToFile('fmt', MODULE, '.', fileSet), undefined);
});

test('readGoModulePath reads the module directive from go.mod on disk', () => {
  assert.strictEqual(readGoModulePath(FX, '.'), MODULE);
});

test('a qualified import call resolves across package directories', async () => {
  const g = buildFunctionGraph(await inputs());
  const byFile = new Map(g.nodes.map((n) => [n.id, n.file]));
  const cross = g.edges
    .map((e) => `${byFile.get(e.srcId)} -> ${byFile.get(e.dstId)}`)
    .filter((s) => {
      const [a, b] = s.split(' -> ');
      return a !== b;
    });
  assert.ok(
    cross.includes('handlers/health.go -> engine.go'),
    `shop.Run must resolve to the root package: ${JSON.stringify(cross)}`
  );
});

test('H4 regression: same-directory bare calls still resolve', async () => {
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
    `normalizePath/debugPrint are same-package: ${JSON.stringify(cross)}`
  );
});

test('a bare call does not cross a package boundary without an import', async () => {
  const g = buildFunctionGraph(await inputs());
  const fileOf = new Map(g.nodes.map((n) => [n.id, n.file]));
  for (const e of g.edges) {
    const src = fileOf.get(e.srcId);
    const dst = fileOf.get(e.dstId);
    assert.ok(
      !(src === 'handlers/health.go' && dst === 'router.go'),
      'normalizePath is not in scope in handlers — must not resolve'
    );
  }
});

test('methods are never resolved through import bindings', async () => {
  const g = buildFunctionGraph(await inputs());
  const resetNodes = g.nodes.filter((n) => n.name === 'Reset').map((n) => n.id);
  assert.strictEqual(resetNodes.length, 1);
  assert.ok(!g.edges.some((e) => resetNodes.includes(e.dstId)));
});

test('resolveGoCallee uses the declared package name as the default binding', async () => {
  const fileInputs = await inputs();
  const goByDirName = new Map<string, Map<string, { file: string; fn: import('../types.js').FunctionFact }[]>>();
  const dirOf = (f: string): string => (f.lastIndexOf('/') < 0 ? '' : f.slice(0, f.lastIndexOf('/')));

  for (const entry of fileInputs) {
    const dir = dirOf(entry.file);
    const byName = goByDirName.get(dir) ?? new Map();
    for (const fn of entry.functions) {
      if (fn.method === true) continue;
      const bucket = byName.get(fn.name) ?? [];
      bucket.push({ file: entry.file, fn });
      byName.set(fn.name, bucket);
    }
    goByDirName.set(dir, byName);
  }

  const health = fileInputs.find((f) => f.file === 'handlers/health.go')!;
  const pkgNames = buildGoPackageNameByDir(fileInputs);
  const target = resolveGoCallee('shop.Run', health.imports ?? [], pkgNames, goByDirName);
  assert.ok(target);
  assert.strictEqual(target!.file, 'engine.go');
  assert.strictEqual(target!.fn.name, 'Run');
});
