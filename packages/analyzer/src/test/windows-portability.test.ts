import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser, parseSource } from '../parse/treesitter.js';

/**
 * Owner report (Windows test session): EVERY scan crashed with
 *
 *   TypeError [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in:
 *   file, data, and node are supported by the default ESM loader. On Windows,
 *   absolute paths must be valid file:// URLs.
 *
 * The cause was `parse/treesitter.ts` handing a raw absolute filesystem path
 * (`path.join(pkgDir, 'wasm', 'tree-sitter.js')`) straight to a dynamic
 * `import()`. On POSIX an absolute path happens to be accepted; on Windows
 * `C:\…\tree-sitter.js` is not a valid specifier and the loader refuses it, so
 * the whole tree-sitter parser — and therefore every scan — died at init.
 *
 * These are SOURCE-SCAN locks (the repo's convention for platform bugs that a
 * POSIX CI can never reproduce at runtime): the crash class cannot come back
 * without one of them failing, on any platform.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_SRC = path.resolve(here, '..', '..', 'src');
const TREESITTER_SRC = path.join(ANALYZER_SRC, 'parse', 'treesitter.ts');

/** Strip line + block comments so a comment can never satisfy (or trip) a check. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Extract the argument text of every runtime `await import(...)` call in `src`,
 * balancing parentheses so a multi-line call is captured whole.
 */
function dynamicImportArgs(src: string): string[] {
  const out: string[] = [];
  const re = /\bawait\s+import\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** Every .ts file under src/, excluding the test tree itself. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      out.push(...sourceFiles(p));
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

test('treesitter: the tree-sitter entry is imported as a file:// URL, never a raw absolute path', () => {
  const src = fs.readFileSync(TREESITTER_SRC, 'utf8');
  // The conversion helper must actually be imported from node:url.
  assert.match(
    src,
    /import\s*\{[^}]*\bpathToFileURL\b[^}]*\}\s*from\s*'node:url'/,
    'treesitter.ts must import pathToFileURL from node:url'
  );

  const args = dynamicImportArgs(stripComments(src));
  assert.strictEqual(args.length, 1, 'treesitter.ts has exactly one dynamic import (the wasm entry)');
  const arg = args[0].trim();

  // The specifier must be a file:// URL — either produced inline or via a local
  // const that pathToFileURL produced.
  const producedByPathToFileURL =
    /pathToFileURL/.test(arg) ||
    (/^[A-Za-z_$][\w$]*$/.test(arg) &&
      new RegExp(`\\b(?:const|let|var)\\s+${arg}\\s*=[^;]*pathToFileURL`).test(stripComments(src)));
  assert.ok(
    producedByPathToFileURL,
    `the dynamic import specifier must go through pathToFileURL — got: ${arg}`
  );
  assert.doesNotMatch(
    arg,
    /path\.(join|resolve)\s*\(/,
    'a bare path.join()/path.resolve() specifier is exactly the Windows ERR_UNSUPPORTED_ESM_URL_SCHEME crash'
  );
});

test('analyzer sources: no dynamic import() is fed a computed filesystem path', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(ANALYZER_SRC)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const rawArg of dynamicImportArgs(src)) {
      const arg = rawArg.trim();
      // A bare module specifier string literal (e.g. import('pg')) is always fine.
      if (/^'[^']*'$/.test(arg) || /^"[^"]*"$/.test(arg)) continue;
      // Anything else must be a file:// URL by construction.
      const okIdentifier =
        /^[A-Za-z_$][\w$]*$/.test(arg) &&
        new RegExp(`\\b(?:const|let|var)\\s+${arg}\\s*=[^;]*pathToFileURL`).test(src);
      if (/pathToFileURL/.test(arg) || okIdentifier) continue;
      offenders.push(`${path.relative(ANALYZER_SRC, file)}: import(${arg})`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'a dynamic import of a computed path must go through pathToFileURL (Windows rejects raw absolute paths)'
  );
});

test('treesitter: initParser() actually loads the wasm entry and parses source', async () => {
  await initParser();
  const tree = parseSource('export function hello() { return 1; }\n', 'ts');
  assert.strictEqual(tree.rootNode.type, 'program');
  assert.ok(tree.rootNode.namedChildCount > 0, 'the parsed tree has real named children');
});
