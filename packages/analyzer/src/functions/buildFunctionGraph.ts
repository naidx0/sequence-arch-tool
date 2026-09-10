import type { FunctionGraph } from '@sequence/schema';
import { functionEdgeId, functionNodeId } from '@sequence/schema';
import type { CallFact, FunctionFact } from '../types.js';
import { buildGoPackageNameByDir, resolveGoCallee } from './goResolve.js';
import { buildJavaTypeIndex, resolveJavaCallee, type JavaTypeIndex } from './javaResolve.js';
import { resolveJsCallee } from './jsResolve.js';

export interface ResolvedImport {
  raw: string;
  line: number;
  /** Repo-relative path when import resolution succeeded. */
  resolved?: string;
  /** Local binding names this import statement names explicitly (mirrors
   * `ImportFact.names`) — when present and non-empty, cross-file callee
   * resolution is restricted to these names instead of every function the
   * target file happens to define. */
  names?: string[];
  /** Namespace/default import, or any import we could not read symbol names
   * for — genuinely module-granular (mirrors `ImportFact.moduleGranular`).
   * Cross-file resolution still falls back to whole-module name matching for
   * these, but the resulting edge is labeled so the precision claim stays
   * honest. */
  moduleGranular?: boolean;
}

/** Fixed, grep-able marker so a module-granular call edge (namespace/default
 * import, or an import we have no symbol-level read on) never gets confused
 * for a symbol-confirmed one. */
export const MODULE_GRANULAR_CALL_LABEL =
  'module-granular import — target inferred by name, not confirmed by imported symbol';

export interface FunctionGraphFileInput {
  file: string;
  lang: string;
  functions: FunctionFact[];
  calls: CallFact[];
  imports?: ResolvedImport[];
  /** Total lines in the file — the module scope's `endLine`. See
   * {@link MODULE_SCOPE_NAME}. Falls back to the last call line when absent. */
  loc?: number;
  /**
   * Java-only (U33): declared name -> unqualified type, from `parse/facts.ts`.
   * `null` marks a name declared with two types. See `./javaResolve.ts` for
   * why a Java cross-file call cannot be resolved without it.
   */
  varTypes?: Map<string, string | null>;
  /** Go-only (H10): `package` clause — default import binding for this file. */
  goPackageName?: string;
}

/**
 * The name of a file's MODULE SCOPE — the code that runs when the file is
 * loaded, which is not inside any function.
 *
 * U23. "Show main flow" dead-ended on flask, express and n8n with *"the scan
 * recorded no calls out of it"*, and the reason was the same in all three:
 *
 *   flask   src/flask/__main__.py   `from .cli import main` / `main()`
 *   express index.js                `module.exports = require('./lib/express')`
 *   n8n     .../src/main.ts         top-level `createApp().mount(...)`
 *
 * An entrypoint file is USUALLY nothing but module-level statements — that is
 * what makes it an entrypoint. But every call was attributed to its enclosing
 * function, and these calls have none, so they were dropped on the floor: the
 * repo's actual first hop was the one call the graph never recorded. The three
 * most prominent "no main flow" repos were the three where the entry file is
 * pure module scope.
 *
 * The module body is not an invention — it is real, executable code with a real
 * span, and Python names it `<module>` in its own tracebacks. Angle brackets are
 * not valid in any identifier in any language here, so this name can never be
 * confused with, or resolved as, a declared function.
 *
 * It stays as strict as every other rule beside it:
 *  - only Python and JS/TS, the languages that HAVE a module body that executes
 *    statements (a Go or Java file's top level declares, it does not run);
 *  - a module node is emitted ONLY when a top-level call actually RESOLVES to a
 *    known function. A file whose top level only calls `require(...)` or some
 *    third-party name gains nothing and gets no node — so this never inflates
 *    the graph with a node per file, and every module node it does add carries
 *    at least one grounded call edge.
 */
export const MODULE_SCOPE_NAME = '<module>';

const MODULE_SCOPE_LANGS = new Set(['py', 'js', 'ts']);

function nodeId(file: string, fn: FunctionFact): string {
  return functionNodeId(file, fn.name, fn.startLine);
}

/** Innermost enclosing function whose span contains `line` (inclusive). */
export function enclosingFunction(line: number, functions: FunctionFact[]): FunctionFact | undefined {
  let best: FunctionFact | undefined;
  let bestSpan = Infinity;
  for (const fn of functions) {
    if (line < fn.startLine || line > fn.endLine) continue;
    const span = fn.endLine - fn.startLine;
    if (span < bestSpan) {
      bestSpan = span;
      best = fn;
    }
  }
  return best;
}

/** Grounded resolution: callee must match a defined function name in one file. */
export function resolveCalleeInFile(
  callee: string,
  functions: FunctionFact[]
): FunctionFact | undefined {
  const matches = functions.filter((fn) => fn.name === callee);
  if (matches.length === 1) return matches[0];
  return undefined;
}

