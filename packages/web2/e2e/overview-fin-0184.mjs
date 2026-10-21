#!/usr/bin/env node
/**
 * THE CHAT OVERVIEW, LOOKED AT (0.1.8.4 finish, lane overview)
 *
 * jsdom has no layout, so the claims that are about LAYOUT live here, in a real browser against the built app:
 *
 *   - chat-only and wide: the overview is the floating panel and has NO collapse control, even with the older build's
 *     stored fold in localStorage;
 *   - the glance row names the agents running (one mark each, with an accessible name) and the chats;
 *   - a surface open: the overview moves to the chat header; back to chat-only it is the panel again;
 *   - 420 px: it folds to the header pill by itself.
 *
 * The agent activity is faked at the wire (/api/acp/runs, /api/acp/live): no agent runs, no binary is launched.
 * The screenshots go to docs/bench/0184-fin-overview/ (or $SHOTS).
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { is, resize, sel, settle, suite } from './lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.env.SHOTS ?? path.join(REPO, 'docs', 'bench', '0184-fin-overview');
fs.mkdirSync(OUT, { recursive: true });

const NOW = Date.now();
const usage = (input, output) => ({ input, output, cacheRead: 0, cacheWrite: 0, thought: 0, total: input + output });
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const json = (body) => (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/* The REAL analyzer serves the app and the chat index (a throwaway user dir and home); only the agent wire is faked. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await freePort();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-fin-'));
const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port)], {
  env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1', SEQUENCE_USER_DIR: path.join(home, 'user'), HOME: home, USERPROFILE: home },
  stdio: 'ignore',
});
process.on('exit', () => child.kill());
const APP = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${APP}/api/status`)).ok) break;
  } catch {}
  if (i > 120) throw new Error('the analyzer did not come up');
  await sleep(250);
}
/* Four chats in the real index; the first stays active. */
const post = async (url, body) => (await fetch(`${APP}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json();
const ids = [];
for (let i = 0; i < 4; i++) {
  const r = await post('/api/sessions');
  ids.push(r.index.activeId);
}
const [, C2, C3] = ids;
const SAVED = { runs: [{ id: 't1', agentRef: 'claude', prompt: 'Now add a test for the proxy case', text: '', status: 'running', error: null, stopReason: null, startedAt: NOW - 30_000, endedAt: null, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(9300, 640) }] };
const LIVE = {
  turns: [
    { turnId: 'live-c2', chatId: C2, agentRef: 'codex', prompt: 'Split the invoice module', startedAt: NOW - 20_000 },
    { turnId: 'live-c3', chatId: C3, agentRef: 'gemini', prompt: 'Rewrite the README', startedAt: NOW - 10_000 },
  ],
};

await suite(
  'overview-fin-0184',
  async ({ page, base, check, log }) => {
    await page.route('**/api/acp/runs*', (r) => ([C2, C3].includes(new URL(r.request().url()).searchParams.get('chatId')) ? json({ runs: [] })(r) : json(SAVED)(r)));
    await page.route('**/api/acp/live*', json(LIVE));
    await page.route('**/api/acp/attach*', () => {}); /* the followed turns stay running: the request never answers */
    await page.route('**/api/acp/capabilities*', json(CAPS));
    await page.route('**/api/acp/agents', json({ agents: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }, { id: 'gemini', label: 'Gemini' }] }));
    await page.route('**/api/acp/available', json({ available: true }));

    const open = async (width) => {
      await resize(page, width, 900);
      await page.goto(APP);
      await page.evaluate(() => {
        try {
          localStorage.setItem('v3.overview.pill', '1'); /* the older build's stored fold */
        } catch {}
      });
      await page.reload();
      await page.waitForSelector(sel('shell'));
      await settle(page);
      for (let i = 0; i < 6; i++) {
        const x = page.locator('.s2-sp-x').first();
        if (!(await x.count())) break;
        await x.click();
        await settle(page);
      }
      await page.waitForTimeout(600);
    };

    await open(1440);
    await check('wide chat-only: the panel, no collapse control, despite the stored fold', async () => {
      is(await page.locator('.s2-row').getAttribute('data-stage'), 'none', 'data-stage');
      is(await page.locator(sel('chat-overview')).getAttribute('data-kind'), 'panel', 'overview kind');
      is(await page.locator(sel('ov-collapse')).count(), 0, 'collapse controls');
    });
    await check('the glance names the agents running and the chats', async () => {
      const agents = await page.locator(sel('ov-agents')).textContent();
      const names = await page.locator(sel('ov-agent-mark')).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      const chats = await page.locator(sel('ov-chats')).textContent();
      log('agents', agents, JSON.stringify(names), '| chats', chats);
      if (!/3\s*running/.test(agents ?? '')) throw new Error(`agents row: ${agents}`);
      if (names.length !== 3) throw new Error(`marks: ${JSON.stringify(names)}`);
      if (!/^\d+ chats, 3 running$/.test(chats ?? '')) throw new Error(`chats row: ${chats}`);
    });
    await page.screenshot({ path: path.join(OUT, 'wide-chat-only-1440.png') });

    await check('a surface open: the overview yields, and the header toggle puts it in the chat header', async () => {
      await page.locator(sel('s2-tab-files')).first().click();
      await settle(page);
      await page.waitForTimeout(400);
      is(await page.locator(sel('chat-overview')).count(), 0, 'overview with a surface and no toggle press');
      await page.locator(sel('s2-overview-toggle')).click();
      await page.locator(sel('chat-overview')).waitFor({ timeout: 10000 });
      is(await page.locator(sel('chat-overview')).getAttribute('data-kind'), 'inline', 'overview kind with a surface');
    });
    await page.screenshot({ path: path.join(OUT, 'surface-open-1440.png') });

    await check('back to chat-only: the panel is restored', async () => {
      for (let i = 0; i < 6; i++) {
        const x = page.locator('.s2-sp-x').first();
        if (!(await x.count())) break;
        await x.click();
        await settle(page);
      }
      await page.waitForTimeout(400);
      is(await page.locator(sel('chat-overview')).getAttribute('data-kind'), 'panel', 'overview kind after return');
    });

    await open(1280);
    await check('1280 (no room beside the card): it folds to the header pill by itself', async () => {
      await page.locator(sel('chat-overview')).waitFor({ timeout: 10000 });
      is(await page.locator(sel('chat-overview')).getAttribute('data-kind'), 'inline', 'overview kind at 1280');
      is(await page.locator(sel('chat-overview')).locator(sel('ov-pill')).count(), 1, 'header pill');
    });
    await page.screenshot({ path: path.join(OUT, 'narrow-1280-pill.png') });

    await open(420);
    await check('420 px: the overview and its toggle are not offered, and nothing overflows', async () => {
      is(await page.locator(sel('chat-overview')).count(), 0, 'overview at 420');
      is(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
    });
    await page.screenshot({ path: path.join(OUT, 'narrow-420.png') });
  },
);
