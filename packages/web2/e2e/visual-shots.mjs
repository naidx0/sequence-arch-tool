#!/usr/bin/env node
/**
 * (lane visual) Inline svg and html in the chat: dark and light shots at 1440x900. Original header follows. (v2: id on the card, quiet chrome, Reference.)
 * R11 chat shots, dark and light at 1440x900: the thinking shimmer, subagent
 * rows (with the centre-alignment check), the step timeline (dot, icon and
 * label centres), the diagram's hover film, the watchdog row, and the Agents
 * surface with two chats. Live turns are faked at /api/acp/run-node (no agent
 * runs). Shots go to $SHOTS (default
 * /mnt/project-files/sequence/harness-study/t3gap/visual/shots/v2).
 */
import fs from 'node:fs';
import http from 'node:http';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/harness-study/t3gap/visual/shots/v2';
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
const SVG = ['```svg', '<svg viewBox="0 0 360 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Request path">', '<rect x="10" y="40" width="80" height="40" rx="8" fill="none" stroke="currentColor"/>', '<text x="50" y="65" text-anchor="middle" fill="currentColor" font-size="13">Client</text>', '<path d="M90 60 H140" stroke="currentColor" marker-end="url(#a)"/>', '<defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="currentColor"/></marker></defs>', '<rect x="140" y="40" width="80" height="40" rx="8" fill="none" stroke="currentColor"/>', '<text x="180" y="65" text-anchor="middle" fill="currentColor" font-size="13">Proxy</text>', '<path d="M220 60 H270" stroke="currentColor" marker-end="url(#a)"/>', '<rect x="270" y="40" width="80" height="40" rx="8" fill="none" stroke="currentColor"/>', '<text x="310" y="65" text-anchor="middle" fill="currentColor" font-size="13">Limiter</text>', '</svg>', '```'].join('\n');
const HTML = ['```html', '<style>.row{display:flex;gap:8px;align-items:center}.bar{height:14px;border-radius:7px;background:var(--seq-accent)}.card{border:1px solid var(--seq-edge);background:var(--seq-surface);border-radius:10px;padding:10px 12px}small{color:var(--seq-muted)}</style>', '<div class="card"><b>Requests per window</b> <small>before and after the fix</small>', '<div class="row"><small style="width:60px">before</small><div class="bar" style="width:92%"></div></div>', '<div class="row"><small style="width:60px">after</small><div class="bar" style="width:31%"></div></div>', '<button onclick="this.textContent=\'Clicked: scripts run, network does not\'">Try it</button></div>', '```'].join('\n');
const TEXT = 'The window is keyed on `req.ip`, which is the proxy for every request. Here is the path, then the effect of the fix.\n\n' + SVG + '\n\n' + HTML + '\n\nPlans: [chart.html](/work/chart.html).';
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
  'visual-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const drawings = new Map();
    await page.route('**/api/drawings', async (route) => {
      const b = JSON.parse(route.request().postData() ?? '{}');
      const key = b.source;
      if (!drawings.has(key)) drawings.set(key, drawings.size + 1);
      const n = drawings.get(key);
      const slug = b.kind === 'svg' ? 'request-path' : 'requests-per-window';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drawing: { id: `d${n}` }, name: `${n}-${slug}.${b.kind}`, version: 1 }) });
    });
    for (const theme of ['dark', 'light']) {
      await page.route('**/api/file*', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: '<p style="margin:0">A file the agent wrote: <b>chart.html</b></p>' }));
      await fresh(page, base, theme);
      await page.locator(sel('chat-html-frame')).first().waitFor({ timeout: 15000 });
      await page.waitForFunction(() => /\nd\d+/.test(document.querySelector('[data-testid="chat-card-title"]')?.getAttribute('title') ?? ''), null, { timeout: 8000 });
      await page.waitForTimeout(800);
      await check(`${theme}: card is transparent with a faint hairline, and shows its id and file name`, async () => {
        const m = await page.locator(sel('chat-diagram')).first().evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, b: getComputedStyle(n).borderTopColor }));
        if (m.bg !== 'rgba(0, 0, 0, 0)') throw new Error(`card background ${m.bg}`);
        /* (lane cards) the id and file name are in the title's tooltip now, not the header text. */
        const id = ((await page.locator(sel('chat-card-title')).first().getAttribute('title')) ?? '').split('\n').pop();
        if (!/^d\d+(?: v\d+)?$/.test(id)) throw new Error(`id text "${id}"`);
      });
      await check(`${theme}: the html frame is sandboxed and its colours are the chat surface, not black`, async () => {
        const f = page.locator(sel('chat-html-frame')).first();
        if ((await f.getAttribute('sandbox')) !== 'allow-scripts') throw new Error('sandbox');
        const doc = await f.getAttribute('srcdoc');
        const bg = /--seq-bg:([^;]+);/.exec(doc)?.[1];
        if (!bg || /^(#000|#000000|rgb\(0, ?0, ?0\))$/.test(bg.trim())) throw new Error(`--seq-bg ${bg}`);
      });
      await page.locator(sel('chat-html-frame')).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/inline-visuals-${theme}.png` });
      /* Reference the first drawing from the composer, as a later turn would. */
      await page.locator(sel('chat-diagram')).first().hover();
      await page.locator(sel('chat-visual-reference')).first().click({ force: true });
      await check(`${theme}: Reference puts @drawing:<id> in the message box`, async () => {
        const v = await page.locator('section.s2-chat textarea').first().inputValue();
        if (!/@drawing:d\d+ /.test(v)) throw new Error(`draft "${v}"`);
      });
      await page.locator('section.s2-chat textarea').first().type('make the boxes wider');
      await page.screenshot({ path: `${OUT}/reference-earlier-drawing-${theme}.png` });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS_C1 } },
);
