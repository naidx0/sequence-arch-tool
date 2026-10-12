#!/usr/bin/env node
/**
 * THE PAGE AUDIT (ask 32): open every overlay, dialog and pane the audit slice
 * owns in a real browser, dark and light, 1440x900, and screenshot it.
 *
 *   SHOT_DIR=/path node e2e/audit-pages.mjs [only,names]
 *
 * It asserts only that each thing opens; the look is judged from the pictures
 * (cloud-pass/page-audit.md).
 */
import fs from 'node:fs';
import path from 'node:path';

import { sel, suite } from './lib/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '/tmp/claude-0/sc';
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const HOME_TABS = { tabs: [{ id: 'chat', minimized: false }], active: 'chat' };

const PALETTE = [
  ['search', 'Search this repository'],
  ['help', 'help'],
  ['rewind', 'Rewind an edit'],
  ['review', 'review'],
  ['activity', 'Show workflows'],
];

const DIFF = [
  'diff --git a/src/server/limiter.ts b/src/server/limiter.ts',
  'index 1111111..2222222 100644',
  '--- a/src/server/limiter.ts',
  '+++ b/src/server/limiter.ts',
  '@@ -10,9 +10,12 @@ export function limit(req: Request) {',
  '   const key = req.ip;',
  '   const hits = store.get(key) ?? 0;',
  '-  if (hits > 100) {',
  "-    return deny('slow down');",
  '+  if (hits > LIMIT) {',
  "+    return deny('rate limited', { retryAfter: WINDOW_MS });",
  '   }',
  '+  store.set(key, hits + 1);',
  '   return allow();',
  ' }',
  '',
].join('\n');

const routes = {
  '/api/git/status': {
    branch: 'main',
    files: [
      { path: 'src/server/limiter.ts', status: 'modified', unstaged: true },
      { path: 'src/server/config.ts', status: 'modified', unstaged: true },
    ],
  },
  '/api/git/diff': { path: 'src/server/limiter.ts', diff: DIFF },
  '/api/git/revisions': {
    commits: [{ sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'Add gateway', at: '2026-10-06T10:00:00Z' }],
    branches: ['main'],
    head: 'main',
  },
  '/api/checkpoints': { checkpoints: [], tracked: [] },
  '/api/snapshots/sessions': { sessions: [{ sessionId: 's1', turns: 2, lastAt: Date.now(), reverted: false }] },
  '/api/snapshots': {
    sessionId: 's1',
    turns: [
      { seq: 1, label: 'Add rate limiting to the gateway', at: Date.now() - 3600000, files: ['src/server/limiter.ts', 'src/server/config.ts'] },
      { seq: 2, label: 'Fix the retry header', at: Date.now() - 1800000, files: ['src/server/limiter.ts'] },
    ],
  },
};

await suite('audit-pages', async ({ page, base, check }) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shot = (name, theme) => page.screenshot({ path: path.join(SHOT_DIR, `audit-${name}${process.env.SHOT_SUFFIX || ''}-${theme}.png`) });
  const settle = async () => {
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await page.waitForTimeout(250);
  };
  const want = (n) => !ONLY.length || ONLY.includes(n);
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page.evaluate(([t, tabs, view]) => {
      localStorage.clear();
      localStorage.setItem('v3.chromeTabs', JSON.stringify(tabs));
      if (view) localStorage.setItem('sequence.review.view', view);
      localStorage.setItem('seq.theme', t);
    }, [theme, HOME_TABS, process.env.DIFF_VIEW || '']);
    await page.reload();
    await page.waitForSelector(sel('shell'));
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(1500);

    if (want('palette'))
      await check(`${theme}: palette`, async () => {
        await page.keyboard.press('Control+k');
        await page.waitForSelector(sel('command-surface'), { timeout: 5000 });
        await settle();
        await shot('palette', theme);
        await page.keyboard.press('Escape');
      });
    if (want('keys'))
      await check(`${theme}: keys help`, async () => {
        await page.keyboard.press('Control+/');
        await page.waitForSelector(sel('keys-help'), { timeout: 5000 });
        await settle();
        await shot('keys', theme);
        await page.keyboard.press('Escape');
      });
    for (const [name, q] of PALETTE) {
      if (!want(name)) continue;
      await check(`${theme}: ${name}`, async () => {
        await page.keyboard.press('Control+k');
        await page.waitForSelector(sel('command-field'));
        await page.fill(sel('command-field'), q);
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');
        await page.waitForSelector(sel(`v3-overlay-${name}`), { timeout: 5000 });
        await page.waitForTimeout(700);
        await settle();
        await shot(name, theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      });
    }
    for (const id of ['architecture', 'files', 'whiteboard']) {
      if (!ONLY.includes(id)) continue;
      await check(`${theme}: ${id} surface`, async () => {
        await page.locator(sel(`s2-tab-${id}`)).click();
        await page.waitForSelector(`[data-surface-pane="${id}"]`, { timeout: 5000 });
        await page.waitForTimeout(1500);
        await settle();
        await shot(id, theme);
        await page.locator(sel(`v3-tab-close-${id}`)).click();
      });
    }
    if (want('terminal'))
      await check(`${theme}: terminal pane`, async () => {
        await page.locator(sel('s2-tab-terminal')).click();
        await page.waitForSelector('[data-surface-pane="terminal"]', { timeout: 5000 });
        await page.waitForTimeout(800);
        await settle();
        await shot('terminal', theme);
        await page.locator(sel('v3-tab-close-terminal')).click();
      });
    if (ONLY.includes('browser'))
      await check(`${theme}: browser pane`, async () => {
        /* The Browser surface is not in the default tab strip: open it the way a saved layout would. */
        await page.evaluate((tabs) => localStorage.setItem('v3.chromeTabs', JSON.stringify(tabs)), {
          tabs: [{ id: 'chat', minimized: false }, { id: 'browser', minimized: false }],
          active: 'browser',
        });
        await page.reload();
        await page.waitForSelector('[data-surface-pane="browser"]', { timeout: 8000 });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.waitForTimeout(800);
        await settle();
        await shot('browser', theme);
      });
  }
}, { routes });