/**
 * The same rule as {@link resolveCalleeInFile}, indexed: name → the ONE function
 * with that name, or `undefined` when the name is defined 0 or 2+ times (an
 * ambiguous name is still not resolved to whichever function came first).
 *
 * Built once per file instead of a `.filter` over every function per call — the
 * per-file cost went from `calls × functions` allocations to one pass. Locked
 * against the original by `functions-perf.test.ts`.
 */
function uniqueFunctionsByName(functions: FunctionFact[]): Map<string, FunctionFact | null> {
  const byName = new Map<string, FunctionFact | null>();
  for (const fn of functions) {
    const name = fn?.name;
    if (typeof name !== 'string') continue;
    byName.set(name, byName.has(name) ? null : fn);
  }
  return byName;
}

/**
 * Cross-file: callee must be unique among functions in files the caller imports.
 * Unresolved or ambiguous imports → no match.
 *
 * Symbol-granular: an import that names specific symbols (`{ a, b }` / `from x
 * import a, b`) only ever contributes a candidate when the callee is literally
 * one of those names — a same-named function elsewhere in that file, or in
 * some unrelated import the caller never named, must not be pulled in just
 * because the module as a whole was imported. Namespace/default imports (and
 * anything we couldn't read a symbol list for) stay module-granular on
 * purpose: any function in the resolved file matching by name is still a
 * candidate, but the caller must mark it — see `moduleGranular` on the result.
 */
function resolveCalleeCrossFile(
  callee: string,
  imports: ResolvedImport[],
  functionsByFile: Map<string, FunctionFact[]>
): { file: string; fn: FunctionFact; moduleGranular: boolean } | undefined {
  const matches: { file: string; fn: FunctionFact; moduleGranular: boolean }[] = [];
  for (const imp of imports) {
    const resolved = imp.resolved;
    if (!resolved) continue;
    const fns = functionsByFile.get(resolved);
    if (!fns) continue;

    const namesImported = imp.names && imp.names.length > 0 ? imp.names : undefined;
    if (namesImported && namesImported.includes(callee)) {
      for (const fn of fns) {
        if (fn.name === callee) matches.push({ file: resolved, fn, moduleGranular: false });
      }
      continue;
    }
    if (namesImported && !imp.moduleGranular) {
      // A purely named import (`{ a, b }`, no default/namespace alongside it)
      // that did not name `callee` — must not fall back to whole-module
      // matching just because the module was imported for something else.
      continue;
    }

    // No symbol list for this import (namespace/default/bare/unparsed), or a
    // default/namespace binding alongside a named clause that didn't cover
    // `callee` — honest coarse fallback: match by name across the whole file.
    for (const fn of fns) {
      if (fn.name === callee) matches.push({ file: resolved, fn, moduleGranular: true });
    }
  }
  if (matches.length === 1) return matches[0];
  return undefined;
}

/** The directory a repo-relative file sits in — a Go package IS its directory. */
function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}

/** Bare identifier — `Foo(...)`, not `pkg.Foo(...)` or `x.Foo(...)`. */
const BARE_CALLEE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Go's package scope: a bare call resolves inside the SAME DIRECTORY.
 *
 * Every other language in this scanner reaches another file through an import,
 * so `resolveCalleeCrossFile` is the whole story. Go is different by its own
 * rules: files in one directory are one package and share a namespace with no
 * import between them. The consequence was not a rounding error — on `gin`
 * (58 Go files, 501 functions) EVERY resolved call edge was intra-file and the
 * cross-file count was exactly zero, so `detectStemCandidates` had no flow to
 * find and the repo reported "no main flow" over a library that is nothing but
 * cross-file calls.
 *
 * This is a language rule, not a heuristic, and it stays as strict as the
 * import path it sits beside:
 *  - Go files only, both sides;
 *  - the callee must be a bare identifier (a dotted `x.Foo` is a method or
 *    another package, neither of which package scope resolves);
 *  - methods are excluded — `func (e *Engine) Run()` is not in scope as `Run`;
 *  - exactly one match in the package, or nothing. An ambiguous name is not
 *    resolved to whichever file sorted first.
 */
