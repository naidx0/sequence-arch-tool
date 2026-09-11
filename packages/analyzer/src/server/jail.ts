import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo-root jailing for the platform server's file endpoints.
 *
 * The server binds localhost-only, but a `?path=` query is still fully
 * attacker-controlled, so every repo-relative path a caller supplies is
 * funnelled through {@link resolveInRepo} before any fs access. The check is
 * defence-in-depth, in layers, each of which is sufficient on its own:
 *
 *  1. Reject absolute inputs outright (`path.isAbsolute`) — a caller may only
 *     ever address paths *relative* to the repo root.
 *  2. Lexical containment: `path.resolve(root, rel)` collapses any `..`
 *     segments (including ones that arrive percent-encoded, since the URL layer
 *     has already decoded `%2e%2e%2f` → `../` by the time we see the value); the
 *     result must equal the root or sit strictly beneath it (`root + sep`).
 *  3. Symlink-escape check via `realpath`: even a lexically-contained path can
 *     point outside the root through a symlink. When the FULL path exists we
 *     canonicalise it and re-run the containment test. When it does NOT exist
 *     (e.g. a new file about to be written), realpath'ing the full path throws,
 *     so we instead walk UP to the deepest ancestor that DOES exist and
 *     canonicalise THAT: a pre-existing symlinked ancestor pointing outside the
 *     repo would otherwise let a brand-new file be created outside the jail
 *     (the lexical check in layer 2 cannot see through a symlink). The
 *     not-yet-existing suffix contains no symlinks by construction, so once the
 *     existing prefix is proven inside the canonical root, containment holds.
 *     A symlink whose target escapes the jail is rejected in either case.
 *
 * Returns the absolute on-disk path when the input is safe, or `null` when it
 * violates the jail (callers turn `null` into a 403).
 */
export function resolveInRepo(repoRootReal: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  // Absolute inputs (POSIX `/etc/passwd`, Windows `C:\`, UNC) are never valid.
  if (path.isAbsolute(rel)) return null;
  // NUL byte would truncate the path at the fs layer — reject defensively.
  if (rel.includes('\0')) return null;

  const abs = path.resolve(repoRootReal, rel);
  if (abs !== repoRootReal && !abs.startsWith(repoRootReal + path.sep)) {
    return null; // lexical escape
  }

  const contained = (p: string): boolean =>
    p === repoRootReal || p.startsWith(repoRootReal + path.sep);

  // Symlink-escape check: canonicalise whatever exists on the path and require
  // it to stay within the canonical root.
  try {
    // Fast path: the full path exists — canonicalise it directly.
    if (!contained(fs.realpathSync(abs))) return null;
  } catch {
    // A DANGLING SYMLINK also lands here — `realpathSync` throws when the target
    // is missing, but the leaf itself very much exists as a link, and both
    // `writeFileSync` and `readFileSync` FOLLOW it. Treating that as "nothing is
    // there yet" and falling back to the lexical path was a jail escape: a repo
    // can commit `notes.md -> /outside/pwned.txt` or `harmless.md ->
    // .git/hooks/pre-commit` (dangling in a fresh clone, since git does not
    // create hooks), and a single Save then wrote through it — arbitrary write,
    // and code execution at the user's next commit. Git stores symlinks, so a
    // clone carries the payload. Resolve the link ourselves and judge the TARGET.
    const linked = resolveLinkTarget(abs);
    if (linked) return contained(linked) ? linked : null;

    // Genuinely missing: walk up to the deepest ancestor that DOES exist and
    // canonicalise it. This catches a NEW file addressed through a pre-existing
    // symlinked DIRECTORY that escapes the repo.
    let ancestor = path.dirname(abs);
    for (;;) {
      let real: string;
      try {
        real = fs.realpathSync(ancestor);
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) return null; // reached fs root, nothing existed
        ancestor = parent;
        continue;
      }
      if (!contained(real)) return null;
      break;
    }
  }
  return abs;
}

/**
 * Resolve a path whose LEAF is a symlink whose target does not exist (dangling).
 *
 * `fs.realpathSync` throws on these, which made every caller mistake "the leaf is
 * a link pointing somewhere that does not exist yet" for "nothing is there" — and
 * then operate on the LEXICAL path, while the OS quietly followed the link. Both
 * the jail check and the reserved-dir check need the target, not the link.
 *
 * Returns the absolute target (with any existing prefix canonicalised), or
 * undefined when `abs` is not a symlink at all. Chains are followed to a small
 * cap so a symlink loop terminates instead of spinning.
 */
function resolveLinkTarget(abs: string): string | undefined {
  let cur = abs;
  for (let hop = 0; hop < 16; hop++) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return hop === 0 ? undefined : cur; // nothing here; the last hop is the answer
    }
    if (!st.isSymbolicLink()) return hop === 0 ? undefined : cur;
    const target = fs.readlinkSync(cur);
    cur = path.resolve(path.dirname(cur), target);
    // If the new target exists, canonicalise it fully and stop.
    try {
      return fs.realpathSync(cur);
    } catch {
      /* still dangling — keep hopping in case it points at another link */
    }
  }
  return cur; // loop cap: judge what we have rather than recursing forever
}

/** Canonical (symlink-resolved) absolute root for a repo. Throws if missing. */
export function canonicalRoot(repoRoot: string): string {
  return fs.realpathSync(path.resolve(repoRoot));
}

/**
 * Canonicalise a jail-contained absolute path to its on-disk realpath location,
 * resolving symlinks the same way {@link resolveInRepo}'s containment layer does.
 *
 * For an EXISTING target this is simply `realpath(abs)` — so an in-repo symlink
 * (e.g. `docs` → `.sequence`) is followed to where it actually points. For a
 * NOT-YET-existing target (a new file about to be written) `realpath(abs)`
 * throws, so we walk UP to the deepest ancestor that DOES exist, canonicalise
 * THAT, and re-append the missing suffix — which contains no symlinks by
 * construction. A new file addressed through a pre-existing symlinked directory
 * therefore canonicalises to its real destination too.
 *
 * This is the piece the reserved-dir guard needs so it can judge reserved-ness
 * (`.sequence` / `.git`) on the REALPATH rather than the caller's lexical input:
 * a lexical top segment of `docs` is meaningless once `docs` is a symlink into a
 * reserved dir. Assumes `abs` has already passed {@link resolveInRepo} (i.e. is
 * contained); returns the canonical absolute path (falls back to `abs` only if
 * nothing on the path exists, which cannot happen for a contained input under an
 * existing repo root).
 */
export function realpathContained(abs: string): string {
  try {
    return fs.realpathSync(abs);
  } catch {
    // Same dangling-symlink hole as `resolveInRepo`: judge the TARGET, so a link
    // at `.sequence/decisions/x.md` pointing into `.git` is seen as reserved.
    const linked = resolveLinkTarget(abs);
    if (linked) return linked;
    const missing: string[] = [];
    let ancestor = abs;
    for (;;) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return abs; // reached fs root; nothing existed
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
      try {
        const real = fs.realpathSync(ancestor);
        return path.join(real, ...missing);
      } catch {
        // keep walking up to the deepest existing ancestor
      }
    }
  }
}
