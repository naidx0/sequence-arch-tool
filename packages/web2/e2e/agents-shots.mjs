#!/usr/bin/env node
/**
 * Round 9 (asks 28, 29, 30): the Agents dock in a real browser, dark and
 * light at 1440x900: the main agent's turns open, a sub-agent collapsed with
 * its failure on the row, a failed step with its error, a stalled step, and
 * the token strip (per turn and session total) fed by the chat's saved runs.
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/cloud).
 */
import fs from 'node:fs';
import { is, sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/cloud';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Fix the failing gateway tests', createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
const RUNS = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why do the gateway tests fail?', text: 'The mock server is never started.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(18400, 2100, 61200) },
    { id: 't2', agentRef: 'claude', prompt: 'Fix it and rerun them', text: '', status: 'failed', error: 'Session expired.', stopReason: null, startedAt: 10, endedAt: 19, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(9300, 640, 28800) },
  ],
};

const now = Date.now();
let n = 0;
const ev = (dt, e) => ({ id: `e${++n}`, at: now + dt, source: 'acp', sessionId: 'h1', paths: [], status: 'done', ...e });
const hit = (p) => [{ path: p, fileNodeId: null, moduleId: null, serviceId: null, serviceLabel: null, touchedEdgeIds: [], liftedEdges: [] }];
const EVENTS = [
  ev(-300000, { kind: 'session_start', status: 'running', title: 'Fix the failing gateway tests' }),
  ev(-299000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'], board: hit('gateway/src/server.ts') }),
  ev(-298400, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'], board: hit('gateway/src/server.ts'), result: "import express from 'express';" }),
  ev(-298000, { kind: 'subagent_start', agentId: 'sub', title: 'Explore', status: 'running' }),
  ev(-297000, { kind: 'tool_start', agentId: 'sub', tool: 'Search', toolKind: 'search', toolUseId: 's1', status: 'running', title: 'Grep mockServer' }),
  ev(-296500, { kind: 'tool_end', agentId: 'sub', tool: 'Search', toolKind: 'search', toolUseId: 's1', title: 'Grep mockServer', result: '3 matches in 2 files' }),
  ev(-296000, { kind: 'tool_start', agentId: 'sub', tool: 'Read', toolKind: 'read', toolUseId: 's2', status: 'running', title: 'Read gateway/test/helpers.ts', paths: ['gateway/test/helpers.ts'] }),
  ev(-295900, { kind: 'tool_end', agentId: 'sub', tool: 'Read', toolKind: 'read', toolUseId: 's2', status: 'failed', title: 'Read gateway/test/helpers.ts', paths: ['gateway/test/helpers.ts'], error: 'ENOENT: no such file or directory' }),
  ev(-295000, { kind: 'subagent_stop', agentId: 'sub', title: 'Explore' }),
  ev(-290000, { kind: 'tool_start', tool: 'Edit', toolKind: 'edit', toolUseId: 'b', status: 'running', title: 'Edit gateway/test/setup.ts', paths: ['gateway/test/setup.ts'], board: hit('gateway/test/setup.ts') }),
  ev(-289000, { kind: 'tool_end', tool: 'Edit', toolKind: 'edit', toolUseId: 'b', title: 'Edit gateway/test/setup.ts', paths: ['gateway/test/setup.ts'], board: hit('gateway/test/setup.ts') }),
  ev(-288000, { kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'c', status: 'running', title: 'pnpm --filter @sequence/gateway test' }),
  ev(-262000, { kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'c', status: 'failed', title: 'pnpm --filter @sequence/gateway test', error: 'FAIL test/rate.test.ts: expected 429 but received 200' }),
  ev(-260000, { kind: 'stop', usage: usage(18400, 2100, 61200), tokens: 20500 }),
  ev(-120000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'd', status: 'running', title: 'Read gateway/src/rate.ts', paths: ['gateway/src/rate.ts'], board: hit('gateway/src/rate.ts') }),
  ev(-119000, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'd', title: 'Read gateway/src/rate.ts', paths: ['gateway/src/rate.ts'], board: hit('gateway/src/rate.ts'), result: 'export function rateLimit(opts) {' }),
  ev(-118000, { kind: 'tool_start', tool: 'Bash', toolKind: 'execute', toolUseId: 'e', status: 'running', title: 'pnpm --filter @sequence/gateway test' }),
  ev(-117000, { kind: 'tool_end', tool: 'Bash', toolKind: 'execute', toolUseId: 'e', title: 'pnpm --filter @sequence/gateway test', result: 'Tests 14 passed' }),
  ev(-80000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'f', status: 'running', title: 'Read gateway/src/limiter.log', paths: ['gateway/src/limiter.log'] }),
];

await suite(
  'agents-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/agent-events', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: EVENTS.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') }),
    );
    for (const theme of ['dark', 'light']) {
      await page.goto(base);
      await page.evaluate((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForSelector(sel('shell'));
      if (!(await page.locator(sel('agents-panel')).count())) {
        await page.locator(sel('s2-chat-more')).first().click();
        await page.locator(sel('v3-agents-toggle')).first().click();
      }
      await page.locator(sel('agents-tree')).waitFor({ timeout: 15000 });
      await page.locator(sel('agents-usage')).waitFor({ timeout: 15000 });
      await page.locator(sel('agents-tree')).getByText('Turn 1', { exact: true }).click();
      await page.waitForTimeout(500);
      if (theme === 'dark') {
        await check('the sub-agent is one collapsed row; its failure shows on it', async () => {
          const sub = page.locator(`${sel('agents-tree-node')}:has-text("Sub-agent: Explore")`);
          is(await sub.count(), 1, 'one sub-agent row');
          is(await sub.locator('xpath=..').getAttribute('aria-expanded'), 'false', 'collapsed');
          const why = await sub.locator(sel('agents-why')).textContent();
          if (!/failed/.test(why ?? '')) throw new Error(`no failure on the collapsed row: ${why}`);
        });
        await check('a failed step names why, and a stalled step is marked', async () => {
          const text = await page.locator(sel('agents-tree')).innerText();
          if (!/FAIL test\/rate\.test\.ts/.test(text)) throw new Error('no error text in the tree');
          if (!/Stalled: no result after/.test(text)) throw new Error('no stall marker in the tree');
        });
        await check('tokens: per turn and the session total', async () => {
          const total = await page.locator(sel('agents-usage-total')).innerText();
          if (!/28k in, 2\.7k out, 90k cached/.test(total.replace(/\s+/g, ' '))) throw new Error(`total: ${total}`);
          is(await page.locator(sel('agents-usage-turn')).count(), 2, 'two turns');
        });
      }
      await page.screenshot({ path: `${OUT}/agents-trace-${theme}.png` });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS } },
);
