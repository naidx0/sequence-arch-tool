#!/usr/bin/env node
/* pnpm bench:scan — what a user waits for, and what the engine keeps afterwards, measured on a PINNED commit.

   For the pinned export of this repo (archive of main, sha printed) and, unless --no-big, the generated
   20k-file repo (the find_files makeBigRepo generator; optional, acceptance uses the pinned monorepo):
     cli cold     `cli.js scan <repo> --no-cache` wall time
     attach cold  cli.js app --repo <repo>: spawn to /api/status {attached:true} (what the window waits for)
     rescan 1     edit one source file, POST /api/scan (JSON), wall time to the response
     rss          the engine's RSS sampled every 250 ms; settled = CPU < 2 % for 5 s; peak over the run
   Each measure repeats --reps (default 3); median and min..max are printed. Every rep runs in a fresh HOME and
   user dir, with a scrubbed env (see cleanEnv). The RSS medians use only runs that settled (n settled / n total
   is printed; none settled prints UNSETTLED). Raw output: tools/measure/out/scan-bench-<sha12>-<ISO time>.json,
   one file per run, never overwritten (the dir is gitignored). Wall-clock numbers, not a CI gate; they move with
   machine load, so loadavg is recorded.
   Flags: --reps N  --sha <ref>  --no-big  --big-files N  --big-reps N  --keep */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isolatedEnv } from './lib/isolatedEnv.mjs';
import {
  CLI, OUT_DIR, arg, flag, sleep, summarize, settledSummary, detectSettle, mb, sec, machineNotes, pinnedSha, exportPinned,
  makeBigRepo, makeWork, freshHome, runFile, cleanEnv, rmQuiet, spawnEngine, waitStatus, startRssSampler,
} from './lib/scanBenchLib.mjs';

const REPS = Number(arg('--reps', 3));
const BIG_REPS = Number(arg('--big-reps', REPS));
const log = (...a) => console.log(...a);

function cliScan(repo, home, userDir) {
  return new Promise((resolve, reject) => {
    const out = path.join(home, 'cli-out.json');
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, 'scan', repo, '--no-cache', '--out', out], {
      env: cleanEnv(isolatedEnv(process.env, { userDir }), home), stdio: 'ignore',
    });
    child.on('exit', (code) => (code === 0 ? resolve(Date.now() - t0) : reject(new Error(`cli scan exit ${code}`))));
  });
}

async function settleFrom(sampler, fromT, { timeoutMs = 120_000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = detectSettle(sampler.samples.filter((x) => x.t >= fromT));
    if (s.settled) return s;
    await sleep(500);
  }
  return detectSettle(sampler.samples.filter((x) => x.t >= fromT));
}

async function engineRep(repo, touchRel, home, userDir) {
  const { child, base, spawnedAt } = await spawnEngine({ repo, work: home, userDir });
  const sampler = startRssSampler(child.pid, 250);
  const t0 = Date.now();
  try {
    const listenAt = await waitStatus(base, () => true, { everyMs: 50 });
    const readyAt = await waitStatus(base, (b) => b.attached === true, { everyMs: 100 });
    const settle1 = await settleFrom(sampler, readyAt - t0);
    // One-file rescan: edit one source file, then the same POST /api/scan a user's Rescan runs.
    fs.appendFileSync(path.join(repo, touchRel), `\n// bench touch ${Date.now()}\n`);
    const rs0 = Date.now();
    const r = await fetch(`${base}/api/scan`, { method: 'POST' });
    await r.arrayBuffer();
    const rescanMs = Date.now() - rs0;
    if (!r.ok) throw new Error(`POST /api/scan ${r.status}`);
    const settle2 = await settleFrom(sampler, Date.now() - t0);
    const all = sampler.stop();
    return {
      listenMs: listenAt - spawnedAt, attachMs: readyAt - spawnedAt, rescanMs,
      settledRssKb: settle1.rssKb, settled: settle1.settled,
      afterRescanRssKb: settle2.rssKb, settledAfterRescan: settle2.settled,
      peakRssKb: all.reduce((m, s) => Math.max(m, s.rss), 0),
    };
  } finally {
    sampler.stop();
    child.kill();
    await sleep(300);
  }
}

