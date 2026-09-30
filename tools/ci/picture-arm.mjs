#!/usr/bin/env node
/**
 * ONE ARM OF THE BELT'S SECOND QUESTION — does the product draw for an engineer?
 *
 *   node tools/ci/picture-arm.mjs --trim 0|1 [--port 4400]
 *
 * Registered in `docs/research/belt-second-question-registration.md`. Clause 1:
 * on a three-turn dependency conversation, at least one turn renders a chart.
 * Refuted if both runs of an arm give three turns and no picture.
 *
 * ── WHY THIS ONE DRIVES A BROWSER ────────────────────────────────────────
 *
 * The referents arms drive HTTP, because clause 1 there asked what turn 2
 * NAMES and the DOM does not separate an answer from its tool receipts. This
 * clause asks whether a PICTURE APPEARS, and the rendered page is the only
 * witness to that. A `chart:proposal` on the wire is a proposal; a chart in the
 * document is the thing a person sees.
 *
 * ── THE WITNESS, AND WHAT IT MUST NOT BE ─────────────────────────────────
 *
 * `[data-testid="ai-canvas-chart"] [data-testid="seqchart"]` — THE NESTED PAIR,
 * and nothing else.
 *
 * The outer marker alone is not enough, and the reason is the product working
 * correctly. It is emitted per PARSED chart, including one whose spec the
 * validator refuses, and `ChartRefusal` renders `seqchart-fail` rather than a
 * `ChartFrame`. The first refusal path is the fabrication guard: an item naming
 * a node absent from the scanned graph refuses by design, because a picture that
 * fabricates is believed faster than prose that fabricates. So the outer marker
 * alone scores that correct refusal as a picture drawn.
 *
 * The outer one is still needed: it is gated on structured chart data, so a
 * model's raw SVG cannot reach it — that lands on `ai-canvas-svg-inline`, which
 * `AiCanvas.test.tsx` asserts. Outer for unforgeability, inner for evidence that
 * something drew.
 *
 * `role="img"` IS NOT A FALLBACK. Three components carry it, two of them are
 * not charts, and arbitrary model SVG can put it in the DOM. A fallback there
 * turns a distinguishing witness into a non-distinguishing one at exactly the
 * moment it decides a result.
 *
 * The witness can say NO as well as yes. Four cases in `AiCanvas.test.tsx`
 * assert it: absent with no charts, absent for a raw svg payload, absent for a
 * REFUSED spec whose outer article exists, and present for a valid one. A
 * marker that only ever appears cannot refute anything.
 *
 * THE VERDICT IS BINARY and the registration says why in the same breath as the
 * clause: "at least one of the three turns RENDERS a chart … this is the whole
 * question and it is binary on purpose." A refusal is not a chart rendered, so
 * it already counts as no picture. `proposed > 0 && drawn === 0` is recorded as
 * an OBSERVATION and does not enter the kill.
 *
 * ── WHAT WOULD MAKE AN ARM INVALID, NAMED BEFORE IT RUNS ─────────────────
 *
 *   1. A STALE BUILD, EITHER HALF — `/api/build` reports both, and a chart
 *      captured from a process older than its source is a measurement of last
 *      week. Exit 4.
 *   2. AN APP THAT IS NOT THIS ONE — the port is checked free first, or the arm
 *      would measure whatever flags that process began with. Exit 2.
 *   3. A TURN THAT NEVER ANSWERED — a conversation that produced no assistant
 *      text cannot be said to have DECLINED to draw. Exit 6, void, replaced
 *      rather than averaged in.
 *
 * ── EVERY INVOCATION LEAVES A LINE ───────────────────────────────────────
 *
 * `docs/research/../out/picture-arm.log`, append-only, one line per run with
 * the flags, the exit and the reason — written on the way out whatever the exit.
 *
 * The referents runner does not do this and `docs/BACKLOG.md` item 2 is the
 * finding: six of its exits occur before it writes anything, so an arm that
 * aborts on a bad flag, a busy port or a stale build is indistinguishable by
 * construction from an arm nobody started. This one is built with the fix
 * rather than repeating the gap.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import url from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'tools', 'bench', 'out');
const LOG = path.join(OUT, 'picture-arm.log');
const RUN_STARTED_AT = new Date().toISOString();

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const TRIM = flag('trim') === '1';
const PORT = Number(flag('port') ?? 4400);
const base = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log('[picture]', ...a);

/** The registered conversation — an engineer tracing a dependency. */
const TURNS = [
  'Which files depend on scan.ts, and what breaks if it changes?',
  'Of those, which one would I have to change first?',
  'Show me how that file uses what scan.ts returns.',
];

/**
 * ONE LINE PER INVOCATION, WHATEVER HAPPENS.
 *
 * Registered on the way out rather than at the end, so an arm that exits early
 * is a record instead of an absence. `docs/BACKLOG.md` item 2.
 */
let exitReason = 'started';

