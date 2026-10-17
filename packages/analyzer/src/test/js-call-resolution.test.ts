/**
 * U31 — Express / JS dotted-callee resolution.
 *
 * Measured on express at `a3714473`: 276 dotted call sites in `lib/`, 23
 * resolvable `this.method` → same-file unique method. The function graph had
 * been intra-file only because `BARE_CALLEE` dropped every `this.set` call.
 *
 * Positive tests lock `this.method` same-file resolution and anonymous CJS
 * `exports.name = function()` extraction. Negative tests lock what we
 * deliberately do NOT resolve: framework dispatch (`app.get`), ambiguous
 * names, and `module.exports = require(...)` (U23).
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser } from '../parse/treesitter.js';
import { extractFacts } from '../parse/facts.js';
import { buildFunctionGraph, MODULE_SCOPE_NAME, type FunctionGraphFileInput } from '../functions/buildFunctionGraph.js';
import { resolveJsCallee } from '../functions/jsResolve.js';
import type { FunctionFact } from '../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.resolve(here, '..', '..', 'test', 'fixtures', 'express-cjs');

const FILES = ['lib/app.js', 'lib/utils.js', 'lib/ambiguous.js', 'index.js'];

async function inputs(): Promise<FunctionGraphFileInput[]> {
  await initParser();
  return FILES.map((rel) => {
    const facts = extractFacts(fs.readFileSync(path.join(FX, rel), 'utf8'), rel, 'js');
    return {
      file: rel,
      lang: 'js',
      functions: facts.functions,
      calls: facts.calls,
      imports: facts.imports.map((imp) => ({ raw: imp.raw, line: imp.line, names: imp.names, moduleGranular: imp.moduleGranular })),
      loc: facts.loc,
    };
  });
}

/** `a.js -> b.js` for every call edge, sources and targets as file paths. */
async function edgePairs(): Promise<string[]> {
  const g = buildFunctionGraph(await inputs());
  const label = new Map(g.nodes.map((n) => [n.id, `${n.file}#${n.name}`]));
  return g.edges.map((e) => `${label.get(e.srcId)} -> ${label.get(e.dstId)}`);
}

test('anonymous CJS exports are extracted as FunctionFact', async () => {
  await initParser();
  const facts = extractFacts(fs.readFileSync(path.join(FX, 'lib/utils.js'), 'utf8'), 'lib/utils.js', 'js');
  const names = facts.functions.map((fn) => fn.name);
  assert.ok(names.includes('compileETag'), 'exports.compileETag = function() must be named compileETag');
  assert.ok(names.includes('formatUrl'), 'named function expressions on exports still count');
  assert.equal(names.filter((n) => n === 'duplicate').length, 2, 'duplicate export names stay honest');
});

test('`this.method(...)` resolves inside the caller\'s own file', async () => {
  const pairs = await edgePairs();
  assert.ok(
    pairs.includes('lib/app.js#configure -> lib/app.js#setup'),
    '`this.setup()` from configure must resolve'
  );
  assert.ok(
    pairs.includes('lib/app.js#setup -> lib/app.js#set'),
    '`this.set()` from setup must resolve'
  );
  assert.ok(
    pairs.includes('lib/app.js#dispatch -> lib/app.js#handle'),
    '`this.handle()` from dispatch must resolve'
  );
});

test('framework dispatch and non-this receivers resolve to nothing', async () => {
  const pairs = await edgePairs();
  const fromListen = pairs.filter((p) => p.startsWith('lib/app.js#listen '));
  assert.deepStrictEqual(
    fromListen,
    [],
    '`app.get(...)` is framework dispatch — must not invent an edge'
  );

  const utilsPairs = pairs.filter((p) => p.startsWith('lib/utils.js#useEtag '));
  assert.deepStrictEqual(
    utilsPairs,
    [],
    '`exports.compileETag()` is not a `this.method` call — must not resolve here'
  );
});

