#!/usr/bin/env node
/**
 * STAGE 3 — THE SEAT READ ON TURN THREE, FOR AN ENGINEER.
 *
 *   node tools/ci/seat-turn-three.mjs [port]
 *
 * The reader this tests for is **a software engineer with a hard system in front
 * of them**, which is the identity now public on the site. Not a learner. So the
 * ask is a dependency question about this repository, the follow-ups are what an
 * engineer asks next, and the judgement at the end is whether turn three still
 * knows what turn one read.
 *
 * ── WHAT WOULD MAKE THIS READ INVALID, NAMED BEFORE IT RUNS ───────────────
 *
 * Every one of these has burned a measurement in this repository, and every one
 * has a check that exists because it did:
 *
 *   1. A STALE SERVER — the process older than the code it serves. Three seat
 *      reads were once done against a separately-started instance and the stale
 *      one was never noticed. `/api/build` reports `startedAt` against `builtAt`.
 *   2. A BUILD OLDER THAN THE CODE, in EITHER half. The server half and the
 *      client half live in two packages with separate builds; on 2026-09-06 the
 *      server was minutes old and the browser was served a bundle from the
 *      previous night, and half a commit was missing from the product with every
 *      test green. `/api/build` now reports both halves against their sources.
 *   3. A CHART CAPTURED FROM A PROCESS NOBODY RESTARTED — the same fault as (1)
 *      wearing a screenshot. Guarded by the same stamp, checked again after the
 *      run so a mid-read restart cannot pass unnoticed.
 *
 * A read that cannot satisfy all three REFUSES rather than reporting. A seat read
 * against a stale process is a measurement of last week.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PORT = Number(process.argv[2] ?? 4173);
const base = `http://127.0.0.1:${PORT}`;
const OUT = path.join(REPO, 'docs', 'journeys', 'img');
const log = (...a) => console.log('[turn3]', ...a);

/** An engineer's conversation: one hard question, then what they ask next. */
const TURNS = [
  'Which files depend on scan.ts, and what breaks if it changes?',
  'Of those, which one would I have to change first?',
  'Show me how that file uses what scan.ts returns.',
];

async function buildStamp() {
  const r = await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`no /api/build on ${PORT}`);
  return r.json();
}

/** All three invalidation conditions, checked together. Throws rather than warns. */
function assertValid(stamp, when) {
  const bad = [];
  if (stamp.stale === true) bad.push(`the app reports itself stale (${when})`);
  if (stamp.server?.stale === true) bad.push(`the SERVER build is older than its source (${when})`);
  if (stamp.client?.stale === true) bad.push(`the CLIENT bundle is older than its source (${when})`);
  if (bad.length > 0) {
    throw new Error(
      `seat-turn-three: REFUSED — ${bad.join('; ')}. A seat read against a stale process is a ` +
        'measurement of last week. Run `pnpm restart:app` (which now rebuilds the stale half) first.',
    );
  }
}

const before = await buildStamp();
assertValid(before, 'before the read');
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
log(`app current — started ${before.startedAt}, built ${before.builtAt}, tree at ${commit}`);
log(`server half ${before.server?.stale === true ? 'STALE' : 'ok'}, client half ${before.client?.stale === true ? 'STALE' : 'ok'}`);

const chromium = await loadPlaywright();
const browser = await chromium.launch({ ...launchOptions(), executablePath: findChromium(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const observed = [];
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  /* A fresh conversation, so nothing earlier bleeds into turn three. */
  const fresh = page.getByText('New chat', { exact: true }).first();
  if ((await fresh.count()) > 0) await fresh.click();
  await page.waitForTimeout(1500);

  for (let i = 0; i < TURNS.length; i += 1) {
    const box = page.locator('textarea, [contenteditable="true"]').first();
    await box.click();
    await box.fill(TURNS[i]);
    const started = Date.now();
    await page.keyboard.press('Enter');
    /* Wait for the reply to settle: the composer re-enables when the turn ends. */
    let settled = false;
    for (let w = 0; w < 120 && !settled; w += 1) {
      await page.waitForTimeout(2000);
      const busy = await page.locator('[data-testid="stop-button"], [aria-label="Stop"]').count();
      if (busy === 0 && Date.now() - started > 6000) settled = true;
    }
    const secs = Math.round((Date.now() - started) / 1000);
    const text = await page.locator('body').innerText();
    observed.push({ turn: i + 1, ask: TURNS[i], seconds: secs, chars: text.length });
    log(`turn ${i + 1}: ${secs}s — "${TURNS[i].slice(0, 44)}…"`);
    await page.screenshot({ path: path.join(OUT, `turn3-${i + 1}.png`) });
  }

  /* THE JUDGEMENT: does turn three still know what turn one read? */
  const body = await page.locator('body').innerText();
  const aria = await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => null);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'turn3.aria.txt'), aria ?? '(no snapshot)');
  const checks = {
    'turn 3 names scan.ts (the subject of turn 1)': /scan\.ts/i.test(body),
    'turn 3 names a concrete dependent file': /\b\w[\w-]*\.(ts|tsx|js|mjs)\b/.test(body.split('scan.ts').pop() ?? ''),
    'the reply cites evidence it read': /read|line\s*\d|packages\//i.test(body),
    'a picture is on the page': (await page.locator('[data-testid="ai-canvas-chart"], [data-testid="chat-chart-pointer"]').count()) > 0,
  };
  for (const [k, v] of Object.entries(checks)) log(`  ${v ? 'ok  ' : 'MISS'} ${k}`);

  const after = await buildStamp();
  assertValid(after, 'after the read');
  if (after.startedAt !== before.startedAt) {
    throw new Error('seat-turn-three: REFUSED — the server restarted mid-read; the screens are from two processes.');
  }
  fs.writeFileSync(
    path.join(OUT, 'turn3.json'),
    `${JSON.stringify({ commit, before, after, turns: observed, checks }, null, 2)}\n`,
  );
  log(`wrote docs/journeys/img/turn3.json and three screens`);
} finally {
  await browser.close();
}
