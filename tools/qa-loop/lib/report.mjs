/**
 * Summary table + baseline regression diff.
 *
 * Raw numbers are not a result — "is this worse than last time?" is. The diff
 * below is the part that turns a wall of metrics into a verdict, and it is
 * deliberately asymmetric: a metric moving the wrong way is a REGRESSION and
 * fails the run, a metric moving the right way is an IMPROVEMENT and does not.
 *
 * The report-generation shape (build an array of lines, join at the end) mirrors
 * `packages/analyzer/src/eval/grade.ts`'s `buildReport`, so both read the same.
 */

/**
 * U30 — WHEN A METRIC CHANGES MEANING, THE BASELINE MUST NOT SILENTLY READ AS A
 * REGRESSION.
 *
 * `baseline.json` stores a number per repo, and the diff below assumes both
 * sides were computed the same way. That assumption broke the moment `U30`
 * widened two rules:
 *
 *   - `dupTitleCount` now compares titles the way they READ (trim, collapse,
 *     case-fold), so it can only go UP against a baseline recorded with the old
 *     byte-identical rule.
 *   - `fallbackTitlePct` now counts a BLANK label/summary, so it can only go UP
 *     too.
 *
 * A rise in either is a REGRESSION under the rules below. Against a v1
 * baseline, that rise would be the metric getting sharper — reported as the
 * product getting worse. So the baseline carries the version it was recorded
 * under, and a diff across versions REFUSES to judge the redefined metrics and
 * says so out loud instead. The numbers come back the moment the baseline is
 * deliberately re-recorded with `--update-baseline` on a whole tier.
 *
 * Bump this, and add to REDEFINED_METRICS, whenever a metric's rule changes.
 */
export const METRIC_VERSION = 2;

/** metric -> the version that changed its meaning, and why, for the operator. */
export const REDEFINED_METRICS = {
  dupTitleCount: {
    since: 2,
    why: 'now counts titles that differ only by case or whitespace (they read identically)',
  },
  fallbackTitlePct: {
    since: 2,
    why: 'now counts a blank label or blank summary (G12 — a row that reads as nothing)',
  },
};

/**
 * Thresholds. Each one is a judgement, so each one is named and explained
 * rather than being a bare number buried in a comparison.
 */
export const REGRESSION_RULES = {
  /** Evidence coverage is an invariant, not a metric — any real drop is a bug. */
  evidencePctDrop: 0.1,
  /**
   * U30 — evidence that OPENS. Same reasoning as above, one step further along:
   * a citation the user cannot open is not evidence, so any real drop is a bug.
   */
  evidenceResolvedPctDrop: 0.1,
  /**
   * U30 — how much shorter a main flow got. `stemPlays` flipping true→false is a
   * flat regression (below); a flow that still plays but collapsed from 34 hops
   * to 1 is a quality loss that is NOT automatically a defect — hop counts move
   * legitimately when clustering or resolution changes. So it is flagged, never
   * fatal, exactly like the wall-clock rule.
   */
  stemHopsDropFactor: 2,
  stemHopsFloor: 3,
  /** Edge scores against hand-verified truth: 1 point of noise tolerance. */
  scoreDrop: 1,
  /** Naming quality moves in lumps as clustering changes; 5 points is signal. */
  fallbackTitlePctRise: 5,
  /** A duplicate row is settled owner canon — any new one counts. */
  dupTitleRise: 1,
  /** Wall-clock: only flagged (never fatal) and only when both slow and much slower. */
  slowdownFactor: 2,
  slowdownFloorMs: 5000,
};

/**
 * Findings that need no baseline to be wrong.
 *
 * The baseline diff answers "worse than last time?". These two answer "wrong on
 * its own terms?", and they exist because a first run has no baseline and would
 * otherwise report a repo that scanned to nothing as a clean pass — then the
 * next `--update-baseline` would freeze that nothing in as the expectation.
 *
 *  - A repo with a HAND-VERIFIED ground truth that matches none of it. Somebody
 *    checked those edges by hand; matching zero is a defect, not a data point.
 *  - A repo that scanned OK and produced zero files. "Silence is the worst
 *    failure mode" (HANDOFF §7.5) — an empty graph reported as success is
 *    exactly that. A declared `negativeCase` row is exempt: producing nothing
 *    is the answer we want there, and the row says so in `why`.
 */
