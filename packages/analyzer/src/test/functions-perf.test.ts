/**
 * LOCKING TEST for the function-graph performance round (H12b).
 *
 * `buildFunctionGraph` resolved every call by re-scanning the whole function
 * list of the file (`.filter` per call — O(calls × functions), with an
 * allocation each time) and every Go package call by re-filtering the whole
 * package. Both are now indexed once per file / per package.
 *
 * That is a pure performance change, so this test runs the ORIGINAL resolution
 * loop — assembled from the still-exported originals `enclosingFunction`,
 * `resolveCalleeInFile` and `resolveCalleeInPackage` — as an ORACLE, over
 * randomly generated file inputs full of the awkward shapes (duplicate function
 * names, nested and identical spans, methods, same-package Go files, named vs
 * namespace imports), and asserts the shipped implementation returns exactly
 * the same nodes and edges, in the same order.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { functionEdgeId, functionNodeId, type FunctionGraph } from '@sequence/schema';
import type { FunctionFact } from '../types.js';
import {
  buildFunctionGraph,
  enclosingFunction,
  resolveCalleeInFile,
  resolveCalleeInPackage,
  MODULE_GRANULAR_CALL_LABEL,
  MODULE_SCOPE_NAME,
  type FunctionGraphFileInput,
} from '../functions/buildFunctionGraph.js';

/* ------------------------------------------------------------------ oracle -- */

function nodeId(file: string, fn: FunctionFact): string {
  return functionNodeId(file, fn.name, fn.startLine);
}

/** The pre-index implementation, verbatim apart from cross-file resolution
 * (which this round did not touch and is called through the shipped code path
 * only in the sense that it is re-implemented identically here). */
function oracleGraph(files: FunctionGraphFileInput[]): FunctionGraph {
  const nodes: FunctionGraph['nodes'] = [];
  const edges: FunctionGraph['edges'] = [];
  const edgeIds = new Set<string>();
  const functionsByFile = new Map<string, FunctionFact[]>();
  const goFunctionsByDir = new Map<string, { file: string; fn: FunctionFact }[]>();
  const dirOf = (f: string): string => (f.lastIndexOf('/') < 0 ? '' : f.slice(0, f.lastIndexOf('/')));

  for (const entry of files) {
    const file = entry.file;
    const fnList = entry.functions;
    if (file) functionsByFile.set(file, fnList);
    if (file && entry.lang === 'go') {
      const dir = dirOf(file);
      const bucket = goFunctionsByDir.get(dir) ?? [];
      for (const fn of fnList) if (fn && typeof fn.name === 'string') bucket.push({ file, fn });
      goFunctionsByDir.set(dir, bucket);
    }
  }

  for (const entry of files) {
    const file = entry.file;
    const lang = entry.lang;
    const fnList = entry.functions;
    /* U23 module scope, stated independently of the shipped implementation:
     * py/js/ts only, created lazily by the FIRST top-level call that resolves,
     * spanning line 1 to `loc` (or the last call line when `loc` is absent),
     * and emitted after this file's declared functions. */
    const moduleAllowed = lang === 'py' || lang === 'js' || lang === 'ts';
    let moduleScope: FunctionFact | undefined;
    const moduleScopeFor = (): FunctionFact => {
      if (!moduleScope) {
        let lastCall = 1;
        for (const c of entry.calls) if (c && c.line > lastCall) lastCall = c.line;
        const loc = typeof entry.loc === 'number' && entry.loc > 0 ? entry.loc : 0;
        moduleScope = { name: MODULE_SCOPE_NAME, startLine: 1, endLine: Math.max(loc, lastCall, 1) };
      }
      return moduleScope;
    };
    const pendingEdges: { srcFn: FunctionFact; dstFile: string; dstFn: FunctionFact; moduleGranular: boolean }[] = [];

    for (const call of entry.calls) {
      if (!call.callee || call.line <= 0) continue;
      const srcFn = enclosingFunction(call.line, fnList);
      if (!srcFn && !moduleAllowed) continue;
      let dstFile = file;
      let dstFn = resolveCalleeInFile(call.callee, fnList);
      let moduleGranular = false;
      if (!dstFn) {
        const cross = oracleCrossFile(call.callee, entry.imports ?? [], functionsByFile);
        if (cross) {
          dstFile = cross.file;
          dstFn = cross.fn;
          moduleGranular = cross.moduleGranular;
        } else if (lang === 'go') {
          const samePackage = resolveCalleeInPackage(call.callee, file, goFunctionsByDir);
          if (!samePackage) continue;
          dstFile = samePackage.file;
          dstFn = samePackage.fn;
        } else {
          continue;
        }
      }
      pendingEdges.push({ srcFn: srcFn ?? moduleScopeFor(), dstFile, dstFn, moduleGranular });
    }

    for (const fn of fnList) {
      if (!fn.name || fn.startLine <= 0 || fn.endLine < fn.startLine) continue;
      nodes.push({ id: nodeId(file, fn), name: fn.name, file, startLine: fn.startLine, endLine: fn.endLine, lang });
    }
    if (moduleScope) {
      nodes.push({
        id: nodeId(file, moduleScope),
        name: moduleScope.name,
        file,
        startLine: moduleScope.startLine,
        endLine: moduleScope.endLine,
        lang,
      });
    }

    for (const { srcFn, dstFile, dstFn, moduleGranular } of pendingEdges) {
      const id = functionEdgeId('call', nodeId(file, srcFn), nodeId(dstFile, dstFn));
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      edges.push({
        id,
        srcId: nodeId(file, srcFn),
        dstId: nodeId(dstFile, dstFn),
        kind: 'call',
        ...(moduleGranular ? { label: MODULE_GRANULAR_CALL_LABEL } : {}),
      });
    }
  }
  return { nodes, edges };
}

