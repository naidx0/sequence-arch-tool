#!/usr/bin/env node
/**
 * THE NIGHT'S CARD WINDOW, in one command.
 *
 *   node tools/bench/night-window.mjs
 *   node tools/bench/night-window.mjs --preflight   # checks only, takes nothing
 *
 * Three stages in order, each taking and releasing the card itself so the lock
 * log carries a take line and a release line per stage:
 *
 *   1. the seat's one-lesson run      ~6 min   the ask twice with a reload,
 *                                              then the same read replayed on
 *                                              the tree at 43da3119^
 *   2. the next-picture bands        ~16 min   two runs with
 *                                              SEQUENCE_TEACH_CHECKIN_FORM=next-picture
 *   3. the walk condition            ~50-70 min two runs, bands registered in
 *                                              docs/research/walk-condition-prediction.md
 *
 * ── EVERY PREREQUISITE IS CHECKED BEFORE THE CARD IS TAKEN ────────────────
 *
 * This is the rule the night taught, three times over. A window that takes the
 * card and then discovers the app is down, or the build is stale, or an arm file
 * already exists, has spent somebody else's minutes finding out something it
 * could have known for free. `--preflight` runs exactly those checks and stops.
 *
 * ── PER-STAGE LOCKING, AND WHAT IT COSTS ──────────────────────────────────
 *
 * Each stage runs under its own `gpu-lock run`, which is what produces a take
 * and a release line for each. The cost is real and is stated rather than hidden:
 * BETWEEN stages the card is free, so another lane can take it, and then the
 * next stage is refused with exit 3. That is not a crash — the window stops,
 * says which stages finished, and every finished stage keeps its output. Restart
 * it and the finished stages are skipped.
 *
 * The alternative, holding one lock across all three, would keep the card
 * against a lane that is waiting for it while this window does its card-free
 * halves. Per-stage was asked for and is also the more honest of the two.
 *
 * ── IDEMPOTENT PER STAGE ──────────────────────────────────────────────────
 *
 * A stage whose output is already on disk is skipped, not re-run. Twenty minutes
 * of card was nearly spent overwriting a good report once already.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'tools', 'bench', 'out');
const SEAT = path.join(ROOT, 'docs', 'journeys', 'seat');
const PREFLIGHT_ONLY = process.argv.includes('--preflight');
const PORT = Number(process.env.SEQUENCE_SEAT_PORT ?? 4173);
const log = (...a) => console.log('[night]', ...a);
const node = process.execPath;

/** This tree's HEAD, or null when it cannot be read — never guessed. */
const head = () => {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : null;
};

const ENV = {
  ...process.env,
  SEQUENCE_AI_MODEL: process.env.SEQUENCE_AI_MODEL ?? 'granite42-hermes',
  SEQUENCE_AI_BASE_URL: process.env.SEQUENCE_AI_BASE_URL ?? 'http://127.0.0.1:11434/v1',
  SEQUENCE_AI_API_KEY: process.env.SEQUENCE_AI_API_KEY ?? 'local',
  SEQUENCE_AI_PROVIDER: 'openai-compatible',
  TEACH_EVAL_REPO: 'sequence',
};

/* ── the three stages ─────────────────────────────────────────────────────
 *
 * `done` is checked BEFORE the card is taken. `needsApp` says whether a running
 * app on PORT is a prerequisite, which is checked the same way.
 */
