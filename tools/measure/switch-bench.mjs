#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   SWITCH BENCH: how long a chat switch takes, click to settled paint
   tools/measure/switch-bench.mjs

   Builds a throwaway repo + isolated home, seeds N chats of M messages (each with prose, a list and
   a code block) through the real /api/sessions routes, boots the BUILT web2 in Chromium, and clicks
   through the rail. "Settled" = the clicked chat's last line is on screen and two animation frames
   have passed. Also reports boot time to an interactive composer and JS heap after opening K chats.

     node tools/measure/switch-bench.mjs --chats 10 --turns 500 --throttle 4 --switches 12 [--out f.json]

   Needs the built analyzer + web2. Calls no model.
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import { arg, launch, median, pct, r1, seedChats, startApp } from './lib/benchApp.mjs';

const CHATS = Number(arg('--chats', '10'));
const TURNS = Number(arg('--turns', '500'));
const THROTTLE = Number(arg('--throttle', '1'));
const SWITCHES = Number(arg('--switches', '12'));
const CODE = Number(arg('--code-lines', '14'));
const HOVER = Number(arg('--hover-ms', '250'));
const OUT = arg('--out', '');

const app = await startApp();
const ids = await seedChats(app.base, { chats: CHATS, turns: TURNS, codeLines: CODE });
const { browser, page, cdp } = await launch({ throttle: THROTTLE });
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

/* boot: navigation start to a focusable composer */
const tBoot = Date.now();
await page.goto(app.base);
await page.waitForSelector('[data-testid="s2-chat"] textarea', { state: 'visible', timeout: 60000 });
const bootMs = Date.now() - tBoot;
const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp?.startTime ?? null }; });
await page.waitForSelector('[data-testid="s2-session"]', { timeout: 30000 });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  window.__settle = (marker) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector('[aria-label="Chat transcript"]');
      if (el && el.textContent.includes(marker)) {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
      } else if (performance.now() - t0 > 20000) resolve(-1);
      else requestAnimationFrame(tick);
    };
    tick();
  });
});

const rows = page.locator('[data-testid="s2-session"] .s2-it-hit');
const titles = await page.locator('[data-testid="s2-session"] .s2-t').allInnerTexts();
const idxOf = (c) => titles.findIndex((t) => t.trim() === `Chat ${c}`);
const samples = { cold: [], warm: [] };
const seen = new Set();
const heap = [];
let longTasks = 0;
const order = [];
const N = Math.max(SWITCHES, Math.min(2 * CHATS, 40));
for (let i = 0; i < N; i++) order.push(i % CHATS);
for (const c of order) {
  const k = idxOf(c);
  const m0 = await metrics();
  /* click, then wait for the marker; the page measures from just before the click */
  /* a person's pointer rests on a row for a moment before the click */
  await rows.nth(k).hover();
  if (HOVER) await page.waitForTimeout(HOVER);
  const settle = page.evaluate((m) => window.__settle(m), `END-${c}`);
  await rows.nth(k).click();
  const ms = await settle;
  const m1 = await metrics();
  (seen.has(c) ? samples.warm : samples.cold).push({ ms, taskMs: (m1.TaskDuration - m0.TaskDuration) * 1000 });
  seen.add(c);
  await page.waitForTimeout(250);
}
const h = await cdp.send('Runtime.getHeapUsage');
const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
const out = {
  chats: CHATS, turns: TURNS, throttle: THROTTLE,
  bootMs, ...nav,
  coldSwitchMs: { n: samples.cold.length, p50: r1(median(samples.cold.map((s) => s.ms))), p95: r1(pct(samples.cold.map((s) => s.ms), 0.95)), taskP50: r1(median(samples.cold.map((s) => s.taskMs))) },
  warmSwitchMs: { n: samples.warm.length, p50: r1(median(samples.warm.map((s) => s.ms))), p95: r1(pct(samples.warm.map((s) => s.ms), 0.95)), taskP50: r1(median(samples.warm.map((s) => s.taskMs))) },
  heapMB: r1(h.usedSize / 1048576), domNodes: dom,
  failed: [...samples.cold, ...samples.warm].filter((s) => s.ms < 0).length,
};
console.log(JSON.stringify(out));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
await browser.close();
app.stop();
