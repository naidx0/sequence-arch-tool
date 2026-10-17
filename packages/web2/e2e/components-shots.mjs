#!/usr/bin/env node
/**
 * (lane components) The visual kit in the real app, light and dark:
 *   gallery-<theme>.png          every component in one message (tall window)
 *   <id>-<theme>.png             each component alone
 *   ai-gateway-<theme>.png       "an AI feature gateway at 1,000 users" as an agent would answer it
 * Live turns are faked at /api/acp/runs (no agent runs); the fences are what an agent writes.
 * Shots go to $SHOTS (default /mnt/project-files/sequence/harness-study/t3gap/components/shots).
 */
import fs from 'node:fs';
import path from 'node:path';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/harness-study/t3gap/components/shots';
fs.mkdirSync(OUT, { recursive: true });
const { COMPONENTS } = await import('../../schema/dist/visual/index.js');

const at = (h) => new Date(Date.UTC(2026, 9, 9, h)).toISOString();
const SESSIONS = { index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Gateway sizing', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] }, scope: 'workspace', repos: [] };
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const usage = { input: 9800, output: 1400, cacheRead: 40200, cacheWrite: 0, thought: 0, total: 11200 };
const fence = (spec) => '```visual\n' + JSON.stringify(spec) + '\n```';

const GATEWAY = COMPONENTS.find((c) => c.id === 'capacity').example;
const FLOW = {
  component: 'flow',
  title: 'Proposed AI feature gateway',
  spec: {
    nodes: [{ id: 'app', label: 'Product app', kind: 'user' }, { id: 'gw', label: 'AI gateway', sub: 'auth, quota, routing', group: 'new' }, { id: 'cache', label: 'Response cache', kind: 'db', group: 'new' }, { id: 'quota', label: 'Quota service' }, { id: 'ev', label: 'Usage events', kind: 'queue', group: 'new' }, { id: 'llm', label: 'Model provider', kind: 'external' }, { id: 'wh', label: 'Warehouse', kind: 'db' }],
    edges: [{ from: 'app', to: 'gw', label: 'HTTPS' }, { from: 'gw', to: 'cache', label: 'lookup' }, { from: 'gw', to: 'quota', label: 'check' }, { from: 'gw', to: 'llm', label: 'stream' }, { from: 'gw', to: 'ev' }, { from: 'ev', to: 'wh' }],
  },
};
const PATH = {
  component: 'loadpath',
  spec: { title: 'Where a request spends its time', hops: [{ name: 'CDN', rps: 44, latencyMs: 12, util: 0.02 }, { name: 'AI gateway', sub: 'auth, quota', rps: 44, latencyMs: 40, util: 0.2 }, { name: 'Model proxy', rps: 31, latencyMs: 820, util: 0.65, note: 'tightest' }, { name: 'Provider', sub: 'external', rps: 31, latencyMs: 300 }] },
};
const GATEWAY_TEXT = [
  'Here is the sizing for the proposed gateway at 1,000 users (40 requests per user per hour, peak at 4x the average). The model proxy is the first service to saturate, at about 65% of capacity today and past the 80% line in month 3 if usage grows 8% a month.',
  '',
  fence({ component: 'capacity', spec: GATEWAY }),
  '',
  'The shape I would build:',
  '',
  fence(FLOW),
  '',
  'And the request path, with the latency budget (most of it is the model call, not the gateway):',
  '',
  fence(PATH),
  '',
  'Recommendation: put the response cache in front of the model proxy first; it moves the breach out by several months for no new capacity.',
].join('\n');

const WIDE = ['line', 'bar', 'kpi', 'sparkline', 'histogram', 'donut', 'flow', 'sequence', 'loadpath', 'timeline', 'capacity', 'dashboard'];
const GALLERY_TEXT = WIDE.map((id) => `**${id[0].toUpperCase() + id.slice(1)}**\n\n${fence({ component: id, spec: COMPONENTS.find((c) => c.id === id).example })}`).join('\n\n');

const run = (prompt, text) => ({ runs: [{ id: 't1', agentRef: 'claude', prompt, text, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null, tools: [], usage }] });
let current = run('Propose an AI feature gateway for our service. At 1,000 users, where does the load hit, what does network analytics look like, and give me a forecast.', GATEWAY_TEXT);

async function fresh(page, base, theme) {
  await page.unroute('**/api/acp/runs*').catch(() => {});
  await page.unroute('**/api/acp/capabilities*').catch(() => {});
  await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
  await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }));
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
  await page.waitForTimeout(600);
}

