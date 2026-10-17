#!/usr/bin/env node
/**
 * Round 0.1.5, G2: the surface tabs and the panes at four widths plus squeezed-pane cases. Boots the real
 * analyzer on a fixture repo with a neutral home, opens the surfaces, screenshots, and reports anything that spills
 * past its pane. Usage: node e2e/surfaces-shots.mjs <repo> <outDir> [suffix]. Exit 2 when the harness cannot run.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const [repo, outDir, suffix = ''] = process.argv.slice(2);
if (!repo || !outDir) {
  console.error('usage: surfaces-shots.mjs <repo> <outDir> [suffix]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-home-'));
const port = 4190 + Math.floor(Math.random() * 50);

async function waitHttp(url, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      await new Promise((res, rej) => {
        const r = http.get(url, (x) => {
          x.resume();
          res();
        });
        r.on('error', rej);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server not ready');
}

const exe = findChromium();
const chromium = await loadPlaywright();
if (!exe || !chromium) {
  console.log('SKIP: no chromium/playwright');
  process.exit(0);
}
const child = spawn(process.execPath, [CLI, 'app', '--repo', repo, '--no-open', '--port', String(port)], {
  env: { ...process.env, HOME: home, USERPROFILE: home, SEQUENCE_BIND_HOST: '127.0.0.1' },
  stdio: 'ignore',
});
const browser = await chromium.launch(launchOptions(exe));
let code = 0;
/* name, window width, surfaces to open, chat column width (px) or null for the stored default. */
const CASES = [
  ['1440', 1440, ['whiteboard', 'files'], null],
  ['1024', 1024, ['whiteboard', 'files'], null],
  ['800', 800, ['whiteboard', 'files'], null],
  ['520', 520, ['whiteboard', 'files'], null],
  ['1180-three', 1180, ['architecture', 'whiteboard', 'files'], null],
  ['1280-squeezed', 1280, ['architecture', 'whiteboard'], 760],
  ['1440-squeezed-three', 1440, ['architecture', 'whiteboard', 'files'], 760],
];
try {
  const base = `http://127.0.0.1:${port}`;
  await waitHttp(base);
  const report = {};
  for (const [name, w, ids, chat] of CASES) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    if (chat) await page.addInitScript((c) => localStorage.setItem('v3.chatW', String(c)), chat);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const ws = page.getByText('Workspace', { exact: true });
    if (w < 900 && (await ws.count())) await ws.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    for (const id of ids) {
      const b = page.locator(`[data-testid="s2-tab-${id}"]`);
      if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(1200);
    report[name] = await page.evaluate(() => {
      const bad = [];
      for (const p of document.querySelectorAll('.s2-pane')) {
        const r = p.getBoundingClientRect();
        for (const el of p.querySelectorAll('button, [role=tab], .btag, .board-tabs, input')) {
          const e = el.getBoundingClientRect();
          if (e.width && (e.right > r.right + 1 || e.left < r.left - 1) && getComputedStyle(el).visibility !== 'hidden') {
            bad.push(`${el.className || el.tagName}@${Math.round(e.left)}-${Math.round(e.right)} vs ${Math.round(r.left)}-${Math.round(r.right)}`);
          }
        }
      }
      const bar = document.querySelector('.s2-surfaces');
      const pills = [...document.querySelectorAll('.s2-sp')].map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.dataset.pill, l: Math.round(r.left), r: Math.round(r.right) };
      });
      const barR = bar ? bar.getBoundingClientRect() : null;
      const cut = barR ? pills.filter((p) => p.r > barR.right + 1 || p.l < barR.left - 1).map((p) => p.id) : [];
      return {
        panes: [...document.querySelectorAll('.s2-pane')].map((p) => Math.round(p.getBoundingClientRect().width)),
        spill: bad.slice(0, 8),
        barScroll: bar ? [bar.scrollWidth, bar.clientWidth] : null,
        pillsCutByBar: cut,
      };
    });
    await page.screenshot({ path: path.join(outDir, `${name}${suffix}.png`) });
    await page.close();
  }
  console.log(JSON.stringify(report));
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser.close();
  child.kill();
}
process.exit(code);