const STAGES = [
  {
    name: 'seat',
    what: "the seat's one-lesson run, the ask twice with a reload",
    needsApp: true,
    /*
     * KEYED ON THE COMMIT THAT PRODUCED IT, not on the file existing.
     *
     * The first version checked only for seat.json, and the preflight promptly
     * said "already on disk — will skip" about a read taken against an older
     * tree. A seat read is a statement about ONE build; a file left over from a
     * previous one is not evidence about this one, and skipping on it would have
     * quietly dropped the stage the window exists to run. Same reasoning as the
     * lesson checkpoint: what matters is which build wrote it.
     */
    done: () => {
      const f = path.join(SEAT, 'seat.json');
      if (!fs.existsSync(f)) return false;
      try {
        /*
         * PREFIX, NOT EQUALITY, AND THE FIRST VERSION USED EQUALITY.
         *
         * `scripted-seat` writes `git rev-parse --short HEAD`; this read
         * `git rev-parse HEAD`. A short hash is never equal to a full one, so
         * `done()` was false forever and the stage could not be skipped — the
         * window re-ran a completed seat read, failed on its known DIFFs, and
         * stopped again before reaching a single bench stage. Two takes of the
         * card, both spent on the same six-minute read.
         *
         * Compared as a prefix so either form works, and guarded against the
         * empty string, which is a prefix of everything.
         */
        const stored = String(JSON.parse(fs.readFileSync(f, 'utf8')).commit ?? '');
        const now = head();
        return stored.length >= 7 && now !== null && now.startsWith(stored);
      } catch {
        return false; /* unreadable is not "done" */
      }
    },
    cmd: [node, path.join(ROOT, 'tools', 'ci', 'scripted-seat.mjs'), String(PORT)],
    /* Card-free, and run OUTSIDE the lock: the replay needs no model — the
       lesson is already on disk and the defect is in the load path. Holding the
       card through a rebuild of web2 would be paying for a compile. */
    after: [node, path.join(ROOT, 'tools', 'ci', 'seat-replay.mjs')],
  },
  {
    name: 'nextpic-1',
    what: 'the next-picture bands, run 1 of 2',
    done: () => fs.existsSync(path.join(OUT, 'nextpic-1.json')),
    cmd: [node, path.join(ROOT, 'tools', 'bench', 'teach-eval.mjs')],
    env: { SEQUENCE_TEACH_CHECKIN_FORM: 'next-picture' },
    collect: 'nextpic-1.json',
  },
  {
    name: 'nextpic-2',
    what: 'the next-picture bands, run 2 of 2',
    done: () => fs.existsSync(path.join(OUT, 'nextpic-2.json')),
    cmd: [node, path.join(ROOT, 'tools', 'bench', 'teach-eval.mjs')],
    env: { SEQUENCE_TEACH_CHECKIN_FORM: 'next-picture' },
    collect: 'nextpic-2.json',
  },
  {
    name: 'walk',
    what: "the walk condition, two runs",
    done: () =>
      fs.existsSync(path.join(OUT, 'walk-1.json')) && fs.existsSync(path.join(OUT, 'walk-2.json')),
    cmd: [node, path.join(ROOT, 'tools', 'bench', 'seq-condition-window.mjs'), 'walk'],
  },
];

/* ── preflight, all of it card-free ───────────────────────────────────────── */

/**
 * Is there an app on PORT, and is it CURRENT?
 *
 * UP IS NOT ENOUGH, and the first version only asked that. The preflight passed,
 * the window took the card, and `scripted-seat` refused one second later: the
 * app had started at 05:35 against code built at 06:41. Thirteen seconds of card
 * spent learning something `/api/build` would have said for free — which is
 * precisely the failure this preflight exists to prevent, committed by the
 * preflight itself.
 *
 * It asks the same endpoint the seat asks, and trusts the server's own `stale`
 * rather than recomputing it: two readers deciding staleness separately is one
 * rule in two places, and they would drift.
 *
 * Returns 'ok', 'down', or 'stale:<detail>'.
 */
