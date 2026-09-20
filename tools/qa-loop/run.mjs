#!/usr/bin/env node
/**
 * Sequence multi-repo QA loop — DETERMINISTIC (key-free) TIER.
 *
 * Fixture scale proves logic; only a REAL repo proves the result (CLAUDE.md).
 * Today the only real repo any check runs on is this monorepo itself, and the
 * four hand-verified edge truths in `docs/ground-truth/` are consumed by
 * nothing. This harness closes both gaps: it clones a pinned-SHA set of real
 * open-source repositories and drives the SHIPPED engine over each one —
 * `scanRepo`, `validateGraph`, `scoreGraph`, `buildStructuralTree`,
 * `buildRepoFunctionGraph`, `detectStemCandidates` — reading it, never
 * reimplementing it.
 *
 * It needs no API key and calls no model. The AI-judge tier is a documented
 * seam (`lib/judge.mjs`) that skips loudly; it does not exist yet and does not
 * pretend to.
 *
 *   node tools/qa-loop/run.mjs --tier smoke
 *   node tools/qa-loop/run.mjs --repos robot-shop,express
 *   node tools/qa-loop/run.mjs --local /path/to/a/repo --local /path/to/another
 *   pnpm qa:smoke   ·   pnpm qa:full
 *
 * Flags
 *   --tier smoke|full     which slice of the manifest (default: smoke)
 *   --repos a,b,c         explicit ids; overrides --tier
 *   --local <path>        run the same metrics over a repo already on disk
 *                         (repeatable). Skips cloning entirely, so it works
 *                         with no network.
 *   --no-ai               force the judge tier to skip even if a key is present
 *   --stamp <s>           run directory name (default: ISO-ish timestamp)
 *   --cache <dir>         clone cache root (default: $SEQUENCE_QA_CACHE, else tmp)
 *   --timeout-ms <n>      hard per-repo cap; the child is killed (default 900000)
 *   --concurrency <n>     repos measured at once (default 1 — sequential)
 *   --max-files <n>       scanRepo file cap (default: the engine's own 20000)
 *   --update-baseline     write this run's numbers to baseline.json
 *   --no-function-graph   skip the function graph (and therefore stem detection)
 *
 * EACH REPO RUNS IN ITS OWN CHILD PROCESS (`lib/runner.mjs`). Tree-sitter parses
 * into a WASM heap that is grown and never returned, and a single process
 * measuring the whole corpus degraded so badly with position that the full tier
 * could not finish at all. A fresh process per repo also makes `--timeout-ms` a
 * real kill rather than an abandoned promise.
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadManifest, selectRepos, cloneUrl, QA_ROOT, REPO_ROOT } from './lib/manifest.mjs';
import { cacheRoot, ensureRepo, git } from './lib/clone.mjs';
import { runAllRepos } from './lib/runner.mjs';
import { DIST } from './lib/measure.mjs';
import { runAiJudgeTier } from './lib/judge.mjs';
import { buildSummary, diffBaseline, hardFindings, toBaseline } from './lib/report.mjs';

const RUNS_DIR = path.join(QA_ROOT, 'runs');
const BASELINE_FILE = path.join(QA_ROOT, 'baseline.json');

const USAGE = `Sequence multi-repo QA loop — deterministic (key-free) tier.

  node tools/qa-loop/run.mjs [flags]

  --tier smoke|full     which slice of the manifest (default: smoke)
  --repos a,b,c         explicit manifest ids; overrides --tier
  --local <path>        measure a repo already on disk (repeatable, no network)
  --no-ai               force the judge tier to skip even if a key is present
  --stamp <s>           run directory name (default: ISO timestamp)
  --cache <dir>         clone cache root (default: $SEQUENCE_QA_CACHE, else tmp)
  --timeout-ms <n>      hard per-repo cap; the child is killed (default 900000)
  --concurrency <n>     repos measured at once (default 1 — sequential)
  --max-files <n>       scanRepo file cap (default: the engine's own 20000)
  --update-baseline     write this run's numbers to baseline.json (whole tiers only)
  --no-function-graph   skip the function graph, and therefore stem detection

Exit code is 1 when any non-negative-case repo failed or any baseline
regression was detected, 0 otherwise.`;

// ---------------------------------------------------------------------------
// Preflight. The engine itself is loaded inside each child (`lib/measure.mjs`);
// this parent only checks that it EXISTS, so a missing build fails in one clear
// line here instead of 27 identical child failures.
// ---------------------------------------------------------------------------

function assertEngineBuilt() {
  const missing = Object.entries(DIST)
    .filter(([, p]) => !fs.existsSync(p))
    .map(([k, p]) => `${k}: ${path.relative(REPO_ROOT, p)}`);
  if (missing.length > 0) {
    throw new Error(
      `the engine is not built — run \`pnpm -r build\` first.\nMissing:\n  - ${missing.join('\n  - ')}`
    );
  }
}

// ---------------------------------------------------------------------------
// Small utilities.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    tier: 'smoke',
    repos: [],
    local: [],
    noAi: false,
    stamp: null,
    cache: null,
    timeoutMs: 900_000,
    concurrency: 1,
    maxFiles: null,
    updateBaseline: false,
    functionGraph: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--tier': args.tier = next(); break;
      case '--repos': args.repos = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--local': args.local.push(next()); break;
      case '--no-ai': args.noAi = true; break;
      case '--stamp': args.stamp = next(); break;
      case '--cache': args.cache = next(); break;
      case '--timeout-ms': args.timeoutMs = Number(next()); break;
      case '--concurrency': args.concurrency = Number(next()); break;
      case '--max-files': args.maxFiles = Number(next()); break;
      case '--update-baseline': args.updateBaseline = true; break;
      case '--no-function-graph': args.functionGraph = false; break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`unknown flag ${a} (try --help)`);
    }
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) throw new Error('--timeout-ms must be a positive number');
  if (!Number.isInteger(args.concurrency) || args.concurrency <= 0) {
    throw new Error('--concurrency must be a positive integer');
  }
  if (args.maxFiles !== null && (!Number.isFinite(args.maxFiles) || args.maxFiles <= 0)) {
    throw new Error('--max-files must be a positive number');
  }
  return args;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  assertEngineBuilt();
  const stamp = args.stamp ?? stampNow();
  const runDir = path.join(RUNS_DIR, stamp);
  fs.mkdirSync(runDir, { recursive: true });
  const root = cacheRoot(args.cache);

  /** @type {{row: any, dir: string | null, cloneError: string | null}[]} */
  const targets = [];

  if (args.local.length > 0) {
    for (const p of args.local) {
      const abs = path.resolve(p);
      if (!fs.existsSync(abs)) {
        targets.push({ row: { id: path.basename(abs), sha: `local:${abs}` }, dir: null, cloneError: `--local path does not exist: ${abs}` });
        continue;
      }
      targets.push({ row: { id: path.basename(abs), sha: `local:${abs}` }, dir: abs, cloneError: null });
    }
  } else {
    const manifest = loadManifest();
    const rows = selectRepos(manifest, { tier: args.repos.length > 0 ? undefined : args.tier, repos: args.repos });
    if (rows.length === 0) throw new Error(`no repos selected (tier=${args.tier}, repos=${args.repos.join(',') || 'all'})`);
    console.log(`[qa-loop] ${rows.length} repo(s); cache ${root}`);
    for (const row of rows) {
      process.stdout.write(`[qa-loop] fetching ${row.id} @ ${row.sha.slice(0, 12)} … `);
      const res = await ensureRepo(row, cloneUrl(row), root);
      if (!res.ok) {
        console.log('FAILED');
        targets.push({ row, dir: null, cloneError: res.reason });
      } else {
        console.log(res.cached ? 'cached' : 'ok');
        targets.push({ row, dir: res.dir, cloneError: null });
      }
    }
  }

  const opts = {
    maxFiles: args.maxFiles,
    functionGraph: args.functionGraph,
    graphsDir: path.join(runDir, 'graphs'),
  };

  // A clone that never landed is still a row, with the same shape as every
  // other red row — this literal is the historical shape and stays byte-exact.
  const cloneErrorRow = (t) => ({
    id: t.row.id,
    sha: t.row.sha,
    dir: null,
    negativeCase: t.row.negativeCase === true,
    why: t.row.why ?? null,
    ok: false,
    elapsedMs: 0,
    rssMb: null,
    counts: null,
    evidencePct: null,
    evidenceResolvedPct: null,
    fallbackTitlePct: null,
    dupTitleCount: null,
    stemFound: null,
    stemPlays: null,
    stemHops: null,
    scoreVsTruth: null,
    warnings: [],
    error: { name: 'CloneError', message: t.cloneError, stack: null },
  });

  const parallel = args.concurrency > 1;
  if (parallel) {
    console.log(`[qa-loop] measuring ${args.concurrency} repos at a time — per-repo wall clock is NOT comparable to a sequential run.`);
  }

  const rows = await runAllRepos(targets, {
    opts,
    timeoutMs: args.timeoutMs,
    concurrency: args.concurrency,
    ioDir: path.join(runDir, 'children'),
    cloneErrorRow,
    onStart: (row) => {
      // Sequential runs keep the historical one-line-per-repo progress shape;
      // in parallel that line cannot be completed in place, so it is split.
      if (parallel) console.log(`[qa-loop] scanning ${row.id} …`);
      else process.stdout.write(`[qa-loop] scanning ${row.id} … `);
    },
    onDone: (r) => {
      const prefix = parallel ? `[qa-loop] ${r.id}: ` : '';
      if (r.error?.name === 'CloneError') {
        console.log(`[qa-loop] ${r.id}: ❌ ${r.error.message.split('\n')[0]}`);
        return;
      }
      console.log(
        prefix +
          (r.ok
            ? `ok ${r.elapsedMs}ms · ${r.counts.services} svc · ${r.counts.files} files · ${r.counts.edges} edges · evidence ${r.evidencePct ?? '—'}%`
            : `❌ ${r.error.message.split('\n')[0]}`)
      );
    },
  });

  const judgeRows = runAiJudgeTier(rows, { noAi: args.noAi });

  const hasBaseline = fs.existsSync(BASELINE_FILE);
  const baseline = hasBaseline ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : null;
  const diff = diffBaseline(rows, baseline);

  const sequenceSha = (await git(['rev-parse', 'HEAD'], REPO_ROOT, 30_000)).stdout.trim() || undefined;
  const summary = buildSummary(rows, judgeRows, diff, {
    stamp,
    tier: args.local.length > 0 ? `local(${args.local.length})` : args.repos.length > 0 ? `repos(${args.repos.length})` : args.tier,
    cacheRoot: root,
    baselineFile: path.relative(REPO_ROOT, BASELINE_FILE),
    hasBaseline,
    sequenceSha,
  });

  fs.writeFileSync(path.join(runDir, 'results.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(runDir, 'judge.jsonl'), judgeRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(runDir, 'summary.md'), summary);

  if (args.updateBaseline) {
    if (args.local.length > 0 || args.repos.length > 0) {
      console.log('[qa-loop] refusing --update-baseline on a partial run — a baseline must be a whole tier.');
    } else {
      fs.writeFileSync(
        BASELINE_FILE,
        JSON.stringify(toBaseline(rows, { tier: args.tier, stamp, sequenceSha }), null, 2) + '\n'
      );
      console.log(`[qa-loop] baseline updated: ${path.relative(REPO_ROOT, BASELINE_FILE)}`);
    }
  }

  console.log(`\n[qa-loop] wrote ${path.relative(REPO_ROOT, runDir)}/summary.md`);
  const failed = rows.filter((r) => !r.ok && !r.negativeCase);
  const hard = hardFindings(rows);
  let bad = false;
  if (hard.length > 0) {
    console.log(`[qa-loop] ${hard.length} HARD FINDING(S):`);
    for (const h of hard) console.log(`  - ${h}`);
    bad = true;
  }
  if (diff.staleMetrics?.length > 0) {
    // U30 — a metric that is NOT being judged must be said out loud, or the
    // green line below means something narrower than it appears to.
    console.log(`[qa-loop] ${diff.staleMetrics.length} metric(s) NOT judged against this baseline:`);
    for (const s of diff.staleMetrics) console.log(`  - ${s}`);
  }
  if (diff.regressions.length > 0) {
    console.log(`[qa-loop] ${diff.regressions.length} REGRESSION(S) vs baseline:`);
    for (const d of diff.regressions) console.log(`  - ${d}`);
    bad = true;
  }
  if (failed.length > 0) {
    console.log(`[qa-loop] ${failed.length} repo(s) failed: ${failed.map((r) => r.id).join(', ')}`);
    bad = true;
  }
  if (!bad) console.log('[qa-loop] no failures, no regressions, no hard findings.');
  return bad ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[qa-loop] ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
);