export function hardFindings(rows) {
  const out = [];
  for (const r of rows) {
    if (!r.ok) continue;
    if (r.scoreVsTruth && r.scoreVsTruth.recall === 0) {
      out.push(
        `${r.id}: matched NONE of the hand-verified edges in ${r.scoreVsTruth.truth} ` +
          `(recall 0%) — the ground truth says this repo has real edges and the scan found none of them`
      );
    }
    /**
     * U30 — every edge cites evidence and NOT ONE citation opens. That is not a
     * "worse than last time" question: a graph whose every claim points at a
     * file that is not there, or a line that is not in it, is fabricated on its
     * own terms even though `evidencePct` reads 100%. One openable citation
     * anywhere is enough to stay out of this list, so it cannot fire on noise.
     */
    const er = r.evidenceResolution;
    if (er && er.edgesWithEvidence > 0 && er.edgesWithResolvableEvidence === 0) {
      out.push(
        `${r.id}: ${er.edgesWithEvidence} edge(s) carry evidence and NONE of it opens — ` +
          `evidencePct says ${fmt(r.evidencePct, '%')} while every file:line is unreachable` +
          (er.examples?.[0] ? ` (e.g. ${er.examples[0].edge}: ${er.examples[0].problem})` : '')
      );
    }
    if (!r.negativeCase && r.counts && r.counts.files === 0) {
      out.push(
        `${r.id}: scan reported success but produced ZERO files` +
          (r.warnings?.length ? ` — scanner said: ${r.warnings[0]}` : ' — and said nothing about why')
      );
    }
  }
  return out;
}

function fmt(v, suffix = '') {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return `${Number.isInteger(v) ? v : v.toFixed(1)}${suffix}`;
  return String(v);
}

/**
 * Compare a run against a baseline.
 *
 * @param {any[]} rows current result rows
 * @param {{repos?: Record<string, any>} | null} baseline
 * @returns {{regressions: string[], improvements: string[], warnings: string[], newRepos: string[], missing: string[]}}
 */
