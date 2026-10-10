#!/usr/bin/env node
/**
 * Round 0.1.5 (G3): inline chat drawings, in the shipped bundle. A replayed answer (no model runs) holds
 *   (a) a 6-step flow the model wrote left to right (the visual kit) and the same as a hand-written svg strip,
 *   (b) a dense architecture sketch with long labels and an arrow label on a border (a hand-written svg),
 *   (c) a chart (the kit), and a left-to-right mermaid flow.
 * Checks: one click folds and unfolds; no card has a scrollbar; every drawing fits the chat column; the title is
 * centred on the card; the full-screen preview centres the drawing. Shots (inline expanded, folded, full screen)
 * at 1440 wide and at a 420 px chat column go to $SHOTS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? path.join(os.tmpdir(), 'sequence-drawings-shots');
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'How a request moves through the agent', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] },
  scope: 'workspace',
  repos: [],
};
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

const STEPS = ['Client', 'Gateway', 'Auth', 'Router', 'Model', 'Store'];
const FLOW = {
  component: 'flow',
  spec: {
    title: 'Request path',
    direction: 'LR',
    nodes: STEPS.map((label) => ({ id: label.toLowerCase(), label })),
    edges: STEPS.slice(0, -1).map((a, i) => ({ from: a.toLowerCase(), to: STEPS[i + 1].toLowerCase(), label: i === 1 ? 'verify token' : undefined })),
  },
};
const CHART = { component: 'bar', spec: { title: 'p95 latency by route', categories: ['/ask', '/plan', '/draw', '/files', '/runs'], series: [{ name: 'ms', values: [420, 310, 180, 95, 260] }], unit: 'ms' } };

/** The way a model draws it unprompted: a strip of boxes wider than the column, long labels, an arrow label on a border. */
function sketch() {
  const labels = ['1 THINK about the next step', '2 ACT call a tool', '3 OBSERVE tool result and state', '4 REFLECT update the plan', '5 DONE write the answer'];
  const w = 130;
  const boxes = labels.map((t, i) => {
    const x = 16 + i * 150;
    const [head, ...rest] = t.split(' ');
    return `<rect x="${x}" y="40" width="${w}" height="56" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="${x + w / 2}" y="72" text-anchor="middle" font-size="13">${t}</text>`;
  });
  const arrows = labels.slice(0, -1).map((_, i) => `<line x1="${16 + i * 150 + w}" y1="68" x2="${16 + (i + 1) * 150 - 2}" y2="68" stroke="currentColor" marker-end="url(#a)"/>`);
  const loop = `<path d="M${16 + 3 * 150 + 65} 96 v34 h-${2 * 150} v-32" fill="none" stroke="currentColor" stroke-dasharray="4 3" marker-end="url(#a)"/><text x="${16 + 2 * 150 + 140}" y="97" text-anchor="middle" font-size="12">loop 3-4 until done</text>`;
  return `<svg viewBox="0 0 770 150" xmlns="http://www.w3.org/2000/svg" role="img"><title>Agent memory loop</title><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 Z"/></marker></defs>${boxes.join('')}${arrows.join('')}${loop}</svg>`;
}
const MERMAID = ['```mermaid', 'flowchart LR', '  Client --> Proxy', '  Proxy --> Limiter', '  Limiter --> Store', '  Store --> Audit', '```'].join('\n');
const fence = (lang, body) => ['```' + lang, body, '```'].join('\n');
const TEXT = [
  'Here is the path a request takes, then the loop the agent runs, and the latency by route.',
  fence('visual', JSON.stringify(FLOW)),
  fence('svg', sketch()),
  fence('visual', JSON.stringify(CHART)),
  MERMAID,
].join('\n\n');
const RUNS = {
  runs: [{ id: 't1', agentRef: 'claude', prompt: 'Draw how a request moves through the agent', text: TEXT, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: { input: 1000, output: 800, cacheRead: 0, cacheWrite: 0, thought: 0, total: 1800 } }],
};

