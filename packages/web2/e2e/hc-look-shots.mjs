#!/usr/bin/env node
/**
 * 017 HC look shots: the light cream room, the window backdrop dim, the run watchdog card.
 * Env: OUT (dir), STEM (before|after). Dark and light, 1440x900. Live turns are faked as in r11-chat-shots.
 * Prints the measured backdrop opacity and the watchdog's computed colours.
 */
import fs from 'node:fs';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.OUT ?? 'shots';
const STEM = process.env.STEM ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] },
  scope: 'workspace',
  repos: [],
};
const RUNS = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why does the rate limiter return 200 under load?', text: 'The window is keyed on `req.ip`, which is the proxy for every request. Reading `x-forwarded-for` first fixes it.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null, tools: [] },
  ],
};
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

await suite(
  'hc-look-shots',
  async ({ page, base, log }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + (window.__skew || 0);
    });
    await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNS) }));
    for (const theme of ['dark', 'light']) {
      await page.goto(base);
      await page.evaluate(() => { try { localStorage.clear(); } catch {} });
      await page.reload();
      await page.evaluate((t) => { try { localStorage.setItem('seq.theme', t); } catch {} document.documentElement.setAttribute('data-theme', t); }, theme);
      await page.waitForSelector(sel('shell'));
      await page.locator('section.s2-chat .s2-run, section.s2-chat [data-testid="agent-run"]').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/window-${theme}_${STEM}.png` });
      const bd = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.s2-backdrop')) out.push({ mode: el.dataset.mode, drawn: el.dataset.drawn, opacity: getComputedStyle(el).opacity, filter: getComputedStyle(el.querySelector('canvas') ?? el).filter });
        return out;
      });
      log(theme, 'backdrop', JSON.stringify(bd));
      await page.unroute('**/api/acp/run-node*').catch(() => {});
      await page.route('**/api/acp/run-node*', () => {});
      const box = page.locator('section.s2-chat textarea').first();
      await box.click();
      await box.fill('Run the gateway tests again');
      await box.press('Enter');
      await page.evaluate(() => { window.__skew = 47_000; });
      const w = page.locator(sel('agent-run-watchdog'));
      await w.waitFor({ timeout: 10000 });
      await page.waitForTimeout(300);
      const m = await w.evaluate((n) => {
        const g = (e) => (e ? getComputedStyle(e).color : null);
        return { bg: getComputedStyle(n).backgroundColor, text: g(n.querySelector('.agnote-text')), keys: [...n.querySelectorAll('.agnote-key')].map(g), btns: [...n.querySelectorAll('button')].map((b) => b.className + ' ' + getComputedStyle(b).backgroundColor) };
      });
      log(theme, 'watchdog', JSON.stringify(m));
      await page.screenshot({ path: `${OUT}/watchdog-${theme}_${STEM}.png` });
      const r = await page.locator('section.s2-chat').boundingBox();
      const wb = await w.boundingBox();
      await page.screenshot({ path: `${OUT}/watchdog-crop-${theme}_${STEM}.png`, clip: { x: r.x, y: Math.max(0, wb.y - 140), width: r.width, height: 260 } });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS } },
);
