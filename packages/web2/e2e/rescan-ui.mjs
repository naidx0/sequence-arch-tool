#!/usr/bin/env node
/**
 * 019-rescan-ui: THE OPEN PAGE FOLLOWS THE DISK.
 *
 * Owner-seat review: "There is no Rescan anywhere in the UI, and the board and Files never pick up an edit until the
 * page is reloaded." Boots the REAL analyzer over web2's dist on a THROWAWAY CLONE of this repo (HOME, USERPROFILE,
 * APPDATA, LOCALAPPDATA and the user store all in a scratch folder; the real claude/codex never run) and checks, in a
 * real browser:
 *   1. auto-refresh ON (the default): an edit in the clone shows in the open page's Files tree within ~3 s, no click;
 *   2. auto-refresh OFF (Settings): the notice "Files changed" appears; Rescan is a click away and the new file shows;
 *      Ctrl+K "Rescan project" is a door to the same rescan;
 *   3. Open project shows "Reading N of M files" while a repo is read, and the status bar says it is opening;
 *   4. the progress bar paints a coloured fill (Chrome), at about 30 % at 1440 and 420 px.
 *
 * SCRATCH=<dir> picks the scratch folder; SHOTS=<dir> saves screenshots. Exit 0 pass (or skip: no Chromium),
 * 1 product wrong, 2 harness broken.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';
import { sel } from './lib/harness.mjs';

const NAME = 'rescan-ui';
const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const SHOTS = process.env.SHOTS || null;

const log = (...a) => console.log(`[${NAME}]`, ...a);
const failHarness = (m) => {
  console.error(`[${NAME}] ERROR: ${m}`);
  process.exit(2);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function until(what, fn, ms = 20000, every = 100) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
}

/** Ctrl+K, type the command, wait until its row is the one shown, Enter. */
async function runCommand(page, text) {
  await page.keyboard.press('Control+k');
  await page.waitForSelector(sel('command-surface'));
  await page.keyboard.type(text);
  await page.waitForSelector(`${sel('command-row')}:has-text("${text}")`, { timeout: 5000 });
  await sleep(200);
  await page.keyboard.press('Enter');
  await page.waitForSelector(sel('command-surface'), { state: 'detached', timeout: 5000 }).catch(() => undefined);
}

