#!/usr/bin/env node
/**
 * THE STATE GALLERY (ask 32): the parts the live shell only shows in a state,
 * drawn on fixtures by src/shell2/auditGallery.tsx, served by vite, screenshot
 * in both rooms at 1440x900.
 *
 *   SHOT_DIR=/path node e2e/audit-gallery.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '/tmp/claude-0/sc';
const PORT = 5199;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'pipe', detached: true });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 60000);
  vite.stdout.on('data', (d) => {
    if (String(d).includes('Local')) {
      clearTimeout(t);
      resolve();
    }
  });
});

const chromium = await loadPlaywright();
const browser = await chromium.launch(launchOptions(findChromium()));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let code = 0;
page.on('pageerror', (e) => console.error('pageerror', e.message.slice(0, 400)));
try {
  for (const theme of ['dark', 'light']) {
    await page.goto(`http://localhost:${PORT}/src/shell2/auditGallery.html?theme=${theme}`);
    await page.waitForSelector('[data-gallery]');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, `audit-gallery-${theme}.png`), fullPage: true });
  }
} catch (e) {
  console.error(e);
  code = 1;
}
await browser.close();
try { process.kill(-vite.pid); } catch { vite.kill(); }
process.exit(code);
