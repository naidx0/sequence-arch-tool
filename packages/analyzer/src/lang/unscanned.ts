/* ══════════════════════════════════════════════════════════════════════════
   UNSCANNED REGIONS — source the walk never reached
   packages/analyzer/src/lang/unscanned.ts

   Owner walk 2026-08-22: "Index is cool. It shows the files. Missing a couple,
   actually, unfortunately, but so be it."

   MEASURED: 59 tracked source files were absent from the graph. Not one of
   them was a parse failure. They are files that sit OUTSIDE every discovered
   service — 54 `.mjs` under `tools/` and `docs/brand/graphite/tools/`, plus
   `examples/` — and the scan only ever walks service directories.

   ── WHY `unfollowed` DOES NOT COVER THIS, AND WHY THAT MATTERED ──────────

   `UnfollowedTally` answers a different question: which files inside a scanned
   service were skipped because nothing here parses their LANGUAGE. On this
   repository it correctly reported `[]` — every file it looked at was
   readable.

   And `[]` is a claim. Its own contract says so: absent means "not recorded",
   empty means "looked, and everything was readable". So the graph asserted
   full coverage while 59 source files had never been opened. The tally was
   right, the sentence it produced was wrong, and nothing in between could tell.

   That is the exact failure the coverage machinery exists to prevent, one
   level up: not "we could not read this language" but "we never went there".

   ── WHAT THIS REPORTS ────────────────────────────────────────────────────

   Regions, not files. A list of 59 paths is a haystack; "tools/ — 41 source
   files, none read" is something a reader can act on, and the count is what
   tells them whether it matters.

   PURE. It is handed paths and service directories and does arithmetic. No
   filesystem, no clock.
   ══════════════════════════════════════════════════════════════════════════ */

/** One directory holding source the scan never opened. */
export interface UnscannedRegion {
  /** Top-level directory, repo-relative POSIX — `tools`, `examples`, `(root)`. */
  dir: string;
  /** How many source files it holds that no service covers. */
  files: number;
  /** Which extensions, sorted, so a reader can tell scripts from sources. */
  extensions: string[];
}

/** Files at the repository root itself, which have no directory to name. */
export const ROOT_REGION = '(root)';

function posix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Is `file` inside `dir`?
 *
 * SEGMENT-WISE, not `startsWith`. A prefix test says `packages/webhooks` is
 * inside `packages/web`, which would silently mark a whole package as covered
 * by an unrelated service and remove it from this report — the report whose
 * entire job is noticing what went missing.
 */
function within(file: string, dir: string): boolean {
  const d = posix(dir).replace(/\/+$/, '');
  if (d === '' || d === '.') return true;
  const f = posix(file);
  return f === d || f.startsWith(`${d}/`);
}

/**
 * Which regions hold source files that no service directory covers.
 *
 * `sourceFiles` is every source file in the repository; `serviceDirs` is what
 * the scan actually walked. Anything in the first and not under the second is
 * something the graph is silent about, and silence is what this converts into
 * a sentence.
 */
export function unscannedRegions(
  sourceFiles: readonly string[],
  serviceDirs: readonly string[],
): UnscannedRegion[] {
  const covered = serviceDirs.map((d) => posix(d)).filter((d) => d.length > 0);

  const byDir = new Map<string, { files: number; extensions: Set<string> }>();

  for (const raw of sourceFiles) {
    const file = posix(raw);
    if (covered.some((d) => within(file, d))) continue;

    const cut = file.indexOf('/');
    const dir = cut === -1 ? ROOT_REGION : file.slice(0, cut);
    const dot = file.lastIndexOf('.');
    const ext = dot === -1 ? '' : file.slice(dot).toLowerCase();

    let row = byDir.get(dir);
    if (!row) {
      row = { files: 0, extensions: new Set() };
      byDir.set(dir, row);
    }
    row.files += 1;
    if (ext) row.extensions.add(ext);
  }

  return [...byDir.entries()]
    /* Biggest first — the region with the most unread source is the one most
       likely to change what a reader concludes. Ties by name, so the order is
       stable across scans. */
    .sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]))
    .map(([dir, row]) => ({
      dir,
      files: row.files,
      extensions: [...row.extensions].sort(),
    }));
}

/**
 * One sentence, or null when there is genuinely nothing to say.
 *
 * Null and "nothing was missed" are the same fact here, and a surface that
 * rendered an empty region list would be showing a reader an empty box to make
 * a point about completeness.
 */
export function unscannedSummary(regions: readonly UnscannedRegion[]): string | null {
  if (regions.length === 0) return null;
  const files = regions.reduce((n, r) => n + r.files, 0);
  const named = regions
    .slice(0, 3)
    .map((r) => `${r.dir} (${r.files})`)
    .join(', ');
  const rest = regions.length > 3 ? `, and ${regions.length - 3} more` : '';
  return `${files} source file${files === 1 ? '' : 's'} sit outside every service and were not read: ${named}${rest}.`;
}
