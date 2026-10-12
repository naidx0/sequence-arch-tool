#!/usr/bin/env node
/*
 * FIRST BOARD â€” how long from launch until a person sees the architecture board, and how many
 * clicks it takes.
 *
 * For each run it starts the built CLI (`sequence app --repo <dir>`) on a free port, opens a fresh
 * Chromium profile, and records:
 *   serverMs   spawn -> GET /api/status answers 200
 *   composerMs page navigation -> the chat composer is visible
 *   boardMs    page navigation -> the first board node is visible (after any clicks needed)
 *   layoutMs   page navigation -> the board's first layout is applied (data-layout laying-out -> idle)
 *   clicks     clicks the script had to make to reach the board (0 = lands on it)
 *   bootApi    /api requests made in the boot window: before the first click, or until the
 *              board's first layout is applied (see the window note in oneRun)
 *   bootRequests every request (any type) in the same window
 *   bootModules  script requests in the same window; bootJsBytes their exact response bytes
 *   bootJsKB   script bytes fetched in the same window
 *   dupApi     of those, requests made more than once for the same method + path
 * With --cold each run scans a fresh copy of the repo (no .sequence cache).
 *
 *   node tools/measure/first-board.mjs --repo <dir> [--runs 5] [--cold] [--out file.json]
 *
 * Calls no model. Needs playwright-core (a web2 dev dependency) and a Chromium.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './lib/isolatedEnv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const REPO = path.resolve(arg('--repo', path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront')));
const RUNS = Number(arg('--runs', '5'));
const COLD = process.argv.includes('--cold');
const OUT = arg('--out');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const NODE_SEL = '.react-flow__node';
const BOARD_TAB = '[data-testid="workspace-tab-architecture"], nav[aria-label="Workspace"] button[aria-label="Architecture"]';

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function copyRepo(src) {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-first-board-'));
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p) });
  return dst;
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function waitStatus(port, t0, capMs = 120000) {
  while (Date.now() - t0 < capMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (r.ok) return Date.now() - t0;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server never answered /api/status');
}

async function oneRun(browser, i) {
  const repo = COLD ? copyRepo(REPO) : REPO;
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-first-board-home-'));
  const t0 = Date.now();
  const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
    /* SEQUENCE_USER_DIR is what the analyzer reads; without it a run uses the real ~/.sequence. */
    env: isolatedEnv(process.env, { userDir: home }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    const serverMs = await waitStatus(port, t0);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const api = [];
    let requests = 0;
    /** What the window fetched, in order: the row says WHICH requests a count moved on. */
    const requestPaths = [];
    let clicked = false;
    /*
     * THE BOOT WINDOW ENDS WHEN THE BOARD'S FIRST LAYOUT IS APPLIED, not when
     * the first node is visible. The board paints a seed arrangement first and
     * ELK's answer later (a worker that imports elk.bundled, 1.4 MB). Ending at
     * "first node visible" raced that import: about 3 reads in 12 came in at
     * ~1,024,500 B and 1-3 modules. The board root's `data-layout` goes
     * 'laying-out' -> 'idle' (or 'failed') when the first layout has been
     * applied; an init script records that edge, and the window closes on it.
     * An event, not a timer and not network idle: idle is still a timeout,
     * and boot-extras preload on their own timer (ConnectedBoard, 1.2 s), so a
     * quiet period could include or exclude them depending on machine speed.
     *
     * Bytes are counted for every script REQUESTED inside the window, whenever
     * its response lands, so a slow response cannot fall out of the count.
     */
    const scripts = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (clicked) return;
      requests += 1;
      requestPaths.push(`${r.resourceType()} ${u.pathname}`);
      if (u.pathname.startsWith('/api/')) api.push(`${r.method()} ${u.pathname}`);
      if (r.resourceType() === 'script') scripts.push(r);
    });
    await page.addInitScript(() => {
      /* The edge itself (oldValue 'laying-out'), so an element born mid-layout counts too. */
      new MutationObserver((ms) => {
        for (const m of ms) {
          const v = m.target.getAttribute('data-layout');
          if (m.oldValue === 'laying-out' && (v === 'idle' || v === 'failed') && !window.__seqFirstLayout) window.__seqFirstLayout = v;
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-layout'], attributeOldValue: true });
    });
    const n0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="composer-field"]', { state: 'visible', timeout: 30000 }).catch(async (e) => {
      if (OUT) await page.screenshot({ path: OUT.replace(/\.json$/, '') + `-fail-${i}.png` });
      throw e;
    });
    const composerMs = Date.now() - n0;
    let clicks = 0;
    let boardMs = null;
    const landed = await page.waitForSelector(NODE_SEL, { state: 'visible', timeout: 4000 }).then(() => true, () => false);
    if (!landed) {
      clicked = true;
      const tab = page.locator(BOARD_TAB).first();
      if (await tab.count()) {
        await tab.click();
        clicks += 1;
        await page.waitForSelector(NODE_SEL, { state: 'visible', timeout: 60000 });
      }
    }
    if (await page.locator(NODE_SEL).first().isVisible().catch(() => false)) boardMs = Date.now() - n0;
    /* Boot ends when the first layout is applied (see the window note above). */
    const layout = await page
      .waitForFunction(() => window.__seqFirstLayout, null, { timeout: 60000 })
      .then((h) => h.jsonValue(), () => null);
    clicked = true;
    if (!layout) throw new Error('first-board: the board never finished its first layout (no data-layout laying-out -> idle edge)');
    const layoutMs = Date.now() - n0;
    const counts = {};
    for (const a of api) counts[a] = (counts[a] || 0) + 1;
    const dupApi = Object.entries(counts).filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
    const sizes = await Promise.all(
      scripts.map(async (r) => {
        const res = await r.response().catch(() => null);
        return res ? res.body().then((b) => b.length, () => 0) : 0;
      }),
    );
    const bootJsBytes = sizes.reduce((a, b) => a + b, 0);
    const bootJsKB = Math.round(bootJsBytes / 1024);
    await ctx.close();
    return { run: i, serverMs, composerMs, boardMs, layoutMs, layout, clicks, bootApi: api.length, bootRequests: requests, bootModules: scripts.length, bootJsBytes, bootJsKB, dupApi, landedOnBoard: landed, requestPaths };
  } finally {
    child.kill();
    /* the server can still be writing its shadow snapshot when it is killed (ENOTEMPTY on .sequence/snapshots/git);
       wait for it to exit, and let rmSync retry */
    await new Promise((r) => (child.exitCode !== null ? r() : (child.once('exit', r), setTimeout(r, 3000))));
    const rm = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };
    if (COLD) fs.rmSync(repo, rm);
    fs.rmSync(home, rm);
  }
}