test('ambiguous same-file names resolve to nothing', async () => {
  const pairs = await edgePairs();
  assert.deepStrictEqual(
    pairs.filter((p) => p.startsWith('lib/ambiguous.js#run ')),
    [],
    'two `helper` declarations — unique or nothing'
  );
  assert.deepStrictEqual(
    pairs.filter((p) => p.startsWith('lib/app.js#ambiguous ')),
    [],
    'a missing `helper` is not resolved to a guess'
  );
});

test('`resolveJsCallee` unit: this-only, unique-or-nothing', () => {
  const index = new Map<string, FunctionFact | null>([
    ['setup', { name: 'setup', startLine: 1, endLine: 3 }],
    ['set', { name: 'set', startLine: 5, endLine: 7 }],
    ['dup', null],
  ]);
  const lookup = () => index;

  const hit = resolveJsCallee('this.setup', 'lib/app.js', lookup);
  assert.ok(hit?.fn.name === 'setup');

  assert.strictEqual(resolveJsCallee('app.get', 'lib/app.js', lookup), undefined);
  assert.strictEqual(resolveJsCallee('exports.compileETag', 'lib/utils.js', lookup), undefined);
  assert.strictEqual(resolveJsCallee('this.dup', 'lib/app.js', lookup), undefined);
  assert.strictEqual(resolveJsCallee('this.missing', 'lib/app.js', lookup), undefined);
});

test('the entry re-export still has no outbound edge — U23', async () => {
  const g = buildFunctionGraph(await inputs());
  const entryIds = new Set(g.nodes.filter((n) => n.file === 'index.js').map((n) => n.id));
  assert.equal(entryIds.size, 0, 'module.exports = require(...) names no function this scan knows');
  const out = g.edges.filter((e) => entryIds.has(e.srcId));
  assert.deepStrictEqual(out, []);
});

test('module scope is not invented for the entry re-export', async () => {
  await initParser();
  const facts = extractFacts(fs.readFileSync(path.join(FX, 'index.js'), 'utf8'), 'index.js', 'js');
  const g = buildFunctionGraph([
    {
      file: 'index.js',
      lang: 'js',
      functions: facts.functions,
      calls: facts.calls,
      imports: facts.imports.map((imp) => ({ raw: imp.raw, line: imp.line, moduleGranular: imp.moduleGranular })),
      loc: facts.loc,
    },
  ]);
  assert.equal(
    g.nodes.filter((n) => n.name === MODULE_SCOPE_NAME).length,
    0,
    'a top level that resolves nothing must not gain a module-scope node'
  );
});

test('no OTHER language gained JS-only resolution', async () => {
  await initParser();
  for (const [src, file, lang] of [
    ['def a():\n    b()\n', 'a.py', 'py'],
    ['package main\nfunc a() { b() }\n', 'a.go', 'go'],
    [
      'class A { void a() { this.b(); } void b() {} }',
      'A.java',
      'java',
    ],
  ] as const) {
    const facts = extractFacts(src, file, lang);
    const g = buildFunctionGraph([
      {
        file,
        lang,
        functions: facts.functions,
        calls: facts.calls,
        imports: facts.imports.map((imp) => ({ raw: imp.raw, line: imp.line })),
        loc: facts.loc,
        varTypes: facts.varTypes,
      },
    ]);
    if (lang === 'java') {
      assert.ok(
        g.edges.some((e) => e.srcId.includes('#a@') && e.dstId.includes('#b@')),
        'Java keeps its own this.method resolver'
      );
    } else {
      assert.equal(g.edges.length, 0, `${lang} must not pick up JS resolver`);
    }
  }
});

test('fixture graph edge count is grounded', async () => {
  const g = buildFunctionGraph(await inputs());
  assert.ok(
    g.edges.length >= 3,
    `expected at least the three this.method hops in lib/app.js, got ${g.edges.length}`
  );
});
