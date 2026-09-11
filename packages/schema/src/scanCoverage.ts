/* ══════════════════════════════════════════════════════════════════════════
   DID THE SCANNER ACTUALLY LOOK HERE?

   ABSENCE OF A SIGNAL IS NOT EVIDENCE OF ABSENCE. Every consumer that reasons
   from something MISSING in the graph — no `.py` file node, no edge between two
   services — is one question away from turning a gap in OUR knowledge into a
   confident claim about the WORLD. This module is that question, asked once.

   IT EXISTS BECAUSE TWO FEATURES DERIVED IT SEPARATELY IN ONE NIGHT. The
   question-premise check (`moat/claimCheck.ts`) needed it to answer "this repo
   has no Python", and W3's `graph-gap` verdict needs it to answer "no such edge
   exists" without blaming a learner who is right. A third derivation was coming,
   and the third one gets it subtly wrong. One definition, in one place, with the
   second asking the first.

   THREE SIGNALS, AND THEY MEAN DIFFERENT THINGS:

     `warnings`   the file walk stops at `maxFiles` (20,000) and pushes
                  `file limit N reached — remaining files skipped`. Past that
                  point nothing about absence is knowable.
     `unfollowed` "we opened this and cannot parse the language" — the C#
                  payment service that produced a graph with no payment service
                  in it and nothing saying why.
     `unscanned`  "we never went there at all" — directories holding source no
                  scanned service covers.

   USING ONE ALONE PRODUCES A CONFIDENTLY FALSE ANSWER, and this repository is
   the proof twice over. Measured 2026-08-22, 59 tracked source files were absent
   from the graph, none of them parse failures, while `unfollowed` reported `[]`
   throughout — a value its own contract defines as "looked, and everything was
   readable". And measured 2026-09-03 on the live scan, `unscanned` holds
   `tools` (68 files, `.mjs` `.py`) and `examples` (6 files, `.py` `.ts`): this
   repository CONTAINS Python that the walk never visited, so a check reading
   only file nodes would answer "there is no Python here" and be wrong.

   ABSENT IS NOT EMPTY. `[]` is a real answer meaning "looked, found nothing
   unread". `undefined` means "not recorded" — an older persisted graph, or a
   hand-authored design spec. Treating absent as complete is the same defect in
   its purest form, so it gets its own verdict rather than a boolean.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph } from './index.js';

/**
 * Whether an ABSENCE in this graph may be treated as proof.
 *
 * `complete` — the walk finished, opened everything it found, and reached every
 *   region. An absence is evidence.
 * `partial`  — it stopped early, or could not parse something, or never visited
 *   somewhere. An absence is evidence ONLY outside the gaps; ask
 *   `canRefuteExtension`.
 * `unknown`  — coverage was never recorded. Nothing about absence is knowable.
 */
export type CoverageVerdict = 'complete' | 'partial' | 'unknown';

export interface ScanCoverage {
  verdict: CoverageVerdict;
  /** The file walk hit its cap; beyond it the graph knows nothing. */
  truncated: boolean;
  /** Extensions sitting in directories the walk never entered. */
  unvisitedExtensions: ReadonlySet<string>;
  /** Extensions the walk opened and could not parse. */
  unparsedExtensions: ReadonlySet<string>;
  /** Human-readable, so a turn can cite what was not covered. */
  reasons: string[];
}

const TRUNCATED = /file limit \d+ reached/i;

const norm = (ext: string): string => {
  const e = ext.trim().toLowerCase();
  return e === '' || e.startsWith('.') ? e : `.${e}`;
};

export function scanCoverage(
  graph: Pick<ArchGraph, 'warnings' | 'unfollowed' | 'unscanned'>,
): ScanCoverage {
  const truncated = (graph.warnings ?? []).some((w) => TRUNCATED.test(w));
  const recorded = graph.unfollowed !== undefined && graph.unscanned !== undefined;

  const unvisitedExtensions = new Set<string>();
  const unparsedExtensions = new Set<string>();
  const reasons: string[] = [];

  for (const region of graph.unscanned ?? []) {
    for (const ext of region.extensions ?? []) unvisitedExtensions.add(norm(ext));
    reasons.push(`${region.dir}: ${region.files} source files never visited`);
  }
  for (const src of graph.unfollowed ?? []) {
    for (const ext of src.extensions ?? []) unparsedExtensions.add(norm(ext));
    reasons.push(`${src.language}: ${src.files} files opened but not parsed`);
  }
  if (truncated) reasons.push('the file walk stopped at its limit; the rest was never seen');

  const verdict: CoverageVerdict = !recorded
    ? 'unknown'
    : truncated || unvisitedExtensions.size > 0 || unparsedExtensions.size > 0
      ? 'partial'
      : 'complete';

  return { verdict, truncated, unvisitedExtensions, unparsedExtensions, reasons };
}

/**
 * May "the graph holds no file with this extension" be treated as "the
 * repository has none"?
 *
 * PARTIAL COVERAGE DOES NOT DISQUALIFY EVERY QUESTION, which is the point of
 * asking per-extension rather than for one boolean. A scan that never entered
 * `docs/` still knows perfectly well whether there is Ruby in the services it
 * did walk. It is only the extensions actually sitting in a gap — and any
 * extension at all once the walk was truncated or coverage was never recorded —
 * that an absence cannot speak to.
 */
export function canRefuteExtension(coverage: ScanCoverage, ext: string): boolean {
  if (coverage.verdict === 'unknown' || coverage.truncated) return false;
  const e = norm(ext);
  return !coverage.unvisitedExtensions.has(e) && !coverage.unparsedExtensions.has(e);
}
