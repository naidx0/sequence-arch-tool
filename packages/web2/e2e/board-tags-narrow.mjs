#!/usr/bin/env node
/**
 * THE BOARD TAGS IN A NARROW PANE (0.1.5 review, finding 1).
 *
 * At window 1280 with the chat at 760 and Architecture, Whiteboard and Files open, each pane is about 240 px wide.
 * The Whiteboard's board-tag strip overflowed there (clientWidth 146, scrollWidth 196): the whiteboard tag's x was
 * half clipped and + was hidden. The architecture board folds its tags on its own width (board.css); the whiteboard's
 * strip did not fold at all, and the `data-many` fold does not fire with two tags.
 *
 * In the reader's seat, measured in a real browser on the real analyzer (fixture repo, throwaway user store):
 *   1. in the 240 px case, every board-tag strip on screen fits its box (scrollWidth <= clientWidth), and every
 *      control in it that is shown lies inside the strip, so nothing is cut;
 *   2. there the whiteboard's tags have folded to the one pill, and the pill opens the list of boards;
 *   3. CONTROL: in a wide whiteboard pane the tags are shown as tags (not folded), so the fold is not simply always on.
 *
 * Exit 0 pass (or skip: no Chromium), 1 product wrong, 2 harness broken.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';
import { sel } from './lib/harness.mjs';

const NAME = 'board-tags-narrow';
const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const FIXTURES = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures');
const SHOTS = process.env.SHOTS || null;

const log = (...args) => console.log(`[${NAME}]`, ...args);
const failHarness = (msg) => {
  console.error(`[${NAME}] ERROR: ${msg}`);
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

async function until(what, fn, ms = 20000, every = 150) {
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

/** Every board-tag strip on screen: its box, its scroll extent, and each shown control's edges. */
function measureStrips() {
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  return [...document.querySelectorAll('[data-testid="board-tabs"]')].filter(shown).map((strip) => {
    const r = strip.getBoundingClientRect();
    const pane = strip.closest('.s2-pane');
    const where = strip.closest('[data-testid="wb-boards"]') ? 'whiteboard' : 'architecture';
    const controls = [...strip.querySelectorAll('.btag, .btag-add, .btag-fold, .btag-main, .btag-x')]
      .filter((el) => shown(el) && !el.closest('.btag-fold-list'))
      .map((el) => {
        const e = el.getBoundingClientRect();
        return { what: el.getAttribute('data-testid') || el.className, l: Math.round(e.left), r: Math.round(e.right) };
      });
    const fold = strip.querySelector('[data-testid="board-tab-fold"]');
    return {
      where,
      pane: pane ? Math.round(pane.getBoundingClientRect().width) : null,
      l: Math.round(r.left),
      r: Math.round(r.right),
      sw: strip.scrollWidth,
      cw: strip.clientWidth,
      folded: !!fold && shown(fold),
      controls,
    };
  });
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

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-btags-')));
  const userDir = path.join(tmp, 'home', '.sequence');
  const repo = path.join(tmp, 'home', 'shopfront');
  fs.mkdirSync(userDir, { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'shopfront'), repo, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'agents.json'), JSON.stringify({ agents: [] }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [ANALYZER_CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
    cwd: REPO_ROOT,
    env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1', SEQUENCE_USER_DIR: userDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();

  const failures = [];
  let passes = 0;
  const check = async (label, fn) => {
    try {
      await fn();
      passes += 1;
      log('ok  ', label);
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      log('FAIL', label, '—', e.message);
    }
  };

  const browser = await chromium.launch(launchOptions(executablePath));
  try {
    await until('the server', async () => (await fetch(`${base}/api/acp/agents`)).ok, 30000, 250);

    /** A page at `width` with the chat column at `chat` (null: the default) and `ids` open, whiteboard in front. */
    async function open(width, chat, ids) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
      await context.addInitScript(
        ([c, tabs]) => {
          try {
            if (c) localStorage.setItem('v3.chatW', String(c));
            localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: ['chat', ...tabs].map((id) => ({ id, minimized: false })), active: 'whiteboard' }));
          } catch {
            /* defaults */
          }
        },
        [chat, ids],
      );
      const page = await context.newPage();
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await until('the whiteboard tags with the board index', async () => (await page.locator(`${sel('wb-boards')} ${sel('board-tab-new')}:not([disabled])`).count()) > 0, 30000);
      await until('the pane layout to settle', async () => {
        const a = JSON.stringify(await page.evaluate(measureStrips));
        await sleep(300);
        return a === JSON.stringify(await page.evaluate(measureStrips));
      }, 10000, 50);
      return { page, context };
    }

    /* ── 1 and 2: three surfaces beside a 760 px chat at 1280: about 240 px a pane ── */
    {
      const { page, context } = await open(1280, 760, ['architecture', 'whiteboard', 'files']);
      const strips = await page.evaluate(measureStrips);
      log('narrow', JSON.stringify(strips));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${NAME}-1280-760.png`) });
      const wb = strips.find((s) => s.where === 'whiteboard');
      await check('the whiteboard pane is the narrow one this is about (at most 320 px)', async () => {
        if (!wb) throw new Error('no whiteboard strip on screen');
        if (!(wb.pane <= 320)) throw new Error(`pane ${wb.pane} px`);
      });
      for (const s of strips) {
        await check(`${s.where}: the tag strip fits its box (scrollWidth ${s.sw} <= clientWidth ${s.cw})`, async () => {
          if (s.sw > s.cw + 1) throw new Error(`overflows by ${s.sw - s.cw} px`);
        });
        await check(`${s.where}: every shown tag control lies inside the strip`, async () => {
          const cut = s.controls.filter((c) => c.l < s.l - 1 || c.r > s.r + 1);
          if (cut.length) throw new Error(cut.map((c) => `${c.what} ${c.l}-${c.r} vs ${s.l}-${s.r}`).join('; '));
        });
      }
      await check('the whiteboard tags folded to the one pill, and it lists the boards', async () => {
        if (!wb?.folded) throw new Error('not folded');
        await page.locator(`${sel('wb-boards')} ${sel('board-tab-fold')}`).click();
        const list = page.locator(`${sel('wb-boards')} ${sel('board-tab-fold-list')}`);
        await until('the boards list', async () => (await list.count()) > 0, 5000);
        const rows = await list.locator('[role="menuitemradio"]').count();
        if (rows < 2) throw new Error(`${rows} boards listed`);
      });
      await context.close();
    }

    /* ── 3. CONTROL: a wide whiteboard pane shows its tags as tags ── */
    {
      const { page, context } = await open(1440, null, ['whiteboard']);
      const strips = await page.evaluate(measureStrips);
      log('wide', JSON.stringify(strips));
      const wb = strips.find((s) => s.where === 'whiteboard');
      await check('CONTROL: in a wide pane the whiteboard tags are not folded, and fit', async () => {
        if (!wb) throw new Error('no whiteboard strip on screen');
        if (wb.folded) throw new Error(`folded in a ${wb.pane} px pane`);
        if (!wb.controls.some((c) => c.what === 'board-tab-new')) throw new Error('+ not shown');
        if (wb.sw > wb.cw + 1) throw new Error(`overflows by ${wb.sw - wb.cw} px`);
      });
      await context.close();
    }
  } catch (e) {
    failures.push(`harness: ${e.stack ?? e.message}`);
    log('FAIL', 'the walk stopped:', e.message);
  } finally {
    await browser.close().catch(() => {});
    child.kill();
    await sleep(300);
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows may hold a file a moment longer */
    }
  }

  if (failures.length) {
    console.error(`\n[${NAME}] ${failures.length} FAILED, ${passes} passed`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(failures.some((f) => f.startsWith('harness:')) ? 2 : 1);
  }
  log(`${passes} checks passed`);
  process.exit(0);
}

await main();