/*
 * INTENT, because a forced failure and a real one look identical otherwise.
 *
 * Four lines in this log were written by deliberate exit-proving runs — two bad
 * flags, a busy port, and a stale build created by touching a source. A reader
 * took them for arms failing before the measurement and concluded the
 * environment was broken. It was not: the build was current and the run had been
 * stopped for an unrelated reason.
 *
 * The record was accurate about what happened and silent about what it was FOR,
 * which is tonight's pattern one layer in. `PICTURE_ARM_PROOF=1` marks a run
 * that exists to make an exit fire.
 */
const INTENT = process.env.PICTURE_ARM_PROOF === '1' ? 'proof' : 'measure';

const logLine = (kind, extra) => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(
      LOG,
      `at=${RUN_STARTED_AT} intent=${INTENT} trim=${TRIM ? 1 : 0} port=${PORT} ${kind}=${extra}\n`,
    );
  } catch {
    /* A logging failure must never change an exit code. */
  }
};

/*
 * A START LINE, because an exit handler cannot cover every way a run ends.
 *
 * The arm that reached turn 1 and was force-killed left NO line at all:
 * `process.on('exit')` does not fire on a SIGKILL. So the fix built for "an
 * aborted arm leaves no trace" had a hole exactly where it was first used.
 *
 * A start line closes it without pretending to catch a kill. An arm that dies
 * any way at all leaves a start with no exit beside it — an incomplete pair,
 * which is visible, rather than an absence, which is not.
 */
logLine('start', `pid=${process.pid}`);
const writeExitLine = (code) => logLine('exit', `${code} reason=${exitReason}`);
process.on('exit', writeExitLine);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    exitReason = `signal-${sig}`;
    process.exit(130);
  });
}

const portFree = () =>
  new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      s.destroy();
      resolve(false);
    });
    s.on('error', () => resolve(true));
  });

if (flag('trim') !== '0' && flag('trim') !== '1') {
  exitReason = 'bad-trim-flag';
  console.error('[picture] REFUSED — --trim must be 0 or 1.');
  process.exit(2);
}
if (!(await portFree())) {
  exitReason = 'port-busy';
  console.error(
    `[picture] REFUSED — something is already listening on ${PORT}. An arm must start its own app, ` +
      'or it measures whatever flags that process began with.',
  );
  process.exit(2);
}

const armName = `picture-${TRIM ? 'trim' : 'notrim'}-${RUN_STARTED_AT.replace(/[:.]/g, '-')}`;
const armPath = path.join(OUT, `${armName}.json`);

log(`starting app on ${PORT} with TRIM_TOOLS=${TRIM ? '1' : '0'}`);
const app = spawn(
  process.execPath,
  ['packages/analyzer/dist/cli.js', 'app', '--repo', '.', '--port', String(PORT), '--no-open'],
  {
    cwd: REPO,
    env: { ...process.env, ...(TRIM ? { SEQUENCE_ASK_TRIM_TOOLS: '1' } : {}) },
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
let appStderr = '';
app.stderr.on('data', (d) => {
  appStderr += String(d);
});
const stopApp = () => {
  try {
    app.kill();
  } catch {
    /* already gone */
  }
};
process.on('exit', stopApp);

async function awaitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`app never answered /api/build on ${PORT}. stderr:\n${appStderr.slice(0, 600)}`);
}

const stamp = await awaitReady();
if (stamp.stale === true || stamp.server?.stale === true || stamp.client?.stale === true) {
  exitReason = 'stale-build';
  console.error(
    '[picture] REFUSED — a build half is older than its source ' +
      `(process ${stamp.stale === true}, server ${stamp.server?.stale === true}, client ${stamp.client?.stale === true}).`,
  );
  process.exit(4);
}
log(`app ready — built ${stamp.builtAt}, both halves current`);