async function fresh(page, base, theme) {
  await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
  await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNS) }));
  await page.goto(base);
  await page.evaluate((t) => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('seq.theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.reload();
  await page.waitForSelector(sel('shell'));
  await page.locator(sel('chat-diagram')).first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-diagram"][data-state="drawn"]').length >= 4, null, { timeout: 20000 });
  await page.waitForTimeout(800);
}

await suite('drawings-shots', async ({ page, base, check }) => {
  const drawings = new Map();
  await page.route('**/api/drawings', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}');
    if (!drawings.has(b.source)) drawings.set(b.source, drawings.size + 1);
    const n = drawings.get(b.source);
    const title = /<title>([^<]*)<\/title>/.exec(b.source)?.[1] ?? 'drawing';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drawing: { id: `d${n}`, title }, name: `${n}-drawing.svg`, version: 1 }) });
  });
  await page.route('**/api/file*', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: '<p>x</p>' }));
  for (const [name, width, height] of [['1440', 1440, 1000], ['narrow1100', 1100, 1000]]) {
    await page.setViewportSize({ width, height });
    await fresh(page, base, 'dark');
    const cards = page.locator(sel('chat-diagram'));
    const n = await cards.count();
    const col = await page.locator('section.s2-chat').first().evaluate((s) => Math.round((s.querySelector('[data-testid="chat-diagram"]') ?? s).getBoundingClientRect().width));
    console.log(`[drawings-shots] ${name}: ${n} cards, card width ${col}px`);
    await check(`${name}: no card or drawing has a scrollbar, and every drawing fits the card width`, async () => {
      const rows = await cards.evaluateAll((ns) => ns.map((c) => {
        const art = c.querySelector('.dgm-art');
        const svg = art?.querySelector('svg');
        const sw = (e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
        const scrolls = [c, c.querySelector('.dgm-body'), art].filter(Boolean).filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) || ['auto', 'scroll'].includes(getComputedStyle(e).overflowX));
        return { kind: c.dataset.kind, scrolls: scrolls.length, over: art ? sw(art) : false, svgW: svg ? Math.round(svg.getBoundingClientRect().width) : 0, artW: art ? Math.round(art.getBoundingClientRect().width) : 0, h: svg ? Math.round(svg.getBoundingClientRect().height) : 0 };
      }));
      console.log(JSON.stringify(rows));
      for (const r of rows) if (r.scrolls || r.over || r.svgW > r.artW + 1) throw new Error(JSON.stringify(r));
    });
    await check(`${name}: the 6-step flow is taller than wide (a column)`, async () => {
      const r = await cards.first().locator('.dgm-art svg').first().evaluate((s) => { const b = s.getBoundingClientRect(); return { w: b.width, h: b.height }; });
      if (r.h <= r.w) throw new Error(JSON.stringify(r));
    });
    await check(`${name}: every title sits on the middle of its card`, async () => {
      const rows = await cards.evaluateAll((ns) => ns.map((c) => {
        const t = c.querySelector('[data-testid="chat-card-title"]').getBoundingClientRect();
        const f = c.getBoundingClientRect();
        return { off: Math.round(Math.abs(t.left + t.width / 2 - (f.left + f.width / 2))) };
      }));
      for (const r of rows) if (r.off > 3) throw new Error(JSON.stringify(rows));
    });
    await check(`${name}: hand-written text stays inside its boxes (the fit pass)`, async () => {
      const bad = await cards.nth(1).evaluate((c) => {
        const svg = c.querySelector('.dgm-art svg');
        const rects = [...svg.querySelectorAll('rect')].map((r) => r.getBoundingClientRect());
        return [...svg.querySelectorAll('text')].map((t) => t.getBoundingClientRect()).filter((tb) => {
          const home = rects.find((r) => tb.left + tb.width / 2 >= r.left && tb.left + tb.width / 2 <= r.right && tb.top + tb.height / 2 >= r.top && tb.top + tb.height / 2 <= r.bottom);
          return home && (tb.left < home.left - 0.5 || tb.right > home.right + 0.5 || tb.top < home.top - 0.5 || tb.bottom > home.bottom + 0.5);
        }).length;
      });
      if (bad) throw new Error(`${bad} texts outside their box`);
    });
    const area = page.locator('section.s2-chat').first();
    await cards.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${name}-1-expanded.png`, fullPage: false });
    for (let i = 0; i < n; i += 1) await cards.nth(i).screenshot({ path: `${OUT}/${name}-card${i + 1}-expanded.png` });
    await check(`${name}: one click on the fold button collapses a card, one click on its row opens it`, async () => {
      const t0 = Date.now();
      await cards.first().locator(sel('chat-card-fold')).click();
      await cards.first().locator(sel('chat-card-row')).waitFor({ timeout: 2000 });
      const hidden = await cards.first().locator(sel('chat-card-body')).evaluate((b) => b.hidden);
      if (!hidden) throw new Error('body still shown');
      await cards.first().locator(sel('chat-card-row')).click();
      await cards.first().locator(sel('chat-card-fold')).waitFor({ timeout: 2000 });
      if (Date.now() - t0 > 3000) throw new Error('slow');
    });
    for (let i = 0; i < n; i += 1) await cards.nth(i).locator(sel('chat-card-fold')).click();
    await page.waitForTimeout(300);
    await cards.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${name}-2-folded.png` });
    await check(`${name}: folded stays folded after a reload`, async () => {
      await page.reload();
      await page.locator(sel('chat-card-row')).first().waitFor({ timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="chat-card-row"]').length >= 4, null, { timeout: 15000 }).catch(() => {});
      const rows = await page.locator(sel('chat-card-row')).count();
      if (rows !== n) throw new Error(`${rows} of ${n} rows`);
    });
    for (let i = 0; i < n; i += 1) await page.locator(sel('chat-card-row')).first().click();
    await page.waitForTimeout(300);
    /* Full screen: Open on the hand-written sketch. */
    await cards.nth(1).hover();
    await cards.nth(1).locator(sel('chat-visual-open')).click();
    await page.locator(sel('chat-visual-dialog')).waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
    await check(`${name}: full screen centres the drawing both ways with even padding`, async () => {
      const frame = page.frameLocator('[data-testid="chat-visual-dialog"] iframe').first();
      const r = await frame.locator('svg').first().evaluate((s) => {
        const b = s.getBoundingClientRect();
        const vb = s.viewBox.baseVal;
        const k = Math.min(b.width / vb.width, b.height / vb.height);
        const w = vb.width * k;
        const h = vb.height * k;
        const left = b.left + (b.width - w) / 2;
        const top = b.top + (b.height - h) / 2;
        return { l: Math.round(left), r: Math.round(innerWidth - (left + w)), t: Math.round(top), b: Math.round(innerHeight - (top + h)), scale: Math.round(k * 100) / 100 };
      });
      console.log(JSON.stringify(r));
      if (Math.abs(r.l - r.r) > 3 || Math.abs(r.t - r.b) > 3) throw new Error(JSON.stringify(r));
    });
    await page.screenshot({ path: `${OUT}/${name}-3-fullscreen.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}, { routes: { "/api/sessions": SESSIONS, "/api/acp/runs": RUNS } });
