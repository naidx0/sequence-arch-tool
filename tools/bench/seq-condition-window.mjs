#!/usr/bin/env node
/**
 * THE SEQUENCE CONDITION'S REMAINING CARD WINDOW, in one command.
 *
 *   node tools/ci/gpu-lock.mjs run --what "..." -- node tools/bench/seq-condition-window.mjs
 *
 * Three runs and a prediction, in order, so the card is held once and nothing is
 * spent waiting for a person between steps:
 *
 *   1. OLD scan, run 2 of 2   (`seq-old-1.json` exists; the replication rule
 *                              needs two a side or neither side has a range)
 *   2. NEW scan, run 1 of 2
 *   3. NEW scan, run 2 of 2   — with TEACH_EVAL_WRITE_SESSIONS=1, which writes
 *                              the thirteen sessions the checkpoint prediction
 *                              needs, at no extra card cost
 *   4. the checkpoint prediction, card-free, against those thirteen
 *
 * ── TWO CONDITIONS, ONE WINDOW ────────────────────────────────────────────
 *
 *   node tools/bench/seq-condition-window.mjs          # the scan condition
 *   node tools/bench/seq-condition-window.mjs walk     # the walk condition
 *
 * The WALK condition swaps nothing: both its arms run on one build, because what
 * changed (`TEACH_ASK` in buildQueue, bb1d7f16) is already in the tree. So it
 * checks nothing out, restores nothing, and — this is the part that matters —
 * REBUILDS NOTHING AFTERWARDS. The first checkpoint prediction was unmeasurable
 * because this window rebuilt the analyzer after the last arm wrote its
 * sessions, so they were opened by a build that had not written them. Here that
 * holds by construction rather than by care.
 *
 * Its bands are registered in `docs/research/walk-condition-prediction.md`.
 *
 * ── THE OLD SCANNER GOES IN THE WORKING TREE AND NOWHERE ELSE ─────────────
 *
 * The old arm needs `facts.ts` at `ecceb7a4^`. That revert is restored in a
 * `finally` and is never staged: committing it once already put a scanner
 * regression on main, and the commit message described the working tree while
 * publishing it. The tree is verified clean at the end, and a failure to restore
 * is shouted rather than logged.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FACTS = 'packages/analyzer/src/parse/facts.ts';
const OLD_AT = 'ecceb7a4^';
const MODE = process.argv[2] ?? 'scan';
const log = (...a) => console.log('[window]', ...a);
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const ENV = {
  ...process.env,
  SEQUENCE_AI_MODEL: process.env.SEQUENCE_AI_MODEL ?? 'granite42-hermes',
  SEQUENCE_AI_BASE_URL: process.env.SEQUENCE_AI_BASE_URL ?? 'http://127.0.0.1:11434/v1',
  SEQUENCE_AI_API_KEY: process.env.SEQUENCE_AI_API_KEY ?? 'local',
  SEQUENCE_AI_PROVIDER: 'openai-compatible',
  TEACH_EVAL_REPO: 'sequence',
};

function build() {
  const r = spawnSync('pnpm', ['--filter', '@sequence/analyzer', 'build'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: true,
  });
  if (r.status !== 0) throw new Error('analyzer build failed');
}

/**
 * Edge count of the current build's scan — proof of which arm is in force.
 *
 * IN A CHILD PROCESS, and that is the whole point. The first version imported
 * `scan.js` with a cache-busting query and re-read it after the rebuild; ESM
 * caches the TRANSITIVE modules, so `facts.js` stayed at whatever was loaded
 * first and the second reading returned the first arm's number. The window then
 * refused its own new arm with "expected ~2,860, measured 2,621" while the build
 * on disk was correct — a guard firing on a stale measurement rather than on a
 * bad build, which is the same class of error as measuring a stale server.
 *
 * A child process loads the tree as it is now. That is what the bench does, and
 * it is why the bench's arm was right when this check was wrong.
 */
function edgeCount() {
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      "(async()=>{const {scanRepo}=await import('./packages/analyzer/dist/scan.js');" +
        'const g=await scanRepo(process.cwd(),{cluster:true});console.log(g.edges.length);})()',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const n = Number(String(r.stdout ?? '').trim());
  if (!Number.isFinite(n)) throw new Error(`could not measure the edge count: ${r.stderr ?? ''}`);
  return n;
}

function runBench(label, extraEnv = {}) {
  const out = path.join(ROOT, 'tools/bench/out', `${label}.json`);
  /* IDEMPOTENT: an arm already on disk is not re-run. The window stopped once
     between arms and re-running a completed arm would spend twenty minutes of
     card to overwrite a good report. */
  if (fs.existsSync(out)) {
    log(`${label}: already on disk — skipping`);
    return out;
  }
  log(`${label}: starting`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/bench/teach-eval.mjs')], {
    cwd: ROOT,
    env: { ...ENV, ...extraEnv },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) throw new Error(`${label} exited ${r.status}`);
  fs.copyFileSync(path.join(ROOT, 'tools/bench/out/teach-eval-report.json'), out);
  log(`${label}: done in ${Math.round((Date.now() - started) / 1000)}s → ${path.relative(ROOT, out)}`);
  return out;
}

