#!/usr/bin/env node
/* pnpm bench:status — does the app keep answering while a scan runs?

   For each scan path, a separate process polls GET /api/status every 20 ms (open loop, fresh connection per
   request) while a CPU-heavy scan runs. Handoff acceptance: p95 < 50 ms.
     i    runtime attach        POST /api/attach {path}        (engine started with no repo)
     ii   rescan, JSON          POST /api/scan
     iii  rescan, SSE           POST /api/scan  Accept: text/event-stream
     iv   HEAD change           checkout of another branch; HeadTracker rescans; done at graph:updated

   WHAT A PASS HAS TO SURVIVE (a stall must never read as a pass):
   - latency percentiles use only HTTP 200 answers; an error, a non-200 or an unanswered request is counted in
     `failed` and FAILs the path (it is not a service time, so it cannot pull p95 down);
   - a tick the sampler could not send because 256 requests were already waiting (a stall of 256 x 20 ms =
     5.1 s or more) is a `skipped` tick in that window and FAILs the path;
   - the window ends when the ENGINE says the scan is done (the trigger's reply, then the graph's scannedAt
     actually changed on /archgraph.json), not at the first HTTP reply: a reply that comes early must not
     shorten the window. A window whose graph has no nodes, whose scannedAt did not change, or that lasted
     under --min-scan ms (default 2000) is INCONCLUSIVE, not PASS.
   Exit 0 with a PASS / FAIL / INCONCLUSIVE verdict per path; --assert exits 1 unless every path is PASS.
   Raw output: tools/measure/out/status-bench-<sha12>-<ISO time>-<paths>.json, one file per run, never
   overwritten. Acceptance uses the pinned monorepo (default); --repo big (generated 20k files) is optional.
   Flags: --repo pinned|big  --files N (big)  --sha <ref>  --paths i,ii,iii,iv  --p95 <ms>  --interval <ms>
          --min-scan <ms>  --assert  --keep */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  OUT_DIR, arg, flag, sleep, detectSettle, sec, machineNotes, pinnedSha, exportPinned, gitInitCommit, gitOut,
  makeBigRepo, makeWork, freshHome, runFile, measureWindow as runMeasured, settleWithin, waitQuiet, cleanEnv, rmQuiet, spawnEngine, waitStatus, startRssSampler,
  killTree, trackTree,
} from './lib/scanBenchLib.mjs';

const SAMPLER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'statusSampler.mjs');
const P95_MAX = Number(arg('--p95', 50));
const INTERVAL = Number(arg('--interval', 20));
const MIN_SCAN = Number(arg('--min-scan', 2000));
const PATHS = arg('--paths', 'i,ii,iii,iv').split(',');
const log = (...a) => console.log(...a);

function startSampler(base) {
  const detached = process.platform !== 'win32'; // POSIX: the sampler leads its own group, so killTree takes the whole tree
  const child = fork(SAMPLER, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: cleanEnv(process.env, os.tmpdir()), detached });
  const untrack = trackTree(child.pid, { detached });
  const ready = new Promise((r) => child.once('message', r));
  return ready.then(() => {
    child.send({ cmd: 'start', url: `${base}/api/status`, intervalMs: INTERVAL });
    return {
      stop: () => new Promise((resolve) => {
        child.once('message', (m) => { untrack(); resolve(m); });
        child.send({ cmd: 'stop' });
      }),
      kill: () => { untrack(); killTree(child.pid, { detached }); },
    };
  });
}

const measureWindow = (label, base, requireBefore, trigger, repeatUntilMinScan = false) => runMeasured({
  label, base, startSampler: () => startSampler(base), trigger, requireBefore, minScanMs: MIN_SCAN, p95Max: P95_MAX, repeatUntilMinScan,
});

async function readSseUntil(url, init, pred) {
  const r = await fetch(url, init);
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.startsWith('data:') && pred(line.slice(5).trim())) return;
  }
}

