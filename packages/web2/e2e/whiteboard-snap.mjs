/* ══════════════════════════════════════════════════════════════════════════
   DRAW A ROUGH BOX WITH A MOUSE, BE OFFERED A CLEAN ONE
   packages/web2/e2e/whiteboard-snap.mjs

   jsdom can click, but it cannot move a real mouse through a real layout, so the
   claims that matter to somebody drawing are checked here, in Chromium, with
   `page.mouse` (real pointer events with real timestamps):

     1. a box drawn in several strokes is OFFERED once, as one box, after the pen
        rests; nothing is changed until the person says so;
     2. Enter (or a click) takes it, and Ctrl+Z puts the raw strokes back;
     3. handwriting beside it is never offered anything;
     4. the offer is readable and reachable: inside the canvas, clear of the tool
        row, its buttons at least 24 px, light and dark;
     5. auto tidies by itself, off leaves everything alone.

   The strokes are a mouse's, not a pen's: whole-pixel positions, a wandering
   hand, uneven speed. With SHOTS_DIR set it also saves the three pictures the
   board-models study shows (a rough sketch, the suggestion, the result) in light
   and dark.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

import { execFileSync } from 'node:child_process';
import os from 'node:os';

import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[whiteboard-snap] ERROR: the analyzer is not built, nothing to scan');
    process.exit(2);
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-snap-e2e-')), 'archgraph.json');
  execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'], cwd: REPO });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
const graph = scanRealRepo();
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

const SHOTS = process.env.SHOTS_DIR ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const WB = { tab: 's2-tab-whiteboard', canvas: 'wb-canvas', item: 'wb-item', undo: 'wb-undo', offer: 'wb-snap-offer', done: 'wb-snap-done' };

/** A deterministic mouse hand. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function walk(outline, px, jitter, seed) {
  const rand = rng(seed);
  const segs = outline.slice(1).map((b, i) => ({ a: outline[i], b, len: Math.hypot(b.x - outline[i].x, b.y - outline[i].y) }));
  const total = segs.reduce((n, s) => n + s.len, 0);
  const out = [];
  for (let d = 0; d <= total; d += px * (0.6 + 0.8 * rand())) {
    let acc = 0;
    for (const s of segs) {
      if (d <= acc + s.len || s === segs[segs.length - 1]) {
        const u = s.len > 0 ? Math.min(1, (d - acc) / s.len) : 0;
        out.push({
          x: Math.round(s.a.x + (s.b.x - s.a.x) * u + Math.sin(d / 40 + seed) * 2 + (rand() - 0.5) * 2 * jitter),
          y: Math.round(s.a.y + (s.b.y - s.a.y) * u + Math.cos(d / 33 + seed) * 2 + (rand() - 0.5) * 2 * jitter),
        });
        break;
      }
      acc += s.len;
    }
  }
  return out;
}

await suite('whiteboard-snap', async ({ page, base, check }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(base, { waitUntil: 'load' });
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem('sequence.whiteboard.snap');
      window.localStorage.removeItem('sequence.boards.editlog');
    } catch {
      /* private window */
    }
  });
  await page.waitForSelector(sel(WB.tab), { timeout: 20000 });
  await page.click(sel(WB.tab));
  await settle(page);
  await page.waitForSelector(sel(WB.canvas), { timeout: 15000 });
  await page.click('[data-testid="wb-tool-draw"]');
  const canvas = await page.locator(sel(WB.canvas)).boundingBox();
  if (!canvas) throw new Error('harness: the whiteboard canvas has no box');
  const ox = canvas.x + 60;
  const oy = canvas.y + 90;
  const P = (x, y) => ({ x: ox + x, y: oy + y });

  const stroke = async (pts, gap = 14) => {
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const p of pts.slice(1)) {
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(gap);
    }
    await page.mouse.up();
  };
  const sidesOf = (x, y, w, h) => [
    [P(x, y), P(x + w, y + 2)],
    [P(x + w, y + 2), P(x + w - 2, y + h)],
    [P(x + w - 2, y + h), P(x + 3, y + h - 2)],
    [P(x + 3, y + h - 2), P(x, y)],
  ];
  const drawBoxInSides = async (x, y, w, h, seed) => {
    for (const [i, side] of sidesOf(x, y, w, h).entries()) {
      await stroke(walk(side, 9, 0.8, seed + i));
      await page.waitForTimeout(160);
    }
  };
  const handwrite = async (x, y) => { // x, y relative to the board origin, like P
    for (let i = 0; i < 6; i++) {
      const lx = x + i * 17;
      const letter = i % 2 === 0
        ? [P(lx, y), P(lx + 9, y), P(lx + 9, y + 18), P(lx, y + 18), P(lx, y + 1)]
        : [P(lx + 2, y - 2), P(lx + 4, y + 20)];
      await stroke(walk(letter, 3, 0.4, 70 + i), 10);
      await page.waitForTimeout(110);
    }
  };
  const kinds = () => page.locator(sel(WB.item)).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  const shot = async (name) => {
    if (!SHOTS) return;
    const box = await board().boundingBox();
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: box ?? undefined });
  };
  const board = () => page.locator('[data-testid="whiteboard"]');
  const clearBoard = async () => {
    /* Clear board lives in the pill's More menu. */
    await page.click('[data-testid="wb-more"]');
    await page.click('[data-testid="wb-more-clear"]').catch(() => undefined);
    await page.keyboard.press('Escape');
    await settle(page);
  };

  await check('a box drawn in four strokes is offered ONCE, as one box, and the ink is untouched', async () => {
    await drawBoxInSides(40, 40, 300, 170, 5);
    await page.waitForTimeout(250);
    is(await page.locator(sel(WB.offer)).count(), 0, 'no offer while the pen is still working (and none to turn a side into a line)');
    await page.waitForSelector(sel(WB.offer), { timeout: 4000 });
    is(await page.locator(sel(WB.offer)).count(), 1, 'one offer');
    is(await page.locator(sel(WB.offer)).getAttribute('data-shape'), 'rect', 'it offers a box');
    is((await kinds()).join(','), 'stroke,stroke,stroke,stroke', 'the four strokes are still there, as drawn');
  });

  await check('the offer is readable and reachable: inside the canvas, clear of the tool pill, buttons 24 px or more', async () => {
    const chip = await page.locator(sel(WB.offer)).boundingBox();
    const tools = await page.locator('[data-testid="wb-tools"]').boundingBox();
    const cv = await page.locator(sel(WB.canvas)).boundingBox();
    if (!chip || !tools || !cv) throw new Error('harness: missing a box');
    atLeast(tools.y + 1, chip.y + chip.height, 'the offer sits above the tool pill (it is at the bottom of the board)');
    atLeast(chip.x, cv.x, 'the offer is inside the canvas on the left');
    atLeast(cv.x + cv.width, chip.x + chip.width, 'the offer is inside the canvas on the right');
    const go = await page.locator('[data-testid="wb-snap-accept"]').boundingBox();
    const x = await page.locator('[data-testid="wb-snap-dismiss"]').boundingBox();
    atLeast(go.height, 24, 'the accept button is at least 24 px tall');
    atLeast(x.width, 24, 'the dismiss button is at least 24 px wide');
    atLeast(x.height, 24, 'the dismiss button is at least 24 px tall');
  });

  await check('Enter takes it: one box replaces the four strokes; Ctrl+Z gives all four back', async () => {
    await page.keyboard.press('Enter');
    await settle(page);
    is((await kinds()).join(','), 'shape', 'one clean shape');
    is(await page.locator(sel(WB.done)).count(), 1, 'it says it tidied, with an Undo');
    await page.keyboard.press('Control+z');
    await settle(page);
    is((await kinds()).join(','), 'stroke,stroke,stroke,stroke', 'the raw strokes are back');
  });

  await check('handwriting beside a box is never offered', async () => {
    await page.keyboard.press('Enter').catch(() => undefined);
    await clearBoard();
    await drawBoxInSides(40, 40, 300, 170, 15);
    await page.waitForSelector(sel(WB.offer), { timeout: 4000 });
    await page.keyboard.press('Enter');
    await settle(page);
    await handwrite(90, 110);
    await page.waitForTimeout(1300);
    is(await page.locator(sel(WB.offer)).count(), 0, 'letters are not offered anything');
    const k = await kinds();
    is(k.filter((x) => x === 'stroke').length, 6, 'all six letters are still ink');
  });

  await check('a trackpad hand (more jitter) and a fast flick still get the offer', async () => {
    for (const [name, px, jitter] of [['trackpad', 7, 1.6], ['fast mouse', 24, 0.7]]) {
      await clearBoard();
      const rect = [P(60, 60), P(360, 62), P(358, 220), P(62, 218), P(64, 64)];
      await stroke(walk(rect, px, jitter, 91), 8);
      await page.waitForSelector(sel(WB.offer), { timeout: 4000 }).catch(() => undefined);
      is(await page.locator(sel(WB.offer)).count(), 1, `${name}: the box is offered`);
    }
  });

  await check('Escape keeps the ink exactly as drawn', async () => {
    await page.keyboard.press('Escape');
    await settle(page);
    is(await page.locator(sel(WB.offer)).count(), 0, 'the offer is gone');
    is((await kinds()).join(','), 'stroke', 'the stroke stays');
  });

  await check('auto tidies by itself and Ctrl+Z gives the stroke back; off never offers', async () => {
    await page.evaluate(() => {
      window.localStorage.setItem('sequence.whiteboard.snap', 'auto');
      window.dispatchEvent(new Event('sequence:whiteboard-prefs'));
    });
    await clearBoard();
    await stroke(walk([P(60, 60), P(360, 62), P(358, 220), P(62, 218), P(64, 64)], 9, 0.8, 93));
    await page.waitForSelector(sel(WB.done), { timeout: 4000 });
    is((await kinds()).join(','), 'shape', 'auto made the box');
    await page.keyboard.press('Control+z');
    await settle(page);
    is((await kinds()).join(','), 'stroke', 'one Ctrl+Z gave the stroke back');
    await page.evaluate(() => {
      window.localStorage.setItem('sequence.whiteboard.snap', 'off');
      window.dispatchEvent(new Event('sequence:whiteboard-prefs'));
    });
    await clearBoard();
    await stroke(walk([P(60, 60), P(360, 62), P(358, 220), P(62, 218), P(64, 64)], 9, 0.8, 94));
    await page.waitForTimeout(1300);
    is(await page.locator(sel(WB.offer)).count(), 0, 'off: nothing offered');
    is((await kinds()).join(','), 'stroke', 'off: the stroke stays');
    await page.evaluate(() => window.localStorage.removeItem('sequence.whiteboard.snap'));
    await page.evaluate(() => window.dispatchEvent(new Event('sequence:whiteboard-prefs')));
  });

  /* THE THREE PICTURES, light then dark: a rough sketch, the suggestion, the result. */
  for (const theme of ['light', 'dark']) {
    await check(`pictures (${theme}): sketch, suggestion, result`, async () => {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await clearBoard();
      await page.mouse.click(canvas.x + 5, canvas.y + canvas.height - 5).catch(() => undefined);
      /* A first box, already tidied, and a second drawn rough in four strokes beside handwriting. */
      await stroke(walk([P(10, 20), P(190, 22), P(188, 130), P(12, 128), P(14, 24)], 9, 0.7, 101));
      await page.waitForSelector(sel(WB.offer), { timeout: 4000 });
      await page.keyboard.press('Enter');
      await settle(page);
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await handwrite(40, 60);
      await drawBoxInSides(300, 10, 230, 140, 111);
      await page.waitForTimeout(200);
      await shot(`sketch-${theme}`);
      await page.waitForSelector(sel(WB.offer), { timeout: 4000 });
      await page.waitForTimeout(350);
      await shot(`suggestion-${theme}`);
      await page.keyboard.press('Enter');
      await settle(page);
      await page.waitForTimeout(300);
      await shot(`snapped-${theme}`);
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    });
  }
}, { routes: { '/archgraph.json': graph, ...Object.fromEntries(REFUSED.map((r) => [r, null])) } });
