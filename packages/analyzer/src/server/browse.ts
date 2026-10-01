import fs from 'node:fs';
import path from 'node:path';

/**
 * Directory-listing for the home screen's folder picker, jailed to an explicit
 * BROWSE ROOT boundary (default: the user's home dir, canonicalised).
 *
 * This is a NEW filesystem-exposure surface, so containment is first-class and
 * built the same way as the repo jail (jail.ts): three layers, each sufficient
 * on its own —
 *
 *  1. Reject NUL-byte inputs (they truncate a path at the fs layer).
 *  2. Lexical containment: `path.resolve` collapses any `..` segments (percent-
 *     encoded ones are already decoded by the URL layer), and an ABSOLUTE input
 *     that lands outside the root fails here too — the result must equal the
 *     browse root or sit strictly beneath it (`root + sep`).
 *  3. Symlink-escape check via `realpath`: a lexically-contained path can still
 *     point outside through a symlink, so we canonicalise the target and re-run
 *     containment. A symlink whose realpath escapes the browse root is rejected.
 *
 * Crucially, this endpoint NEVER returns file contents — only the names/paths of
 * immediate SUB-DIRECTORIES. File reads stay on the jailed /api/file surface.
 */

export interface BrowseEntry {
  name: string;
  /** absolute path (lexical, stable for display + re-navigation) */
  path: string;
  /** the dir looks like a project root (has .git / package.json / docker-compose) */
  isRepo: boolean;
  /** the dir has at least one browsable sub-directory (picker expand hint) */
  hasChildren: boolean;
}

export interface BrowseResult {
  /** the browse-root boundary (absolute, canonical) — nothing above it is reachable */
  root: string;
  /** the directory being listed (absolute, canonical) */
  path: string;
  /** parent directory, or null when at the browse root (cannot ascend past it) */
  parent: string | null;
  entries: BrowseEntry[];
}

export type BrowseOutcome =
  | { ok: true; result: BrowseResult }
  | { ok: false; status: number; error: string };

/** Files whose presence in a dir flags it as a likely repo/project root. */
const REPO_MARKERS = [
  '.git',
  'package.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'pnpm-workspace.yaml',
];

/**
 * Canonical (symlink-resolved) absolute browse root. Falls back to the plain
 * absolute path when the dir cannot be realpath'd yet, so merely CONSTRUCTING a
 * server never throws on an exotic home dir — a missing root simply lists nothing.
 */
export function canonicalBrowseRoot(dir: string): string {
  const abs = path.resolve(dir);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** True when `p` is the browse root or a directory strictly inside it. */
export function isContainedInBrowseRoot(browseRoot: string, p: string): boolean {
  if (p === browseRoot) return true;
  /*
   * A FILESYSTEM ROOT ALREADY ENDS IN THE SEPARATOR.
   *
   * `/` on POSIX, `C:\` on Windows. Appending another one builds a prefix no
   * real path can start with (`//`, `C:\\`), so a browse root set to the
   * filesystem root refused every path underneath it. Unix had a special case
   * for exactly this; Windows drive roots did not, and there the bug was total —
   * point the root at `C:\` and nothing on the machine is reachable.
   *
   * Deriving the prefix instead of special-casing one spelling covers both, and
   * anything else that legitimately ends in a separator.
   */
  const prefix = browseRoot.endsWith(path.sep) ? browseRoot : browseRoot + path.sep;
  return p.startsWith(prefix) && p.length > prefix.length;
}

/**
 * Resolve a caller-supplied browse target to a canonical absolute directory
 * CONTAINED within `browseRoot`, or `null` when it escapes (absolute-outside,
 * `..`-escape, or symlink-escape). An empty target resolves to the root itself.
 * `browseRoot` is assumed already canonical (see {@link canonicalBrowseRoot}).
 */
export function resolveInBrowseRoot(browseRoot: string, target: string): string | null {
  if (typeof target !== 'string') return null;
  if (target.includes('\0')) return null;
  const contained = (p: string): boolean => isContainedInBrowseRoot(browseRoot, p);

  const abs = target === '' ? browseRoot : path.resolve(target);
  if (!contained(abs)) return null; // lexical escape (absolute-outside or ..)

  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return null; // does not exist / broken symlink
  }
  if (!contained(real)) return null; // symlink escape
  return real;
}

/** List the immediate sub-directories of `target` within the browse root. */
export function browseDir(browseRoot: string, target: string): BrowseOutcome {
  const dir = resolveInBrowseRoot(browseRoot, target);
  if (dir === null) return { ok: false, status: 403, error: 'path escapes the browse root' };
  // F2: dot-directories are HIDDEN from listings (see listSubdirs), so they must
  // not be explicitly navigable either — otherwise `?path=<root>/.ssh` enumerates
  // a hidden secret dir's subdirs even though the picker never offers it. Judge on
  // the realpath-resolved `dir` (so a symlink INTO a dot dir is caught too):
  // reject when any path segment beneath the browse root begins with a dot. The
  // browse root itself (relative === '') is always listable.
  const relToRoot = path.relative(browseRoot, dir);
  if (relToRoot && relToRoot.split(path.sep).some((seg) => seg.startsWith('.'))) {
    return { ok: false, status: 403, error: 'cannot browse into a hidden (dot) directory' };
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(dir);
  } catch {
    return { ok: false, status: 404, error: 'directory not found' };
  }
  if (!st.isDirectory()) return { ok: false, status: 400, error: 'path is not a directory' };

  const parent = dir === browseRoot ? null : path.dirname(dir);
  return {
    ok: true,
    result: {
      root: browseRoot,
      path: dir,
      // dirname of any contained non-root dir is itself contained (it walks down
      // to the root); guard defensively anyway.
      parent: parent && isContainedInBrowseRoot(browseRoot, parent) ? parent : null,
      entries: listSubdirs(browseRoot, dir),
    },
  };
}

/**
 * Immediate sub-directories of `dir`, sorted repos-first then alphabetically.
 * Dot-directories are hidden (matching the scanner's dot-skip ethos — you rarely
 * attach a `.hidden` dir), and a symlinked sub-dir whose realpath ESCAPES the
 * browse root is dropped entirely (never listed, never navigable).
 */
function listSubdirs(browseRoot: string, dir: string): BrowseEntry[] {
  const contained = (p: string): boolean => isContainedInBrowseRoot(browseRoot, p);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: BrowseEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue; // hide dot-entries from the picker
    const lexical = path.join(dir, d.name);
    // `probe` is the real on-disk dir to inspect (== lexical for a plain dir; the
    // realpath for a symlink). `null` ⇒ not a browsable/contained directory.
    let probe: string | null = null;
    if (d.isDirectory()) {
      probe = lexical;
    } else if (d.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(lexical);
        if (contained(real) && fs.statSync(real).isDirectory()) probe = real;
      } catch {
        probe = null; // broken or escaping symlink — drop it
      }
    }
    if (!probe) continue;
    out.push({
      name: d.name,
      path: lexical,
      isRepo: looksLikeRepo(probe),
      hasChildren: hasSubdir(probe),
    });
  }
  out.sort((a, b) => {
    if (a.isRepo !== b.isRepo) return a.isRepo ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

function looksLikeRepo(dir: string): boolean {
  return REPO_MARKERS.some((m) => {
    try {
      return fs.existsSync(path.join(dir, m));
    } catch {
      return false;
    }
  });
}

function hasSubdir(dir: string): boolean {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    if (d.isDirectory()) return true;
    if (d.isSymbolicLink()) {
      try {
        if (fs.statSync(path.join(dir, d.name)).isDirectory()) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}
