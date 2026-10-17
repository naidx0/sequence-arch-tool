#!/usr/bin/env node
/*
 * SURFACE LOAD — how each of the seven surfaces loads, what it costs, and whether it fits.
 *
 * Drives the SHIPPED app (a running `sequence app`) in a real Chromium and, for boot and then for
 * each workspace tab (chat, files, architecture, whiteboard, ai-canvas, terminal, browser):
 *   - time from click to the surface settling (no new DOM mutations for 300 ms, network quiet)
 *   - the API requests the click caused, and any request made more than once
 *   - console errors and failed requests
 *   - whether every open surface still fits the window (the owner: "surfaces should always fit on
 *     screen … you literally can't see browser")
 * Then it opens all seven together at three window widths and reports the narrowest surface.
 *
 *   node tools/measure/surface-load.mjs --url http://127.0.0.1:4173 [--out dir] [--runs 3]
 *
 * Needs playwright-core (already a dev dependency) and a Chromium (PLAYWRIGHT_BROWSERS_PATH or
 * CHROMIUM_PATH). Calls no model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/* playwright-core is a dev dependency of packages/web2; resolve it from there (or the cwd). */
const WEB2_PKG = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'packages', 'web2', 'package.json');
const require = createRequire(fs.existsSync(WEB2_PKG) ? WEB2_PKG : path.join(process.cwd(), 'package.json'));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL_ = arg('--url', 'http://127.0.0.1:4173');
const OUT = arg('--out', path.join(process.cwd(), 'surface-load-out'));
const RUNS = Number(arg('--runs', '3'));
const TABS = ['chat', 'files', 'architecture', 'whiteboard', 'ai-canvas', 'terminal', 'browser'];
const LABELS = { chat: 'Chat', files: 'Files', architecture: 'Architecture', whiteboard: 'Whiteboard', 'ai-canvas': 'AI Canvas', terminal: 'Terminal', browser: 'Browser' };
/* The v3 toolbar (0.1.2+) names tabs by aria-label; later builds may add workspace-tab-<id>. */
const tabSel = (id) => `[data-testid="workspace-tab-${id}"], nav[aria-label="Workspace"] button[aria-label="${LABELS[id]}"]`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(path.join(root, 'chromium')) && fs.statSync(path.join(root, 'chromium')).isFile()) return path.join(root, 'chromium');
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function settle(page, quietMs = 300, capMs = 15000) {
  const t0 = Date.now();
  await page.evaluate(
    ({ quietMs, capMs }) =>
      new Promise((resolve) => {
        let last = performance.now();
        const mo = new MutationObserver(() => (last = performance.now()));
        mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        const start = performance.now();
        const tick = () => {
          const now = performance.now();
          if (now - last >= quietMs || now - start > capMs) {
            mo.disconnect();
            resolve(now - start);
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { quietMs, capMs },
  );
  return Date.now() - t0 - quietMs;
}

async function fitReport(page) {
  return page.evaluate((tabs) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = [];
    for (const id of tabs) {
      const el =
        document.querySelector(`[data-testid="surface-${id}"]`) ||
        document.querySelector(`[data-surface="${id}"]`) ||
        document.querySelector(`[data-pane="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out.push({ id, x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), offscreen: r.right > vw + 1 || r.x < -1 || r.width < 40, vw, vh });
    }
    const docOverflow = document.documentElement.scrollWidth > vw + 1;
    return { panes: out, docOverflow, vw };
  }, TABS);
}

async function main() {
  const { chromium } = require('playwright-core');
  const exe = findChromium();
  if (!exe) {
    console.error('surface-load: no Chromium found (set CHROMIUM_PATH)');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const reqs = [];
    const errors = [];
    const failed = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) reqs.push({ t: Date.now(), m: r.method(), p: u.pathname });
    });
    page.on('console', (m) => m.type() === 'error' && errors.push({ t: Date.now(), text: m.text().slice(0, 300) }));
    page.on('pageerror', (e) => errors.push({ t: Date.now(), text: `pageerror: ${String(e.message).slice(0, 300)}` }));
    page.on('requestfailed', (r) => failed.push({ t: Date.now(), url: r.url(), why: r.failure()?.errorText }));

    const t0 = Date.now();
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    const dcl = Date.now() - t0;
    await page.waitForSelector('[data-testid="workspace-tabs"], nav[aria-label="Workspace"]', { timeout: 30000 }).catch(() => null);
    const tabsAt = Date.now() - t0;
    const bootSettle = await settle(page);
    const boot = {
      domContentLoadedMs: dcl,
      tabsVisibleMs: tabsAt,
      settledMs: Date.now() - t0,
      apiRequests: reqs.length,
      byPath: Object.entries(reqs.reduce((a, r) => ((a[`${r.m} ${r.p}`] = (a[`${r.m} ${r.p}`] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]),
      errors: errors.length,
    };
    await page.screenshot({ path: path.join(OUT, `r${run}-boot.png`) });

    const surfaces = [];
    for (const id of TABS) {
      const before = reqs.length;
      const errBefore = errors.length;
      const tab = page.locator(tabSel(id));
      const present = (await tab.count()) > 0;
      if (!present) {
        surfaces.push({ id, present: false });
        continue;
      }
      const wasOpen = (await tab.first().getAttribute('aria-pressed').catch(() => null)) === 'true';
      if (wasOpen && id !== 'chat') {
        // already open at boot: close it first so the open is measured from a click like the others
        await tab.first().click({ timeout: 5000 }).catch(() => {});
        await settle(page);
      }
      const c0 = Date.now();
      await tab.first().click({ timeout: 5000 }).catch((e) => errors.push({ t: Date.now(), text: `click ${id}: ${e.message.slice(0, 200)}` }));
      await settle(page);
      const ms = Date.now() - c0 - 300;
      const mine = reqs.slice(before);
      const dup = Object.entries(mine.reduce((a, r) => ((a[r.p] = (a[r.p] ?? 0) + 1), a), {})).filter(([, n]) => n > 1);
      const pressed = await tab.first().getAttribute('aria-pressed').catch(() => null);
      const selected = await tab.first().getAttribute('aria-selected').catch(() => null);
      surfaces.push({ id, present: true, openMs: ms, requests: mine.map((r) => `${r.m} ${r.p}`), duplicateRequests: dup, newErrors: errors.slice(errBefore).map((e) => e.text), state: pressed ?? selected });
      await page.screenshot({ path: path.join(OUT, `r${run}-${id}.png`) });
    }
    const fits = {};
    for (const w of [1440, 1280, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await settle(page);
      fits[w] = await fitReport(page);
      await page.screenshot({ path: path.join(OUT, `r${run}-all-${w}.png`) });
    }
    runs.push({ boot, surfaces, fits, errors, failed });
    await ctx.close();
  }
  await browser.close();

  const summary = {
    url: URL_,
    runs: RUNS,
    boot: {
      tabsVisibleMsMedian: median(runs.map((r) => r.boot.tabsVisibleMs)),
      settledMsMedian: median(runs.map((r) => r.boot.settledMs)),
      apiRequestsMedian: median(runs.map((r) => r.boot.apiRequests)),
      repeatedAtBoot: runs[0].boot.byPath.filter(([, n]) => n > 1),
    },
    surfaces: TABS.map((id) => {
      const rs = runs.map((r) => r.surfaces.find((s) => s.id === id)).filter(Boolean);
      return {
        id,
        present: rs.every((s) => s.present),
        openMsMedian: median(rs.filter((s) => s.present).map((s) => s.openMs)),
        requests: rs[0]?.requests ?? [],
        duplicateRequests: rs[0]?.duplicateRequests ?? [],
        errors: [...new Set(rs.flatMap((s) => s.newErrors ?? []))],
      };
    }),
    fits: runs[0].fits,
    failedRequests: runs.flatMap((r) => r.failed).slice(0, 20),
  };
  fs.writeFileSync(path.join(OUT, 'surface-load.json'), JSON.stringify({ summary, runs }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('surface-load failed:', e);
  process.exit(2);
});