await suite(
  'components-shots',
  async ({ page, base, check }) => {
    const drawings = new Map();
    await page.route('**/api/drawings', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}');
      if (!drawings.has(b.source)) drawings.set(b.source, drawings.size + 1);
      const n = drawings.get(b.source);
      const title = /<title>([^<]*)<\/title>/.exec(b.source)?.[1] ?? 'drawing';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drawing: { id: `d${n}` }, name: `${n}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.svg`, version: 1 }) });
    });
    for (const theme of ['light', 'dark']) {
      /* the AI gateway answer, at a normal window */
      current = run('Propose an AI feature gateway for our service. At 1,000 users, where does the load hit, what does network analytics look like, and give me a forecast.', GATEWAY_TEXT);
      await page.setViewportSize({ width: 1440, height: 900 });
      await fresh(page, base, theme);
      await page.locator(sel('chat-diagram-art')).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      await check(`${theme}: the three visuals draw as svg with an id on the card, no error`, async () => {
        const n = await page.locator(sel('chat-diagram-art')).count();
        if (n !== 3) throw new Error(`${n} drawings`);
        if ((await page.locator(sel('chat-visual-error')).count()) !== 0) throw new Error('an error card');
        /* (lane cards) the id and file name moved from the header into the title's tooltip: "<Title>\nd14, 14-name.svg". */
        await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="chat-card-title"]')].filter((n) => /\nd\d+/.test(n.getAttribute('title') ?? '')).length === 3);
        const ids = await page.locator(sel('chat-card-title')).evaluateAll((ns) => ns.map((n) => n.getAttribute('title') ?? ''));
        if (ids.length !== 3 || !ids.every((t) => /\nd\d+(?: v\d+)?$/.test(t))) throw new Error(`ids ${JSON.stringify(ids)}`);
      });
      await check(`${theme}: the drawing follows the theme (series colours resolve, text is not black on dark)`, async () => {
        const m = await page.locator(sel('chat-diagram-art')).first().evaluate((el) => {
          const s = getComputedStyle(el);
          const text = el.querySelector('text');
          return { s1: s.getPropertyValue('--seq-s1').trim(), fg: s.getPropertyValue('--seq-fg').trim(), fill: text ? getComputedStyle(text).fill : '' };
        });
        if (!m.s1 || !m.fg) throw new Error(`vars ${JSON.stringify(m)}`);
        if (theme === 'dark' && /^rgb\(\s*(0|2?\d),\s*(0|2?\d),\s*(0|2?\d)\)$/.test(m.fill)) throw new Error(`dark text fill ${m.fill}`);
      });
      await check(`${theme}: no kit card is capped at the default chat width (the capacity picture is 398 px, under the 420 cap), text at 1:1 (never scaled), and every kit title is the spec title, once`, async () => {
        const r = await page.locator(sel('chat-diagram')).evaluateAll((figs) => figs.map((f) => ({ title: f.querySelector('[data-testid="chat-card-title"]').textContent, own: f.getAttribute('data-own-title'), capped: f.getAttribute('data-capped'), scale: Math.min(...[...f.querySelectorAll('svg text')].map((t) => t.ownerSVGElement.getScreenCTM().a)), min: Math.min(...[...f.querySelectorAll('svg text')].map((t) => parseFloat(getComputedStyle(t).fontSize) * t.ownerSVGElement.getScreenCTM().a)) })));
        console.log('  kit cards', JSON.stringify(r));
        for (const c of r) if (c.title === 'Visual' || c.title === 'Drawing') throw new Error(JSON.stringify(r));
        if (r.some((c) => c.capped === 'true') || r[0].scale < 0.99) throw new Error(`first card ${JSON.stringify(r[0])}`);
        if (r[0].title !== 'AI feature gateway at 1,000 users') throw new Error(JSON.stringify(r.map((c) => c.title)));
      });
      await page.locator(sel('chat-diagram')).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/ai-gateway-${theme}.png` });
      /* the full answer in one tall shot */
      await page.setViewportSize({ width: 1100, height: 2300 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/ai-gateway-full-${theme}.png` });

      /* the gallery */
      current = run('Show me every visual component you have', GALLERY_TEXT);
      await page.setViewportSize({ width: 1100, height: 900 });
      await fresh(page, base, theme);
      await page.locator(sel('chat-diagram-art')).nth(WIDE.length - 1).waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      const figs = page.locator(sel('chat-diagram'));
      /* element shots: the "Jump to latest" pill and the floating composer are not part of a drawing (they covered loadpath and capacity) */
      await page.evaluate(() => {
        const st = document.createElement('style');
        st.id = 'shots-hide';
        st.textContent = '.v3-jump{display:none!important}[data-testid="composer"],[data-testid="composer"] *{visibility:hidden!important}';
        document.head.appendChild(st);
      });
      /* a window taller than the longest drawing, so no element shot is clipped */
      await page.setViewportSize({ width: 1100, height: 1600 });
      await page.waitForTimeout(400);
      for (let i = 0; i < WIDE.length; i += 1) {
        await figs.nth(i).scrollIntoViewIfNeeded();
        await figs.nth(i).screenshot({ path: `${OUT}/${WIDE[i]}-${theme}.png` });
      }
      await page.evaluate(() => {
        document.getElementById('shots-hide')?.remove();
      });
      const height = await page.evaluate(() => Math.min(9000, document.querySelector('section.s2-chat')?.scrollHeight ?? 4000));
      await page.setViewportSize({ width: 1100, height: Math.max(900, height + 200) });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/gallery-${theme}.png` });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': current } },
);
