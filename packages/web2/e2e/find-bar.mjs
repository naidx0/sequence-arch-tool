#!/usr/bin/env node
/**
 * FIND BAR VISIBILITY (016 c3): the editor's find bar (Ctrl+F) is whole and usable at every editor width. For a
 * 1440 three-surface split, a 1024 window and a 270 px pane, in dark and light: the bar's rect lies inside the
 * editor's rect (never clipped by its overflow), the element at the input's centre is the input and at the bar's
 * own corners is the bar (nothing, not the gutter, the highlight or the field, paints over it), the input keeps a
 * usable width, the bar's fill is opaque, and the input text reads against it (>= 4.5:1).
 * Shots to SHOTS_DIR (default ./tmp-shots/find-bar).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { atLeast, is, sel, suite } from './lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS_DIR ?? path.join(HERE, '..', 'tmp-shots', 'find-bar');
const TREE = { path: '', name: 'repo', type: 'dir', children: [{ path: 'src', name: 'src', type: 'dir', children: [{ path: 'src/wide.ts', name: 'wide.ts', type: 'file' }] }] };
const BODY = Array.from({ length: 80 }, (_, i) => `export const row${i} = compute(${i}, "a long literal that keeps the line wide enough to scroll sideways under the find bar", ${i * 7});`).join('\n');

const CASES = [
  { name: '1440 three-surface split', w: 1440, h: 900, tabs: ['chat', 'files', 'terminal'], pane: null },
  { name: '1024', w: 1024, h: 768, tabs: ['chat', 'files'], pane: null },
  { name: '270 px pane', w: 1024, h: 768, tabs: ['chat', 'files'], pane: 270 },
  { name: '250 px pane', w: 1024, h: 768, tabs: ['chat', 'files'], pane: 250 },
];

await suite(
  'find-bar',
  async ({ page, base, check, log }) => {
    for (const theme of ['dark', 'light']) {
      for (const c of CASES) {
        await page.addInitScript((tabs) => {
          try {
            localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: tabs.map((id) => ({ id, minimized: false })), active: 'files' }));
          } catch {
            /* defaults */
          }
        }, c.tabs);
        await page.setViewportSize({ width: c.w, height: c.h });
        await page.goto(base);
        await page.waitForSelector(sel('shell'));
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.locator(`${sel('files-row')}[data-path="src"]`).click();
        await page.locator(`${sel('files-row')}[data-path="src/wide.ts"]`).click();
        const mode = page.locator('[data-testid="files-view-option"][data-mode="edit"]');
        if (await mode.count()) await mode.click();
        await page.locator(sel('files-code-editor')).waitFor({ state: 'visible', timeout: 15000 });
        if (c.pane) {
          await page.evaluate((w) => {
            const ed = document.querySelector('[data-testid="files-code-editor"]');
            ed.style.flex = 'none';
            ed.style.width = `${w}px`;
          }, c.pane);
        }
        await page.locator('.files-ed-ta').click({ position: { x: 120, y: 40 } });
        await page.keyboard.press('Control+f');
        await page.locator(sel('files-find')).waitFor({ state: 'visible' });
        await page.locator(sel('files-find-input')).fill('compute');
        await page.waitForTimeout(250);
        const label = `${theme} / ${c.name}`;
        const countOf = () => page.evaluate(() => { const n = document.querySelector('[data-testid="files-find-count"]'); const b = n.getBoundingClientRect(); return { w: b.width, text: n.textContent.trim() }; });
        const hit = await countOf();
        await page.locator(sel('files-find-input')).fill('zzzzqq');
        await page.waitForTimeout(150);
        const miss = await countOf();
        await page.locator(sel('files-find-input')).fill('compute');
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => {
          const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
          const ed = document.querySelector('[data-testid="files-code-editor"]');
          const bar = document.querySelector('[data-testid="files-find"]');
          const inp = document.querySelector('[data-testid="files-find-input"]');
          const at = (x, y) => document.elementFromPoint(x, y);
          const bb = r(bar);
          const ib = r(inp);
          const centre = at(ib.l + ib.w / 2, ib.t + ib.h / 2);
          const probes = [[bb.l + 14, bb.t + bb.h / 2], [bb.r - 14, bb.t + bb.h / 2], [bb.l + bb.w / 2, bb.t + 3], [bb.l + bb.w / 2, bb.b - 3]];
          const lum = (c) => { const v = c.match(/[\d.]+/g).map(Number); const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
          const bg = getComputedStyle(bar).backgroundColor;
          const fg = getComputedStyle(inp).color;
          const alpha = (bg.match(/[\d.]+/g) ?? []).length > 3 ? Number(bg.match(/[\d.]+/g)[3]) : 1;
          const [L1, L2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
          return {
            ed: r(ed), bar: bb, input: ib,
            inputIsTop: centre === inp,
            probesOnBar: probes.map(([x, y]) => bar.contains(at(x, y))),
            alpha, contrast: (L1 + 0.05) / (L2 + 0.05),
            docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        log(label, JSON.stringify({ ed: [m.ed.l, m.ed.r], bar: [m.bar.l, m.bar.r], input: m.input.w, contrast: +m.contrast.toFixed(2) }));
        try {
          fs.mkdirSync(SHOTS, { recursive: true });
          await page.screenshot({ path: path.join(SHOTS, `find-${theme}-${c.pane ?? c.w}.png`) });
        } catch (e) {
          console.log('[find-bar] no shot:', e.message);
        }
        await check(`${label}: the bar lies wholly inside the editor`, async () => {
          atLeast(m.bar.l, m.ed.l, 'bar left edge is not left of the editor');
          atLeast(m.ed.r, m.bar.r - 0.5, 'bar right edge is not right of the editor');
          atLeast(m.bar.t, m.ed.t, 'bar top is not above the editor');
          atLeast(m.ed.b, m.bar.b, 'bar bottom is not below the editor top area');
        });
        await check(`${label}: the input is on top at its centre and the bar at its own edges`, async () => {
          is(m.inputIsTop, true, 'elementFromPoint at the input centre is the input');
          is(m.probesOnBar.every(Boolean), true, `all four probes hit the bar: ${m.probesOnBar}`);
        });
        await check(`${label}: the match count is visible with its text ("n of m" and "No match")`, async () => {
          atLeast(hit.w, 20, `count width ${hit.w}`);
          is(/^\d+ of \d+$/.test(hit.text), true, `count text ${hit.text}`);
          atLeast(miss.w, 20, `no-match width ${miss.w}`);
          is(miss.text, 'No match', 'no-match text');
        });
        await check(`${label}: the input keeps a usable width`, async () => {
          atLeast(m.input.w, 64, 'input width');
        });
        await check(`${label}: the fill is opaque enough and the text reads (>= 4.5:1)`, async () => {
          atLeast(m.alpha, 0.95, 'fill alpha');
          atLeast(m.contrast, 4.5, 'input text contrast');
        });
      }
    }
  },
  { routes: { '/api/tree': TREE, '/api/file': BODY } },
);
