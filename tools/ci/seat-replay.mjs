#!/usr/bin/env node
/**
 * PLANTED CASE 3 — the fourth seat read, replayed against the tree that had the
 * defect, to prove the seat looks where the person looked.
 *
 *   node tools/ci/seat-replay.mjs            # against 43da3119^
 *   node tools/ci/seat-replay.mjs <commit>
 *
 * On 2026-09-05 at 15:56 a person reopened a session whose `canvas.json` held a
 * chart and saw the placeholder. `43da3119` ("the load path read the chart and
 * threw it away") fixed it. An instrument that would not have caught that is
 * insurance on nothing, so this puts the pre-fix client back and asks the seat's
 * question again.
 *
 * **Expected: placeholder after reload.** A chart here means the seat is not
 * looking where the person looked — which is one of the three conditions the
 * design page names for the whole thing not being worth building.
 *
 * ── CARD-FREE, BECAUSE THE DEFECT IS IN THE LOAD PATH ─────────────────────
 *
 * No model turn is needed: the lesson is already on disk with `charts: 1`, and
 * the bug is what the client does when READING it. Reopen and reload is the
 * whole reproduction.
 *
 * ── WHAT IT TOUCHES, AND HOW IT PUTS IT BACK ──────────────────────────────
 *
 * `43da3119` changed two client files. This checks those two out at the parent
 * commit, rebuilds web2, runs the replay against a SECOND app on its own port,
 * and restores both files and the build in a `finally`. It also copies the
 * session directory aside first: the pre-fix client is the one that wiped charts
 * on landing, and a replay that corrupted the evidence it replays would be worse
 * than no replay.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const AT = process.argv[2] ?? '43da3119^';
const FILES = ['packages/web2/src/state/connect.tsx', 'packages/web2/src/state/store.ts'];
const log = (...a) => console.log('[replay]', ...a);
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

/* ── refuse to start on a dirty tree ─────────────────────────────────────── */

const dirty = git(['status', '--porcelain', '--', ...FILES]);
if (dirty !== '') {
  console.error(`seat-replay: REFUSED — these files have uncommitted changes and would be lost:\n${dirty}`);
  process.exit(2);
}