const chromium = await loadPlaywright();
const browser = await chromium.launch({ ...launchOptions(), executablePath: findChromium(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const turns = [];
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const fresh = page.getByText('New chat', { exact: true }).first();
  if ((await fresh.count()) > 0) await fresh.click();
  await page.waitForTimeout(1500);

  for (let i = 0; i < TURNS.length; i += 1) {
    const box = page.locator('textarea, [contenteditable="true"]').first();
    await box.click();
    await box.fill(TURNS[i]);
    const started = Date.now();
    await page.keyboard.press('Enter');
    let settled = false;
    for (let w = 0; w < 150 && !settled; w += 1) {
      await page.waitForTimeout(2000);
      const busy = await page.locator('[data-testid="stop-button"], [aria-label="Stop"]').count();
      if (busy === 0 && Date.now() - started > 6000) settled = true;
    }
    /*
     * THE WITNESS IS THE NESTED PAIR, and it reads THREE states.
     *
     * `ai-canvas-chart` alone scores a chart REFUSAL as a picture: the article
     * is emitted per parsed chart including one the validator rejects, and the
     * first rejection path is the fabrication guard — an item naming a node
     * absent from the scanned graph refuses by design. `ChartRefusal` renders
     * `seqchart-fail` and never a `ChartFrame`, so the inner marker is the
     * evidence that something actually drew.
     *
     *   outer absent            -> NO PICTURE          (nothing proposed)
     *   outer without inner     -> PROPOSED AND REFUSED (decided, then declined)
     *   both                    -> PICTURE
     */
    const proposed = await page.locator('[data-testid="ai-canvas-chart"]').count();
    const drawn = await page
      .locator('[data-testid="ai-canvas-chart"] [data-testid="seqchart"]')
      .count();
    const refused = await page.locator('[data-testid="seqchart-fail"]').count();
    /* The per-turn note is an observation; the verdict below is binary. */
    const outcome =
      drawn > 0 ? 'PICTURE' : refused > 0 ? 'refused' : proposed > 0 ? 'unaccounted' : 'NO_PICTURE';
    const body = await page.locator('body').innerText();
    const secs = Math.round((Date.now() - started) / 1000);
    turns.push({ turn: i + 1, ask: TURNS[i], seconds: secs, proposed, drawn, refused, outcome, chars: body.length });
    log(`turn ${i + 1}: ${secs}s — ${outcome} (proposed ${proposed}, drawn ${drawn}, refused ${refused})`);
    await page.screenshot({ path: path.join(REPO, 'docs/journeys/img', `${armName}-t${i + 1}.png`) });
  }
  fs.writeFileSync(
    path.join(REPO, 'docs/journeys/img', `${armName}.body.txt`),
    await page.locator('body').innerText(),
  );
} finally {
  await browser.close();
  stopApp();
}

/* VOID: a conversation that never answered cannot have declined to draw. */
const answered = turns.filter((t) => t.chars > 400).length;
const record = {
  arm: TRIM ? 'treatment (TOOLS trimmed)' : 'control',
  flags: { SEQUENCE_ASK_TRIM_TOOLS: TRIM ? '1' : '0' },
  when: RUN_STARTED_AT,
  build: { builtAt: stamp.builtAt, startedAt: stamp.startedAt },
  turnsAnswered: answered,
  proposedMax: turns.reduce((a, t) => Math.max(a, t.proposed), 0),
  drawnMax: turns.reduce((a, t) => Math.max(a, t.drawn), 0),
  /*
   * BINARY, because the registration says so in the same breath as the clause:
   * "at least one of the three turns RENDERS a chart … this is the whole
   * question and it is binary on purpose." A refusal is not a chart rendered,
   * so it already counts as no picture — correctly, and by the author's choice.
   *
   * A third verdict was drafted and withdrawn: it would have widened a clause
   * somebody had deliberately narrowed. The refusal is RECORDED per turn as an
   * observation and does not enter the kill.
   */
  clauseOne: turns.some((t) => t.drawn > 0) ? 'PICTURE' : 'NO_PICTURE',
  /*
   * OBSERVATIONS, NAMED BY WHAT IS THERE RATHER THAN BY WHAT IS MISSING.
   *
   * `refusedTurns` counts `seqchart-fail`, which `ChartRefusal` emits and
   * nothing else does (`SeqChartView.tsx:126`, unique in the source tree).
   *
   * The tempting derivation is *outer article without inner frame*, and it is
   * wrong: that also matches a loading skeleton, a new block state, or an empty
   * render — anything that article may hold in future that is neither a drawn
   * chart nor a refusal. Naming the refusal positively leaves
   * `unaccountedTurns` as a FOURTH state nobody has seen, visible instead of
   * silently counted as refused.
   *
   * Neither enters the kill. The verdict is binary, as registered.
   */
  refusedTurns: turns.filter((t) => t.refused > 0).length,
  unaccountedTurns: turns.filter((t) => t.proposed > 0 && t.drawn === 0 && t.refused === 0).length,
  turns,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(armPath, `${JSON.stringify(record, null, 1)}\n`);
const back = JSON.parse(fs.readFileSync(armPath, 'utf8'));
if (back.turns?.length !== turns.length) {
  exitReason = 'write-assert-failed';
  console.error(`[picture] REFUSED — ${armPath} holds ${back.turns?.length} turns, the run produced ${turns.length}.`);
  process.exit(5);
}

log(
  `clause 1: ${record.clauseOne} — proposed max ${record.proposedMax}, drawn max ${record.drawnMax}` +
    `, refused turns ${record.refusedTurns}, unaccounted turns ${record.unaccountedTurns}`,
);
if (record.unaccountedTurns > 0) {
  console.error(
    `[picture] NOTE — ${record.unaccountedTurns} turn(s) held a chart article with neither a drawn ` +
      'frame nor a refusal. That is a state this arm has no name for; read the screenshot before ' +
      'reading the verdict.',
  );
}
log(`wrote ${path.basename(armPath)}`);
if (answered < TURNS.length) {
  exitReason = `void-${answered}-of-${TURNS.length}-answered`;
  console.error(
    `[picture] VOID — only ${answered} of ${TURNS.length} turns produced an answer. A turn that ` +
      'never answered cannot be said to have declined to draw. Exit 6: re-run it.',
  );
  process.exit(6);
}
exitReason = record.clauseOne.toLowerCase();
