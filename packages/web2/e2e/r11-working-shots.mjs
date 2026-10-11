#!/usr/bin/env node
/**
 * R11 working-chat shots, dark and light at 1440x900: a RUNNING chat, not a finished one.
 *   a thinking-shimmer     the turn is thinking, its label shimmers
 *   b tools-running        tool rows, one still running with the ASCII spinner
 *   c subagent-nested      a subagent running, its own steps nested under it
 *   d approval-smart       Smart mode: a command waits on the person
 *   e finished             the answer, a diagram and the changed-files row
 *   f ring-hover           the status bar's context ring hovered mid-run
 *   g agents-live          the Agents surface showing this live run, then its Workflows section
 * The run is a scripted SSE stream from a tiny local server that writes its events and then never ends
 * (the page's /api/acp/run-node is routed to it with route.continue); the finished shot answers with a stream
 * that ends. No agent runs. Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r11/working).
 */
import fs from 'node:fs';
import http from 'node:http';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r11/working';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'w1', sessions: [{ id: 'w1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] },
  scope: 'workspace',
  repos: [],
};
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
/* One earlier, finished turn: it is what attaches this chat to Claude (agentRef) before the live turn starts. */
const RUNS = {
  runs: [{ id: 't0', agentRef: 'claude', prompt: 'Where does the limiter read the client address?', text: 'In `gateway/src/rate.ts`, from `req.ip`.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9000, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: { input: 4200, output: 300, cacheRead: 9000, cacheWrite: 0, thought: 0, total: 4500 } }],
};
const RUNS_HEAD = { runs: [] };
const PROGRAM_RUNS = {
  runs: [
    { runId: 'run-m1a2b3-0001abcd', programId: 'prog-sweep', programName: 'Nightly sweep', status: 'running', startedAt: Date.UTC(2026, 9, 8, 6, 30), lastEventSeq: 9, steps: 4, nodesTotal: 5, nodesDone: 3, nodesError: 0 },
    { runId: 'run-m1a2b3-0002abcd', programId: 'prog-docs', programName: 'Docs pass', status: 'completed', startedAt: Date.UTC(2026, 9, 8, 4, 10), lastEventSeq: 14, steps: 5, nodesTotal: 5, nodesDone: 5, nodesError: 0 },
    { runId: 'run-m1a2b3-0003abcd', programId: 'prog-types', programName: 'Type audit', status: 'failed', startedAt: Date.UTC(2026, 9, 7, 22, 0), lastEventSeq: 6, steps: 3, nodesTotal: 4, nodesDone: 2, nodesError: 1 },
  ],
};

const upd = (u) => ({ type: 'acp:update', update: { sessionId: 's', update: u } });
const thought = (text) => upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } });
const say = (text) => upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const call = (id, title, kind, status, extra = {}) => upd({ sessionUpdate: id.startsWith('end') || status !== 'in_progress' ? 'tool_call_update' : 'tool_call', toolCallId: id, title, kind, status, ...extra });
const ctx = (used) => upd({ sessionUpdate: 'usage_update', used, size: 200000, cost: null });
const MERMAID = ['```mermaid', 'flowchart LR', '  Client --> Proxy', '  Proxy -->|x-forwarded-for| Limiter', '  Limiter -->|over limit| Reject[429]', '```'].join('\n');

const SCENARIOS = {
  thinking: [thought('The limiter keys its window on the client address. If that is the proxy for every request, one bucket serves everyone, so I should look at where the address is read and whether x-forwarded-for is trusted.')],
  tools: [
    thought('Reading the limiter first.'),
    call('a', 'Read gateway/src/rate.ts', 'read', 'in_progress'),
    call('a', 'Read gateway/src/rate.ts', 'read', 'completed'),
    call('b', 'Grep x-forwarded-for', 'search', 'in_progress'),
    call('b', 'Grep x-forwarded-for', 'search', 'completed'),
    call('c', 'pnpm --filter @sequence/gateway test', 'execute', 'in_progress'),
    ctx(61200),
  ],
  subagent: [
    call('task', 'Task', 'other', 'in_progress', { rawInput: { subagent_type: 'Explore', description: 'find where the limiter reads the client address' } }),
    call('s1', 'Read gateway/src/rate.ts', 'read', 'in_progress', { _meta: { claudeCode: { parentToolUseId: 'task' } } }),
    call('s1', 'Read gateway/src/rate.ts', 'read', 'completed', { _meta: { claudeCode: { parentToolUseId: 'task' } } }),
    call('s2', 'Grep req.ip', 'search', 'in_progress', { _meta: { claudeCode: { parentToolUseId: 'task' } } }),
    ctx(74800),
  ],
  approval: [
    call('d', 'rm -rf gateway/.cache && pnpm --filter @sequence/gateway test', 'execute', 'pending', { rawInput: { command: 'rm -rf gateway/.cache && pnpm --filter @sequence/gateway test' } }),
    { type: 'acp:permission', requestId: 'req-1', toolCallId: 'd', title: 'Run rm -rf gateway/.cache && pnpm --filter @sequence/gateway test', toolKind: 'execute', decision: null, pending: true, always: 'pnpm --filter' },
    ctx(80400),
  ],
};
const FINISHED = [
  thought('Done investigating.'),
  call('a', 'Read gateway/src/rate.ts', 'read', 'completed'),
  call('e', 'Edit gateway/src/rate.ts', 'edit', 'completed', { content: [{ type: 'diff', path: 'gateway/src/rate.ts', oldText: 'const key = req.ip;\n', newText: 'const key = clientAddress(req);\n' }] }),
  call('f', 'Edit gateway/src/proxy.ts', 'edit', 'completed', { content: [{ type: 'diff', path: 'gateway/src/proxy.ts', oldText: null, newText: 'export const clientAddress = (req) => req.headers["x-forwarded-for"] ?? req.ip;\n' }] }),
  say('The window was keyed on `req.ip`, which is the proxy for every request, so one bucket served everyone.\n\n' + MERMAID + '\n\nThe key now comes from `clientAddress(req)`, which trusts `x-forwarded-for` from the proxy only.'),
  ctx(92300),
  { type: 'acp:result', stopReason: 'end_turn', text: 'done' },
];
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

