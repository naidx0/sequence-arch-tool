#!/usr/bin/env node
/*
 * Record demo part 1: attach a repository and watch its architecture board get
 * built, then move across it at reading zoom so the cards and edge labels are
 * legible (the zoomed-out overview is what every other screenshot shows).
 *
 *   node tools/demo/record-build.mjs --url http://127.0.0.1:4190 --out <dir> [--repo shopfront]
 *
 * Start the app with NO repository, a neutral home folder holding only the demo
 * repository, and its own user store, so the folder picker and sidebar show
 * nothing personal:
 *   USERPROFILE=<home> HOME=<home> SEQUENCE_USER_DIR=<empty dir> sequence app --port 4190 --no-open
 *
 * Writes <out>/sequence-build.webm.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', '..', 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');
const { findChromium, launchOptions } = await import(url.pathToFileURL(path.join(HERE, '..', '..', 'packages', 'web2', 'e2e', 'lib', 'chromium.mjs')).href);

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const APP = arg('--url', 'http://127.0.0.1:4190');
const OUT = path.resolve(arg('--out', '.'));
const REPO = arg('--repo', 'shopfront');
const SIZE = { width: 1280, height: 800 };
fs.mkdirSync(OUT, { recursive: true });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(launchOptions(findChromium()));
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, colorScheme: 'dark' });
const page = await context.newPage();
const id = (t) => page.locator(`[data-testid="${t}"]`);

await page.goto(APP);
await id('shell').waitFor({ timeout: 60000 });
await pause(1200);

/* Give the board the room: narrow the chat column before the repository arrives. */
const rz = await id('v3-resize-chat').boundingBox();
if (rz) {
  await page.mouse.move(rz.x + rz.width / 2, rz.y + 300);
  await page.mouse.down();
  await page.mouse.move(rz.x - 340, rz.y + 300, { steps: 20 });
  await page.mouse.up();
}
await pause(800);

await page.getByRole('button', { name: 'Open repository' }).click();
await pause(1400);
const pick = page.getByRole('button').filter({ hasText: new RegExp(`^${REPO}`) }).first();
await pick.hover();
await pause(700);
await pick.click();
await id('board-node').first().waitFor({ timeout: 60000 });
await pause(2500);
await id('board-fit').click();
await pause(2000);

/* Pan by wheel so a card's centre lands in the board's centre, eased over
   `ms`. Measured on this board: a wheel delta of d moves the view by d / 2
   (React Flow's pan-on-scroll speed), so the whole move is planned up front
   rather than corrected step by step, which is what made the first cut wobble. */
async function centerOn(title, ms = 1600) {
  const board = await id('board').boundingBox();
  const cx = board.x + board.width / 2, cy = board.y + board.height / 2;
  await page.mouse.move(cx, cy);
  const b = await id('board-node-title').filter({ hasText: new RegExp(`^${title}`) }).first().boundingBox();
  const dx = (b.x + b.width / 2 - cx) * 2, dy = (b.y + b.height / 2 - cy) * 2;
  const n = Math.max(8, Math.round(ms / 33));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  let done = 0;
  for (let k = 1; k <= n; k++) {
    const f = ease(k / n) - done;
    done += f;
    await page.mouse.wheel(dx * f, dy * f);
    await pause(ms / n);
  }
}

await id('board-zoom-in').click(); // 100%: cards carry their kind, description and trace
await pause(1200);
await centerOn('Gateway');
await pause(1600);
await centerOn('Orders');
await pause(800);
await id('board-zoom-in').click(); // 200% on one card
await pause(2200);
await id('board-zoom-out').click();
await pause(700);
await centerOn('Payments');
await pause(1300);
await centerOn('Postgres');
await pause(1300);
await centerOn('Order Created');
await pause(1300);
await centerOn('Shipping');
await pause(1000);
await id('board-fit').click();
await pause(2200);

const video = page.video();
await context.close();
await browser.close();
const dest = path.join(OUT, 'sequence-build.webm');
fs.renameSync(await video.path(), dest);
console.log(`wrote ${dest}`);