/**
 * Is the WALK in force in the build on disk?
 *
 * The arm-in-force check, and the same lesson as `edgeCount`: measured in a
 * CHILD PROCESS, because ESM caches transitive modules and a guard that reads a
 * stale module refuses a correct build — which this window already did once,
 * with "expected ~2,860, measured 2,621".
 *
 * It asks the shopfront fixture, not this repository: 36 nodes scan in about a
 * second where 1,072 take the best part of a minute, and the question is a
 * boolean about a branch, not a count. The ask is the planted case's own ask, so
 * the guard and the test cannot drift into disagreeing about what the walk is.
 */
function walkInForce() {
  const r = spawnSync(
    process.execPath,
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
  const n = Number(String(r.stdout ?? '').trim());
  if (!Number.isFinite(n)) throw new Error(`could not measure the queue: ${r.stderr ?? ''}`);
  return n;
}

if (MODE === 'carry') {
  /*
   * THE CARRY'S TWO CARD-BOUND NUMBERS, which no dry provider can supply:
   * provider calls a turn against today's 5.4, and repeated concepts across a
   * lesson against 17 and 18. Both depend on what a real model DOES with the
   * prompt rather than on what the prompt contains.
   *
   * Same shape as the control (four turns, next-picture form) so the only
   * difference is that the carry is now threaded. Control: ceiling-1, ceiling-2.
   */
  const bench = fs.readFileSync(path.join(ROOT, 'tools/bench/teach-eval.mjs'), 'utf8');
  if (!bench.includes('carryOut')) {
    console.error('seq-condition-window: REFUSED — the bench does not thread the carry. Exit 2.');
    process.exit(2);
  }
  const env = { SEQUENCE_TEACH_CHECKIN_FORM: 'next-picture', TEACH_EVAL_MIN_TURNS: '4' };
  const made = [runBench('carry-1', env), runBench('carry-2', env)];
  log(`runs produced: ${made.map((x) => path.basename(x)).join(', ')}`);
  log('control is ceiling-1 and ceiling-2 — same length, same form, without the carry');
  process.exit(0);
}

if (MODE === 'belt') {
  /*
   * THE BELT CONDITION: the TOOLS section removed, CHARTS and AI CANVAS kept.
   * Bands in docs/research/belt-condition-registration.md. Control: ceiling-1
   * and ceiling-2.
   *
   * The guard is that the flag is actually in the build — a run of the control
   * twice would cost the card an hour and a half and answer nothing.
   */
  const src = fs.readFileSync(
    path.join(ROOT, 'packages/analyzer/src/server/askPipeline.ts'),
    'utf8',
  );
  if (!src.includes("SEQUENCE_ASK_TRIM_TOOLS === '1'")) {
    console.error('seq-condition-window: REFUSED — the belt flag is not in this build. Exit 2.');
    process.exit(2);
  }
  const env = {
    SEQUENCE_TEACH_CHECKIN_FORM: 'next-picture',
    TEACH_EVAL_MIN_TURNS: '4',
    SEQUENCE_ASK_TRIM_TOOLS: '1',
  };
  const made = [runBench('belt-1', env), runBench('belt-2', env)];
  log(`runs produced: ${made.map((x) => path.basename(x)).join(', ')}`);
  log('four clauses: tool calls must not RISE, fabrication must not rise, refusals must not rise,');
  log('and a FALL IN CHARTS VOIDS the run rather than refuting it.');
  process.exit(0);
}

if (MODE === 'ceiling') {
  /*
   * CONDITION A of docs/research/ceiling-condition-registration.md: the same
   * next-picture form, on conversations padded to four turns, so a question is
   * not the last thing said. Two runs, one build, nothing checked out and
   * nothing rebuilt afterwards.
   *
   * The claim is LANDABLE QUESTIONS, not reveals — reveals are a product of two
   * things and only the length is under test here.
   */
  const bench = fs.readFileSync(path.join(ROOT, 'tools/bench/teach-eval.mjs'), 'utf8');
  if (!bench.includes('TEACH_EVAL_MIN_TURNS')) {
    console.error('seq-condition-window: REFUSED — teach-eval has no turn floor. Exit 2.');
    process.exit(2);
  }
  const env = { SEQUENCE_TEACH_CHECKIN_FORM: 'next-picture', TEACH_EVAL_MIN_TURNS: '4' };
  const made = [runBench('ceiling-1', env), runBench('ceiling-2', env)];
  log(`runs produced: ${made.map((x) => path.basename(x)).join(', ')}`);
  log('next: node tools/bench/next-picture-report.mjs tools/bench/out/nextpic-[34].json tools/bench/out/ceiling-*.json');
  process.exit(0);
}

if (MODE === 'nextpic') {
  /*
   * THE NEXT-PICTURE BANDS, RE-RUN UNDER THE REPAIRED BENCH.
   *
   * Registered in docs/research/next-picture-rerun-registration.md. Two runs, one
   * build, nothing checked out and nothing rebuilt afterwards — the same shape as
   * `walk`. The control is nextpic-1 and nextpic-2, already on disk, which asked
   * seven questions between them and produced ZERO reveals because nothing
   * carried the prediction from one turn to the next.
   *
   * The guard is that the carrier is actually in the bench: without it the run
   * would repeat the first one exactly and cost the card twice for one answer.
   */
  const bench = fs.readFileSync(path.join(ROOT, 'tools/bench/teach-eval.mjs'), 'utf8');
  if (!bench.includes('carryPrediction(')) {
    console.error('seq-condition-window: REFUSED — teach-eval does not carry the prediction (69a3498f). Exit 2.');
    process.exit(2);
  }
  log('carrier check: teach-eval calls carryPrediction');
  const env = { SEQUENCE_TEACH_CHECKIN_FORM: 'next-picture' };
  const made = [runBench('nextpic-3', env), runBench('nextpic-4', env)];
  log(`runs produced: ${made.map((x) => path.basename(x)).join(', ')}`);
  log('next: node tools/bench/next-picture-report.mjs   # reveals, and the gate reasons from stopReason');
  process.exit(0);
}

if (MODE === 'walk') {
  /*
   * NO CHECKOUT, NO RESTORE, NO REBUILD. Everything the scan condition does to
   * the working tree is absent here, and the `finally` that used to rebuild is
   * not on this path at all.
   */
  const q = walkInForce();
  log(`walk check: a lesson ask with no sequence phrase yields ${q} concepts`);
  if (q <= 1) {
    console.error(
      `seq-condition-window: REFUSED — the walk is NOT in the build on disk (queue ${q}). ` +
        'Build the analyzer at bb1d7f16 or later before running this condition.',
    );
    process.exit(2);
  }
  const made = [runBench('walk-1'), runBench('walk-2', { TEACH_EVAL_WRITE_SESSIONS: '1' })];
  log(`runs produced: ${made.map((x) => path.basename(x)).join(', ')}`);
  log('next: node tools/bench/seq-condition-report.mjs tools/bench/out/seq-new-*.json tools/bench/out/walk-*.json');
  log('the control is seq-new-1 and seq-new-2 ONLY — never the old-scan arms.');
  process.exit(0);
}

const dirty = git(['status', '--porcelain', '--', FACTS]);
if (dirty !== '') {
  console.error(`seq-condition-window: REFUSED — ${FACTS} has uncommitted changes:\n${dirty}`);
  process.exit(2);
}

const produced = [];
try {
  /* ── 1. the old arm's second run ───────────────────────────────────────── */
  log(`checking out ${FACTS} at ${OLD_AT} (working tree only)`);
  git(['checkout', OLD_AT, '--', FACTS]);
  build();
  const oldEdges = edgeCount();
  log(`old scan in force: ${oldEdges} edges`);
  if (oldEdges > 2700) throw new Error(`expected the old scan (~2,609 edges), measured ${oldEdges}`);
  produced.push(runBench('seq-old-2'));

  /* ── 2 and 3. the new arm ──────────────────────────────────────────────── */
  log(`restoring ${FACTS}`);
  git(['checkout', 'HEAD', '--', FACTS]);
  build();
  const newEdges = edgeCount();
  log(`new scan in force: ${newEdges} edges`);
  if (newEdges < 2800) throw new Error(`expected the new scan (~2,860 edges), measured ${newEdges}`);
  produced.push(runBench('seq-new-1'));
  produced.push(runBench('seq-new-2', { TEACH_EVAL_WRITE_SESSIONS: '1' }));
} finally {
  /*
   * Restore whatever happened, and SHOUT if it did not take.
   *
   * REBUILD ONLY IF THE RESTORE CHANGED SOMETHING. The first version rebuilt
   * unconditionally, which moved the analyzer's mtime AFTER the last run had
   * written its thirteen sessions — so those sessions carried 04:12 while the
   * app carried 05:31, and the checkpoint prediction measured `migrated 9 of 9`
   * against a registered `0 of 13`. The product was right and the harness had
   * changed the build between writing and opening. A restore that restores
   * nothing must not touch the build.
   */
  try {
    const before = git(['status', '--porcelain', '--', FACTS]);
    git(['checkout', 'HEAD', '--', FACTS]);
    if (before !== '') build();
    else log('nothing to restore — leaving the build alone');
  } catch (e) {
    console.error(`[window] RESTORE FAILED: ${e instanceof Error ? e.message : e}`);
  }
  const still = git(['status', '--porcelain', '--', FACTS]);
  console.log(
    still === ''
      ? '[window] tree restored — facts.ts clean'
      : `[window] WARNING: ${FACTS} is NOT clean:\n${still}`,
  );
}

log(`runs produced: ${produced.map((p) => path.basename(p)).join(', ')}`);
log('next: node tools/bench/seq-condition-report.mjs tools/bench/out/seq-*.json');
log('and the checkpoint prediction over the bench-* sessions, which are now on disk');