export function diffBaseline(rows, baseline) {
  const out = { regressions: [], improvements: [], warnings: [], newRepos: [], missing: [], staleMetrics: [] };
  const base = baseline?.repos ?? null;
  if (!base) return out;

  // U30 — which metrics this baseline is too old to be compared on. Named, not
  // silently skipped: an unjudged metric the operator does not know about is
  // the same blindness this round exists to remove.
  const baseVersion = Number.isFinite(baseline?.metricVersion) ? baseline.metricVersion : 1;
  const stale = new Set();
  for (const [metric, info] of Object.entries(REDEFINED_METRICS)) {
    if (baseVersion < info.since) {
      stale.add(metric);
      out.staleMetrics.push(
        `${metric}: baseline was recorded under metric version ${baseVersion}, this run is ${METRIC_VERSION} — ` +
          `${info.why}. NOT judged; re-record with \`--update-baseline\` on a whole tier.`
      );
    }
  }

  const seen = new Set();
  for (const r of rows) {
    seen.add(r.id);
    const b = base[r.id];
    if (!b) {
      out.newRepos.push(r.id);
      continue;
    }
    if (b.ok && !r.ok) {
      out.regressions.push(`${r.id}: was OK, now FAILED — ${r.error?.message ?? 'no message'}`);
      continue;
    }
    if (!b.ok && r.ok) out.improvements.push(`${r.id}: was FAILED, now OK`);
    if (!r.ok) continue;

    const nEvid = r.evidencePct;
    const bEvid = b.evidencePct;
    const nResolved = r.evidenceResolvedPct;
    const bResolved = b.evidenceResolvedPct;
    if (typeof nEvid === 'number' && typeof bEvid === 'number') {
      if (bEvid - nEvid >= REGRESSION_RULES.evidencePctDrop) {
        out.regressions.push(`${r.id}: evidence ${fmt(bEvid, '%')} → ${fmt(nEvid, '%')}`);
      } else if (nEvid - bEvid >= REGRESSION_RULES.evidencePctDrop) {
        out.improvements.push(`${r.id}: evidence ${fmt(bEvid, '%')} → ${fmt(nEvid, '%')}`);
      }
    }

    for (const axis of ['precision', 'recall']) {
      const n = r.scoreVsTruth?.[axis];
      const o = b.scoreVsTruth?.[axis];
      if (typeof n !== 'number' || typeof o !== 'number') continue;
      const dn = (o - n) * 100;
      if (dn >= REGRESSION_RULES.scoreDrop) {
        out.regressions.push(`${r.id}: ground-truth ${axis} ${fmt(o * 100, '%')} → ${fmt(n * 100, '%')}`);
      } else if (-dn >= REGRESSION_RULES.scoreDrop) {
        out.improvements.push(`${r.id}: ground-truth ${axis} ${fmt(o * 100, '%')} → ${fmt(n * 100, '%')}`);
      }
    }

    if (!stale.has('fallbackTitlePct') && typeof r.fallbackTitlePct === 'number' && typeof b.fallbackTitlePct === 'number') {
      const rise = r.fallbackTitlePct - b.fallbackTitlePct;
      if (rise >= REGRESSION_RULES.fallbackTitlePctRise) {
        out.regressions.push(
          `${r.id}: fallback titles ${fmt(b.fallbackTitlePct, '%')} → ${fmt(r.fallbackTitlePct, '%')}`
        );
      } else if (-rise >= REGRESSION_RULES.fallbackTitlePctRise) {
        out.improvements.push(
          `${r.id}: fallback titles ${fmt(b.fallbackTitlePct, '%')} → ${fmt(r.fallbackTitlePct, '%')}`
        );
      }
    }

    if (!stale.has('dupTitleCount') && typeof r.dupTitleCount === 'number' && typeof b.dupTitleCount === 'number') {
      const rise = r.dupTitleCount - b.dupTitleCount;
      if (rise >= REGRESSION_RULES.dupTitleRise) {
        out.regressions.push(`${r.id}: duplicate module titles ${b.dupTitleCount} → ${r.dupTitleCount}`);
      } else if (rise < 0) {
        out.improvements.push(`${r.id}: duplicate module titles ${b.dupTitleCount} → ${r.dupTitleCount}`);
      }
    }

    if (typeof nResolved === 'number' && typeof bResolved === 'number') {
      if (bResolved - nResolved >= REGRESSION_RULES.evidenceResolvedPctDrop) {
        out.regressions.push(`${r.id}: evidence that opens ${fmt(bResolved, '%')} → ${fmt(nResolved, '%')}`);
      } else if (nResolved - bResolved >= REGRESSION_RULES.evidenceResolvedPctDrop) {
        out.improvements.push(`${r.id}: evidence that opens ${fmt(bResolved, '%')} → ${fmt(nResolved, '%')}`);
      }
    }

    if (b.stemFound === true && r.stemFound === false) {
      out.regressions.push(`${r.id}: main-flow stem was found, now none`);
    } else if (b.stemFound === false && r.stemFound === true) {
      out.improvements.push(`${r.id}: main-flow stem now found`);
    }

    /**
     * U30 — the one that matters. `stemFound` above says a stem was NAMED;
     * this says the flow PLAYS. A repo that keeps its stem and loses its flow
     * is exactly the U23 defect, and it used to move neither number.
     */
    if (b.stemPlays === true && r.stemPlays === false) {
      out.regressions.push(
        `${r.id}: main flow no longer plays — ${r.stemFlow?.message ?? 'no reason recorded'}`
      );
    } else if (b.stemPlays === false && r.stemPlays === true) {
      out.improvements.push(`${r.id}: main flow now plays (${fmt(r.stemHops)} hops)`);
    } else if (
      typeof r.stemHops === 'number' &&
      typeof b.stemHops === 'number' &&
      b.stemHops >= REGRESSION_RULES.stemHopsFloor &&
      r.stemHops * REGRESSION_RULES.stemHopsDropFactor <= b.stemHops
    ) {
      out.warnings.push(`${r.id}: main flow shortened ${b.stemHops} → ${r.stemHops} hops`);
    }

    if (
      typeof r.elapsedMs === 'number' &&
      typeof b.elapsedMs === 'number' &&
      r.elapsedMs > REGRESSION_RULES.slowdownFloorMs &&
      r.elapsedMs > b.elapsedMs * REGRESSION_RULES.slowdownFactor
    ) {
      out.warnings.push(`${r.id}: ${b.elapsedMs}ms → ${r.elapsedMs}ms (>${REGRESSION_RULES.slowdownFactor}× slower)`);
    }
  }

  for (const id of Object.keys(base)) if (!seen.has(id)) out.missing.push(id);
  return out;
}

