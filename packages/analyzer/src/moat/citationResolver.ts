/* ══════════════════════════════════════════════════════════════════════════
   DID THIS CITATION EVER NAME A REAL FILE?

   Design and rationale: `docs/research/claim-audit-resolver.md`.

   A grounded tool's citations are the thing that makes its claims checkable, so
   a fabricated one is the most corrosive error it can make. This classifies a
   cited path against a repository AT A COMMIT — the SHA a session record pins,
   not a branch name, because a name resolves to a different tree every hour.

   COVERAGE IS DELIBERATELY NOT CONSULTED, and that is the one instruction worth
   reading twice in a repository that has spent a week building coverage-gating.
   Whether a path exists is decided by the filesystem and git. Coverage governs
   EDGE claims — "A calls B" — where absence in the graph is only evidence inside
   a scanned region. The prior instrument imported it here and dropped 19
   citations from its denominator for no reason; on a repository with no scan it
   would have dropped every one. The discipline is knowing which claims coverage
   governs, and using it where git already answers is a wrong denominator rather
   than extra rigour.

   ORDER IS THE DESIGN. Each class is tried before the next and `fabricated` is
   last, because it is the only one that accuses anybody. Every earlier class
   exists because a real run produced a false accusation without it.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type CitationVerdict =
  /** On disk at the pinned commit, exactly as written. */
  | 'resolves'
  /** Resolves once a package prefix is restored — `acp/src/x.ts` → `packages/acp/src/x.ts`. */
  | 'package-root'
  /** Existed at some commit reachable from any ref. A rename is not a fabrication. */
  | 'history'
  /** A bare filename. Asserts nothing about location, so it is never counted. */
  | 'bare-name'
  /** Exists at no commit on any ref, and nowhere on disk. The only accusation. */
  | 'fabricated';

export interface CitationResult {
  path: string;
  verdict: CitationVerdict;
  /** What it resolved to, when the answer was not the literal citation. */
  resolvedAs?: string;
  /** Counted in the denominator? `bare-name` is not a claim of location. */
  counted: boolean;
}

/** Run git, returning null rather than throwing — a non-checkout is ordinary. */
function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Classify one cited path against `repoRoot` at `commit`.
 *
 * `commit` is a SHA from a session record. When it is absent the working tree is
 * used and the result says so by resolving against disk — an honest degradation,
 * because the alternative is refusing to audit any record written before commits
 * were pinned.
 */
export function resolveCitation(
  repoRoot: string,
  cited: string,
  commit?: string,
): CitationResult {
  const raw = cited.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  /* A BARE FILENAME IS NOT A CLAIM OF LOCATION. `one.ts` asserts nothing about
     where it lives, so counting it either way would be inventing a claim the
     agent did not make. */
  if (!raw.includes('/')) {
    return { path: cited, verdict: 'bare-name', counted: false };
  }

  const atCommit = (p: string): boolean =>
    commit
      ? git(repoRoot, ['cat-file', '-e', `${commit}:${p}`]) !== null
      : fs.existsSync(path.join(repoRoot, p));

  if (atCommit(raw)) return { path: cited, verdict: 'resolves', counted: true };

  /*
   * THE PACKAGE-ROOT FORM, and it is a resolver rule rather than a citing rule.
   * An agent working inside `packages/acp` writes `acp/src/index.ts`, which is
   * unambiguous to a reader and unresolvable to a naive `test -f`. Three of six
   * apparent misses in the prior audit were this.
   */
  const prefixed = `packages/${raw}`;
  if (atCommit(prefixed)) {
    return { path: cited, verdict: 'package-root', resolvedAs: prefixed, counted: true };
  }

  /*
   * HISTORY BEFORE ACCUSATION. A renamed or deleted file existed; calling it
   * fabricated is the false accusation this class exists to prevent, and without
   * it every rename reads as a lie and the verdict becomes noise.
   *
   * `--all` so a file that only ever lived on another branch still counts.
   */
  for (const candidate of [raw, prefixed]) {
    const seen = git(repoRoot, [
      'log',
      '--all',
      '--oneline',
      '-1',
      '--diff-filter=A',
      '--',
      candidate,
    ]);
    if (seen) {
      return { path: cited, verdict: 'history', resolvedAs: candidate, counted: true };
    }
  }

  return { path: cited, verdict: 'fabricated', counted: true };
}

export interface AuditSummary {
  /** The commit every citation was resolved at, or `null` for the working tree. */
  commit: string | null;
  /** Citations that made a claim of location. `bare-name` rows are excluded. */
  denominator: number;
  fabricated: number;
  results: CitationResult[];
}

/**
 * Resolve many citations and report the residual WITH its denominator.
 *
 * The denominator and the commit ride the answer because a rate without them is
 * a claim rather than a measurement — the third law in `docs/how-to-verify.md`,
 * which this instrument exists to serve.
 */
export function auditCitations(
  repoRoot: string,
  cited: readonly string[],
  commit?: string,
): AuditSummary {
  const results = cited.map((c) => resolveCitation(repoRoot, c, commit));
  const counted = results.filter((r) => r.counted);
  return {
    commit: commit ?? null,
    denominator: counted.length,
    fabricated: counted.filter((r) => r.verdict === 'fabricated').length,
    results,
  };
}