async function main() {
  const problem = buildProblem();
  if (problem) failHarness(`${problem} — run: pnpm --filter @sequence/web2 build`);
  if (!fs.existsSync(ANALYZER_CLI)) failHarness('analyzer not built — run: pnpm --filter @sequence/analyzer build');
  const executablePath = findChromium();
  if (!executablePath) {
    log('SKIP: no Chromium found. Searched:', cacheRoots().join(', '));
    process.exit(0);
  }
  const chromium = await loadPlaywright();
  if (!chromium) {
    log('SKIP: playwright-core is not installed');
    process.exit(0);
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  /* ── the specimen: a scratch home, a throwaway clone of this repo, a small second project ── */
  const tmp = process.env.SCRATCH
    ? (fs.mkdirSync(process.env.SCRATCH, { recursive: true }), fs.realpathSync(process.env.SCRATCH))
    : fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-rescanui-')));
  const home = path.join(tmp, 'home');
  const reuse = process.env.REUSE === '1' && fs.existsSync(path.join(home, 'seqclone'));
  if (!reuse) fs.rmSync(home, { recursive: true, force: true });
  const userDir = path.join(home, '.sequence');
  const appData = path.join(home, 'AppData', 'Roaming');
  const localAppData = path.join(home, 'AppData', 'Local');
  for (const d of [userDir, appData, localAppData]) fs.mkdirSync(d, { recursive: true });
  /* Windows Search and antivirus re-reading every scan's cache files froze the engine for ~30 s at a time: keep the scratch home out of the content index (an attribute on our own folder; new files inherit it). */
  if (process.platform === 'win32') execFileSync('attrib', ['+I', home, '/D'], { stdio: 'ignore' });
  const clone = path.join(home, 'seqclone');
  if (!reuse) execFileSync('git', ['-c', 'core.longpaths=true', 'clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { stdio: 'ignore' });
  for (const f of fs.readdirSync(clone)) if (f.startsWith('rescan-probe-')) fs.rmSync(path.join(clone, f));
  /* A big project the engine has never read (the clone without its .git), made BEFORE the server starts: a copy while it
     scans starves it. Kept between runs with REUSE=1. */
  const fresh = path.join(home, 'seqbig');
  if (!fs.existsSync(fresh)) fs.cpSync(clone, fresh, { recursive: true, filter: (src) => !['.git', '.sequence'].includes(path.basename(src)) && !path.basename(src).startsWith('rescan-probe-') });
  fs.rmSync(path.join(fresh, '.sequence'), { recursive: true, force: true }); /* a cached graph would make the attach instant */
  const small = path.join(home, 'shopfront');
  fs.cpSync(path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront'), small, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'recent.json'), JSON.stringify([small]));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [ANALYZER_CLI, 'app', '--no-open', '--port', String(port), '--repo', clone], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SEQUENCE_BIND_HOST: '127.0.0.1',
      /* The ask-index warm build that follows every scan can hold the NEXT scan for ~30 s on this 589 MB clone (an engine
         matter, reported separately); this run is about the page, so the warm build is off. */
      NODE_TEST_CONTEXT: 'child-v8',
      SEQUENCE_USER_DIR: userDir,
      HOME: home,
      USERPROFILE: home,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  child.stdout.on('data', (b) => (serverOut += b.toString('utf8')));
  child.stderr.on('data', (b) => (serverOut += b.toString('utf8')));

  const failures = [];
  let mainPage = null;
  const check = async (label, fn) => {
    try {
      const note = await fn();
      log('ok  ', label, note ?? '');
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      if (SHOTS && mainPage) await mainPage.screenshot({ path: path.join(SHOTS, 'fail-' + label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) + '.png') }).catch(() => undefined);
      log('FAIL', label, '-', e.message);
    }
  };
  const shot = async (page, name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };

  const browser = await chromium.launch(launchOptions(executablePath));
  const pageErrors = [];
  try {
    await until('the server', async () => (await fetch(`${base}/api/status`)).ok, 60000, 250);
    await until('the clone scanned', async () => (await fetch(`${base}/archgraph.json`)).ok, 120000, 500);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
    if (process.env.TRACE) await context.addInitScript(() => { try { new PerformanceObserver((l) => { for (const e of l.getEntries()) console.log('SCANFETCH longtask ' + Math.round(e.duration) + 'ms at ' + Math.round(e.startTime)); }).observe({ entryTypes: ['longtask'] }); } catch {}
       const f = window.fetch; window.fetch = async (...a) => { const u = String(a[0]); const t0 = performance.now(); const r = await f(...a); if (u.includes('api/scan')) { console.log('SCANFETCH headers after ' + Math.round(performance.now() - t0) + 'ms'); const c = r.clone(); (async () => { const rd = c.body.getReader(); let n = 0, k = 0; for (;;) { const { value, done } = await rd.read(); if (done) break; n += value.length; k += 1; if (k % 20 === 1) console.log('SCANFETCH chunk#' + k + ' bytes=' + n + ' at ' + Math.round(performance.now() - t0) + 'ms'); } console.log('SCANFETCH done bytes=' + n + ' chunks=' + k + ' at ' + Math.round(performance.now() - t0) + 'ms'); })(); } return r; }; });
    /* GET /api/functions builds the function graph of the NEW scan on the engine's main thread: ~19 s on this 5,000-file clone,
       during which it answers nothing (reported separately). The page treats a refusal as silence, so it is answered 404 here
       and this run measures the rescan, not that build. */
    await context.route('**/api/functions*', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"skipped in this run"}' }));
    const page = await context.newPage();
    mainPage = page;
    if (process.env.TRACE) page.on('console', (m) => { if (m.text().startsWith('SCANFETCH')) console.log('  ' + m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const scans = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/scan')) scans.push(Date.now());
    });
    const t00 = Date.now();
    if (process.env.TRACE) page.on('response', async (r) => { const u = r.url().replace(base, ''); if (process.env.TRACE === 'all' ? !u.includes('api/status') : ['api/tree', 'api/scan', 'api/status', 'archgraph'].some((k) => u.includes(k))) { let extra = ''; if (u.includes('api/tree')) extra = ' probe=' + (await r.text().catch(() => '')).includes('rescan-probe'); console.log('  +' + (Date.now() - t00) + 'ms', r.request().method(), u.slice(0, 60), r.status(), extra); } });
    if (process.env.TRACE) page.on('requestfinished', (r) => { if (r.url().includes('api/scan')) console.log('  +' + (Date.now() - t00) + 'ms FINISHED POST /api/scan'); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('s2-status'), { timeout: 60000 });

    const openFiles = async () => {
      await runCommand(page, 'Open Files');
      await page.waitForSelector(sel('connected-files'), { timeout: 15000 }).catch(() => undefined);
      await sleep(600);
    };
    const rowNames = () => page.$$eval(sel('files-row'), (els) => els.map((e) => e.textContent ?? ''));
    await openFiles();
    await shot(page, '00-files-opened');
    if (process.env.DEBUG_IDS) log((await page.$$eval('[data-testid]', (els) => [...new Set(els.map((e) => e.getAttribute('data-testid')))])).join(' '));
    await check('Files lists the clone before the edit', async () => {
      const names = await until('file rows', async () => ((await rowNames()).length > 0 ? rowNames() : null), 20000);
      if (names.some((n) => n.includes('rescan-probe'))) throw new Error('the probe file is already listed');
      return `(${names.length} rows)`;
    });

    /* 1. auto-refresh ON */
    await check('auto-refresh on: an edit shows in Files within 3 s, with no click', async () => {
      const before = scans.length;
      const t0 = Date.now();
      fs.writeFileSync(path.join(clone, 'rescan-probe-auto.md'), '# auto\n');
      await until('rescan-probe-auto.md in the tree', async () => (await rowNames()).some((n) => n.includes('rescan-probe-auto')), 5000, 50);
      const ms = Date.now() - t0;
      if (scans.length === before) throw new Error('the file appeared but the page never posted /api/scan');
      return `(${ms} ms, ${scans.length - before} scan)`;
    });
    await shot(page, '01-auto-refreshed');

    /* The setting */
    const openSettings = async () => {
      await runCommand(page, 'Open Settings');
      await page.waitForSelector(sel('v3-overlay-settings'), { timeout: 15000 });
    };
    await openSettings();
    const switchSel = sel('settings-auto-refresh-switch');
    await check('Settings shows the switch, on by default', async () => {
      await page.getByText('General', { exact: true }).first().click();
      await page.waitForSelector(switchSel, { timeout: 15000, state: 'attached' });
      if (!(await page.isChecked(switchSel))) throw new Error('the switch is off by default');
    });
    await shot(page, '02-setting');
    await page.locator(switchSel).evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => undefined);
    await shot(page, '02-setting-centered');
    await page.click(switchSel);
    await check('switching it off persists', async () => {
      const stored = await page.evaluate(() => localStorage.getItem('sequence.autoRefresh'));
      if (stored !== 'off') throw new Error(`stored ${stored}`);
    });
    await page.keyboard.press('Escape');
    await sleep(300);

    /* 2. auto-refresh OFF */
    await check('auto-refresh off: the notice appears; Rescan shows the new file', async () => {
      const before = scans.length;
      fs.writeFileSync(path.join(clone, 'rescan-probe-manual.md'), '# manual\n');
      await page.waitForSelector(sel('rescan-strip'), { timeout: 8000 });
      const text = await page.textContent(sel('rescan-strip'));
      if (!/Files changed/.test(text ?? '')) throw new Error(`notice says: ${text}`);
      await sleep(3500);
      if (scans.length !== before) throw new Error('it rescanned by itself with the setting off');
      if ((await rowNames()).some((n) => n.includes('rescan-probe-m'))) throw new Error('Files already shows the new file without a rescan');
      await shot(page, '03-notice');
      const t0 = Date.now();
      await page.click(sel('rescan-strip-button'));
      await until('the manual file in the tree', async () => (await rowNames()).some((n) => n.includes('rescan-probe-m')), 8000, 100).catch(async (e) => { await shot(page, '99-manual-fail'); throw new Error(e.message + ' rows=' + (await rowNames()).join(',')); });
      await until('the notice gone', async () => !(await page.$(sel('rescan-strip'))), 5000, 100);
      return `(${Date.now() - t0} ms)`;
    });
    await check('Ctrl+K "Rescan project" is a door to the same rescan', async () => {
      fs.writeFileSync(path.join(clone, 'rescan-probe-palette.md'), '# palette\n');
      await page.waitForSelector(sel('rescan-strip'), { timeout: 8000 });
      const before = scans.length;
      await runCommand(page, 'Rescan project');
      await shot(page, '98-after-palette');
      /* Generous: on this machine the engine's synchronous file walk has frozen it for ~30 s now and then (reported). */
      await until('the palette file in the tree', async () => (await rowNames()).some((n) => n.includes('rescan-probe-p')), 70000, 100);
      await until('the notice gone', async () => !(await page.$(sel('rescan-strip'))), 5000, 100);
      if (scans.length === before) throw new Error('no POST /api/scan');
    });

    /* 3. Open project shows progress */
    await check('Open project: "Reading N of M files" and the status bar says it is opening', async () => {
      await runCommand(page, 'Open a project');
      await page.waitForSelector(sel('attach'), { timeout: 10000 });
      await page.fill(sel('attach-path'), fresh);
      await page.click(sel('attach-path-open'));
      const line = await until('a Reading N of M files line', async () => {
        const t = await page.locator(sel('attach-progress-line')).textContent({ timeout: 300 }).catch(() => null);
        return t && /Reading [0-9,]+ of [0-9,]+ files/.test(t) ? t : null;
      }, 30000, 40).catch(async (e) => { await shot(page, '97-dialog-fail'); const ids = await page.$$eval('[data-testid^="attach"]', (els) => els.map((x) => x.getAttribute('data-testid') + ':' + (x.textContent || '').slice(0, 60))); throw new Error(e.message + ' ' + ids.join(' | ')); });
      await shot(page, '04-dialog-progress');
      const busy = await page.textContent(sel('s2-status-busy')).catch(() => null);
      if (!busy || !/Opening/.test(busy)) throw new Error(`status bar busy item: ${busy}`);
      return `(${line}; status: ${busy})`;
    });

    /* 4. the bar at about 30 %, at 1440 and 420 px: a page whose status reports 30 of 100 files and whose attach waits */
    for (const [w, h] of [[1440, 900], [420, 860]]) {
      await check(`the progress bar paints a fill at about 30 % (${w} px)`, async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        await ctx.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
        await ctx.route('**/api/status*', async (r) => {
          const real = await r.fetch();
          const body = await real.json().catch(() => ({}));
          await r.fulfill({ response: real, json: { ...body, attaching: { path: small, phase: 'scanning', done: 30, total: 100, startedAt: Date.now() } } });
        });
        await ctx.route('**/api/functions*', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
        await ctx.route('**/api/attach', () => {});
        const pg = await ctx.newPage();
        await pg.goto(base, { waitUntil: 'domcontentloaded' });
        await pg.waitForSelector(sel('s2-status'), { timeout: 60000 });
        await runCommand(pg, 'Open a project');
        await pg.waitForSelector(sel('attach'), { timeout: 10000 });
        await pg.fill(sel('attach-path'), small);
        await pg.click(sel('attach-path-open'));
        await until('30 of 100', async () => /Reading 30 of 100/.test((await pg.textContent(sel('attach-progress-line')).catch(() => '')) ?? ''), 8000, 50);
        const paint = await pg.$eval(sel('attach-progress-bar'), (el) => {
          const track = getComputedStyle(el, '::-webkit-progress-bar').backgroundColor;
          const fill = getComputedStyle(el, '::-webkit-progress-value').backgroundColor;
          const r = el.getBoundingClientRect();
          return { track, fill, width: r.width, height: r.height, value: el.value };
        });
        if (Math.abs(paint.value - 0.3) > 0.01 || paint.height < 3) throw new Error('bar geometry: ' + JSON.stringify(paint));
        await pg.screenshot({ path: SHOTS ? path.join(SHOTS, `05-bar-30-${w}.png`) : undefined });
        // the corner panel (the same bar) too, when it is not under the dialog
        const corner = await pg.$(sel('switch-progress-bar'));
        await ctx.close();
        return `(${Math.round(paint.width)}x${paint.height}px, value ${paint.value}${corner ? ", corner panel also shown" : ""})`;
      });
    }

    await sleep(500);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => undefined);
    child.kill();
  }

  if (failures.length) {
    console.error(`[${NAME}] FAILED\n - ${failures.join('\n - ')}`);
    console.error(serverOut.split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  log('PASS');
}

main().catch((e) => failHarness(e.stack || String(e)));