async function main() {
  const sha = pinnedSha();
  const which = arg('--repo', 'pinned');
  const startedAt = new Date();
  log(`bench:status  pinned ${sha}  repo=${which}  paths=${PATHS.join(',')}  p95 limit ${P95_MAX} ms  min scan ${MIN_SCAN} ms`);
  const { work } = makeWork('seq-statusbench-');
  const machine = machineNotes();
  const rows = [];
  const settleTimeouts = [];
  try {
    let repo;
    if (which === 'big') {
      log('generating the big repo ...');
      repo = makeBigRepo(work, Number(arg('--files', 20_000)));
    } else {
      repo = path.join(work, 'pinned');
      exportPinned(sha, repo);
      gitInitCommit(repo);
    }
    // A second branch that differs by one tracked file, for the HEAD-change path.
    const bumpRel = which === 'big' ? fs.readdirSync(path.join(repo, 'packages/p0/src/m0')).map((n) => `packages/p0/src/m0/${n}`)[0] : 'packages/analyzer/src/scan.ts';
    gitOut(repo, 'checkout', '-q', '-b', 'other');
    fs.appendFileSync(path.join(repo, bumpRel), '\n// other branch\n');
    gitOut(repo, 'commit', '-q', '-am', 'other branch change');
    gitOut(repo, 'checkout', '-q', 'main');

    if (PATHS.includes('i')) {
      const fh = freshHome(work, repo, 'i');
      repo = fh.repo;
      const { child, base } = await spawnEngine({ repo: null, work: fh.home, userDir: fh.userDir });
      try {
        await waitStatus(base, () => true, { everyMs: 50 });
        log('path i: runtime attach ...');
        rows.push(await measureWindow('i   attach (POST /api/attach)', base, false, async () => {
          const r = await fetch(`${base}/api/attach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
          const body = await r.text();
          if (!r.ok) throw new Error(`attach ${r.status} ${body.slice(0, 200)}`);
        }));
      } finally { child.kill(); await sleep(300); }
    }

    if (PATHS.some((p) => ['ii', 'iii', 'iv'].includes(p))) {
      const fh = freshHome(work, repo, 'rest');
      repo = fh.repo;
      const { child, base } = await spawnEngine({ repo, work: fh.home, userDir: fh.userDir });
      const rss = startRssSampler(child.pid, 250);
      const quiet = (name) => waitQuiet(name, () => settleWithin(rss), settleTimeouts, log);
      try {
        await waitStatus(base, (b) => b.attached === true, { everyMs: 100 });
        await quiet('path ii');
        if (PATHS.includes('ii')) {
          log('path ii: POST /api/scan (JSON) ...');
          rows.push(await measureWindow('ii  POST /api/scan JSON', base, true, async () => {
            fs.appendFileSync(path.join(repo, 'packages/analyzer/src/ignoreDirs.ts'), `
// status bench touch ${Date.now()}
`);
            const r = await fetch(`${base}/api/scan`, { method: 'POST' });
            await r.arrayBuffer();
            if (!r.ok) throw new Error(`scan ${r.status}`);
          }, true));
          await quiet('path iii');
        }
        if (PATHS.includes('iii')) {
          log('path iii: POST /api/scan (SSE) ...');
          rows.push(await measureWindow('iii POST /api/scan SSE', base, true, async () => {
            fs.appendFileSync(path.join(repo, 'packages/analyzer/src/ignoreDirs.ts'), `
// status bench touch ${Date.now()}
`);
            let result = false;
            await readSseUntil(`${base}/api/scan`, { method: 'POST', headers: { accept: 'text/event-stream' } }, (d) => {
              if (d.includes('"scan:error"')) throw new Error(d.slice(0, 200));
              if (d.includes('"scan:result"')) result = true;
              return false;
            });
            if (!result) throw new Error('SSE ended without scan:result');
          }, true));
          await quiet('path iv');
        }
        if (PATHS.includes('iv')) {
          log('path iv: HEAD change (checkout other branch) ...');
          const events = new AbortController();
          let updated = () => {};
          readSseUntil(`${base}/api/git/events`, { signal: events.signal }, (d) => {
            if (d.includes('"graph:updated"')) updated(true);
            return false;
          }).catch(() => {});
          await sleep(500);
          // Each trigger is one HEAD change; the window repeats them (other <-> main) until it is long enough to prove something.
          let onOther = false;
          rows.push(await measureWindow('iv  HEAD change (checkout)', base, true, async () => {
            const gotUpdate = new Promise((r) => { updated = r; });
            gitOut(repo, 'checkout', '-q', onOther ? 'main' : 'other');
            onOther = !onOther;
            const hit = await Promise.race([gotUpdate, sleep(300_000).then(() => false)]);
            if (!hit) throw new Error('no graph:updated within 300 s of the checkout (HeadTracker did not rescan)');
          }, true));
          events.abort();
        }
      } finally { rss.stop(); child.kill(); await sleep(300); }
    }
  } finally {
    if (!flag('--keep')) rmQuiet(work);
  }

  machine.loadavgEnd = os.loadavg().map((x) => Math.round(x * 100) / 100);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = runFile('status-bench', sha, startedAt, PATHS.join(''));
  fs.writeFileSync(file, JSON.stringify({ sha, repo: which, p95LimitMs: P95_MAX, intervalMs: INTERVAL, minScanMs: MIN_SCAN, startedAt: startedAt.toISOString(), machine, settleTimeouts, rows }, null, 2));

  const f1 = (x) => (x == null ? '-' : x < 10 ? x.toFixed(1) : String(Math.round(x)));
  log(`\nmachine: ${machine.cpus} CPUs, loadavg at start ${machine.loadavgStart.join(' ')}, at end ${machine.loadavgEnd.join(' ')}`);
  if (settleTimeouts.length) log(`engine did not settle before: ${settleTimeouts.join(', ')}`);
  log(`\n| Path | scan (s) | ok samples | p50 (ms) | p95 (ms) | max (ms) | longest stall (ms) | failed | skipped ticks | idle p95 (ms) | verdict (p95 < ${P95_MAX} ms) |\n|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) log(`| ${r.path} | ${sec(r.scanMs)} | ${r.n} | ${f1(r.p50)} | ${f1(r.p95)} | ${f1(r.max)} | ${f1(r.longestStallMs)} | ${r.failed} | ${r.skipped} | ${f1(r.idleP95)} | ${r.verdict} |`);
  for (const r of rows) if (r.reasons.length) log(`  ${r.path.trim()}: ${r.reasons.join('; ')}`);
  for (const r of rows) for (const w of r.warnings) log(`  WARNING ${r.path.trim()}: ${w}`);
  const bad = rows.filter((r) => r.verdict !== 'PASS');
  log(bad.length ? `\n${bad.length} of ${rows.length} paths not PASS${flag('--assert') ? ' (--assert: exit 1)' : ' (reported; pass --assert to fail the run)'}` : '\nall paths PASS');
  log(`wrote ${path.relative(process.cwd(), file)}`);
  if (flag('--assert') && (bad.length || rows.length === 0)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
