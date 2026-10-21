#!/usr/bin/env node
/*
 * BOARD REOPEN: what a reader sees on the way back to the Architecture tab.
 *
 *   node tools/measure/board-reopen.mjs [--runs 8] [--throttle 1] [--out f.json]
 *
 * Boots the built app on a throwaway copy of the shopfront fixture, opens Files, then clicks Architecture again and samples the
 * board every animation frame for 2 s. A frame's signature is the rounded rectangle of every card; the report is how many different
 * arrangements were on screen before the final one (0 is the goal: the cards stay where they were), how many frames showed a pile
 * (three or more cards on top of each other), and the click-to-final-arrangement time. Calls no model.
 */
import fs from 'node:fs';
import { arg, launch, median, r1, startApp } from './lib/benchApp.mjs';

const RUNS = Number(arg('--runs', '8'));
const THROTTLE = Number(arg('--throttle', '1'));
const OUT = arg('--out', '');

const app = await startApp();
const rows = [];
try {
  for (let run = 0; run < RUNS; run++) {
    const { browser, page, cdp } = await launch({ throttle: THROTTLE });
    try {
      await page.goto(app.base);
      await page.waitForSelector('[data-testid="board-node"]', { timeout: 90000 });
      await page.waitForFunction(() => document.querySelector('[data-layout]')?.getAttribute('data-layout') === 'idle', null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      await page.click('[data-testid="s2-tab-files"]');
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        window.__frames = [];
        const sig = () => {
          const rects = [...document.querySelectorAll('[data-testid="board-node"]')].map((n) => n.getBoundingClientRect()).map((r) => [Math.round(r.left / 4), Math.round(r.top / 4)]);
          const seen = new Map();
          for (const [x, y] of rects) seen.set(`${x},${y}`, (seen.get(`${x},${y}`) ?? 0) + 1);
          return { sig: rects.map((r) => r.join(':')).join('|'), nodes: rects.length, stacked: Math.max(0, ...seen.values()) };
        };
        const t0 = performance.now();
        window.__t0 = t0;
        const tick = () => { window.__frames.push({ t: performance.now() - t0, ...sig() }); if (performance.now() - t0 < 2000) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      await page.click('[data-testid="s2-tab-architecture"]');
      await page.waitForTimeout(2300);
      const frames = await page.evaluate(() => window.__frames);
      const withNodes = frames.filter((f) => f.nodes > 0);
      const final = withNodes[withNodes.length - 1];
      const lastChange = withNodes.findLastIndex((f) => f.sig !== final.sig);
      const before = withNodes.slice(0, lastChange + 1);
      rows.push({
        run,
        arrangementsBeforeFinal: new Set(before.map((f) => f.sig)).size,
        pileFrames: withNodes.filter((f) => f.stacked >= 3).length,
        framesNotFinal: before.length,
        msToFinal: r1(before.length ? withNodes[lastChange + 1].t : withNodes[0].t),
      });
    } finally {
      await cdp.detach().catch(() => {});
      await browser.close();
    }
  }
} finally {
  app.stop();
}
const col = (k) => rows.map((r) => r[k]);
const summary = {
  runs: rows.length,
  throttle: THROTTLE,
  arrangementsBeforeFinalMedian: median(col('arrangementsBeforeFinal')),
  arrangementsBeforeFinalMax: Math.max(...col('arrangementsBeforeFinal')),
  pileFramesMedian: median(col('pileFrames')),
  pileFramesMax: Math.max(...col('pileFrames')),
  framesNotFinalMedian: median(col('framesNotFinal')),
  msToFinalMedian: median(col('msToFinal')),
};
console.log(JSON.stringify(summary));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
