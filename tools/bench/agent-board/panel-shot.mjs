#!/usr/bin/env node
/*
 * PANEL SHOT — build packages/web2/src/agents/specimen.html with the app's own
 * vite + react plugin into a temp dir, serve it, and screenshot the agents
 * panel (tree and timeline) at 1440x900.
 *
 *   node tools/bench/agent-board/panel-shot.mjs --shots <dir>
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB2 = path.join(ROOT, 'packages', 'web2');
const require = createRequire(path.join(WEB2, 'package.json'));
const { chromium } = require('playwright-core');
const { build } = await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')), 'dist', 'node', 'index.js')).href);
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
const { findChromium } = await import(new URL('../../../packages/web2/e2e/lib/chromium.mjs', import.meta.url).href);

const i = process.argv.indexOf('--shots');
const SHOTS = i >= 0 ? process.argv[i + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'agents-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const HERE = path.join(WEB2, 'src', 'agents');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-agents-'));
await build({ root: HERE, configFile: false, logLevel: 'error', plugins: [react()], base: './', build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(HERE, 'specimen.html') } } });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = new URL(req.url ?? '/', 'http://x').pathname;
  const file = path.join(outDir, p === '/' ? 'specimen.html' : decodeURIComponent(p));
  if (p === '/favicon.ico') return res.writeHead(204).end();
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const view of ['tree', 'timeline']) {
    await page.goto(`${base}/?view=${view}`);
    await page.waitForSelector('[data-testid="agents-panel"]');
    await page.waitForTimeout(300);
    const file = path.join(SHOTS, `agents-${view}.png`);
    await page.screenshot({ path: file });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('.ag-scope *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible').length,
    );
    console.log(`${file} overflowing=${overflow}`);
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    code = 1;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