function oracleCrossFile(
  callee: string,
  imports: NonNullable<FunctionGraphFileInput['imports']>,
  functionsByFile: Map<string, FunctionFact[]>
): { file: string; fn: FunctionFact; moduleGranular: boolean } | undefined {
  const matches: { file: string; fn: FunctionFact; moduleGranular: boolean }[] = [];
  for (const imp of imports) {
    if (!imp.resolved) continue;
    const fns = functionsByFile.get(imp.resolved);
    if (!fns) continue;
    const named = imp.names && imp.names.length > 0 ? imp.names : undefined;
    if (named && named.includes(callee)) {
      for (const fn of fns) if (fn.name === callee) matches.push({ file: imp.resolved, fn, moduleGranular: false });
      continue;
    }
    if (named && !imp.moduleGranular) continue;
    for (const fn of fns) if (fn.name === callee) matches.push({ file: imp.resolved, fn, moduleGranular: true });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/* ------------------------------------------------------------- generation --- */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const NAMES = ['handle', 'run', 'run', 'save', 'Save', 'init', 'helper', 'main', 'New'];

function generateInputs(seed: number): FunctionGraphFileInput[] {
  const r = rng(seed);
  const langs = ['ts', 'py', 'go', 'go', 'java'];
  const files: FunctionGraphFileInput[] = [];
  const nFiles = 2 + Math.floor(r() * 6);
  const dirs = ['pkg', 'pkg', 'other', ''];
  for (let i = 0; i < nFiles; i += 1) {
    const dir = dirs[Math.floor(r() * dirs.length)];
    const lang = langs[Math.floor(r() * langs.length)];
    const file = `${dir === '' ? '' : `${dir}/`}f${i}.${lang}`;
    const functions: FunctionFact[] = [];
    const nFns = 1 + Math.floor(r() * 6);
    let line = 1;
    for (let f = 0; f < nFns; f += 1) {
      const start = line;
      const end = start + Math.floor(r() * 20);
      // Deliberately allow overlapping/identical spans and duplicate names.
      functions.push({
        name: NAMES[Math.floor(r() * NAMES.length)],
        startLine: start,
        endLine: end,
        ...(r() < 0.3 ? { method: true } : {}),
      });
      line = r() < 0.4 ? start : end + 1;
    }
    const calls = [];
    const nCalls = Math.floor(r() * 12);
    for (let c = 0; c < nCalls; c += 1) {
      calls.push({
        callee: r() < 0.15 ? `pkg.${NAMES[Math.floor(r() * NAMES.length)]}` : NAMES[Math.floor(r() * NAMES.length)],
        args: [],
        kwargs: {},
        line: 1 + Math.floor(r() * line),
      });
    }
    // U23 — half the generated files carry a `loc`, so the module scope's
    // span is exercised on both the `loc` path and the last-call-line fallback.
    files.push({ file, lang, functions, calls, imports: [], ...(r() < 0.5 ? { loc: line + Math.floor(r() * 10) } : {}) });
  }
  // Wire some imports between the generated files.
  for (const f of files) {
    const nImports = Math.floor(r() * 3);
    for (let i = 0; i < nImports; i += 1) {
      const target = files[Math.floor(r() * files.length)];
      if (target.file === f.file) continue;
      const roll = r();
      f.imports!.push({
        raw: `./${target.file}`,
        line: 1,
        resolved: target.file,
        ...(roll < 0.4 ? { names: [NAMES[Math.floor(r() * NAMES.length)]] } : {}),
        ...(roll > 0.7 ? { moduleGranular: true } : {}),
      });
    }
  }
  return files;
}

test('buildFunctionGraph matches the pre-index oracle on generated inputs', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const inputs = generateInputs(seed);
    assert.deepStrictEqual(
      buildFunctionGraph(inputs),
      oracleGraph(inputs),
      `seed ${seed}: indexed resolution must be identical to the original`
    );
  }
});