/** Reduce result rows to the comparable subset stored in baseline.json. */
export function toBaseline(rows, meta = {}) {
  const repos = {};
  for (const r of rows) {
    repos[r.id] = {
      sha: r.sha,
      ok: r.ok,
      counts: r.counts,
      evidencePct: r.evidencePct,
      evidenceResolvedPct: r.evidenceResolvedPct ?? null,
      fallbackTitlePct: r.fallbackTitlePct,
      dupTitleCount: r.dupTitleCount,
      // U30 — `stemFound` stays so the redefinition is auditable: it is the OLD
      // number, unchanged, sitting next to the one that measures the outcome.
      stemFound: r.stemFound,
      stemPlays: r.stemPlays ?? null,
      stemHops: r.stemHops ?? null,
      scoreVsTruth: r.scoreVsTruth ?? null,
      elapsedMs: r.elapsedMs,
    };
  }
  // `version` is the FILE format; `metricVersion` is how the numbers inside were
  // computed. They move independently and conflating them is how a redefined
  // metric reads as a regression.
  return { version: 1, metricVersion: METRIC_VERSION, ...meta, repos };
}

/**
 * @param {any[]} rows
 * @param {any} judgeRows
 * @param {ReturnType<typeof diffBaseline>} diff
 * @param {{stamp: string, tier: string, cacheRoot: string, baselineFile: string, hasBaseline: boolean, sequenceSha?: string}} meta
 */