/** A session whose canvas.json really holds a chart — the case being replayed. */
function sessionWithChart() {
  const dir = path.join(REPO, '.sequence', 'sessions');
  if (!fs.existsSync(dir)) return null;
  for (const id of fs.readdirSync(dir)) {
    const f = path.join(dir, id, 'canvas.json');
    if (!fs.existsSync(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if ((j.charts?.length ?? 0) > 0) {
        /* The TITLE too, so the replay can open the session it chose. Clicking
           the first row matching a generic phrase opened a DIFFERENT session
           from the one whose evidence had been backed up. */
        let title = '';
        try {
          const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
          title = idx.sessions?.find((x) => x.id === id)?.title ?? '';
        } catch {
          /* no index; the caller falls back to a generic match */
        }
        return { id, charts: j.charts.length, title };
      }
    } catch {
      /* not this one */
    }
  }
  return null;
}

const target = sessionWithChart();
if (target === null) {
  console.error(
    'seat-replay: no session on disk holds a chart, so there is nothing to replay. ' +
      'Run a teach lesson first (the card), then this.',
  );
  process.exit(2);
}
log(`replaying against session ${target.id} "${target.title}" (canvas.json holds ${target.charts} chart)`);

const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/* The evidence, copied aside before a pre-fix client is allowed near it. */
const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-replay-'));
fs.cpSync(path.join(REPO, '.sequence', 'sessions', target.id), path.join(backup, target.id), {
  recursive: true,
});
log(`session copied to ${backup}`);

let result = null;
let app = null;
try {
  /* ── put the pre-fix client back ───────────────────────────────────────── */
  log(`checking out ${FILES.length} client files at ${AT}`);
  git(['checkout', AT, '--', ...FILES]);
  execFileSync('pnpm', ['--filter', '@sequence/web2', 'build'], {
    cwd: REPO,
    stdio: 'ignore',
    shell: true,
  });
  log('web2 rebuilt with the pre-fix load path');

  /* ── a second app, on its own port ─────────────────────────────────────── */
  const port = await freePort();
  app = spawn(
    process.execPath,
    [
      path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js'),
      'app',
      '--repo',
      REPO,
      '--port',
      String(port),
      '--no-open',
      '--web',
      path.join(REPO, 'packages', 'web2', 'dist'),
    ],
    { cwd: REPO, stdio: 'ignore' },
  );
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      up = (await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      /* starting */
    }
  }
  if (!up) throw new Error(`the replay app did not come up on ${port}`);
  log(`replay app on ${port}`);

  /* ── the seat's question, asked of the old client ──────────────────────── */
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({
    ...launchOptions(),
    executablePath: findChromium(),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const OUT = path.join(REPO, 'docs', 'journeys', 'seat');
  fs.mkdirSync(OUT, { recursive: true });
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    /* Reopen the lesson from the session list, then reload — the exact pair the
       person did by hand. */
    /*
     * BY ID, NOT BY TITLE. Five rows share the substring "Teach me how brief.ts
     * works", so `has-text(...).first()` opened the TOPMOST of them — a
     * different session from the one whose evidence had been backed up and whose
     * canvas.json holds the chart. The row carries `data-id`; use it.
     *
     * The symptom was a replay reporting all zeros, which the verdict then read
     * as "the placeholder, as expected" — a false pass over a run in which
     * nothing was opened.
     */
    const row = page.locator(`[data-testid="sessions-row"][data-id="${target.id}"]`).first();
    if ((await row.count()) > 0 && (await row.getAttribute('data-active')) !== 'true') await row.click();
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const pointer = page.getByTestId('chat-chart-pointer').first();
    if ((await pointer.count()) > 0) {
      await pointer.click();
      await page.waitForTimeout(1500);
    }
    /*
     * THE DEFECT AS TEXT, not as a pixel comparison.
     *
     * The accessibility snapshot renders the canvas region as words, so the
     * 15:56 defect becomes a diff a person reads: the placeholder's sentence
     * present on the pre-fix client and absent on head, the chart's node labels
     * the other way round. A pixel diff says "these images differ"; this says
     * WHICH SENTENCE.
     */
    const aria = await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => null);
    if (aria !== null) {
      fs.writeFileSync(path.join(OUT, 'replay.aria.txt'), aria);
    }
    result = await page.evaluate(() => ({
      chartRows: document.querySelectorAll('[data-testid="chat-chart-pointer"]').length,
      canvasCharts: document.querySelectorAll('[data-testid="ai-canvas-chart"]').length,
      canvasPlaceholder: document.querySelectorAll('.ai-canvas-empty').length,
    }));
    await page.screenshot({ path: path.join(OUT, 'replay-after-reload.png') });
    result.ariaChars = aria === null ? null : aria.length;
    /* The placeholder's own sentence, read out of AiCanvas.tsx rather than
       guessed — a regex invented for a string nobody checked is the selector
       defect wearing different clothes. */
    result.ariaHasPlaceholder =
      aria === null ? null : aria.includes('Ask in chat to populate this surface');
  } finally {
    await browser.close();
  }
} finally {
  /* ── put everything back, whatever happened ────────────────────────────── */
  if (app !== null) app.kill();
  git(['checkout', 'HEAD', '--', ...FILES]);
  execFileSync('pnpm', ['--filter', '@sequence/web2', 'build'], { cwd: REPO, stdio: 'ignore', shell: true });
  fs.cpSync(path.join(backup, target.id), path.join(REPO, '.sequence', 'sessions', target.id), {
    recursive: true,
  });
  const still = git(['status', '--porcelain', '--', ...FILES]);
  log(still === '' ? 'tree and session restored' : `WARNING: tree NOT clean:\n${still}`);
}

/* ── the verdict ─────────────────────────────────────────────────────────── */

console.log('');
log(`after reopen + reload on ${AT}:`);
log(`  chat chart rows   ${result?.chartRows ?? '?'}`);
log(`  canvas charts     ${result?.canvasCharts ?? '?'}`);
log(`  canvas placeholder ${result?.canvasPlaceholder ?? '?'}`);
/*
 * ── THE VERDICT NEEDS EVIDENCE THAT SOMETHING WAS OPENED ──────────────────
 *
 * `canvasCharts === 0` alone is a FALSE POSITIVE: it is also true when no lesson
 * was opened at all, and this replay printed "EXPECTED: the placeholder" over a
 * run in which the session row never matched and nothing was clicked. A check
 * that passes when the subject is absent is the vacuity this repository has now
 * been bitten by three times.
 *
 * So reproduction requires BOTH halves: the lesson visibly open (a chart row in
 * the chat, which the pre-fix client still renders) AND the canvas empty.
 */
const opened = result !== null && (result.chartRows > 0 || result.canvasPlaceholder > 0);
const reproduced = opened && result.canvasCharts === 0;
console.log('');
if (reproduced) {
  log('EXPECTED: the placeholder after reload, on the tree that had the defect.');
  log('The seat looks where the person looked.');
} else if (!opened) {
  log('CANNOT DECIDE: no lesson was opened — no chart row and no placeholder on screen.');
  log('The session row did not match, so nothing was tested. This is not a pass.');
} else {
  log('NOT REPRODUCED: the pre-fix tree shows a chart after reload.');
  log('By the design page that means the seat is not looking where the person looked,');
  log('and is insurance on nothing. Do not read a green seat run as evidence until this is explained.');
}
fs.writeFileSync(
  path.join(REPO, 'docs', 'journeys', 'seat', 'replay.json'),
  `${JSON.stringify({ at: AT, session: target, result, reproduced }, null, 2)}\n`,
);
process.exitCode = reproduced ? 0 : opened ? 1 : 2;
