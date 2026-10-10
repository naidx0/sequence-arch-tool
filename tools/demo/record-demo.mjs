#!/usr/bin/env node
/*
 * Record a short demo of the running app: the map draws, a service is picked,
 * a question is asked and answered. For the project page on the owner's site.
 *
 *   node tools/demo/record-demo.mjs --url http://127.0.0.1:4190 --out <dir> [--question "..."]
 *
 * Start the app first on a neutral copy of the repository with its own user
 * store, so no real chat history or home path is in the frame:
 *   SEQUENCE_USER_DIR=<empty dir> sequence app --repo <copy> --port 4190 --no-open
 *
 * Writes <out>/sequence-demo.webm. Uses the machine's Chrome through playwright-core.
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
const QUESTION = arg('--question', 'How does an order reach payments and postgres?');
const SIZE = { width: 1280, height: 800 };
fs.mkdirSync(OUT, { recursive: true });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(launchOptions(findChromium()));
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, colorScheme: 'dark' });
const page = await context.newPage();

await page.goto(APP);
await page.locator('[data-testid="board-node"]').first().waitFor({ timeout: 60000 });
await pause(1500);
await page.getByRole('button', { name: 'Fit', exact: true }).click();
await pause(2000);
/* Click the card's title, where a person clicks; it sits over the card's hit target. */
await page.getByTestId('board-node-title').filter({ hasText: /^Orders$/ }).first().click();
await pause(2500);

const box = page.getByPlaceholder(/Ask about the architecture/);
await box.click();
await box.pressSequentially(QUESTION, { delay: 35 });
await pause(600);
await page.keyboard.press('Enter');

/* The answer streams; wait until the chat stops growing for 4 s, capped at 120 s. */
const chatText = () => page.evaluate(() => document.querySelector('[data-testid="shell-chat"]')?.innerText.length ?? 0);
let last = -1, stable = 0;
for (let t = 0; t < 120 && stable < 4; t++) {
  await pause(1000);
  const n = await chatText();
  stable = n === last && n > 0 ? stable + 1 : 0;
  last = n;
}
await pause(2500);

const canvas = page.getByRole('button', { name: /AI Canvas/ });
if (await canvas.count()) {
  await canvas.first().click();
  await pause(4000);
}

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const dest = path.join(OUT, 'sequence-demo.webm');
fs.renameSync(raw, dest);
console.log(`wrote ${dest}`);