export function buildSummary(rows, judgeRows, diff, meta) {
  const ok = rows.filter((r) => r.ok);
  const failed = rows.filter((r) => !r.ok);
  const L = [];
  L.push(`# Sequence QA loop — ${meta.tier} tier — ${meta.stamp}`);
  L.push('');
  L.push('> Deterministic (key-free) multi-repo run. Every number below comes from the real');
  L.push('> engine (`scanRepo` → `validateGraph` / `scoreGraph` / `mainFlowState`) over a');
  L.push(
    meta.tier.startsWith('local(')
      ? '> repository already on disk (`--local`, so no pinned commit). Nothing here is estimated.'
      : '> real repository at its pinned commit. Nothing here is estimated or filled in.'
  );
  L.push('');
  L.push(`- Repos attempted: **${rows.length}** · scanned OK: **${ok.length}** · failed: **${failed.length}**`);
  if (meta.sequenceSha) L.push(`- Sequence commit under test: \`${meta.sequenceSha}\``);
  L.push(`- Clone cache: \`${meta.cacheRoot}\``);
  L.push(`- Baseline: ${meta.hasBaseline ? `\`${meta.baselineFile}\`` : '**none yet** — this run cannot detect a regression'}`);
  L.push('');

  const hard = hardFindings(rows);
  L.push('## Hard findings — wrong on their own terms, baseline or not');
  L.push('');
  if (hard.length === 0) {
    L.push('None.');
  } else {
    for (const h of hard) L.push(`- ❌ ${h}`);
  }
  L.push('');

  L.push('## Regression diff');
  L.push('');
  if (!meta.hasBaseline) {
    L.push('No baseline recorded. Re-run with `--update-baseline` to make this run the reference.');
  } else if (diff.regressions.length === 0 && diff.improvements.length === 0 && diff.warnings.length === 0) {
    L.push('No change against the baseline on any tracked metric.');
  } else {
    if (diff.regressions.length > 0) {
      L.push(`**REGRESSIONS (${diff.regressions.length})**`);
      L.push('');
      for (const d of diff.regressions) L.push(`- ❌ ${d}`);
      L.push('');
    }
    if (diff.warnings.length > 0) {
      L.push(`**Warnings (${diff.warnings.length})** — flagged, not fatal`);
      L.push('');
      for (const d of diff.warnings) L.push(`- ⚠️ ${d}`);
      L.push('');
    }
    if (diff.improvements.length > 0) {
      L.push(`**Improvements (${diff.improvements.length})**`);
      L.push('');
      for (const d of diff.improvements) L.push(`- ✅ ${d}`);
      L.push('');
    }
  }
  if (diff.staleMetrics?.length > 0) {
    L.push('');
    L.push(`**Not judged — the metric changed, not the product (${diff.staleMetrics.length})**`);
    L.push('');
    for (const s of diff.staleMetrics) L.push(`- ⏸ ${s}`);
    L.push('');
  }
  if (diff.newRepos.length > 0) L.push(`- New in this run (no baseline row): ${diff.newRepos.join(', ')}`);
  if (diff.missing.length > 0) L.push(`- In the baseline but not this run: ${diff.missing.join(', ')}`);
  L.push('');

  L.push('## Per repo');
  L.push('');
  L.push(
    '| repo | ok | elapsed | peak RSS | svc | mod | files | edges | evidence | opens | fallback titles | dup titles | stem | main flow | truth P/R |'
  );
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    if (!r.ok) {
      L.push(`| ${r.id} | ❌ | ${fmt(r.elapsedMs)}ms | — | — | — | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const pr = r.scoreVsTruth
      ? `${fmt(r.scoreVsTruth.precision * 100, '%')} / ${fmt(r.scoreVsTruth.recall * 100, '%')}`
      : '—';
    // U30 — two columns, deliberately: `stem` is "a stem was named", `main flow`
    // is "clicking it plays something". They disagreed on four repos for rounds.
    const flow =
      r.stemPlays === true
        ? `✅ ${fmt(r.stemHops)} hop${r.stemHops === 1 ? '' : 's'}`
        : r.stemPlays === false
          ? '❌ dead end'
          : '—';
    L.push(
      `| ${r.id} | ✅ | ${fmt(r.elapsedMs)}ms | ${fmt(r.rssMb)}MB | ${r.counts.services} | ${r.counts.modules} | ` +
        `${r.counts.files} | ${r.counts.edges} | ${fmt(r.evidencePct, '%')} | ${fmt(r.evidenceResolvedPct, '%')} | ` +
        `${fmt(r.fallbackTitlePct, '%')} | ` +
        `${r.dupTitleCount} | ${r.stemFound ? '✅' : '—'} | ${flow} | ${pr} |`
    );
  }
  L.push('');

  // U30 — the dead ends, named. A row in this list is not automatically a bug
  // (sqlfluff's calls land in frameworks the scan does not read), which is
  // exactly why it is a NAMED LIST with the engine's own sentence rather than a
  // silent ✅ or a fabricated failure.
  const deadEnds = ok.filter((r) => r.stemPlays === false);
  if (deadEnds.length > 0) {
    L.push('## "Show main flow" dead ends');
    L.push('');
    L.push('A stem was found but no grounded call path plays from it. Read the sentence: it is');
    L.push('what the user is shown, and on some repos it is the honest answer, not a defect.');
    L.push('');
    for (const r of deadEnds) {
      L.push(`- **${r.id}** — ${r.stemFlow?.stemFile ?? '(no stem)'}: ${r.stemFlow?.message ?? '(no message)'}`);
    }
    L.push('');
  }

  if (failed.length > 0) {
    L.push('## Failures (verbatim)');
    L.push('');
    for (const r of failed) {
      L.push(`### ${r.id}`);
      L.push('');
      L.push(`Pinned \`${r.sha}\`. Repro: \`node tools/qa-loop/run.mjs --repos ${r.id}\``);
      if (r.negativeCase) L.push(`\n**Negative case — a failure here may be the CORRECT answer.** ${r.why}`);
      L.push('');
      L.push('```');
      L.push(r.error?.message ?? '(no message)');
      if (r.error?.stack) L.push(r.error.stack);
      L.push('```');
      L.push('');
    }
  }

  const withWarnings = ok.filter((r) => r.warnings && r.warnings.length > 0);
  L.push('## Scanner warnings (verbatim)');
  L.push('');
  if (withWarnings.length === 0) {
    L.push('None.');
  } else {
    for (const r of withWarnings) {
      L.push(`- **${r.id}** (${r.warnings.length})`);
      for (const w of r.warnings) L.push(`  - ${w}`);
    }
  }
  L.push('');

  const negatives = rows.filter((r) => r.negativeCase);
  if (negatives.length > 0) {
    L.push('## Negative cases');
    L.push('');
    L.push('These rows exist to catch a confident-looking answer where the engine has no parser.');
    L.push('Read the outcome, do not read a pass/fail: the point is that the result is honest.');
    L.push('');
    for (const r of negatives) {
      const outcome = r.ok
        ? `scanned: ${r.counts.services} service(s), ${r.counts.files} file(s), ${r.counts.edges} edge(s)`
        : `did not scan: ${r.error?.message ?? '(no message)'}`;
      L.push(`- **${r.id}** — ${outcome}`);
      L.push(`  - why it is here: ${r.why}`);
    }
    L.push('');
  }

  L.push('## AI-judge tier');
  L.push('');
  const reasons = [...new Set(judgeRows.map((j) => j.reason))];
  L.push(`${judgeRows.length} repo(s), all **skipped**. No model was called and no judged score exists.`);
  for (const reason of reasons) L.push(`- ${reason}`);
  L.push('');
  L.push('---');
  L.push('');
  L.push('_Machine-readable rows: `results.jsonl` next to this file. Reproduce one repo with_');
  L.push('_`node tools/qa-loop/run.mjs --repos <id>`._');
  L.push('');
  return L.join('\n');
}
