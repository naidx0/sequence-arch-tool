import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Lang } from '../types.js';

// @vscode/tree-sitter-wasm ships a CJS-style entry; interop via createRequire.
const require = createRequire(import.meta.url);

export interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  namedChildCount: number;
  childCount: number;
  namedChild(i: number): TSNode | null;
  child(i: number): TSNode | null;
  childForFieldName(name: string): TSNode | null;
  parent: TSNode | null;
}

export interface TSTree {
  rootNode: TSNode;
  /**
   * Frees the tree's WASM-side allocation. Tree-sitter's syntax trees live in
   * the emscripten heap, NOT on the JS heap — the garbage collector cannot see
   * them and will never reclaim one. Every tree that is parsed and not deleted
   * is a permanent leak inside a fixed-size WASM memory, so a long enough scan
   * exhausts it and the runtime calls `abort()`. See `parseSource` below.
   */
  delete(): void;
}

interface ParserLike {
  setLanguage(lang: unknown): void;
  parse(src: string): TSTree | null;
}

/**
 * The tree-sitter WASM runtime aborted and CANNOT be restarted in this process.
 *
 * Emscripten's `abort()` sets a module-global kill switch: after it fires, every
 * later call into the module throws `memory access out of bounds` or
 * `table index is out of bounds`, and re-running `Parser.init()` does not help
 * (verified — a fresh `Parser` after an abort throws on its first parse). So the
 * only honest response is to stop, name it, and count what could not be read.
 * Silence here is what turned "the parser died" into "this repo has no files".
 */
export class ParserAbortedError extends Error {
  /** the runtime's own message, verbatim */
  readonly detail: string;
  constructor(detail: string) {
    super(
      `the tree-sitter parser aborted (${detail}) and cannot be restarted in this process`,
    );
    this.name = 'ParserAbortedError';
    this.detail = detail;
  }
}

let parser: ParserLike | undefined;
const languages = new Map<string, unknown>();
/** Set once the WASM runtime has aborted; holds its own message. */
let abortedWith: string | undefined;
/** Lines emscripten printed to stderr, captured instead of leaking to the console. */
const runtimeMessages: string[] = [];

/** Trees handed out by `parseSource` that have not been `delete()`d yet. */
let liveTrees = 0;

/** The runtime's abort message, or undefined while the parser is healthy. */
export function parserAbortedWith(): string | undefined {
  return abortedWith;
}

/**
 * How many parsed trees are still holding WASM memory.
 *
 * Steady state is 0: every tree `parseSource` hands out must be freed by its
 * caller. A number that climbs with the file count is the leak that killed the
 * runtime mid-run, and this is how a test catches it in milliseconds.
 */
export function liveTreeCount(): number {
  return liveTrees;
}

/** Emscripten failure modes that mean the WASM runtime is dead, not that one
 * file is malformed. A malformed file produces ERROR nodes, never these. */
function isRuntimeDeath(message: string): boolean {
  return (
    /Aborted\(/.test(message) ||
    /memory access out of bounds/.test(message) ||
    /table index is out of bounds/.test(message) ||
    /null function or function signature mismatch/.test(message) ||
    /out of memory/i.test(message)
  );
}

/** TEST SEAM ONLY — force the aborted state so the guard can be exercised
 * without burning a WASM heap. Never called by product code. */
export function __forceParserAbortedForTest(detail: string | undefined): void {
  abortedWith = detail;
}

const WASM_BY_LANG: Record<Lang, string> = {
  ts: 'tree-sitter-typescript.wasm',
  js: 'tree-sitter-javascript.wasm',
  py: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
};

export async function initParser(): Promise<void> {
  if (parser) return;
  const pkgDir = path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json'));
  // The ESM loader only accepts file://, data: and node: specifiers for a dynamic import.
  // On Windows an absolute path like C:\... is rejected outright ("Only URLs with a scheme
  // in: file, data, node are supported"), so the path MUST be converted to a file:// URL.
  const entryUrl = pathToFileURL(path.join(pkgDir, 'wasm', 'tree-sitter.js')).href;
  const mod = await import(/* the entry is wasm/tree-sitter.js */ entryUrl);
  const { Parser, Language } = (mod.default ?? mod) as {
    Parser: { init(opts?: Record<string, unknown>): Promise<void>; new (): ParserLike };
    Language: { load(p: string): Promise<unknown> };
  };
  // Capture emscripten's stderr instead of letting it out. Before this, a heap
  // exhaustion printed a bare `Aborted()` line straight to the terminal — 58 of
  // them in one QA run — which names no file, explains nothing, and does not
  // reach `graph.warnings` where a user would see it.
  await Parser.init({
    printErr: (m: string) => {
      runtimeMessages.push(m);
    },
  });
  for (const [lang, wasm] of Object.entries(WASM_BY_LANG)) {
    languages.set(lang, await Language.load(path.join(pkgDir, 'wasm', wasm)));
  }
  // tsx uses a separate grammar
  languages.set('tsx', await Language.load(path.join(pkgDir, 'wasm', 'tree-sitter-tsx.wasm')));
  parser = new Parser();
}

/**
 * Parse one source file.
 *
 * THE CALLER OWNS THE TREE AND MUST `delete()` IT. See `TSTree.delete`: the
 * tree lives in the WASM heap, so dropping the JS reference frees nothing.
 * `extractFacts` is the only product caller and disposes in a `finally`.
 *
 * Throws `ParserAbortedError` — never a raw emscripten `RuntimeError` — once
 * the WASM runtime has died, so a caller can report "could not parse X: the
 * parser aborted" per file instead of degrading silently to zero files.
 */
export function parseSource(src: string, lang: Lang, isTsx = false): TSTree {
  if (!parser) throw new Error('initParser() must be awaited before parseSource()');
  if (abortedWith) throw new ParserAbortedError(abortedWith);
  const key = isTsx ? 'tsx' : lang;
  const before = runtimeMessages.length;
  try {
    parser.setLanguage(languages.get(key));
    const tree = parser.parse(src);
    if (!tree) throw new Error('tree-sitter returned null tree');
    return track(tree);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The abort message emscripten printed for THIS call, if any — it says more
    // than the generic `RuntimeError` the throw carries.
    const printed = runtimeMessages.slice(before).join('; ');
    if (isRuntimeDeath(msg) || (printed && isRuntimeDeath(printed))) {
      abortedWith = printed || msg;
      throw new ParserAbortedError(abortedWith);
    }
    throw e;
  }
}

/**
 * Wrap a tree so an undisposed one is COUNTABLE.
 *
 * A leaked tree is invisible by construction: it costs nothing on the JS heap
 * and only shows up thousands of files later as `Aborted()`. This counter is
 * what makes "every parsed tree is freed" a one-line assertion in a test
 * instead of a twenty-second heap-exhaustion race.
 */
function track(real: TSTree): TSTree {
  liveTrees += 1;
  let freed = false;
  return {
    get rootNode() {
      return real.rootNode;
    },
    delete() {
      if (!freed) {
        freed = true;
        liveTrees -= 1;
        real.delete();
      }
    },
  };
}

export function walk(node: TSNode, fn: (n: TSNode) => void | boolean): void {
  // fn returning false prunes the subtree
  if (fn(node) === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, fn);
  }
}

export function countErrors(root: TSNode): number {
  let n = 0;
  walk(root, (node) => {
    if (node.type === 'ERROR') n++;
  });
  return n;
}
