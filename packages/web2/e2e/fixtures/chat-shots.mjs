#!/usr/bin/env node
/* Screenshots of the chat fixture (dev server on :5199). Usage: node e2e/fixtures/chat-shots.mjs <mode> <name> [outdir] */
import fs from 'node:fs';
import { findChromium, launchOptions, loadPlaywright } from '../lib/chromium.mjs';

const [mode = 'done', name = 'transcript', out = '/mnt/project-files/sequence/cloud-pass/shots/cloud'] = process.argv.slice(2);
const pw = await loadPlaywright();
const chromium = pw;
const exe = findChromium();
const browser = await chromium.launch(launchOptions(exe));
fs.mkdirSync(out, { recursive: true });
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:5199/e2e/fixtures/chat-shots.html?mode=${mode}&theme=${theme}`);
  await page.waitForSelector('[data-testid="agent-run"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/chat-${name}-${theme}.png`, fullPage: false });
  await page.close();
}
await browser.close();
