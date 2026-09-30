import path from 'node:path';

/**
 * Repo-relative paths are DATA. They are POSIX everywhere, on every platform.
 *
 * A path that comes out of a scan is not an argument you hand to `fs` — it is an
 * identifier. It becomes a node id (`file:gateway/src/index.ts`), an evidence
 * ref (`packages/alpha/src/one.ts:3`), a key in an export, and a string a client
 * compares against. `path.relative()` answers in the host's separator, so
 * without this the same repo scanned on Windows and on Linux produces DIFFERENT
 * node identities and anything joining across that boundary silently misses.
 *
 * This is a single source of truth on purpose, for the reason `ignoreDirs.ts`
 * is: the rule was previously re-implemented inline in `graphCache.ts` on the
 * cache-WRITE path only, so the persisted `archgraph.json` looked correct while
 * the in-memory graph every consumer actually reads was still native. That gap
 * cost six red analyzer tests, all of them filed as environmental "Windows path
 * separator" noise rather than the one-line bug they were.
 *
 * ABSOLUTE PATHS ARE NOT THIS. `repoRoot`, and anything else handed back to the
 * filesystem, must stay native — do not run those through here.
 */
export function toRelPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}
