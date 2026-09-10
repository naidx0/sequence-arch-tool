import fs from 'node:fs';
import path from 'node:path';
import { IGNORE_DIRS } from '../scan.js';

export interface TreeNode {
  name: string;
  /** repo-relative path (POSIX separators); '' for the root node */
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

/**
 * Directory names that MUST NEVER appear in the tree, whatever else is listed.
 *
 * A verbatim mirror of the reserved set the HTTP server refuses reads/writes for
 * (`reservedRoots()` in server/repoServer.ts): `.sequence` holds the plaintext
 * BYO API key, `.git` holds repo internals, and `.ssh`/`.aws`/`.gnupg` are the
 * common local-secret dirs. Keep the two lists in step — server.test.ts locks
 * that `/api/tree` never leaks `.sequence/` or `.git/`.
 */
export const RESERVED_TREE_DIRS = new Set(['.sequence', '.git', '.ssh', '.aws', '.gnupg']);

/**
 * Credential-bearing FILES that are never listed, at any depth.
 *
 * Listing dot-entries fixed a real findability bug, but the blanket dot-filter
 * it replaced was also the only thing keeping these names out of the tree — and
 * `buildTree(activeRoot())` feeds the provider prompt builders (`buildPlainTree`,
 * `buildAnnotations`, `buildDigest`). Without this set, attaching a repo and
 * clicking Explain ships `.npmrc` / `.git-credentials` / `.netrc` filenames to a
 * third-party model, and hands a hostile model response an exact target list.
 *
 * Config that legitimately governs a project (`.github/`, `.gitignore`,
 * `.eslintrc`, `.vscode/`) stays listed — that is the point of the change.
 * Bare `.env` also stays: it was the one explicit exception before this and is
 * frequently the file a user actually wants to open. Its `.env.local` /
 * `.env.production` siblings were never listed and are not re-exposed here.
 */
export const RESERVED_TREE_FILES = new Set([
  '.npmrc', '.yarnrc', '.yarnrc.yml',
  '.git-credentials', '.netrc', '_netrc',
  '.pypirc', '.dockercfg', '.htpasswd', '.pgpass', '.my.cnf',
]);

/**
 * `.env` TEMPLATES — committed on purpose, hold placeholders rather than values,
 * and are usually the first file a newcomer opens. Hiding them was collateral
 * damage from the `.env.` prefix rule, not a security decision.
 */
const ENV_TEMPLATE_FILES = new Set([
  '.env.example', '.env.sample', '.env.template', '.env.dist', '.env.defaults',
]);

/** `.env.local`, `.env.production`, … — secret-bearing; bare `.env` and the
 *  {@link ENV_TEMPLATE_FILES} templates are exempt. */
function isSecretEnvFile(name: string): boolean {
  return name.startsWith('.env.') && !ENV_TEMPLATE_FILES.has(name);
}

/**
 * Tool caches and IDE state the tree must not DESCEND into.
 *
 * Separate from the scanner's {@link IGNORE_DIRS} because it is a rendering
 * concern, not an analysis one: `.terraform` holds vendored provider binaries
 * (often hundreds of MB), `.yarn/cache` holds zipped packages, `.idea`/`.vscode`
 * hold editor state. Walking them made `/api/tree` slow and buried the repo's own
 * files under thousands of rows nobody navigates to. Nothing first-party lives
 * here, so the entries are skipped whole — the same treatment `node_modules` and
 * `dist` already get.
 */
export const EXTRA_TREE_IGNORE_DIRS = new Set([
  '.yarn', '.pnpm-store', '.terraform', '.idea',
  '.cache', '.parcel-cache', '.sass-cache',
  '.svelte-kit', '.nuxt', '.output', '.astro',
  '.tox', '.serverless', '.nyc_output',
]);

/**
 * Recursive file tree of the repo root.
 *
 * Dot-entries are LISTED (`.github/`, `.gitignore`, `.eslintrc`, `.vscode/`, `.env`
 * …): they are real, editable parts of a repo, and blanket-hiding them was a
 * findability bug — the user could not see, let alone open, config that governs
 * their project. This is a deliberate divergence from the scanner's `walkFiles`,
 * which skips them because they carry no import graph. The two exceptions are
 * absolute: {@link RESERVED_TREE_DIRS} (secrets / platform internals) are never
 * listed, and directories in {@link IGNORE_DIRS} (node_modules, dist, .venv, …)
 * are not descended.
 *
 * Entries are sorted directories-first then alphabetically for a stable shape.
 */
export function buildTree(repoRoot: string): TreeNode {
  const abs = path.resolve(repoRoot);
  return {
    name: path.basename(abs),
    path: '',
    type: 'dir',
    children: readDir(abs, ''),
  };
}

function readDir(dirAbs: string, relBase: string): TreeNode[] {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  const out: TreeNode[] = [];
  for (const e of entries) {
    // Secrets / platform internals are never listed, at any depth.
    //
    // KNOWN LIMITATION (deliberate): `.sequence/decisions/` is allowlisted by the
    // HTTP server for read+write, so a MADR written by "Open in editor" exists
    // and is openable by path — but it does NOT appear in the Files rail, because
    // exposing any part of `.sequence` here would weaken a tested security
    // invariant ("/api/tree never lists .sequence/ or .git/"). Surfacing records
    // belongs in a move to a normal repo directory, not a hole in this filter.
    if (RESERVED_TREE_DIRS.has(e.name)) continue;
    if (RESERVED_TREE_FILES.has(e.name) || isSecretEnvFile(e.name)) continue;
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || EXTRA_TREE_IGNORE_DIRS.has(e.name)) continue;
      out.push({
        name: e.name,
        path: rel,
        type: 'dir',
        children: readDir(path.join(dirAbs, e.name), rel),
      });
    } else if (e.isFile()) {
      out.push({ name: e.name, path: rel, type: 'file' });
    }
    // symlinks / sockets / fifos are intentionally ignored
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}
