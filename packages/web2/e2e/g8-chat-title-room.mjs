#!/usr/bin/env node
/**
 * 0.1.8 G8: the chat header's quick icons (undo, working tree, find) must not squeeze the chat title twice. Measured in
 * a real browser at 1024 and 1280 with a LONG title and with a short one:
 *   - a short title is never cut;
 *   - a long title takes what the header leaves: the empty gap between the title's right edge and the quick icons is at
 *     most 56 px (the window-drag handle), not the 132 px the title used to reserve for itself;
 *   - at 1024 the title keeps at least 190 px.
 * Shots to SHOTS_DIR (default ./tmp-shots/g8-title).
 */
import fs from 'node:fs';
import path from 'node:path';

import { atLeast, resize, sel, settle, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(process.cwd(), 'tmp-shots', 'g8-title');
fs.mkdirSync(OUT, { recursive: true });
const at = (h) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
const sessions = (title) => ({ index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title, titleEdited: false, createdAt: at(5), updatedAt: at(6) }] }, scope: 'workspace', repos: [] });
const LONG = 'Rate limiter returns 200 under load when the proxy collapses every client onto one address';

/* One case per process (the harness exits when a suite ends): CASE=long or CASE=short; default long. */
for (const [name, title] of [['long', LONG], ['short', 'Rate limits']].filter(([n]) => n === (process.env.CASE ?? 'long'))) {
  await suite(
    `g8-chat-title-room-${name}`,
    async ({ page, base, check, log }) => {
      for (const w of [1024, 1280]) {
        await resize(page, w, 800);
        await page.goto(base);
        await page.waitForSelector(sel('shell'));
        await settle(page);
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const head = document.querySelector('.s2-ch');
          const t = head.querySelector('.r9-title');
          const q = head.querySelector('.s2-chat-quick');
          const tr = t.getBoundingClientRect();
          const qr = q.getBoundingClientRect();
          const inner = t.querySelector('span, b') ?? t;
          return { titleW: tr.width, gap: qr.left - tr.right, cut: [t, ...t.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1), text: t.textContent };
        });
        log(w, name, JSON.stringify(m));
        await page.locator('.s2-ch').first().screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
        if (name === 'short') {
          await check(`${w} short title is whole`, async () => {
            if (m.cut) throw new Error(`cut: ${JSON.stringify(m)}`);
          });
        } else {
          await check(`${w} long title leaves at most 68px unused beside the icons`, async () => {
            if (!(m.gap <= 68)) throw new Error(`gap ${m.gap}`);
          });
          await check(`${w} long title keeps its room`, async () => atLeast(m.titleW, 190, `${w} title width`));
        }
      }
    },
    { routes: { '/api/sessions': sessions(title) } },
  );
}
