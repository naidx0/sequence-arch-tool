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
  /** UTF-16 offsets into the source string the tree was parsed from. */
  startIndex: number;
  endIndex: number;
  namedChildCount: number;
  childCount: number;
  namedChild(i: number): TSNode | null;
  child(i: number): TSNode | null;
  childForFieldName(name: string): TSNode | null;
  parent: TSNode | null;
}

/** The slice of web-tree-sitter's TreeCursor the one-pass walk uses. */
export interface TSCursor {
  readonly currentNode: TSNode;
  readonly nodeTypeId: number;
  readonly startIndex: number;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
  delete(): void;
}

interface LanguageLike {
  readonly nodeTypeCount: number;
  nodeTypeForId(id: number): string | null;
  nodeTypeIsNamed(id: number): boolean;
}

export interface TSTree {
  rootNode: TSNode;
  /** A cursor positioned at the root. The caller must `delete()` it. */
  walk(): TSCursor;
  /** Which grammar parsed this tree ('tsx' for the tsx grammar). */
  readonly langKey: string;
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

let parsedFiles = 0;
/** How many files this process has parsed (test seam: "a rescan re-parses exactly one file"). */
export function parsedFileCount(): number {
  return parsedFiles;
}

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

/** The grammar per language (tsx below). See {@link LOADED_GRAMMARS} for the full loaded list. */
export const WASM_BY_LANG: Readonly<Record<Lang, string>> = {
  ts: 'tree-sitter-typescript.wasm',
  js: 'tree-sitter-javascript.wasm',
  py: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
};

/** tsx has its own grammar, loaded beside the table above. */
const TSX_WASM = 'tree-sitter-tsx.wasm';

/**
 * EVERY grammar file `initParser` loads — the one list the desktop installer
 * keeps (0.1.8.1 D2); every other `tree-sitter-*.wasm` is pruned. Add a
 * grammar to the loader and it is here, because the loader reads these names.
 */
export const LOADED_GRAMMARS: readonly string[] = [...new Set([...Object.values(WASM_BY_LANG), TSX_WASM])];

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
  languages.set('tsx', await Language.load(path.join(pkgDir, 'wasm', TSX_WASM)));
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
    parsedFiles += 1;
    const tree = parser.parse(src);
    if (!tree) throw new Error('tree-sitter returned null tree');
    return track(tree, key);
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
function track(real: TSTree, langKey: string): TSTree {
  liveTrees += 1;
  let freed = false;
  return {
    get rootNode() {
      return real.rootNode;
    },
    walk() {
      return real.walk();
    },
    langKey,
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

/** Per grammar: bit 1 = selected, bit 2 = env-probe candidate, bit 4 = named; indexed by node type id. */
const tableCache = new WeakMap<ReadonlySet<string>, WeakMap<ReadonlyMap<string, string>, Map<string, { flags: Uint8Array; prefix: (string | undefined)[] }>>>();

const ERROR_TYPE_ID = 65535;

function typeTable(
  langKey: string,
  selected: ReadonlySet<string>,
  probe: ReadonlyMap<string, string>,
): { flags: Uint8Array; prefix: (string | undefined)[] } {
  let byProbe = tableCache.get(selected);
  if (!byProbe) tableCache.set(selected, (byProbe = new WeakMap()));
  let byLang = byProbe.get(probe);
  if (!byLang) byProbe.set(probe, (byLang = new Map()));
  let t = byLang.get(langKey);
  if (!t) {
    const lang = languages.get(langKey) as LanguageLike;
    /* ERROR nodes carry the reserved id 65535, outside [0, nodeTypeCount): size the
       table to cover it, and record it as a NAMED node so a walk descends into it
       exactly as `namedChild` did. */
    const flags = new Uint8Array(Math.max(lang.nodeTypeCount, ERROR_TYPE_ID + 1));
    const prefix: (string | undefined)[] = new Array(flags.length);
    flags[ERROR_TYPE_ID] = 4 | (selected.has('ERROR') ? 1 : 0);
    for (let id = 0; id < lang.nodeTypeCount; id++) {
      const name = lang.nodeTypeForId(id);
      let f = lang.nodeTypeIsNamed(id) ? 4 : 0;
      if (name !== null && selected.has(name)) f |= 1;
      const pre = name === null ? undefined : probe.get(name);
      if (pre !== undefined) {
        f |= 2;
        prefix[id] = pre;
      }
      flags[id] = f;
    }
    byLang.set(langKey, (t = { flags, prefix }));
  }
  return t;
}

/**
 * ONE pre-order pass over the NAMED nodes of a tree with a TreeCursor, handing
 * the callback a node only when it is one the caller asked for.
 *
 * Same visit order and the same set of nodes as `walk` (a named node's named
 * children, in order; anonymous nodes and their subtrees are skipped). What
 * differs is cost: `walk` materialises a JS node object, through the WASM
 * boundary, for EVERY node, and the fact extractors act on a few dozen types. The
 * cursor classifies each node by its integer type id (a per-grammar table, no
 * string and no node object) and builds a node only for a selected type, or for
 * an "env candidate": a node whose type is in `probe` AND whose source starts
 * with that type's prefix (a necessary condition of every env-read regex, so
 * skipping the rest cannot drop a read).
 */
export function walkSelected(
  tree: TSTree,
  src: string,
  selected: ReadonlySet<string>,
  probe: ReadonlyMap<string, string>,
  fn: (n: TSNode) => void,
): void {
  const { flags, prefix } = typeTable(tree.langKey, selected, probe);
  const c = tree.walk();
  try {
    const visit = (): void => {
      const id = c.nodeTypeId;
      const f = flags[id];
      if (f & 1) fn(c.currentNode);
      else if (f & 2 && src.startsWith(prefix[id]!, c.startIndex)) fn(c.currentNode);
    };
    const nextNamedSibling = (): boolean => {
      while (c.gotoNextSibling()) if (flags[c.nodeTypeId] & 4) return true;
      return false;
    };
    const firstNamedChild = (): boolean => {
      if (!c.gotoFirstChild()) return false;
      if (flags[c.nodeTypeId] & 4) return true;
      if (nextNamedSibling()) return true;
      c.gotoParent();
      return false;
    };
    let depth = 0;
    visit();
    if (!firstNamedChild()) return;
    depth = 1;
    for (;;) {
      visit();
      if (firstNamedChild()) {
        depth += 1;
        continue;
      }
      for (;;) {
        if (nextNamedSibling()) break;
        c.gotoParent();
        depth -= 1;
        if (depth === 0) return;
      }
    }
  } finally {
    c.delete();
  }
}

export function countErrors(root: TSNode): number {
  let n = 0;
  walk(root, (node) => {
    if (node.type === 'ERROR') n++;
  });
  return n;
}