test('an ambiguous name still resolves to nothing, in-file and in-package', () => {
  const inputs: FunctionGraphFileInput[] = [
    {
      file: 'pkg/a.go',
      lang: 'go',
      functions: [
        { name: 'twice', startLine: 1, endLine: 5 },
        { name: 'twice', startLine: 6, endLine: 9 },
        { name: 'caller', startLine: 10, endLine: 20 },
      ],
      calls: [{ callee: 'twice', args: [], kwargs: {}, line: 11 }],
      imports: [],
    },
    {
      file: 'pkg/b.go',
      lang: 'go',
      functions: [{ name: 'shared', startLine: 1, endLine: 3 }],
      calls: [],
      imports: [],
    },
    {
      file: 'pkg/c.go',
      lang: 'go',
      functions: [{ name: 'shared', startLine: 1, endLine: 3 }],
      calls: [],
      imports: [],
    },
    {
      file: 'pkg/d.go',
      lang: 'go',
      functions: [{ name: 'go_caller', startLine: 1, endLine: 9 }],
      calls: [{ callee: 'shared', args: [], kwargs: {}, line: 2 }],
      imports: [],
    },
  ];
  const graph = buildFunctionGraph(inputs);
  assert.deepStrictEqual(graph, oracleGraph(inputs));
  assert.deepStrictEqual(graph.edges, [], 'ambiguity resolves to no edge at all');
});

test('a Go method is never reachable as a bare package-scope call', () => {
  const inputs: FunctionGraphFileInput[] = [
    {
      file: 'pkg/engine.go',
      lang: 'go',
      functions: [{ name: 'Run', startLine: 1, endLine: 4, method: true }],
      calls: [],
      imports: [],
    },
    {
      file: 'pkg/main.go',
      lang: 'go',
      functions: [{ name: 'main', startLine: 1, endLine: 9 }],
      calls: [{ callee: 'Run', args: [], kwargs: {}, line: 2 }],
      imports: [],
    },
  ];
  const graph = buildFunctionGraph(inputs);
  assert.deepStrictEqual(graph, oracleGraph(inputs));
  assert.deepStrictEqual(graph.edges, []);
});
