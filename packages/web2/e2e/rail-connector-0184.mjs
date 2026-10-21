#!/usr/bin/env node
/**
 * THE RAIL'S FOLDER CONNECTOR (0.1.8.4). A folder's chats hang from a thin line under the folder's icon.
 * Measured in a real Chromium: the line is the hairline width, in the edge colour, its x is the centre of the folder
 * row's icon, it starts at the first chat and stops at the middle of the last one. Control: a folder with no chat rows
 * draws no line (the positive is the folder that has them, the negative the one that has none).
 *
 *   SHOT_DIR=/path node e2e/rail-connector-0184.mjs
 */
import fs from 'node:fs';

import { atLeast, is, sel, settle, suite, within } from './lib/harness.mjs';

const out = process.env.SHOT_DIR || 'tmp-shots/rail-connector-0184';
const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id, title, h) => ({ id, title, createdAt: at(h), updatedAt: at(h) });
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [chat('h1', 'Rate limiting for the gateway', 5), chat('h2', 'Orders health check', 4), chat('h3', 'Retry the webhook', 3)] },
  scope: 'workspace',
  repos: [{ path: 'C:/work/ticketing', name: 'ticketing', index: { version: 1, activeId: 't1', sessions: [chat('t1', 'Seat holds', 3)] } }],
};

await suite('rail-connector-0184', async ({ page, base, check }) => {
  fs.mkdirSync(out, { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
    await page.evaluate((t) => localStorage.setItem('seq.theme', t), theme);
    await page.reload();
    await page.locator(sel('s2-project')).first().waitFor();
    await page.locator(sel('s2-session')).first().waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/rail-${theme}.png`, clip: { x: 0, y: 0, width: 260, height: 460 } });
    await check(`${theme}: the line hangs from the folder icon down its chats`, async () => {
      const m = await page.evaluate(() => {
        const proj = document.querySelector('[data-testid="s2-project"]:has(.s2-proj-chats > .s2-rail-row)');
        if (!proj) return null;
        const list = proj.querySelector('.s2-proj-chats');
        const icon = proj.querySelector('.s2-proj-row .s2-rail-ic svg');
        const rows = [...list.querySelectorAll(':scope > .s2-rail-row')];
        const before = getComputedStyle(list, '::before');
        const lr = list.getBoundingClientRect();
        const ir = icon.getBoundingClientRect();
        return {
          width: parseFloat(before.width),
          left: parseFloat(before.left),
          color: before.backgroundColor,
          edge: getComputedStyle(document.documentElement).getPropertyValue('--edge-strong').trim(),
          top: parseFloat(before.top),
          height: parseFloat(before.height),
          iconCentre: ir.left + ir.width / 2 - lr.left,
          rows: rows.length,
          firstTop: rows[0].getBoundingClientRect().top - lr.top,
          lastMiddle: rows.at(-1).getBoundingClientRect().top - lr.top + rows.at(-1).getBoundingClientRect().height / 2,
        };
      });
      if (!m) throw new Error('no folder with chat rows was drawn (a scan of nothing passes anything)');
      atLeast(m.rows, 2, 'chat rows under the folder');
      is(m.width, 1, 'line width (--w-hair)');
      within(m.left + m.width / 2, m.iconCentre, 1, 'the line is centred on the folder icon');
      is(m.top, 0, 'starts at the first chat');
      within(m.top + m.height, m.lastMiddle, 1.5, 'stops at the middle of the last chat');
      if (m.color === 'rgba(0, 0, 0, 0)') throw new Error('the line has no colour');
    });
  }
  await check('a folder with no chat rows draws no line (negative control)', async () => {
    const display = await page.evaluate(() => {
      const host = document.createElement('div');
      host.className = 's2-proj-chats';
      host.innerHTML = '<p class="s2-empty s2-empty-nest">No chats yet</p>';
      document.body.append(host);
      const d = getComputedStyle(host, '::before').display;
      host.remove();
      return d;
    });
    is(display, 'none', 'pseudo-element display with no rows');
  });
}, { routes: { '/api/sessions': SESSIONS } });