const exe = findChromium();
if (!exe) {
  console.log('first-board: no Chromium found; set CHROMIUM_PATH. Skipping.');
  process.exit(0);
}
const browser = await chromium.launch({ executablePath: exe, headless: true });
const rows = [];
for (let i = 0; i < RUNS; i++) {
  const r = await oneRun(browser, i);
  rows.push(r);
  console.log(JSON.stringify(r));
}
await browser.close();
const summary = {
  repo: REPO,
  cold: COLD,
  runs: RUNS,
  serverMs: median(rows.map((r) => r.serverMs)),
  composerMs: median(rows.map((r) => r.composerMs)),
  boardMs: median(rows.map((r) => r.boardMs)),
  boardMsRange: [Math.min(...rows.map((r) => r.boardMs ?? Infinity)), Math.max(...rows.map((r) => r.boardMs ?? -Infinity))],
  layoutMs: median(rows.map((r) => r.layoutMs)),
  clicks: median(rows.map((r) => r.clicks)),
  bootApi: median(rows.map((r) => r.bootApi)),
  bootJsKB: median(rows.map((r) => r.bootJsKB)),
  bootJsBytes: median(rows.map((r) => r.bootJsBytes)),
  bootModules: median(rows.map((r) => r.bootModules)),
  bootRequests: median(rows.map((r) => r.bootRequests)),
  dupApi: rows[0]?.dupApi ?? [],
};
console.log('SUMMARY ' + JSON.stringify(summary));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
