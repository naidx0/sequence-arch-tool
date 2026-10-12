#!/usr/bin/env node
/**
 * Round 10, lane "look": surface bar (segmented control), board dock centred
 * with no ASCII ramp, accent swatches, translucent menus, agents grouped by
 * chat. Dark and light at 1440x900 (plus a narrow board).
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r10/look).
 */
import fs from 'node:fs';
import { is, sel, settle, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r10/look';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: {
    version: 1,
    activeId: 'h1',
    sessions: [
      { id: 'h1', title: 'Fix the failing gateway tests', createdAt: at(5), updatedAt: at(5) },
      { id: 'h2', title: 'Orders health check', createdAt: at(4), updatedAt: at(4) },
      { id: 'h3', title: 'Rate limiting for the gateway', createdAt: at(3), updatedAt: at(3) },
    ],
  },
  scope: 'workspace',
  repos: [],
};
const now = Date.now();
let n = 0;
const ev = (sid, dt, e) => ({ id: `e${++n}`, at: now + dt, source: 'acp', sessionId: sid, paths: [], status: 'done', ...e });
const EVENTS = [
  ev('h2', -400000, { kind: 'session_start', status: 'running', title: 'Orders health check' }),
  ev('h2', -399000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'o1', status: 'running', title: 'Read orders/src/health.ts', paths: ['orders/src/health.ts'] }),
  ev('h2', -398000, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'o1', title: 'Read orders/src/health.ts', paths: ['orders/src/health.ts'], result: 'export const health = () => ok' }),
  ev('h2', -397000, { kind: 'stop', tokens: 4000 }),
  ev('h1', -300000, { kind: 'session_start', status: 'running', title: 'Fix the failing gateway tests' }),
  ev('h1', -299000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'] }),
  ev('h1', -298400, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'], result: 'import express' }),
  ev('h1', -288000, { kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'c', status: 'running', title: 'pnpm --filter @sequence/gateway test' }),
  ev('h1', -262000, { kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'c', status: 'failed', title: 'pnpm --filter @sequence/gateway test', error: 'FAIL test/rate.test.ts' }),
  ev('h1', -260000, { kind: 'stop', tokens: 20500 }),
  ev('h3', -90000, { kind: 'session_start', status: 'running', title: 'Rate limiting for the gateway' }),
  ev('h3', -80000, { kind: 'tool_start', tool: 'Edit', toolKind: 'edit', toolUseId: 'r1', status: 'running', title: 'Edit gateway/src/rate.ts', paths: ['gateway/src/rate.ts'] }),
];

const clipOf = async (page, locator, pad = 10) => {
  const b = await locator.boundingBox();
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
};

await suite(
  'r10-look-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/agent-events', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: EVENTS.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') }),
    );
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.evaluate((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForSelector(sel('shell'));

      // 1. surface bar: architecture then files open, files focused
      await page.locator(sel('s2-tab-architecture')).click();
      await page.locator(sel('s2-tab-files')).click();
      await settle(page);
      await page.waitForTimeout(400);
      const bar = page.locator(sel('s2-surfaces'));
      await page.screenshot({ path: `${OUT}/surface-bar-full-${theme}.png` });
      await page.screenshot({ path: `${OUT}/surface-bar-crop-${theme}.png`, clip: await clipOf(page, bar, 14) });
      await check(`${theme}: the surface indicator has no accent underline`, async () => {
        const after = await page.evaluate(() => {
          const i = document.querySelector('.s2-sp-ind');
          const cs = getComputedStyle(i, '::after');
          return cs.content;
        });
        if (after !== 'none' && after !== 'normal') throw new Error(`::after content ${after}`);
      });

      // 2. board, dock centred
      await page.locator(sel('s2-tab-architecture')).click();
      await settle(page);
      await page.waitForTimeout(500);
      const widths = [1440, 560];
      for (const w of widths) {
        /* A narrow BOARD (the container query asks the board, not the window):
           pin the board element's width while the window stays 1440. */
        await page.evaluate((width) => {
          document.getElementById('r10-narrow')?.remove();
          if (width < 1000) {
            const st = document.createElement('style');
            st.id = 'r10-narrow';
            st.textContent = `.board.board-scope { width: ${width}px !important; max-width: ${width}px !important; }`;
            document.head.appendChild(st);
          }
        }, w);
        await page.waitForTimeout(400);
        const dock = page.locator(sel('board-dock')).first();
        await dock.waitFor({ timeout: 15000 });
        await check(`${theme} ${w}px: the board dock is centred on the board pane`, async () => {
          const r = await page.evaluate(() => {
            const d = document.querySelector('[data-testid="board-dock"]').getBoundingClientRect();
            const b = document.querySelector('.board-scope.board').getBoundingClientRect();
            return { dc: d.left + d.width / 2, bc: b.left + b.width / 2, bottom: b.bottom - d.bottom, ascii: !!document.querySelector('[data-testid="board-ascii"]') };
          });
          if (Math.abs(r.dc - r.bc) > 6) throw new Error(`dock centre ${r.dc} vs board centre ${r.bc}`);
          if (r.ascii) throw new Error('ascii ramp still mounted');
        });
        await page.screenshot({ path: `${OUT}/board-dock-${w}-${theme}.png` });
      }
      await page.evaluate(() => document.getElementById('r10-narrow')?.remove());

      // 3. a menu: translucency
      await page.locator(sel('s2-chat-more')).first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/menu-translucent-${theme}.png` });
      await page.keyboard.press('Escape');

      // 4. agents panel with 3 chats
      if (!(await page.locator(sel('agents-panel')).count())) {
        await page.locator(sel('s2-chat-more')).first().click();
        await page.locator(sel('v3-agents-toggle')).first().click();
      }
      await page.locator(sel('agents-tree')).waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      await check(`${theme}: agents group by chat, the open chat first`, async () => {
        const heads = await page.locator(sel('agents-chat-group')).count();
        if (heads < 2) throw new Error(`chat groups: ${heads}`);
        is(await page.locator(sel('agents-chat-group')).first().getAttribute('data-active'), 'true', 'first group is the open chat');
      });
      await page.screenshot({ path: `${OUT}/agents-by-chat-${theme}.png` });

      // 5. settings accents (the Agents dock hides the rail, so close it first)
      await page.locator(sel('agents-close')).click();
      await page.waitForTimeout(300);
      await page.goto(base);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForSelector(sel('shell'));
      await page.waitForTimeout(400);
      if (!(await page.locator(sel('v3-rail-settings')).count())) await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
      await page.locator(sel('v3-rail-settings')).click({ timeout: 8000 });
      await page.waitForSelector(sel('settings-panel'), { timeout: 10000 });
      await page.locator(sel('settings-nav-app')).click().catch(() => undefined);
      await page.locator(sel('settings-accent')).first().waitFor({ timeout: 15000 });
      await page.locator(sel('settings-accent')).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/settings-accents-${theme}.png` });
      if (theme === 'dark') {
        await page.locator('[data-accent-choice="violet"]').click({ timeout: 8000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/settings-accent-violet-dark.png` });
      } else {
        await page.locator('[data-accent-choice="rose"]').click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/settings-accent-rose-light.png` });
      }
      await page.evaluate(() => {
        try {
          localStorage.removeItem('sequence.accent');
        } catch {}
      });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': { runs: [] } } },
);