export function resolveCalleeInPackage(
  callee: string,
  callerFile: string,
  goFunctionsByDir: Map<string, { file: string; fn: FunctionFact }[]>
): { file: string; fn: FunctionFact } | undefined {
  if (!BARE_CALLEE.test(callee)) return undefined;
  const candidates = (goFunctionsByDir.get(dirOf(callerFile)) ?? []).filter(
    (c) => c.file !== callerFile && c.fn.name === callee && c.fn.method !== true
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * {@link resolveCalleeInPackage} against a `dir → name → declarations` index —
 * the same rule (bare identifier, not a method, not the caller's own file,
 * exactly one match), without re-filtering the whole package on every call.
 * Bucket order is insertion order, so "exactly one" picks the same declaration.
 * Locked against the original by `functions-perf.test.ts`.
 */
function resolveCalleeInPackageIndexed(
  callee: string,
  callerFile: string,
  goByDirName: Map<string, Map<string, { file: string; fn: FunctionFact }[]>>
): { file: string; fn: FunctionFact } | undefined {
  if (!BARE_CALLEE.test(callee)) return undefined;
  const byName = goByDirName.get(dirOf(callerFile));
  if (!byName) return undefined;
  const named = byName.get(callee);
  if (!named) return undefined;
  let found: { file: string; fn: FunctionFact } | undefined;
  for (const c of named) {
    if (c.file === callerFile) continue;
    if (found) return undefined; // two or more — ambiguous, resolve nothing
    found = c;
  }
  return found;
}

/**
 * Build a grounded function-level graph from per-file facts.
 * Pure, total, deterministic — never throws.
 */
export function buildFunctionGraph(files: FunctionGraphFileInput[]): FunctionGraph {
  const nodes: FunctionGraph['nodes'] = [];
  const edges: FunctionGraph['edges'] = [];
  const edgeIds = new Set<string>();

  const safeFiles = Array.isArray(files) ? files : [];
  const functionsByFile = new Map<string, FunctionFact[]>();
  /**
   * Package-scope index for Go: directory -> name -> every NON-METHOD function
   * declared under that name in the package. Methods are excluded here because
   * package scope never resolves them (see {@link resolveCalleeInPackage}).
   */
  const goByDirName = new Map<string, Map<string, { file: string; fn: FunctionFact }[]>>();
  /**
   * U33 — Java's type index, and the per-file `name -> the ONE method with that
   * name` maps the Java resolver reads through. Both are built lazily: a scan
   * with no Java file pays nothing, and `uniqueFunctionsByName` is computed at
   * most once per target file rather than once per call into it.
   */
  const javaFiles: string[] = [];
  const methodIndex = new Map<string, Map<string, FunctionFact | null>>();
  let javaIndex: JavaTypeIndex | undefined;
  const uniqueMethodsIn = (target: string): Map<string, FunctionFact | null> | undefined => {
    const cached = methodIndex.get(target);
    if (cached) return cached;
    const fns = functionsByFile.get(target);
    if (!fns) return undefined;
    const built = uniqueFunctionsByName(fns);
    methodIndex.set(target, built);
    return built;
  };

  for (const entry of safeFiles) {
    if (!entry || typeof entry !== 'object') continue;
    const file = typeof entry.file === 'string' ? entry.file : '';
    const fnList = Array.isArray(entry.functions) ? entry.functions : [];
    if (file) functionsByFile.set(file, fnList);
    if (file && entry.lang === 'java') javaFiles.push(file);
    if (file && entry.lang === 'go') {
      const dir = dirOf(file);
      const byName = goByDirName.get(dir) ?? new Map<string, { file: string; fn: FunctionFact }[]>();
      for (const fn of fnList) {
        if (!fn || typeof fn.name !== 'string') continue;
        if (fn.method === true) continue;
        const bucket = byName.get(fn.name);
        if (bucket) bucket.push({ file, fn });
        else byName.set(fn.name, [{ file, fn }]);
      }
      goByDirName.set(dir, byName);
    }
  }
  if (javaFiles.length > 0) javaIndex = buildJavaTypeIndex(javaFiles);
  const goPackageNameByDir = buildGoPackageNameByDir(
    safeFiles
      .filter((e) => e && typeof e === 'object' && e.lang === 'go' && typeof e.file === 'string')
      .map((e) => ({ file: e.file as string, goPackageName: e.goPackageName }))
  );

  for (const entry of safeFiles) {
    if (!entry || typeof entry !== 'object') continue;
    const file = typeof entry.file === 'string' ? entry.file : '';
    const lang = typeof entry.lang === 'string' ? entry.lang : '';
    const fnList = Array.isArray(entry.functions) ? entry.functions : [];
    const callList = Array.isArray(entry.calls) ? entry.calls : [];
    const importList = Array.isArray(entry.imports) ? entry.imports : [];
    const uniqueByName = uniqueFunctionsByName(fnList);
    if (file && !methodIndex.has(file)) methodIndex.set(file, uniqueByName);
    const importRaws =
      lang === 'java'
        ? importList.map((imp) => imp?.raw).filter((raw): raw is string => typeof raw === 'string')
        : [];

    /**
     * The file's module scope, created on the FIRST top-level call that
     * actually resolves — see {@link MODULE_SCOPE_NAME}. Never created
     * speculatively, so a file whose top level resolves nothing is exactly as
     * it was before.
     */
    const moduleScopeAllowed = MODULE_SCOPE_LANGS.has(lang);
    let moduleScope: FunctionFact | undefined;
    const moduleScopeFor = (): FunctionFact => {
      if (!moduleScope) {
        const loc = typeof entry.loc === 'number' && entry.loc > 0 ? entry.loc : 0;
        const lastCall = callList.reduce(
          (m, c) => (c && typeof c.line === 'number' && c.line > m ? c.line : m),
          1
        );
        moduleScope = {
          name: MODULE_SCOPE_NAME,
          startLine: 1,
          endLine: Math.max(loc, lastCall, 1),
        };
      }
      return moduleScope;
    };

    /* Edges are resolved BEFORE the nodes are emitted, so that the module
     * scope — which only exists if a top-level call resolved — can still be
     * pushed in this file's node block rather than after its own edge. */
    const pending: { srcFn: FunctionFact; dstFile: string; dstFn: FunctionFact; moduleGranular: boolean }[] = [];

    for (const call of callList) {
      if (!call || typeof call !== 'object') continue;
      const callee = typeof call.callee === 'string' ? call.callee : '';
      const line = typeof call.line === 'number' ? call.line : 0;
      if (!callee || line <= 0) continue;

      const srcFn = enclosingFunction(line, fnList);
      if (!srcFn && !moduleScopeAllowed) continue;

      let dstFile = file;
      let dstFn = uniqueByName.get(callee) ?? undefined;
      let moduleGranular = false;
      if (!dstFn) {
        const cross = resolveCalleeCrossFile(callee, importList, functionsByFile);
        if (cross) {
          dstFile = cross.file;
          dstFn = cross.fn;
          moduleGranular = cross.moduleGranular;
        } else if (lang === 'go') {
          const samePackage = resolveCalleeInPackageIndexed(callee, file, goByDirName);
          if (samePackage) {
            dstFile = samePackage.file;
            dstFn = samePackage.fn;
          } else {
            const crossPkg = resolveGoCallee(callee, importList, goPackageNameByDir, goByDirName);
            if (!crossPkg) continue;
            dstFile = crossPkg.file;
            dstFn = crossPkg.fn;
          }
        } else if (lang === 'java' && javaIndex) {
          /**
           * U33. Reached only after the same-file and import paths found
           * nothing, which for Java is ALWAYS: a Java callee is recorded with
           * its receiver (`this.owners.findById`), so it never equals a bare
           * method name, and `resolveImport` resolves no Java import at all.
           * See `./javaResolve.ts` for the rules and for what is deliberately
           * still not resolved.
           */
          const target = resolveJavaCallee(
            callee,
            file,
            entry.varTypes,
            importRaws,
            javaIndex,
            uniqueMethodsIn
          );
          if (!target) continue;
          dstFile = target.file;
          dstFn = target.fn;
        } else if (lang === 'js' || lang === 'ts') {
          /**
           * U31. Reached after same-file bare and import paths found nothing.
           * A JS callee is often recorded with its receiver (`this.set`), so it
           * never equals a bare method name. See `./jsResolve.ts` for what is
           * deliberately still not resolved.
           */
          const target = resolveJsCallee(callee, file, uniqueMethodsIn);
          if (!target) continue;
          dstFile = target.file;
          dstFn = target.fn;
        } else {
          continue;
        }
      }

      // A top-level call only earns the file a module-scope node once it has
      // resolved to something real; `moduleScopeFor` is deliberately reached
      // AFTER every `continue` above.
      pending.push({ srcFn: srcFn ?? moduleScopeFor(), dstFile, dstFn, moduleGranular });
    }

    const emit = (fn: FunctionFact): void => {
      const name = typeof fn.name === 'string' ? fn.name : '';
      const startLine = typeof fn.startLine === 'number' ? fn.startLine : 0;
      const endLine = typeof fn.endLine === 'number' ? fn.endLine : 0;
      if (!name || startLine <= 0 || endLine < startLine) return;
      nodes.push({ id: nodeId(file, { name, startLine, endLine }), name, file, startLine, endLine, lang });
    };

    for (const fn of fnList) {
      if (!fn || typeof fn !== 'object') continue;
      emit(fn);
    }
    if (moduleScope) emit(moduleScope);

    for (const { srcFn, dstFile, dstFn, moduleGranular } of pending) {
      const srcId = nodeId(file, srcFn);
      const dstId = nodeId(dstFile, dstFn);
      const id = functionEdgeId('call', srcId, dstId);
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      edges.push({
        id,
        srcId,
        dstId,
        kind: 'call',
        ...(moduleGranular ? { label: MODULE_GRANULAR_CALL_LABEL } : {}),
      });
    }
  }

  return { nodes, edges };
}
