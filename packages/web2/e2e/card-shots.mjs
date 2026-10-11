#!/usr/bin/env node
/**
 * (lane cards, review v2) Icon actions with tooltips, the title on one line; a hover shot. Shots go to shots/v2.
 * (lane cards) Card chrome shots: normal, mid-resize, locked at the minimum, collapsed row; dark and light. Original header follows.
 * (lane visual) Inline svg and html in the chat: dark and light shots at 1440x900. Original header follows. (v2: id on the card, quiet chrome, Reference.)
 * R11 chat shots, dark and light at 1440x900: the thinking shimmer, subagent
 * rows (with the centre-alignment check), the step timeline (dot, icon and
 * label centres), the diagram's hover film, the watchdog row, and the Agents
 * surface with two chats. Live turns are faked at /api/acp/run-node (no agent
 * runs). Shots go to $SHOTS (default
 * /mnt/project-files/sequence/harness-study/t3gap/cards/shots).
 */
import fs from 'node:fs';
import http from 'node:http';
import { sel, suite } from './lib/harness.mjs';
import { gatewaySvg, tallSvg } from './fixtures/gatewayPath.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/harness-study/t3gap/cards/shots/v3';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = {
  index: {
    version: 1,
    activeId: 'c1',
    sessions: [
      { id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) },
      { id: 'c2', title: 'Rename the session store', titleEdited: false, createdAt: at(3), updatedAt: at(4) },
    ],
  },
  scope: 'workspace',
  repos: [],
};
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
let clock = 1;
const tool = (id, title, toolKind, status, ms, extra = {}) => {
  const startedAt = clock;
  clock += ms;
  return { id, title, toolKind, status, startedAt, endedAt: startedAt + ms, ...extra };
};
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const SVG = ['```svg', gatewaySvg(), '```'].join('\n');
const TALL = ['```svg', tallSvg(), '```'].join('\n');
const MERMAID = ['```mermaid', 'flowchart LR', '  Client --> Proxy', '  Proxy --> Limiter', '  Limiter --> Store', '```'].join('\n');
const HTML = ['```html', '<style>.row{display:flex;gap:8px;align-items:center}.bar{height:14px;border-radius:7px;background:var(--seq-accent)}.card{border:1px solid var(--seq-edge);background:var(--seq-surface);border-radius:10px;padding:10px 12px}small{color:var(--seq-muted)}</style>', '<div class="card"><b>Requests per window</b> <small>before and after the fix</small>', '<div class="row"><small style="width:60px">before</small><div class="bar" style="width:92%"></div></div>', '<div class="row"><small style="width:60px">after</small><div class="bar" style="width:31%"></div></div>', '<button onclick="this.textContent=\'Clicked: scripts run, network does not\'">Try it</button></div>', '```'].join('\n');
const TEXT = 'The window is keyed on `req.ip`, which is the proxy for every request. Here is the path, then the effect of the fix.\n\n' + SVG + '\n\n' + TALL + '\n\n' + MERMAID + '\n\n' + HTML + '\n\nPlans: [chart.html](/work/chart.html).';
const RUNS_C1 = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Draw why the rate limiter returns 200 under load', text: TEXT, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(18400, 2100, 61200) },
  ],
};
const RUNS_C2 = { runs: [{ id: 'u1', agentRef: 'codex', prompt: 'x', text: 'ok', status: 'done', error: null, stopReason: 'end_turn', startedAt: 20_000, endedAt: 30_000, model: null, nodeId: null, tools: [] }] };
let runsFor = () => RUNS_C1;
async function fresh(page, base, theme) {
  await page.unroute('**/api/acp/runs*').catch(() => {});
  await page.unroute('**/api/acp/capabilities*').catch(() => {});
  await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
  await page.route('**/api/acp/runs*', (r) => {
    const id = new URL(r.request().url()).searchParams.get('chatId');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id === 'c2' ? RUNS_C2 : runsFor()) });
  });
  await page.goto(base);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.reload();
  await page.evaluate((t) => {
    try {
      localStorage.setItem('seq.theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForSelector(sel('shell'));
  await page.locator('section.s2-chat [data-testid="agent-run"], section.s2-chat .s2-run').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
}


await suite(
  'card-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1100, height: 1500 });
    const drawings = new Map();
    await page.route('**/api/drawings', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}');
      if (!drawings.has(b.source)) drawings.set(b.source, drawings.size + 1);
      const n = drawings.get(b.source);
      const svg = b.kind === 'svg';
      const title = svg ? (/<title>([^<]*)<\/title>/.exec(b.source)?.[1] ?? 'drawing') : 'Requests per window';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drawing: { id: `d${n}`, title }, name: `${n}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${b.kind}`, version: 1 }) });
    });
    const state = () => page.locator(sel('chat-diagram')).first();
    for (const theme of ['dark', 'light']) {
      await page.route('**/api/file*', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: '<p>x</p>' }));
      await fresh(page, base, theme);
      const card = state();
      await page.locator(sel('chat-card-grip')).first().waitFor({ timeout: 8000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="chat-card-title"]')?.getAttribute('title'));
      const shot = async (name, pad = 28, loc = card) => {
        const box = await loc.boundingBox();
        await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1100, box.width + pad * 2), height: box.height + pad * 2 } });
      };
      await card.scrollIntoViewIfNeeded();
      await check(`${theme}: header is the capitalised title only; id and file name are in the tooltip`, async () => {
        const t = page.locator(sel('chat-card-title')).first();
        const text = await t.innerText();
        if (text !== 'Request path through the gateway') throw new Error(`title "${text}"`);
        if (!/^Request path through the gateway\nd\d+$/.test((await t.getAttribute('title')) ?? '')) throw new Error('tooltip');
        const all = await card.evaluate((n) => n.textContent + [...n.querySelectorAll('*')].map((e) => [...e.attributes].map((a) => a.value).join(' ')).join(' '));
        if (/\d+-request-path|\.svg\b/.test(all)) throw new Error('a file name is shown on the card');
        const bar = await card.locator('.dgm-bar').first().innerText();
        if (bar.trim() !== 'Request path through the gateway') throw new Error(`bar text "${bar}"`);
      });
      await card.hover();
      await page.waitForTimeout(250);
      await check(`${theme}: the title is one line and the actions are icons that do not squeeze it`, async () => {
        const t = page.locator(sel('chat-card-title')).first();
        const lines = await t.evaluate((n) => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)));
        if (lines !== 1) throw new Error(`${lines} lines`);
        const acts = await card.locator('.dgm-act').evaluateAll((ns) => ns.map((n) => ({ w: Math.round(n.getBoundingClientRect().width), text: n.textContent, op: getComputedStyle(n).opacity })));
        if (acts.length !== 5) throw new Error(`${acts.length} actions`);
        if (acts.some((a) => a.text !== '' || a.w !== 26 || a.op !== '1')) throw new Error(JSON.stringify(acts));
      });
      await shot('card-normal');
      await check(`${theme}: actions are hidden until the card is hovered or focused`, async () => {
        await page.mouse.move(2, 2);
        await page.waitForTimeout(250);
        const op = await card.locator('.dgm-act').first().evaluate((n) => getComputedStyle(n).opacity);
        if (op !== '0') throw new Error(`opacity ${op} at rest`);
        await card.locator(sel('chat-visual-copy')).focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab'); // keyboard focus: :focus-visible
        await page.waitForTimeout(250);
        const tip = await card.locator(sel('chat-visual-copy')).evaluate((n) => ({ op: getComputedStyle(n).opacity, tip: getComputedStyle(n, '::after').opacity, text: getComputedStyle(n, '::after').content }));
        if (tip.op !== '1' || tip.tip !== '1' || !/Copy source/.test(tip.text)) throw new Error(JSON.stringify(tip));
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      });
      await card.locator(sel('chat-visual-copy')).hover();
      await page.waitForTimeout(700);
      await check(`${theme}: hovering an action names it in a tooltip that stays inside the card`, async () => {
        const r = await card.locator(sel('chat-visual-copy')).evaluate((n) => ({ op: getComputedStyle(n, '::after').opacity, card: n.closest('figure').getBoundingClientRect().right, btn: n.getBoundingClientRect().right }));
        if (r.op !== '1') throw new Error(`tooltip opacity ${r.op}`);
        if (r.btn > r.card) throw new Error('outside the card');
      });
      await shot('card-hover');
      /* ── the size rule: a tall card opens at the cap; the bar drags it bigger ── */
      const tall = page.locator(sel('chat-diagram')).nth(1);
      const tallBody = tall.locator(sel('chat-card-body'));
      const tallH = () => tallBody.evaluate((n) => Math.round(n.getBoundingClientRect().height));
      await tall.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const CAP = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-min')));
      await check(`${theme}: a tall card opens at the cap (--col-min = ${CAP}px), clipped at 1:1 (text never shrinks), no sideways scrollbar`, async () => {
        if (!(CAP >= 360 && CAP <= 420)) throw new Error(`cap token ${CAP}`);
        const h = await tallH();
        if (Math.abs(h - CAP) > 2) throw new Error(`body ${h}, cap ${CAP}`);
        const m = await tall.locator('.dgm-art').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, ov: getComputedStyle(n).overflowX, svg: Math.round(n.querySelector('svg').getBoundingClientRect().height) }));
        if (m.sw > m.cw + 1 || m.ov === 'auto' || m.ov === 'scroll') throw new Error(JSON.stringify(m));
        if (m.svg <= CAP) throw new Error(`svg ${m.svg} was scaled down to the cap`);
        const px = await tall.locator('svg text').evaluateAll((ns) => ns.map((t) => parseFloat(getComputedStyle(t).fontSize) * t.ownerSVGElement.getScreenCTM().a));
        if (!px.length || Math.min(...px) < 11) throw new Error(`rendered text ${Math.min(...px)}px`);
        const mask = await tallBody.evaluate((n) => getComputedStyle(n).maskImage || getComputedStyle(n).webkitMaskImage);
        if (!/linear-gradient/.test(mask)) throw new Error('no bottom fade');
        if ((await tall.getAttribute('data-capped')) !== 'true') throw new Error('no data-capped');
      });
      await shot('card-capped', 28, tall);
      await tall.locator(sel('chat-card-grip')).hover();
      await page.waitForTimeout(300);
      await check(`${theme}: the handle has a 20px hit area, a visible pill that grows on hover, and a resize cursor`, async () => {
        const g = await tall.locator(sel('chat-card-grip')).evaluate((n) => ({ h: Math.round(n.getBoundingClientRect().height), cur: getComputedStyle(n).cursor, bg: getComputedStyle(n).backgroundColor, pill: Math.round(n.firstElementChild.getBoundingClientRect().width), op: getComputedStyle(n.firstElementChild).opacity }));
        if (g.h < 20 || g.cur !== 'ns-resize' || g.pill < 40 || Number(g.op) < 0.8) throw new Error(JSON.stringify(g));
        if (/rgb\(\d+, \d+, \d+\)$/.test(g.bg)) throw new Error(`solid handle ${g.bg}`);
      });
      await shot('card-capped-hover', 28, tall);
      const tg = await tall.locator(sel('chat-card-grip')).boundingBox();
      await page.mouse.move(tg.x + tg.width / 2, tg.y + tg.height / 2);
      await page.mouse.down();
      await page.mouse.move(tg.x + tg.width / 2, tg.y + tg.height / 2 + 100, { steps: 8 });
      await page.mouse.up();
      await check(`${theme}: dragging the bar down opens a capped card bigger, and it is still there after a reload`, async () => {
        const h = await tallH();
        if (Math.abs(h - (CAP + 100)) > 4) throw new Error(`body ${h}`);
        await page.reload();
        await page.locator(sel('chat-card-grip')).nth(1).waitFor({ timeout: 15000 });
        await page.waitForTimeout(500);
        const again = await page.locator(sel('chat-card-body')).nth(1).evaluate((n) => Math.round(n.getBoundingClientRect().height));
        if (Math.abs(again - (CAP + 100)) > 4) throw new Error(`after reload ${again}`);
      });
      await check(`${theme}: Home on the bar returns to the minimum; End opens to the natural height`, async () => {
        const g = page.locator(sel('chat-card-grip')).nth(1);
        await g.focus();
        await page.keyboard.press('End');
        await page.waitForTimeout(250);
        const full = await page.locator(sel('chat-card-body')).nth(1).evaluate((n) => Math.round(n.getBoundingClientRect().height));
        if (full <= CAP + 100) throw new Error(`natural ${full}`);
        await page.keyboard.press('Home');
        await page.waitForTimeout(250);
        const min = await page.locator(sel('chat-card-body')).nth(1).evaluate((n) => Math.round(n.getBoundingClientRect().height));
        if (Math.abs(min - 96) > 2) throw new Error(`min ${min}`);
        await page.reload();
        await page.locator(sel('chat-card-grip')).nth(1).waitFor({ timeout: 15000 });
      });
      /* ── mermaid: visible arrowheads, enough contrast, straight routing ── */
      const mer = page.locator(sel('chat-diagram')).nth(2);
      await mer.scrollIntoViewIfNeeded();
      await mer.locator('svg').first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(500);
      await check(`${theme}: mermaid edges are 1.5px, in the strong line colour, with filled arrowheads`, async () => {
        const m = await mer.evaluate((n) => {
          const link = n.querySelector('.flowchart-link');
          const mk = n.querySelector('marker path');
          const ink2 = getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim();
          const probe = document.createElement('i');
          probe.style.color = ink2;
          document.body.appendChild(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return { n: n.querySelectorAll('.flowchart-link').length, w: link && getComputedStyle(link).strokeWidth, stroke: link && getComputedStyle(link).stroke, markers: n.querySelectorAll('marker').length, fill: mk && getComputedStyle(mk).fill, want, d: link && link.getAttribute('d'), sw: n.querySelector('.dgm-art').scrollWidth > n.querySelector('.dgm-art').clientWidth + 1 };
        });
        if (m.n !== 3 || m.w !== '1.5px' || m.stroke !== m.want || m.markers < 1 || m.fill !== m.want) throw new Error(JSON.stringify(m));
        if (m.sw) throw new Error('sideways scroll');
        if (/C/.test(m.d)) throw new Error(`a curved route ${m.d}`);
      });
      await shot('mermaid-edges', 28, mer);
      await card.scrollIntoViewIfNeeded();
      await card.hover({ position: { x: 20, y: 80 } });
      const grip = page.locator(sel('chat-card-grip')).first();
      const gb = await grip.boundingBox();
      const x = gb.x + gb.width / 2;
      const y = gb.y + gb.height / 2;
      const bodyH = () => page.locator(sel('chat-card-body')).first().evaluate((n) => Math.round(n.getBoundingClientRect().height));
      const natural = await bodyH();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - 25, { steps: 6 });
      await check(`${theme}: dragging up shrinks the body and scales the svg`, async () => {
        const h = await bodyH();
        if (!(h < natural - 15)) throw new Error(`body ${h} vs natural ${natural}`);
        const sh = await card.locator('svg').first().evaluate((n) => Math.round(n.getBoundingClientRect().height));
        if (sh > h) throw new Error(`svg ${sh} taller than body ${h}`);
      });
      await shot('card-mid-resize');
      await page.mouse.move(x, y - (natural - 96) - 14, { steps: 8 });
      await check(`${theme}: past the threshold it locks at the minimum`, async () => {
        const h = await bodyH();
        if (Math.abs(h - 96) > 2) throw new Error(`locked at ${h}`);
      });
      await page.mouse.up();
      await shot('card-locked-min');
      await grip.focus();
      await page.keyboard.press('Enter');
      await check(`${theme}: Enter collapses to a one-line row; click opens it at the height it had`, async () => {
        const row = page.locator(sel('chat-card-row')).first();
        await row.waitFor({ timeout: 2000 });
        const rh = await row.evaluate((n) => Math.round(n.getBoundingClientRect().height));
        if (rh > 36) throw new Error(`row ${rh}px`);
      });
      await shot('card-collapsed-row');
      await check(`${theme}: collapsed stays collapsed after a reload`, async () => {
        await page.reload();
        await page.locator(sel('chat-card-row')).first().waitFor({ timeout: 15000 });
      });
      await page.locator(sel('chat-card-row')).first().scrollIntoViewIfNeeded();
      await page.locator(sel('chat-card-row')).first().click();
      await check(`${theme}: expanded again at the locked height`, async () => {
        await page.waitForTimeout(300);
        const h = await bodyH();
        if (Math.abs(h - 96) > 2) throw new Error(`body ${h}`);
      });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS_C1 } },
);
