#!/usr/bin/env node
/**
 * H4: the status bar under the composer. Shots of idle / working / empty ring / hover popover / long model name,
 * dark and light, 1440 and 1024. SHOTS = output dir, STEM_SUFFIX = "before" | "after" (default "after").
 * Live turns are faked at /api/ask/stream and asks at /api/acp/runs, like r13-shell-shots.mjs.
 */
import fs from 'node:fs';
import http from 'node:http';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? 'shots';
const SUFFIX = process.env.STEM_SUFFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const LONG_MODEL = 'acme-experimental-reasoning-model-with-a-very-long-name-v12-preview-2026';
const aiConfig = (model, contextWindow) => ({ configured: true, provider: 'anthropic', model, apiKey: '9f3a', ...(contextWindow ? { contextWindow } : {}) });
const EMPTY_TREE = { path: '', name: 'workspace', type: 'dir', children: [] };
const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = { index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] }, scope: 'workspace', repos: [] };
const CAPS_NONE = { models: [], efforts: [], commands: [], skills: [] };
const RUNS = { runs: [{ id: 't1', agentRef: 'claude', prompt: 'Why?', text: 'The window is keyed on the proxy.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, nodeId: null, tools: [] }] };
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const ASK_RESULT = {
  type: 'result',
  text: 'The limiter keys on the proxy address.',
  usage: { inputTokens: 274_000, outputTokens: 900, estimated: false },
  contextBreakdown: {
    sections: [
      { id: 'instructions', label: 'Tool & plan instructions', tokens: 21_400, estimated: true },
      { id: 'tools', label: 'Tool results this turn', tokens: 63_800, estimated: true },
      { id: 'grounding', label: 'Architecture digest + question', tokens: 92_300, estimated: true },
    ],
    totalApprox: 177_500,
    totalMeasured: 274_000,
  },
};

async function fresh(page, base, theme, w, { agent = false, model = 'claude-sonnet-5-5', window: win = null } = {}) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const pat of ['**/api/sessions', '**/api/acp/runs*', '**/api/acp/capabilities*', '**/api/ai-config', '**/api/tree', '**/api/acp/full-access']) await page.unroute(pat).catch(() => {});
  const json = (body) => (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/sessions', json(SESSIONS));
  await page.route('**/api/acp/capabilities*', json(CAPS_NONE));
  await page.route('**/api/acp/runs*', json(agent ? RUNS : { runs: [] }));
  await page.route('**/api/acp/full-access', json({ confirmed: true, prompt: 'x' }));
  await page.route('**/api/ai-config', json(aiConfig(model, win)));
  await page.route('**/api/tree', json(EMPTY_TREE));
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
      localStorage.setItem('theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForSelector(sel('shell'));
  await page.waitForTimeout(900);
}

async function snap(page, stem, theme, w) {
  const bar = page.locator(sel('s2-status'));
  await bar.waitFor({ timeout: 8000 });
  const b = await bar.boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, b.x - 24);
  const y = Math.max(0, b.y - 150);
  const clip = { x, y, width: Math.min(vp.width - x, b.width + 48), height: Math.min(vp.height - y, 150 + b.height + 24) };
  await page.screenshot({ path: `${OUT}/${stem}_${theme}_${w}_${SUFFIX}.png`, clip });
  console.log('bar:', stem, theme, w, JSON.stringify((await bar.innerText()).replace(/\s+/g, ' ')));
}

async function ask(page) {
  const box = page.locator('section.s2-chat textarea').first();
  await box.click();
  await box.fill('Why does the rate limiter return 200?');
  await box.press('Enter');
}

await suite('status-bar-h4-shots', async ({ page, base, check }) => {
  for (const theme of ['dark', 'light']) {
    for (const w of [1440, 1024]) {
      const T = `${theme} ${w}`;
      await check(`${T}: idle, agent with no model named`, async () => {
        await fresh(page, base, theme, w, { agent: true });
        await page.waitForTimeout(800);
        await snap(page, 'idle-agent', theme, w);
      });
      await check(`${T}: idle, model with no context window`, async () => {
        await fresh(page, base, theme, w, {});
        await snap(page, 'idle-empty-ring', theme, w);
      });
      await check(`${T}: long model name`, async () => {
        await fresh(page, base, theme, w, { model: LONG_MODEL });
        await snap(page, 'long-model', theme, w);
      });
      await check(`${T}: working`, async () => {
        await fresh(page, base, theme, w, { window: 1_000_000 });
        const hang = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
          res.write(sse([{ type: 'status', text: 'Reading files' }]));
        });
        await new Promise((r) => hang.listen(0, '127.0.0.1', r));
        await page.route('**/api/ask/stream', (route) => route.continue({ url: `http://127.0.0.1:${hang.address().port}/` }));
        await ask(page);
        await page.waitForTimeout(1200);
        await snap(page, 'working', theme, w);
        hang.closeAllConnections();
        hang.close();
        await page.unroute('**/api/ask/stream').catch(() => {});
      });
      await check(`${T}: hover popover after a turn`, async () => {
        await fresh(page, base, theme, w, { window: 1_000_000 });
        await page.route('**/api/ask/stream', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([ASK_RESULT]) }));
        await ask(page);
        await page.waitForTimeout(1500);
        await page.locator(sel('s2-status-context')).locator(sel('composer-context')).hover();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/hover-popover_${theme}_${w}_${SUFFIX}.png` });
        await page.unroute('**/api/ask/stream').catch(() => {});
      });
      await check(`${T}: hover popover on the empty ring`, async () => {
        await fresh(page, base, theme, w, {});
        await page.locator(sel('s2-status-context')).locator('button').first().hover();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/hover-empty_${theme}_${w}_${SUFFIX}.png` });
      });
    }
  }
});