async function measureRepo(label, repoStart, touchRel, reps, work) {
  log(`\n== ${label}  (${reps}x)`);
  const cli = [];
  const eng = [];
  let repo = repoStart;
  for (let i = 0; i < reps; i++) {
    // Fresh HOME and user dir for each of the two processes of a rep: the repo is moved in, caches stay behind.
    let fh = freshHome(work, repo, `${i + 1}c`);
    repo = fh.repo;
    const c = await cliScan(repo, fh.home, fh.userDir);
    cli.push(c);
    log(`  rep ${i + 1} cli cold ${sec(c)} s`);
    fh = freshHome(work, repo, `${i + 1}e`);
    repo = fh.repo;
    const e = await engineRep(repo, touchRel, fh.home, fh.userDir);
    eng.push(e);
    log(`  rep ${i + 1} attach ${sec(e.attachMs)} s (listening ${sec(e.listenMs)} s), rescan ${sec(e.rescanMs)} s, rss settled ${mb(e.settledRssKb)} MB${e.settled ? '' : ' (UNSETTLED)'}, after rescan ${mb(e.afterRescanRssKb)} MB${e.settledAfterRescan ? '' : ' (UNSETTLED)'}, peak ${mb(e.peakRssKb)} MB`);
  }
  const col = (k) => eng.map((e) => e[k]);
  return {
    repo: label, reps,
    cliColdMs: { runs: cli, ...summarize(cli) },
    attachColdMs: { runs: col('attachMs'), ...summarize(col('attachMs')) },
    listenMs: { runs: col('listenMs'), ...summarize(col('listenMs')) },
    oneFileRescanMs: { runs: col('rescanMs'), ...summarize(col('rescanMs')) },
    // Per-run flags are kept in `engineRuns`; the RSS summaries below use only the runs that settled.
    settledRssKb: { runs: col('settledRssKb'), ...settledSummary(eng.map((e) => ({ settled: e.settled, value: e.settledRssKb }))) },
    afterRescanRssKb: { runs: col('afterRescanRssKb'), ...settledSummary(eng.map((e) => ({ settled: e.settledAfterRescan, value: e.afterRescanRssKb }))) },
    peakRssKb: { runs: col('peakRssKb'), ...summarize(col('peakRssKb')) },
    engineRuns: eng,
  };
}

function row(name, s, f) {
  const r = (x) => (x == null ? '-' : String(f(x)));
  return `| ${name} | ${r(s.median)} | ${r(s.min)} .. ${r(s.max)} |`;
}
function rssRow(name, s) {
  if (s.nSettled === 0) return `| ${name} | UNSETTLED (0 of ${s.nTotal} runs settled) | |`;
  return `| ${name} | ${mb(s.median)} | ${mb(s.min)} .. ${mb(s.max)} (${s.nSettled} of ${s.nTotal} settled) |`;
}

function printTable(m) {
  log(`\n### ${m.repo} (${m.reps} reps; median, min..max)`);
  log('| Measure | Median | Spread |\n|---|---|---|');
  log(row('Cold scan, CLI --no-cache (s)', m.cliColdMs, sec));
  log(row('Cold attach, app --repo to ready (s)', m.attachColdMs, sec));
  log(row('One-file rescan, POST /api/scan (s)', m.oneFileRescanMs, sec));
  log(rssRow('Idle RSS after attach settles (MB)', m.settledRssKb));
  log(rssRow('Idle RSS after rescan settles (MB)', m.afterRescanRssKb));
  log(row('Peak RSS over the run (MB)', m.peakRssKb, mb));
}

async function main() {
  const sha = pinnedSha();
  log(`bench:scan  pinned ${sha}`);
  const machine = machineNotes();
  const { work } = makeWork();
  const startedAt = new Date();
  const result = { sha, startedAt: startedAt.toISOString(), machine, repos: [] };
  try {
    const pinnedDir = path.join(work, 'pinned');
    exportPinned(sha, pinnedDir);
    result.repos.push(await measureRepo(`pinned ${sha.slice(0, 8)}`, pinnedDir, 'packages/analyzer/src/scan.ts', REPS, work));
    if (!flag('--no-big')) {
      const files = Number(arg('--big-files', 20_000));
      log(`\ngenerating the ${files}-file repo ...`);
      const g0 = Date.now();
      const big = makeBigRepo(work, files);
      log(`  generated in ${sec(Date.now() - g0)} s`);
      const first = fs.readdirSync(path.join(big, 'packages/p0/src/m0')).find((n) => n.endsWith('.ts'));
      result.repos.push(await measureRepo(`generated ${files}-file`, big, `packages/p0/src/m0/${first}`, BIG_REPS, work));
    }
  } finally {
    if (!flag('--keep')) rmQuiet(work);
  }
  result.machine.loadavgEnd = os.loadavg().map((x) => Math.round(x * 100) / 100);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = runFile('scan-bench', sha, startedAt);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  log(`\nmachine: ${machine.cpus} CPUs, loadavg at start ${machine.loadavgStart.join(' ')}, at end ${result.machine.loadavgEnd.join(' ')}`);
  for (const m of result.repos) printTable(m);
  log(`\nwrote ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
