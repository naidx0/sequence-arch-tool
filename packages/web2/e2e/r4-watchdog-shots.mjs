#!/usr/bin/env node
/**
 * 017 R4 watchdog shots and alignment measurement: starting and hung, dark and light, wide and a 320px chat column.
 * 0161 S2: the card is one line. The detail is the sentence's title (tooltip) and screen-reader text, not visible.
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


const CHECK = process.env.CHECK === '1';
await suite(
  'r4-watchdog-shots',
  async ({ page, base, log, check }) => {
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
      await page.route('**/api/acp/run-node*', () => {});
      const box = page.locator('section.s2-chat textarea').first();
      await box.click();
      await box.fill('Run the gateway tests again');
      await box.press('Enter');
      for (const [state, skew] of [['starting', 47_000], ['hung', 190_000]]) {
        await page.evaluate((s) => { window.__skew = s; }, skew);
        const w = page.locator(sel('agent-run-watchdog'));
        await w.waitFor({ timeout: 10000 });
        for (const width of ['wide', 'default', 'narrow']) {
          await page.evaluate((mode) => {
            let st = document.getElementById('r4-narrow');
            if (!st) { st = document.createElement('style'); st.id = 'r4-narrow'; document.head.appendChild(st); }
            const w = { narrow: 320, wide: 560 }[mode]; st.textContent = w ? `section.s2-chat{flex:none!important;width:${w}px!important;max-width:${w}px!important;min-width:0!important}` : '';
          }, width);
          await page.waitForTimeout(400);
          const m = await w.evaluate((n) => {
            const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, cy: (b.top + b.bottom) / 2 }; };
            const card = r(n);
            const mark = r(n.querySelector('.agnote-mark'));
            const text = r(n.querySelector('.agnote-text'));
            const textEl = n.querySelector('.agnote-text');
            const detail = r(n.querySelector('.agnote-sr'));
            const title = textEl.getAttribute('title');
            const fs = parseFloat(getComputedStyle(textEl).fontSize);
            const btns = [...n.querySelectorAll('button')].map(r);
            const run = n.closest('.s2-run');
            const asst = [...document.querySelectorAll('.s2-asst .s2-answer, .s2-asst p')].map(r).slice(-1)[0] ?? null;
            const col = run ? r(run) : null;
            const cs = getComputedStyle(n);
            const btnShadow = [...n.querySelectorAll('button')].map((b) => getComputedStyle(b).boxShadow);
            return { card, mark, text, detail, title, fs, btnShadow, btns, col, asst, bg: cs.backgroundColor, backdrop: cs.backdropFilter, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), chatW: document.querySelector('section.s2-chat').getBoundingClientRect().width };
          });
          log(theme, state, width, JSON.stringify(m));
          await page.screenshot({ path: `${OUT}/watchdog-${state}-${width}-${theme}_${STEM}_full.png` });
          const wb = await w.boundingBox();
          const r = await page.locator('section.s2-chat').boundingBox();
          await page.screenshot({ path: `${OUT}/watchdog-${state}-${width}-${theme}_${STEM}.png`, clip: { x: r.x, y: Math.max(0, wb.y - 100), width: r.width, height: Math.min(wb.height + 200, 320) } });
          if (CHECK) {
            await check(`${theme}/${state}/${width}: card left edge is the transcript column's left edge`, () => { if (Math.abs(m.card.l - m.col.l) > 1) throw new Error(`${m.card.l} vs ${m.col.l}`); });
            await check(`${theme}/${state}/${width}: card right edge within the column`, () => { if (m.card.r > m.col.r + 1) throw new Error(`${m.card.r} vs ${m.col.r}`); });
            await check(`${theme}/${state}/${width}: the sentence is one line`, () => {
              if (m.text.b - m.text.t > m.fs * 1.6) throw new Error(`text ${m.text.b - m.text.t}px tall at ${m.fs}px`);
            });
            await check(`${theme}/${state}/${width}: no detail line is visible (the screen-reader span is clipped to 1px)`, () => {
              if (m.detail.r - m.detail.l > 1.5 || m.detail.b - m.detail.t > 1.5) throw new Error(`detail box ${m.detail.r - m.detail.l}x${m.detail.b - m.detail.t}`);
            });
            await check(`${theme}/${state}/${width}: the detail is the sentence's tooltip`, () => {
              const want = state === 'hung' ? 'Stop the turn, or try it again.' : 'It may still be warming up.';
              if (m.title !== want) throw new Error(`title ${JSON.stringify(m.title)}`);
            });
            await check(`${theme}/${state}/${width}: the buttons carry no box shadow`, () => {
              const bad = m.btnShadow.filter((s) => s !== 'none');
              if (bad.length) throw new Error(bad.join(' | '));
            });
            await check(`${theme}/${state}/${width}: inner padding even (icon inset == buttons inset)`, () => {
              const li = m.mark.l - m.card.l; const ri = m.card.r - Math.max(...m.btns.map((b) => b.r));
              if (Math.abs(li - ri) > 1.5) throw new Error(`left ${li} right ${ri}`);
            });
            if (width === 'wide') await check(`${theme}/${state}: icon, sentence and buttons share one centre line`, () => {
              const cys = [m.mark.cy, m.text.cy, ...m.btns.map((b) => b.cy)];
              if (Math.max(...cys) - Math.min(...cys) > 1.5) throw new Error(JSON.stringify(cys));
            });
            if (width !== 'wide') await check(`${theme}/${state}: buttons wrap below, right-aligned to the same inset`, () => {
              const top = Math.min(...m.btns.map((b) => b.t));
              if (top < m.text.b - 1) throw new Error(`buttons ${top} not below text ${m.text.b}`);
              const ri = m.card.r - Math.max(...m.btns.map((b) => b.r)); const li = m.mark.l - m.card.l;
              if (Math.abs(li - ri) > 1.5) throw new Error(`left ${li} right ${ri}`);
            });
          }
        }
      }
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS } },
);
