#!/usr/bin/env node
/* Round 10: the Activity state labels (quiet inline text, 6px dot) from the
   activity specimen, built with vite like activityRendered.test.ts. */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r10/look';
mkdirSync(OUT, { recursive: true });
const HERE = resolve(import.meta.dirname, '../src/activity');
const outDir = mkdtempSync(join(tmpdir(), 'seq-activity-'));
await build({ root: HERE, configFile: false, logLevel: 'error', plugins: [react()], base: './', build: { outDir, emptyOutDir: true, rollupOptions: { input: join(HERE, 'specimen.html') } } });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  try {
    const p = join(outDir, decodeURIComponent((req.url ?? '/').split('?')[0]));
    const b = readFileSync(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(b);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chromium = await loadPlaywright();
const browser = await chromium.launch(launchOptions(findChromium()));
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/specimen.html`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForSelector('[data-testid="activity-row"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/activity-states-${theme}.png` });
  await page.close();
}
await browser.close();
server.close();
console.log('ok');
