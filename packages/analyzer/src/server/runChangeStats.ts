/* ══════════════════════════════════════════════════════════════════════════
   HOW MUCH A RUN CHANGED
   packages/analyzer/src/server/runChangeStats.ts

   With several runs in the activity view there is no way to tell which one
   touched forty files and which touched one without opening each. The number
   exists two clicks away in Review and never reaches the place triage happens.

   ── WHY GIT, AND NOT OUR OWN WRITE TRACKING ──────────────────────────────

   The checkpoint store already records every write that goes through
   `PUT /api/file`, with a pre-write baseline, and keying that on a run id
   would have been a much smaller change. It would also have been WRONG.

   An ACP agent does not write through our endpoint — it edits the tree with
   its own tooling, and those writes are invisible to us. A counter built on
   our own endpoint would report `3 files` for a run that changed forty, and
   would do it silently, with no error anywhere to suggest the number was
   partial. Under-reporting that looks like reporting is worse than no number
   at all.

   Git sees every write, whoever made it. So git is the source.

   ── AND WHY THE NUMBER IS A DELTA, NOT A TOTAL ───────────────────────────

   The working tree at the end of a run contains whatever was already dirty
   when it started. Reporting the end state would credit a run with edits made
   before it existed. So a run samples the tree when it starts, samples again
   when it finishes, and reports the DIFFERENCE.

   ── THE HONEST LIMIT, DECLARED RATHER THAN HIDDEN ────────────────────────

   Two runs against one working tree share that tree. If run A is going while
   run B starts and finishes, B's delta includes A's edits, and no sampling of
   a shared tree can separate them — the information is not there to recover.

   So {@link deltaOf} sets `overlapping` when it is told the window was shared,
   and every surface that renders these numbers has to say so. A number that
   might be someone else's work, presented as this run's, is the kind of wrong
   that survives for months because it always looks plausible.
   ══════════════════════════════════════════════════════════════════════════ */

/** One file's line counts, as `git diff --numstat` reports them. */
export interface FileNumstat {
  /** Repo-relative, forward-slashed. */
  path: string;
  added: number;
  removed: number;
  /**
   * True for a file git reported as binary (`-\t-\t`). Its lines are NOT
   * counted, because a binary file has none — counting it as 0/0 would make
   * "changed nothing" and "cannot be counted in lines" the same row.
   */
  binary?: boolean;
  /**
   * True for a file whose lines were not counted for a reason OTHER than being
   * binary — today, an untracked file past the size cap.
   *
   * Separate from `binary` because they are different facts and a reader can
   * act on the difference: a binary file will never have a line count, an
   * uncounted one would if it were smaller. Both render as "not counted"
   * rather than as zero, which is the entire point of the distinction.
   */
  uncounted?: boolean;
}

/** The tree at one instant. Sorted by path, so two snapshots compare cheaply. */
export type TreeSnapshot = readonly FileNumstat[];

export interface RunChangeStats {
  /** How many files this run added lines to, removed lines from, or created. */
  files: number;
  added: number;
  removed: number;
  /**
   * Files whose lines were not counted — binary, or untracked and over the
   * size cap. Carried so the row can SAY so instead of implying zero.
   */
  uncountedFiles: number;
  /**
   * True when another run was in flight during this one's window, so these
   * numbers may include its edits. See the header — this is not recoverable,
   * only declarable.
   */
  overlapping?: boolean;
}

/**
 * Parse `git diff --numstat` output.
 *
 * The format is `added \t removed \t path`, with `-` for both counts on a
 * binary file. A rename arrives as `a => b` or with NUL-separated paths under
 * `-z`; this reads the plain form and keeps the path git printed, because the
 * only thing downstream does with it is count it.
 */
export function parseNumstat(text: string): FileNumstat[] {
  const out: FileNumstat[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [a, r, ...rest] = parts;
    const path = rest.join('\t').replace(/\\/g, '/');
    if (path === '') continue;
    if (a === '-' || r === '-') {
      /* BINARY. Not 0/0: a file whose lines cannot be counted is a different
         fact from a file whose lines did not change. */
      out.push({ path, added: 0, removed: 0, binary: true });
      continue;
    }
    const added = Number.parseInt(a ?? '', 10);
    const removed = Number.parseInt(r ?? '', 10);
    if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
    out.push({ path, added, removed });
  }
  out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return out;
}

/**
 * What changed between two samples of the same tree.
 *
 * A file is counted when its numbers MOVED, in either direction. A run that
 * reverts an edit made before it started shows up as a change, which is
 * correct: it changed the tree.
 *
 * NEGATIVE DELTAS ARE CLAMPED TO ZERO for the added/removed totals but still
 * count the file. A run that undoes work has `added: 0` rather than a negative
 * count, because "-40 lines added" is a sentence no reader parses correctly,
 * and the file count is what carries "this run did something".
 */
export function deltaOf(before: TreeSnapshot, after: TreeSnapshot, overlapping = false): RunChangeStats {
  const start = new Map(before.map((f) => [f.path, f]));
  let files = 0;
  let added = 0;
  let removed = 0;
  let uncountedFiles = 0;

  const sameCountability = (a: FileNumstat | undefined, b: FileNumstat): boolean =>
    !!a && !!a.binary === !!b.binary && !!a.uncounted === !!b.uncounted;

  for (const now of after) {
    const was = start.get(now.path);
    if (was && was.added === now.added && was.removed === now.removed && sameCountability(was, now)) {
      continue; // Untouched during the window.
    }
    files += 1;
    if (now.binary || now.uncounted) {
      uncountedFiles += 1;
      continue;
    }
    added += Math.max(0, now.added - (was?.added ?? 0));
    removed += Math.max(0, now.removed - (was?.removed ?? 0));
  }

  /* A file dirty at the start and CLEAN at the end also changed — it fell out
     of the diff entirely, so the loop above never sees it. */
  const stillThere = new Set(after.map((f) => f.path));
  for (const was of before) {
    if (!stillThere.has(was.path)) files += 1;
  }

  const stats: RunChangeStats = { files, added, removed, uncountedFiles };
  return overlapping ? { ...stats, overlapping: true } : stats;
}

/**
 * The one-line form a run row shows.
 *
 * NO NUMBER IS INVENTED WHEN THERE IS NONE. A run that has not finished has no
 * delta yet, and this answers null rather than `0 files` — zero is a
 * measurement, and showing it for "not measured" is the same lie the whole
 * grounded-not-guessed rule exists to prevent.
 */
export function changeStatsLine(stats: RunChangeStats | null): string | null {
  if (!stats) return null;
  if (stats.files === 0) return 'no files changed';
  const parts = [`${stats.files} ${stats.files === 1 ? 'file' : 'files'}`];
  if (stats.added > 0) parts.push(`+${stats.added}`);
  if (stats.removed > 0) parts.push(`-${stats.removed}`);
  if (stats.uncountedFiles > 0) {
    /* NOT folded into the line totals. These files changed and their line
       counts are unknown; adding them as zero would understate the run. */
    parts.push(`${stats.uncountedFiles} not counted`);
  }
  const line = parts.join(' ');
  /* THE CAVEAT TRAVELS WITH THE NUMBER. Rendering it separately, or only in a
     tooltip, means the number gets read and the caveat does not. */
  return stats.overlapping ? `${line} (shared with another run)` : line;
}
