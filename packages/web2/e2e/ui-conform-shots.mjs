#!/usr/bin/env node
/**
 * Before/after shots of the harness work's UI (src/chat/uiConformGallery.tsx), both rooms.
 *   V=before|after OUT=/path PORT=5201 node e2e/ui-conform-shots.mjs
 * Run it from the checkout whose UI you want (the gallery file is copied in for "before").
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const OUT = process.env.OUT || '/tmp/claude-0/sc';
const V = process.env.V === 'before' ? 'before' : 'after';
const PORT = Number(process.env.PORT || 5201);
fs.mkdirSync(OUT, { recursive: true });
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'pipe', detached: true });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 60000);
  vite.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), resolve()));
});
const chromium = await loadPlaywright();
const browser = await chromium.launch(launchOptions(findChromium()));
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e.message.slice(0, 300)));
let code = 0;
try {
  for (const theme of ['dark', 'light']) {
    await page.goto(`http://localhost:${PORT}/src/chat/uiConformGallery.html?theme=${theme}&v=${V}`);
    await page.waitForSelector('[data-gallery]');
    await page.waitForTimeout(1500);
    const shot = async (id, name, clip) => {
      const el = page.locator(`[data-gallery="${id}"]`);
      if (await el.count()) await el.screenshot({ path: path.join(OUT, `${name}-${theme}-${V}.png`) });
      else console.error('missing', id);
    };
    /* Edit from here shows on hover; open its row after the first shot. */
    await page.locator('[data-gallery="run"] .s2-run, [data-gallery="run"] article').first().hover().catch(() => {});
    await shot('run', 'asks-and-edit-trigger');
    const edit = page.getByTestId('edit-from-here');
    if (await edit.count()) {
      await edit.first().click();
      await page.waitForTimeout(400);
      await shot('run', 'edit-from-here-row');
    }
    for (const [id, name] of [['undo', 'edit-undo'], ['note', 'repo-note'], ['older', 'show-older'], ['fanout', 'fanout-menu'], ['compare', 'fanout-compare'], ['drawing', 'drawing-card']]) {
      if (id === 'drawing') await page.locator('[data-gallery="drawing"] .dgm').hover();
      await shot(id, name);
    }
    await page.locator('[data-gallery="pr"]').getByTestId('worktree-pr-open').click();
    await page.waitForTimeout(500);
    await shot('pr', 'pr-form');
    await page.goto(`http://localhost:${PORT}/src/chat/uiConformGallery.html?theme=${theme}&v=${V}&viewer=1`);
    await page.waitForSelector('[data-testid="chat-visual-dialog"]');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `drawing-viewer-${theme}-${V}.png`) });
  }
} catch (e) {
  console.error(e);
  code = 1;
}
await browser.close();
try { process.kill(-vite.pid); } catch { vite.kill(); }
process.exit(code);
