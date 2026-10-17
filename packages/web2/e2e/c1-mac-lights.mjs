#!/usr/bin/env node
/**
 * 0.1.8 C1: on macOS the OS draws the traffic lights over the web view at x 18, y 14 (desktop/src/main.ts
 * trafficLightPosition), about 52 x 16 px. Measured in a real browser with the platform emulated (data-platform=mac from the
 * user agent), in three states: sidebar open; sidebar folded by the reader (no rail); sidebar folded with the icon rail
 * (a window too narrow for the sidebar). In each, no button, title or label may sit under the lights' box, and the chat
 * title is not cut to "New c...". Shots to SHOTS_DIR (default ./tmp-shots/c1-mac).
 * CASE=open|folded|rail picks one (the harness exits when a suite ends).
 */
import fs from 'node:fs';
import path from 'node:path';

import { resize, sel, settle, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(process.cwd(), 'tmp-shots', 'c1-mac');
fs.mkdirSync(OUT, { recursive: true });
const LIGHTS = { x0: 18, y0: 14, x1: 18 + 52, y1: 14 + 16 };
const CASES = {
  open: { w: 1440, fold: false },
  folded: { w: 1440, fold: true },
  /* The rail shows when the Agents dock leaves the stage no room for the sidebar (layoutPrefs.foldRail), from 1200 wide. */
  rail: { w: 1280, fold: false, agents: true },
};
const name = process.env.CASE ?? 'open';
const c = CASES[name];

await suite(`c1-mac-lights-${name}`, async ({ page, base, check, log }) => {
  await page.addInitScript((agents) => {
    try { if (agents) localStorage.setItem('v3.agentsOpen', '1'); } catch {}
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/154 Safari/537.36' });
    window.sequence = { openRepo: async () => null, shell: async () => ({ maximized: false }) };
  }, !!c.agents);
  await resize(page, c.w, 800);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  if (c.fold) await page.locator(sel('s2-sidebar-collapse')).click();
  await page.waitForTimeout(700);
  const m = await page.evaluate((L) => {
    const hit = (r) => r.right > L.x0 && r.left < L.x1 && r.bottom > L.y0 && r.top < L.y1 && r.width > 0 && r.height > 0;
    const under = [...document.querySelectorAll('button, .s2-ph-name, .s2-crumb, .r9-title, input')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
      .filter((e) => hit(e.getBoundingClientRect()))
      .map((e) => e.getAttribute('data-testid') || e.className || e.tagName);
    const t = document.querySelector('.s2-ch .r9-title');
    const rail = document.querySelector('.s2-iconrail');
    return { platform: document.querySelector('.s2').dataset.platform, under, rail: !!rail, titleCut: t ? [t, ...t.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1) : null, titleW: t?.getBoundingClientRect().width ?? null };
  }, LIGHTS);
  log(name, JSON.stringify(m));
  await page.evaluate((L) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${L.x0}px;top:${L.y0}px;z-index:99999;display:flex;gap:8px;pointer-events:none`;
    for (const col of ['#ff5f57', '#febc2e', '#28c840']) d.insertAdjacentHTML('beforeend', `<i style="width:12px;height:12px;border-radius:50%;background:${col};display:block"></i>`);
    document.body.appendChild(d);
  }, LIGHTS);
  await page.screenshot({ path: path.join(OUT, `mac-${name}.png`), clip: { x: 0, y: 0, width: 640, height: 140 } });
  await check('platform is mac', async () => {
    if (m.platform !== 'mac') throw new Error(m.platform);
  });
  await check('nothing sits under the lights', async () => {
    if (m.under.length) throw new Error(`under the lights: ${m.under.join(', ')}`);
  });
  if (name === 'rail') {
    await check('the icon rail is showing in this state', async () => {
      if (!m.rail) throw new Error('no .s2-iconrail at this width');
    });
  }
  await check('the chat title is not cut to a stub', async () => {
    if (m.titleCut) throw new Error(`cut at ${m.titleW}`);
  });
});
