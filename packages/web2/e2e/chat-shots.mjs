#!/usr/bin/env node
/**
 * Round 9 (asks 9-15): a saved chat in a real browser, dark and light at
 * 1440x900: Markdown answers (headings, lists, code), tool rows, a stopped
 * turn with Retry, and the chat's title in the header.
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/cloud).
 */
import fs from 'node:fs';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/cloud';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
const tool = (id, title, toolKind, status, ms) => ({ id, title, toolKind, status, startedAt: 1, endedAt: 1 + ms });
const ANSWER = [
  '## Why the limiter lets traffic through',
  '',
  'The window is keyed on `req.ip`, and behind the proxy every request has the **same** address, so:',
  '',
  '1. the first 100 requests fill one shared bucket;',
  '2. the bucket resets every minute;',
  '3. the test sends from one client, so it never sees a `429`.',
  '',
  'The fix reads the forwarded address first:',
  '',
  '```ts',
  "const key = req.headers['x-forwarded-for']?.split(',')[0] ?? req.ip;",
  'bucket(key).take();',
  '```',
  '',
  'After the change `pnpm --filter @sequence/gateway test` passes (14 tests).',
].join('\n');
const RUNS = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why does the rate limiter return 200 under load?', text: ANSWER, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9, model: 'claude-sonnet-5', nodeId: null,
      tools: [tool('a', 'Read gateway/src/rate.ts', 'read', 'done', 400), tool('b', 'Grep x-forwarded-for', 'search', 'done', 300), tool('c', 'Edit gateway/src/rate.ts', 'edit', 'done', 900), tool('d', 'pnpm --filter @sequence/gateway test', 'execute', 'done', 21000)],
      usage: usage(18400, 2100, 61200) },
    { id: 't2', agentRef: 'claude', prompt: 'Now add a test for the proxy case', text: '', status: 'stopped', error: null, stopReason: 'cancelled', startedAt: 10, endedAt: 19, model: 'claude-sonnet-5', nodeId: null, tools: [tool('e', 'Read gateway/test/rate.test.ts', 'read', 'done', 300)], usage: usage(9300, 640, 28800) },
  ],
};

await suite(
  'chat-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ['dark', 'light']) {
      await page.goto(base);
      await page.evaluate((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForSelector(sel('shell'));
      await page.getByText('Why the limiter lets traffic through').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      await check(`${theme}: the answer renders as Markdown (heading, list, code)`, async () => {
        const chat = page.locator('section.s2-chat');
        if (!(await chat.locator('h2, h3').filter({ hasText: 'Why the limiter' }).count())) throw new Error('no heading');
        if (!(await chat.locator('ol li').count())) throw new Error('no list');
        if (!(await chat.locator('pre').count())) throw new Error('no code block');
      });
      await check(`${theme}: the header names the chat`, async () => {
        const t = await page.locator(sel('chat-title')).innerText();
        if (!/Rate limiter/.test(t)) throw new Error(`title is ${t}`);
      });
      await page.screenshot({ path: `${OUT}/chat-${theme}.png` });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS } },
);