function appState() {
  const r = spawnSync(
    node,
    [
      '-e',
      `fetch('http://127.0.0.1:${PORT}/api/build',{signal:AbortSignal.timeout(4000)})` +
        '.then(r=>r.json()).then(b=>{' +
        "console.log(b.stale===true?('stale:started '+b.startedAt+', built '+b.builtAt):'ok');" +
        '}).catch(()=>console.log("down"))',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return String(r.stdout ?? '').trim() || 'down';
}

const problems = [];
log(`preflight (nothing is taken yet)`);

/* The card, asked rather than assumed — `check` is the guard written after one
   granite call was made on another lane's lock. */
const check = spawnSync(node, [path.join(ROOT, 'tools', 'ci', 'gpu-lock.mjs'), 'check'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const cardFree = check.status === 0;
log(`  card: ${cardFree ? 'available' : 'HELD BY ANOTHER LANE'}`);
if (!cardFree) log(`        ${String(check.stderr ?? '').trim().split('\n').pop()}`);

const remaining = STAGES.filter((s) => !s.done());
for (const s of STAGES) log(`  stage ${s.name}: ${s.done() ? 'done for THIS build — will skip' : 'to run'}`);

const needApp = remaining.some((s) => s.needsApp);
if (needApp) {
  const state = appState();
  log(`  app on ${PORT}: ${state}`);
  /*
   * A PREREQUISITE, NOT A THING TO FIX HERE. Another session drives the app on
   * this port; restarting it from inside a card window would kill somebody
   * else's server to run a test. The remedy is named instead.
   */
  if (state === 'down') {
    problems.push(`the seat stage needs an app on ${PORT}, and none answered /api/build`);
  } else if (state.startsWith('stale')) {
    problems.push(
      `the app on ${PORT} is STALE (${state.slice(6)}). A seat read against it measures last ` +
        'week. Run `pnpm restart:app` first.',
    );
  }
}

/* The walk arm must actually be in the build, and that is measurable without a
   model — the window's own guard refuses otherwise, but finding out here costs
   nothing rather than costing a take. */
if (remaining.some((s) => s.name === 'walk')) {
  const q = spawnSync(
    node,
    [
      '-e',
      "(async()=>{const {pathToFileURL}=await import('node:url');" +
        "const {scanRepo}=await import(pathToFileURL(process.cwd()+'/packages/analyzer/dist/scan.js').href);" +
        "const {buildQueue}=await import(pathToFileURL(process.cwd()+'/packages/analyzer/dist/server/lessonState.js').href);" +
        "const g=await scanRepo(process.cwd()+'/packages/analyzer/test/fixtures/shopfront',{cluster:true});" +
        "console.log(buildQueue(g,'Teach me what orders.ts does here.').length);})()",
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const n = Number(String(q.stdout ?? '').trim());
  log(`  walk in the build: ${Number.isFinite(n) ? `${n} concepts` : 'COULD NOT MEASURE'}`);
  if (!(n > 1)) problems.push(`the walk is not in the build on disk (queue ${q.stdout?.trim() || '?'})`);
}

if (remaining.length === 0) {
  log('every stage is already on disk. Nothing to run.');
  process.exit(0);
}
if (problems.length > 0) {
  console.error('');
  for (const p of problems) console.error(`night-window: REFUSED — ${p}`);
  process.exit(2);
}
log(`preflight clean; ${remaining.length} stage(s) to run`);
if (PREFLIGHT_ONLY) {
  log('--preflight: stopping without taking the card.');
  process.exit(0);
}
if (!cardFree) {
  console.error('night-window: REFUSED — the card is held by another lane. Wait for its release.');
  process.exit(3);
}

/* ── run ──────────────────────────────────────────────────────────────────── */

const finished = [];
for (const stage of STAGES) {
  if (stage.done()) {
    log(`${stage.name}: already on disk — skipping`);
    continue;
  }
  log(`${stage.name}: taking the card — ${stage.what}`);
  const started = Date.now();
  const r = spawnSync(
    node,
    [path.join(ROOT, 'tools', 'ci', 'gpu-lock.mjs'), 'run', '--what', stage.what, '--', ...stage.cmd],
    { cwd: ROOT, env: { ...ENV, ...(stage.env ?? {}) }, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (r.status === 3) {
    console.error(
      `night-window: STOPPED at ${stage.name} — another lane took the card between stages. ` +
        `Finished: ${finished.join(', ') || 'none'}. Re-run to continue; finished stages are skipped.`,
    );
    process.exit(3);
  }
  if (r.status !== 0) {
    console.error(`night-window: ${stage.name} exited ${r.status}. Finished: ${finished.join(', ') || 'none'}.`);
    process.exit(1);
  }
  /* The report the bench always writes to one name, copied to this arm's name
     BEFORE the next arm overwrites it. */
  if (stage.collect !== undefined) {
    fs.copyFileSync(path.join(OUT, 'teach-eval-report.json'), path.join(OUT, stage.collect));
  }
  log(`${stage.name}: done in ${Math.round((Date.now() - started) / 1000)}s — card released`);
  finished.push(stage.name);

  if (stage.after !== undefined) {
    /* OUTSIDE the lock, deliberately: card-free work must not hold the card. */
    log(`${stage.name}: the card-free half (${path.basename(stage.after[1])})`);
    const a = spawnSync(stage.after[0], stage.after.slice(1), { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    log(`${stage.name}: card-free half exited ${a.status}`);
  }
}

console.log('');
log(`finished: ${finished.join(', ')}`);
log('next, all card-free:');
log('  node tools/bench/seq-condition-report.mjs tools/bench/out/seq-new-*.json tools/bench/out/walk-*.json');
log('  node tools/bench/checkpoint-prediction.mjs      # same-build sessions from walk-2');
log('  the next-picture bands: docs/research/next-picture-checkin.md');