let current = SCENARIOS.thinking;
const hang = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
  res.write(sse(current));
});
await new Promise((r) => hang.listen(0, '127.0.0.1', r));
const PORT = hang.address().port;

async function fresh(page, base, theme, scenario) {
  current = SCENARIOS[scenario] ?? [];
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
  }, theme);
  await page.reload();
  await page.waitForSelector(sel('shell'));
  await page.locator('section.s2-chat [data-testid="agent-run"], section.s2-chat .s2-run').first().waitFor({ timeout: 15000 });
  /* The default on a clean profile is Plan; the working chats run in Smart, picked the way a person picks it. */
  const modeBtn = page.locator(sel('s2-mode-trigger')).first();
  if ((await modeBtn.getAttribute('data-mode')) !== 'smart') {
    await modeBtn.click();
    await page.locator(sel('s2-quickmode-smart')).click();
    await page.locator(sel('s2-quickmode-menu')).waitFor({ state: 'detached' });
  }
  await page.waitForTimeout(400);
}

async function send(page, text) {
  const box = page.locator('section.s2-chat textarea').first();
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

await suite(
  'r11-working-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNS) }));
    await page.route('**/api/program/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROGRAM_RUNS) }));
    await page.route('**/api/acp/run-node*', (route) => route.continue({ url: `http://127.0.0.1:${PORT}/` }));
    const quiet = async () => {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
    };
    const shot = async (name, theme) => {
      await quiet();
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    };
    void RUNS_HEAD;

    for (const theme of ['dark', 'light']) {
      /* a: thinking */
      await fresh(page, base, theme, 'thinking');
      await send(page, 'Why does the rate limiter return 200 under load?');
      await check(`${theme}: (a) the thinking label shimmers while the turn runs`, async () => {
        const el = page.locator('section.s2-chat .shimmer-text').first();
        await el.waitFor({ timeout: 10000 });
        const anim = await el.evaluate((n) => getComputedStyle(n).animationName);
        if (anim !== 'shimmer-text') throw new Error(`animation is ${anim}`);
      });
      await shot('a-thinking-shimmer', theme);

      /* b: tool rows, one running */
      await fresh(page, base, theme, 'tools');
      await send(page, 'Why does the rate limiter return 200 under load?');
      await check(`${theme}: (b) tool rows: the finished ones fold into a summary, the running command is a live row with a timer`, async () => {
        const live = page.locator('section.s2-chat [data-testid="agent-card-tool"][data-status="running"]').first();
        await live.waitFor({ timeout: 10000 });
        /* The running command reads whole: no ellipsis, no blank where the spinner goes. */
        const cmd = live.locator(sel('agent-card-title'));
        const clip = await cmd.evaluate((n) => n.scrollWidth - n.clientWidth);
        if (clip > 1) throw new Error(`the running command is clipped by ${clip}px`);
        if ((await live.locator(sel('s2-ascii-spinner')).count()) !== 1) throw new Error('the running row has no spinner glyph');
        await page.locator(sel('agent-tool-fold-toggle')).first().click();
        await page.waitForTimeout(300);
        const rows = await page.locator('section.s2-chat [data-testid="agent-card-title"]').allInnerTexts();
        if (rows.length < 2) throw new Error(`only ${rows.length} tool rows: ${rows}`);
      });
      await shot('b-tools-running', theme);

      /* f: the status bar's ring, hovered mid-run (same stream) */
      await check(`${theme}: (f) the status bar ring, hovered mid-run, opens its measurement; the composer row has no ring`, async () => {
        const ring = page.locator(`${sel('s2-status-context')} ${sel('composer-context')}`);
        await ring.waitFor({ timeout: 10000 });
        if ((await page.locator(`.s2-cb ${sel('composer-context')}`).count()) !== 0) throw new Error('a ring on the composer row');
        await ring.hover();
        await page.locator(sel('composer-context-breakdown')).waitFor({ timeout: 5000 });
        await page.waitForTimeout(250);
      });
      await page.screenshot({ path: `${OUT}/f-ring-hover-${theme}.png` });
      await page.mouse.move(2, 2);

      /* c: subagent nested */
      await fresh(page, base, theme, 'subagent');
      await send(page, 'Find where the limiter reads the client address');
      await check(`${theme}: (c) a running subagent has its own steps nested under it`, async () => {
        const card = page.locator(`${sel('agent-subagent')}[data-status="running"]`).first();
        await card.waitFor({ timeout: 10000 });
        if ((await card.locator(sel('s2-ascii-spinner')).count()) < 1) throw new Error('no spinner on the subagent');
        const toggle = card.locator(sel('agent-subagent-toggle'));
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
        await page.waitForTimeout(300);
        const nested = await card.innerText();
        if (!/Read\s+gateway\/src\/rate\.ts/.test(nested)) throw new Error(`no nested step: ${nested}`);
      });
      await shot('c-subagent-nested', theme);

      /* d: an approval waits in Smart mode */
      await fresh(page, base, theme, 'approval');
      await check(`${theme}: the composer is in Smart`, async () => {
        const mode = await page.locator(sel('s2-mode-trigger')).first().getAttribute('data-mode');
        if (mode !== 'smart') throw new Error(`mode is ${mode}`);
      });
      await send(page, 'Clear the cache and run the gateway tests');
      await check(`${theme}: (d) Smart asks before the command: an approval card waits with Allow and Deny`, async () => {
        const card = page.locator('section.s2-chat').getByText(/rm -rf gateway/).first();
        await card.waitFor({ timeout: 10000 });
        const btns = await page.locator('section.s2-chat button').allInnerTexts();
        if (!btns.some((t) => /allow|approve|yes/i.test(t))) throw new Error(`no allow button: ${btns.join(' | ')}`);
      });
      await shot('d-approval-smart', theme);

      /* e: the finished answer, with a diagram and the changed-files row (the stream ends) */
      current = FINISHED;
      await fresh(page, base, theme, 'none');
      current = FINISHED;
      await send(page, 'Fix the limiter so it keys on the real client');
      await check(`${theme}: (e) the finished answer shows the diagram and the changed files`, async () => {
        await page.locator(sel('chat-diagram')).first().locator(sel('chat-diagram-art')).locator('svg').waitFor({ timeout: 20000 });
        const summary = await page.locator(sel('agent-tool-fold-summary')).first().innerText();
        if (!/edited 2 files/.test(summary)) throw new Error(`the changed-files row says: ${summary}`);
        await page.locator(sel('agent-tool-fold-toggle')).first().click();
        await page.waitForTimeout(300);
        const text = await page.locator('section.s2-chat').innerText();
        if (!/gateway\/src\/rate\.ts/.test(text) || !/gateway\/src\/proxy\.ts/.test(text)) throw new Error('changed files are not named');
      });
      await page.waitForTimeout(600);
      await shot('e-finished-diagram-files', theme);

      /* g: the Agents surface shows the live run; then its Workflows section */
      await fresh(page, base, theme, 'subagent');
      await send(page, 'Find where the limiter reads the client address');
      await page.locator(`${sel('agent-subagent')}[data-status="running"]`).first().waitFor({ timeout: 10000 });
      await page.locator(sel('s2-tab-agents')).click();
      await check(`${theme}: (g) the Agents surface lists the live run and its subagent as running`, async () => {
        await page.locator(sel('agents-surface')).waitFor({ timeout: 10000 });
        const state = await page.locator(sel('agents-surface-chat')).first().getAttribute('data-state');
        if (state !== 'running') throw new Error(`chat state ${state}`);
        if ((await page.locator(`${sel('agents-surface-subagent')}[data-state="running"]`).count()) < 1) throw new Error('no running subagent');
      });
      await shot('g1-agents-live', theme);
      await page.locator(sel('agents-surface-tab-workflows')).click();
      await check(`${theme}: (g) the Workflows section lists the workflow runs with their states and offers Start a workflow`, async () => {
        const rows = page.locator(sel('activity-row'));
        await rows.first().waitFor({ timeout: 10000 });
        if ((await rows.count()) !== 3) throw new Error(`${await rows.count()} workflow runs`);
        const states = (await page.locator(sel('activity-row-state')).allInnerTexts()).join(' ').toLowerCase();
        if (!/running/.test(states) || !/(failed|error)/.test(states)) throw new Error(`states: ${states}`);
        if (!/Start a workflow/.test(await page.locator(sel('activity-new-run')).innerText())) throw new Error('no Start a workflow');
      });
      await shot('g2-workflows', theme);
    }
    hang.closeAllConnections();
    hang.close();
  },
  { routes: { '/api/sessions': SESSIONS } },
);
