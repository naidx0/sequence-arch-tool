/* ══════════════════════════════════════════════════════════════════════════
   WORKSPACE IMPORTS — the edges a monorepo scan was structurally unable to find
   packages/analyzer/src/workspaceImports.ts

   MEASURED, 2026-08-22, on this repository's own live scan:

     import edges                                   1,348
     of those, within one service                   1,348
     of those, CROSSING two services                    0
     source files importing `@sequence/*`             218

   Two hundred and eighteen files carry a real dependency on another package
   and the graph held not one edge for any of them. The board was not hiding
   them and the projector was not dropping them — they were never produced.

   ── WHY NOT, AND WHY IT WAS INVISIBLE ────────────────────────────────────

   `scan.ts` resolves imports inside a per-service loop, against a `fileSet`
   built from that one service's own facts. Its JS/TS branch then opens with
   `if (!raw.startsWith('.')) return []` — bare specifiers are refused outright,
   and even without that refusal the target file is not in the set being
   searched. A cross-package import could not resolve. Not by accident: by
   construction.

   It stayed invisible because every fixture in the suite is one package. A
   monorepo is the only shape that exhibits it, and CLAUDE.md says exactly this:
   "Fixture scale proves logic; only a REAL repo proves the result."

   ── WHAT THIS RESOLVES, AND WHAT IT REFUSES ──────────────────────────────

   It resolves a bare specifier ONLY to a package declared inside this
   repository. `@sequence/schema` is a fact about this tree; `react` is a fact
   about somebody else's, and drawing an edge into `node_modules` would put the
   whole of npm on the board.

   Where a package's entry cannot be found on disk, it resolves to NOTHING
   rather than to a guess. An edge pointing at a file that may not exist is the
   failure CANON's first non-negotiable names, and a plausible path is exactly
   the kind of guess that survives review.
   ══════════════════════════════════════════════════════════════════════════ */

import path from 'node:path';

/** One workspace package: what it is called, and where it lives. */
export interface WorkspacePackage {
  /** The `name` field from its package.json — what importers actually write. */
  name: string;
  /** Repo-relative POSIX directory, e.g. `packages/schema`. */
  dir: string;
  /**
   * The package.json `main` / `module` / `types` value, when it has one.
   *
   * Optional and absent-means-not-declared. A package with no entry field is
   * not broken — it is resolved by convention below, the same way Node does.
   */
  entry?: string;
}

/**
 * Index packages by name, longest name first.
 *
 * ORDER MATTERS AND THIS IS THE WHOLE REASON THIS IS NOT A PLAIN MAP: a repo
 * containing both `@acme/core` and `@acme/core-utils` must match
 * `@acme/core-utils/thing` against the longer name. Matching the shorter one
 * first would resolve it into the wrong package and cite a real file in it.
 */
export function buildWorkspaceIndex(
  packages: readonly WorkspacePackage[],
): readonly WorkspacePackage[] {
  return [...packages].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}

/** POSIX-normalise, because every rel in the graph is POSIX on every platform. */
function posix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * The candidate files a resolved sub-path could mean, in Node's own order.
 *
 * TypeScript ESM writes the OUTPUT extension in the specifier — under
 * `"module": "NodeNext"`, `from './Thing.js'` means `Thing.ts` on disk — so the
 * `.js` rewrite is not a convenience, it is what the specifier means.
 */
function candidates(base: string): string[] {
  const b = posix(base);
  const stripped = b.replace(/\.(js|mjs|cjs)$/, '');
  const out = [
    b,
    `${b}.ts`,
    `${b}.tsx`,
    `${b}/index.ts`,
    `${b}/index.tsx`,
  ];
  if (stripped !== b) {
    out.push(`${stripped}.ts`, `${stripped}.tsx`, `${stripped}/index.ts`, `${stripped}/index.tsx`);
  }
  return out;
}

/**
 * Resolve a bare import specifier to a repo file, or null.
 *
 * `files` is the REPO-WIDE set — the per-service set cannot contain the target
 * by definition, which is the bug this exists to fix.
 *
 * Returns null for anything not declared in this workspace, which includes
 * every third-party package. That is not a failure to resolve; it is a refusal
 * to claim.
 */
export function resolveWorkspaceImport(
  raw: string,
  index: readonly WorkspacePackage[],
  files: ReadonlySet<string>,
): string | null {
  /* Relative and absolute specifiers are somebody else's job — the per-service
     resolver already owns them, and answering here too would double every
     intra-package edge. */
  if (raw.startsWith('.') || raw.startsWith('/')) return null;

  for (const pkg of index) {
    if (raw !== pkg.name && !raw.startsWith(`${pkg.name}/`)) continue;

    const sub = raw === pkg.name ? '' : raw.slice(pkg.name.length + 1);

    /*
     * A deep import names its own file inside the package — but relative to
     * the package's PUBLISH root, not its directory. `@sequence/schema/paths.js`
     * is `packages/schema/src/paths.ts` on disk, because what ships is `src/`
     * compiled into `dist/` and the specifier speaks the published shape.
     *
     * So both are tried: the literal path for packages that publish from their
     * root, and the `src/` hop for the ones that do not. Same rewrite the entry
     * resolution below performs, for the same reason.
     */
    if (sub) {
      const roots = [path.posix.join(pkg.dir, sub), path.posix.join(pkg.dir, 'src', sub)];
      for (const root of roots) {
        for (const cand of candidates(root)) {
          if (files.has(cand)) return cand;
        }
      }
      /* Named a sub-path that is not there. Resolving to the package entry
         instead would silently redirect the citation to a file the importer
         never mentioned. */
      return null;
    }

    /* The package itself: its declared entry, then the conventions. A declared
       `main` usually points into `dist/`, which no scan walks, so the source
       twin is tried in the same breath. */
    const roots: string[] = [];
    if (pkg.entry) {
      const declared = path.posix.join(pkg.dir, posix(pkg.entry));
      roots.push(declared);
      /* dist/index.js -> src/index.ts, which is the file that actually exists
         in the tree being scanned. Built output is not walked, so without this
         every workspace package resolves to nothing. */
      roots.push(declared.replace(/(^|\/)dist\//, '$1src/'));
    }
    roots.push(path.posix.join(pkg.dir, 'src/index'), path.posix.join(pkg.dir, 'index'));

    for (const root of roots) {
      for (const cand of candidates(root)) {
        if (files.has(cand)) return cand;
      }
    }
    /* Declared in the workspace, but nothing on disk answers to it. Silence is
       the honest result; a guess here would be an edge citing a file that may
       not exist. */
    return null;
  }

  return null;
}
