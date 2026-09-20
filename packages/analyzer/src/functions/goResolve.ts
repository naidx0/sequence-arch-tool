/**
 * Go cross-package call resolution (H10).
 *
 * H4 added same-directory package scope (bare identifiers). Cross-directory
 * calls in Go are always qualified through an import binding (`store.Load`,
 * `http.ListenAndServe`) — they never go through `resolveCalleeCrossFile`'s
 * bare-name import matching.
 *
 * Rules mirror Go's own name resolution, restricted to what the scan proves:
 *  - import path + go.mod module prefix → package directory;
 *  - explicit import alias, else the `package` clause of the target directory;
 *  - `binding.Func` only (one selector); methods excluded; unique-or-nothing.
 *
 * Stdlib, vendor, and external modules resolve to nothing — no file in the scan.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FunctionFact } from '../types.js';

/** Minimal import shape the Go resolver reads — mirrors `ResolvedImport`. */
export interface GoResolvedImport {
  raw: string;
  resolved?: string;
  names?: string[];
  moduleGranular?: boolean;
}

/** The directory a repo-relative file sits in — a Go package IS its directory. */
function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}

/** `pkg.Func` — import binding plus one identifier, not a chain. */
const QUALIFIED_GO_CALLEE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

/** Read the `module` path from a service's go.mod on disk. */
export function readGoModulePath(repoRoot: string, serviceDir: string): string | undefined {
  const gomodAbs = path.join(repoRoot, serviceDir === '.' ? '' : serviceDir, 'go.mod');
  try {
    const text = fs.readFileSync(gomodAbs, 'utf8');
    const m = text.match(/^\s*module\s+(\S+)/m);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Resolve a Go import path to one representative `.go` file in the scanned set.
 * Returns `undefined` for stdlib, external, or ambiguous paths.
 */
export function resolveGoImportToFile(
  importPath: string,
  modulePath: string,
  serviceDir: string,
  fileSet: ReadonlySet<string>
): string | undefined {
  if (typeof importPath !== 'string' || !importPath) return undefined;
  if (typeof modulePath !== 'string' || !modulePath) return undefined;

  let suffix: string | undefined;
  if (importPath === modulePath) {
    suffix = '';
  } else {
    const prefix = `${modulePath}/`;
    if (!importPath.startsWith(prefix)) return undefined;
    suffix = importPath.slice(prefix.length);
  }

  const baseParts =
    serviceDir === '.'
      ? suffix
        ? suffix.split('/')
        : []
      : [...serviceDir.split('/'), ...(suffix ? suffix.split('/') : [])].filter(Boolean);
  const dir = baseParts.join('/');

  const matches: string[] = [];
  for (const file of fileSet) {
    if (!file.endsWith('.go')) continue;
    if (dirOf(file) !== dir) continue;
    matches.push(file);
  }
  if (matches.length === 0) return undefined;
  matches.sort();
  return matches[0];
}

/** directory → declared `package` name from the scan (all files in a dir must agree). */
export function buildGoPackageNameByDir(
  files: ReadonlyArray<{ file: string; goPackageName?: string }>
): ReadonlyMap<string, string> {
  const byDir = new Map<string, string>();
  for (const entry of files) {
    const name = entry.goPackageName;
    if (typeof name !== 'string' || !name) continue;
    const dir = dirOf(entry.file);
    const prev = byDir.get(dir);
    if (prev && prev !== name) {
      byDir.delete(dir);
      byDir.set(dir, ''); // mark ambiguous — resolver treats as missing
      continue;
    }
    if (prev === '') continue;
    byDir.set(dir, name);
  }
  for (const [dir, name] of byDir) {
    if (name === '') byDir.delete(dir);
  }
  return byDir;
}

export interface GoCalleeTarget {
  file: string;
  fn: FunctionFact;
}

/**
 * Resolve `binding.Func` to a declared package-level function in an imported package.
 */
export function resolveGoCallee(
  callee: string,
  imports: readonly GoResolvedImport[],
  packageNameByDir: ReadonlyMap<string, string>,
  goByDirName: ReadonlyMap<string, ReadonlyMap<string, { file: string; fn: FunctionFact }[]>>
): GoCalleeTarget | undefined {
  if (!QUALIFIED_GO_CALLEE.test(callee)) return undefined;
  const dot = callee.indexOf('.');
  const binding = callee.slice(0, dot);
  const funcName = callee.slice(dot + 1);
  if (!binding || !funcName) return undefined;

  let targetDir: string | undefined;
  for (const imp of imports) {
    const resolved = imp.resolved;
    if (!resolved) continue;
    const impDir = dirOf(resolved);
    const explicit = imp.names && imp.names.length === 1 ? imp.names[0] : undefined;
    const pkgName = explicit ?? packageNameByDir.get(impDir);
    if (pkgName !== binding) continue;
    if (targetDir && targetDir !== impDir) return undefined;
    targetDir = impDir;
  }
  if (targetDir === undefined) return undefined;

  const byName = goByDirName.get(targetDir);
  if (!byName) return undefined;
  const named = byName.get(funcName);
  if (!named) return undefined;

  let found: { file: string; fn: FunctionFact } | undefined;
  for (const c of named) {
    if (c.fn.method === true) continue;
    if (found) return undefined;
    found = c;
  }
  return found ? { file: found.file, fn: found.fn } : undefined;
}
