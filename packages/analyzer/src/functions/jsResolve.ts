/**
 * JavaScript / TypeScript dotted-callee resolution (U31).
 *
 * Express and most Node CJS codebases record calls through a receiver —
 * `this.set`, `app.use`, `exports.compileETag` — so a bare `fn.name === callee`
 * test never matches and the function graph stays intra-file only.
 *
 * ─ WHAT THIS DOES **NOT** CLAIM ─────────────────────────────────────────────
 * Framework dispatch stays invisible. `app.get('/path', handler)` is a route
 * registration, not a call to a function this scan can ground, and nothing
 * here invents an edge for it. Inherited prototype methods without a local
 * declaration resolve to nothing. `node_modules` is never read.
 *
 * ─ THE RULES ────────────────────────────────────────────────────────────────
 * Mirror U33 Java honesty — unique-or-nothing, resolve to nothing rather than
 * guess:
 *
 *  - `this.method(...)` resolves only inside the caller's own file, and only
 *    when that file declares `method` exactly once.
 *  - Any other receiver shape (`app.get`, `utils.compileETag`, chained
 *    receivers) resolves to nothing in this phase.
 */
import type { FunctionFact } from '../types.js';

export interface JsCalleeTarget {
  file: string;
  fn: FunctionFact;
}

/**
 * Resolve one JS/TS `CallFact.callee` to a declared function.
 *
 * Phase 1 handles only `this.method` inside the caller's file. Everything
 * else returns `undefined`.
 */
export function resolveJsCallee(
  callee: string,
  callerFile: string,
  uniqueMethodsByFile: (file: string) => ReadonlyMap<string, FunctionFact | null> | undefined
): JsCalleeTarget | undefined {
  const cut = callee.lastIndexOf('.');
  if (cut <= 0) return undefined;
  const method = callee.slice(cut + 1);
  if (!method) return undefined;

  const receiver = callee.slice(0, cut);
  if (receiver !== 'this') return undefined;

  return targetIn(callerFile, method, uniqueMethodsByFile);
}

function targetIn(
  file: string,
  method: string,
  uniqueMethodsByFile: (file: string) => ReadonlyMap<string, FunctionFact | null> | undefined
): JsCalleeTarget | undefined {
  const fn = uniqueMethodsByFile(file)?.get(method);
  // `null` marks an overloaded/duplicate name — two declarations, no target.
  return fn ? { file, fn } : undefined;
}
