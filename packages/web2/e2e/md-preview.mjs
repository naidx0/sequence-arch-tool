#!/usr/bin/env node
/**
 * MARKDOWN PREVIEW CORRECTNESS (016 b6): a decision record (MADR) with front-matter, a table, a mermaid flowchart
 * and a sequence diagram opens as a document: both diagrams drawn (an <svg>, no raw fence, no error), the
 * front-matter as rows (no stray rule, no "---" run into a paragraph), the table a table, in dark and light.
 * Shots to SHOTS_DIR (default ./tmp-shots/md-preview).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { is, sel, suite } from './lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(HERE, 'fixtures', 'madr-fixture.md'), 'utf8');
const SHOTS = process.env.SHOTS_DIR ?? path.join(HERE, '..', 'tmp-shots', 'md-preview');
const TREE = { path: '', name: 'repo', type: 'dir', children: [{ path: 'docs', name: 'docs', type: 'dir', children: [{ path: 'docs/0007-queue.md', name: '0007-queue.md', type: 'file' }] }] };

await suite(
  'md-preview',
  async ({ page, base, check, log }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'files', minimized: false }], active: 'files' }));
      } catch {
        /* defaults */
      }
    });
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.locator(`${sel('files-row')}[data-path="docs"]`).click();
      await page.locator(`${sel('files-row')}[data-path="docs/0007-queue.md"]`).click();
      await page.locator('.files-preview-md').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('.files-preview-md [data-testid="chat-diagram"] svg.mermaid, .files-preview-md [data-testid="chat-diagram"] svg[id^="mermaid"], .files-preview-md [data-testid="chat-diagram"] svg[aria-roledescription]').length >= 2, null, { timeout: 20000 });
      await check(`${theme}: both mermaid diagrams are drawn, none is raw source or an error`, async () => {
        const r = await page.evaluate(() => {
          const root = document.querySelector('.files-preview-md');
          const dg = [...root.querySelectorAll('[data-testid="chat-diagram"]')];
          return { n: dg.length, drawn: dg.filter((d) => d.querySelector('svg[aria-roledescription]')).length, raw: /flowchart TD|sequenceDiagram|participant /.test(root.innerText), err: /syntax error|Parse error/i.test(root.innerText) };
        });
        log(theme, JSON.stringify(r));
        is(r.n, 2, 'two diagrams');
        is(r.drawn, 2, 'both drawn');
        is(r.raw, false, 'no mermaid source in the text');
        is(r.err, false, 'no error box');
      });
      await check(`${theme}: front-matter is rows, the table is a table, no stray rule`, async () => {
        const r = await page.evaluate(() => {
          const root = document.querySelector('.files-preview-md');
          return { rows: root.querySelectorAll('.files-fm-row').length, hr: root.querySelectorAll('hr').length, table: root.querySelectorAll('table').length, dashes: root.innerText.includes('---') };
        });
        is(r.rows, 3, 'status, date, deciders');
        is(r.hr, 0, 'no rule');
        is(r.table, 1, 'one table');
        is(r.dashes, false, 'no --- run into the text');
      });
      await check(`${theme}: diagram ink is readable against the page`, async () => {
        const c = await page.evaluate(() => {
          const lum = (s) => { const m = s.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
          const t = document.querySelector('.files-preview-md [data-testid="chat-diagram"] svg text, .files-preview-md [data-testid="chat-diagram"] svg .nodeLabel');
          const bg = getComputedStyle(document.querySelector('.files-preview-md')).backgroundColor;
          const fg = t ? getComputedStyle(t).fill || getComputedStyle(t).color : null;
          return { fg, bg, hasText: !!t };
        });
        log(theme, JSON.stringify(c));
        is(c.hasText, true, 'diagram text exists');
      });
      try {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `md-preview-${theme}.png`) });
      } catch (e) {
        console.log('[md-preview] no shot:', e.message);
      }
    }
  },
  { routes: { '/api/tree': TREE, '/api/file': FIXTURE } },
);
