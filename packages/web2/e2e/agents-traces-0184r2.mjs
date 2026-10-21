#!/usr/bin/env node
/**
 * THE REASONING TRACE AND THE LONG RUN, LOOKED AT (0.1.8.4, round 2, lane traces)
 *
 * jsdom has no layout, so the claims that are about LAYOUT live here, in a real browser against the built app:
 *
 *   - an agent's thought, in Focused mode, opens onto the reasoning trace (one step per paragraph, a dot on the rail,
 *     the model's own heading as the title), wears the agent's mark and no spark, and never overflows sideways;
 *   - a run of 24 reads, a failed command and a plan of thoughts between them reads in the chat as folds and rows;
 *   - the agents window with a LONG run: runs of finished steps fold into one row that says what they did, the failed
 *     step is its own row, the roster above the scroll wears the agent's mark, and nothing overflows the panel.
 *
 * No agent runs. The agent activity is faked at the wire: /api/agent-events (the window) and /api/acp/run-node (the
 * chat, a scripted SSE stream that never ends). Screenshots go to docs/bench/0184-r2-traces/ (or $SHOTS), dark and
 * light at 1440 and 1024.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sel, suite } from './lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.env.SHOTS ?? path.join(REPO, 'docs', 'bench', '0184-r2-traces');
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'w1', sessions: [{ id: 'w1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] },
  scope: 'workspace',
  repos: [],
};
const STATUS = { attached: true, root: 'C:/repo', scanning: false, attaching: false };
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const RUNS = { runs: [{ id: 't0', agentRef: 'claude', prompt: 'Where does the limiter read the client address?', text: 'In `gateway/src/rate.ts`, from `req.ip`.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9000, model: 'claude-sonnet-5', nodeId: null, tools: [] }] };

/* The chat's run: reasoning in paragraphs and a heading, 24 reads with thoughts between, a failed command, an answer. */
const upd = (u) => ({ type: 'acp:update', update: { sessionId: 's', update: u } });
const thought = (text) => upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } });
const say = (text) => upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const call = (id, title, kind, status, extra = {}) => upd({ sessionUpdate: status !== 'in_progress' ? 'tool_call_update' : 'tool_call', toolCallId: id, title, kind, status, ...extra });
const REASON = [
  '## Check the key',
  'The limiter keys its window on the client address. If that is the proxy for every request, one bucket serves everyone.',
  '',
  '## Trust boundary',
  'I should look at where the address is read and whether x-forwarded-for is trusted: packages/gateway/src/very-long-path-without-any-break/another-long-segment-here/rate-limiter-middleware.ts',
  '',
  'Then decide the fix and name the test that would have caught it.',
].join('\n');
const CHAT_EVENTS = [thought(REASON)];
for (let i = 0; i < 24; i++) {
  CHAT_EVENTS.push(call(`r${i}`, `Read gateway/src/modules/module-${i}.ts`, 'read', 'in_progress'), call(`r${i}`, `Read gateway/src/modules/module-${i}.ts`, 'read', 'completed'));
  if (i === 11) CHAT_EVENTS.push(thought('Halfway through the modules.\n\nNothing reads the proxy header yet.'));
}
CHAT_EVENTS.push(call('x', 'pnpm --filter @sequence/gateway test', 'execute', 'in_progress'), call('x', 'pnpm --filter @sequence/gateway test', 'execute', 'failed'));
CHAT_EVENTS.push(say('The window was keyed on `req.ip`, so one bucket served everyone.'));
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
let chatEvents = CHAT_EVENTS;
const streams = new Set();
const hang = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
  streams.add(res);
  res.on('close', () => streams.delete(res));
  res.write(sse(chatEvents));
});
await new Promise((r) => hang.listen(0, '127.0.0.1', r));
const PORT = hang.address().port;

/* The window's run: the same chat, 30 reads, a failed read, 6 edits, 5 searches, a failed command, one read in flight. */
let n = 0;
const ev = (dt, e) => ({ id: `e${++n}`, at: Date.now() + dt, source: 'acp', sessionId: 'w1', paths: [], status: 'done', ...e });
const EVENTS = [ev(-600000, { kind: 'session_start', status: 'running', title: 'Rate limiter returns 200 under load' })];
let t = -590000;
const step = (tool, toolKind, id, title, end = {}) => {
  EVENTS.push(ev((t += 1500), { kind: 'tool_start', tool, toolKind, toolUseId: id, status: 'running', title }));
  EVENTS.push(ev((t += 700), { kind: 'tool_end', tool, toolKind, toolUseId: id, title, ...end }));
};
for (let i = 0; i < 30; i++) step('Read', 'read', `r${i}`, `Read gateway/src/modules/module-${i}.ts`);
step('Read', 'read', 'rf', 'Read gateway/test/helpers.ts', { status: 'failed', error: 'ENOENT: no such file or directory' });
for (let i = 0; i < 5; i++) step('Grep', 'search', `s${i}`, `Grep rateLimit${i}`, { result: `${i + 2} matches` });
for (let i = 0; i < 6; i++) step('Edit', 'edit', `e${i}`, `Edit gateway/src/rate${i}.ts`);
step('Bash', 'execute', 'bf', 'pnpm --filter @sequence/gateway test', { status: 'failed', error: 'FAIL test/rate.test.ts: expected 429 but received 200' });
EVENTS.push(ev(-4000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'live', status: 'running', title: 'Read gateway/src/limiter.log' }));

/** Nothing of an element sticks out sideways: the box, and every box inside it. */
const outside = (page, selector) =>
  page.evaluate((q) => {
    const root = document.querySelector(q);
    if (!root) return ['missing'];
    const pr = root.getBoundingClientRect();
    if (!pr.width || !pr.height) return ['root is hidden; no layout was measured'];
    const bad = [];
    if (root.scrollWidth > root.clientWidth + 1) bad.push(`scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}`);
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > pr.right + 1 || r.left < pr.left - 1) bad.push(`${String(el.className).slice(0, 40)} (${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(pr.left)}..${Math.round(pr.right)})`);
    }
    return bad.slice(0, 6);
  }, selector);

await suite(
  'agents-traces-0184r2',
  async ({ page, base, check, log }) => {
    await page.route('**/api/agent-events', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: EVENTS.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') }),
    );
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNS) }));
    await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
    await page.route('**/api/acp/agents', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'claude', label: 'Claude Code' }] }) }));
    await page.route('**/api/acp/available', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }));
    await page.route('**/api/acp/run-node*', (route) => route.continue({ url: `http://127.0.0.1:${PORT}/` }));

    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 1024, 760]) {
        const tag = `${theme} ${width}`;
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base);
        await page.evaluate((th) => {
          try {
            localStorage.setItem('theme', th);
            localStorage.setItem('seq.theme', th);
            localStorage.setItem('sequence.toolDetail', 'focused');
          } catch {}
          document.documentElement.setAttribute('data-theme', th);
        }, theme);
        await page.reload();
        await page.waitForSelector(sel('shell'));
        await page.locator('section.s2-chat .s2-run').first().waitFor({ timeout: 15000 });
        const box = page.locator('section.s2-chat textarea').first();
        await box.click();
        await box.fill('Why does the rate limiter return 200 under load?');
        await box.press('Enter');
        await page.locator(sel('agent-tool-fold')).first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(600);

        /* THE FOCUSED REASONING VIEW, IN THE CHAT. */
        await check(`${tag}: the thought opens onto the trace: steps, a dot per step, the heading as the title, no spark`, async () => {
          await page.locator(`${sel('agent-thought')} button`).first().click();
          await page.locator(sel('reasoning-step')).first().waitFor({ timeout: 10000 });
          const steps = await page.locator(`${sel('agent-thought')}:first-of-type ${sel('reasoning-step')}`).count();
          if (steps < 3) throw new Error(`${steps} steps from three paragraphs`);
          const titles = await page.locator('.s2-think-step-t').allInnerTexts();
          if (!titles.includes('Check the key') || !titles.includes('Trust boundary')) throw new Error(`titles: ${titles}`);
          if ((await page.locator(`${sel('reasoning-step')} [data-icon="spark"]`).count()) !== 0) throw new Error('a spark on a step');
          if ((await page.locator(sel('reasoning-step-mark')).count()) !== steps) throw new Error('not one dot per step');
          if ((await page.locator(`${sel('agent-thought')} [data-brand="claude"]`).count()) < 1) throw new Error('the thought wears no agent mark');
          const raw = await page.locator(sel('agent-thought')).first().innerText();
          if (/##/.test(raw)) throw new Error(`raw markdown shows: ${raw}`);
        });
        await check(`${tag}: nothing in the chat sticks out sideways`, async () => {
          const bad = await outside(page, 'section.s2-chat');
          if (bad.length) throw new Error(bad.join('; '));
        });
        await page.mouse.move(2, 2);
        await page.screenshot({ path: path.join(OUT, `focused-reasoning-${width}-${theme}.png`) });
        /* The marks, close: the thought header and its steps. */
        const head = page.locator(sel('agent-thought')).first();
        const hb = await head.boundingBox();
        if (hb) await page.screenshot({ path: path.join(OUT, `logos-thought-${width}-${theme}.png`), clip: { x: Math.max(0, hb.x - 8), y: Math.max(0, hb.y - 8), width: Math.min(hb.width + 16, width), height: Math.min(hb.height + 16, 420) } });

        /* THE AGENTS WINDOW (the dock), with the long run. */
        if (!(await page.locator(sel('agents-panel')).count())) {
          await page.locator(sel('s2-chat-more')).first().click();
          await page.locator(sel('v3-agents-toggle')).first().click();
        }
        if (width < 900) await page.locator(sel('s2-narrow-agents')).click();
        await page.locator(sel('agents-panel')).waitFor({ state: 'visible' });
        await page.locator(sel('agents-tree')).waitFor({ timeout: 15000, state: 'attached' });
        await page.waitForTimeout(600);

        await check(`${tag}: the long run is folds and rows, not eighty rows`, async () => {
          const rows = await page.locator(sel('agents-tree-node')).count();
          const folds = await page.locator(sel('agents-step-fold')).allInnerTexts();
          if (!folds.some((f) => /Read 30 files/.test(f))) throw new Error(`no fold for the 30 reads: ${JSON.stringify(folds)}`);
          if (!folds.some((f) => /Edited 6 files/.test(f))) throw new Error(`no fold for the edits: ${JSON.stringify(folds)}`);
          if (rows > 14) throw new Error(`${rows} step rows in the tree`);
        });
        await check(`${tag}: the failed steps are their own rows, never inside a fold`, async () => {
          const text = await page.locator(sel('agents-tree')).innerText();
          if (!/ENOENT/.test(text) || !/expected 429/.test(text)) throw new Error('a failure is hidden');
        });
        await check(`${tag}: the roster wears the agent's mark`, async () => {
          if ((await page.locator(`${sel('agents-roster-row')} [data-brand="claude"]`).count()) < 1) throw new Error('no mark on the roster');
        });
        await check(`${tag}: nothing overflows the panel`, async () => {
          const bad = await outside(page, sel('agents-panel'));
          if (bad.length) throw new Error(bad.join('; '));
        });
        await page.mouse.move(2, 2);
        await page.screenshot({ path: path.join(OUT, `agents-window-long-${width}-${theme}.png`) });

        await check(`${tag}: a fold opens onto its steps, and the panel still fits`, async () => {
          const toggle = page.locator(sel('agents-step-fold-toggle')).first();
          await toggle.click();
          await page.waitForTimeout(250);
          if ((await toggle.getAttribute('aria-expanded')) !== 'true') throw new Error('did not open');
          const bad = await outside(page, sel('agents-panel'));
          if (bad.length) throw new Error(bad.join('; '));
        });
        await page.screenshot({ path: path.join(OUT, `agents-window-fold-open-${width}-${theme}.png`) });
        log(`shots ${tag}`);
      }
    }
    // The exact same provider frames, while reasoning is still arriving and after
    // an answer settles it. Detailed must preserve the raw provider text.
    for (const detail of ['focused', 'detailed']) {
      chatEvents = [thought(REASON)];
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.evaluate((value) => localStorage.setItem('sequence.toolDetail', value), detail);
      await page.reload();
      const box = page.locator('section.s2-chat textarea').first();
      await box.fill(`Inspect the ${detail} live reasoning`);
      await box.press('Enter');
      const live = page.locator(`${sel('agent-thought')}[data-live="true"]`).first();
      await live.waitFor({ timeout: 15000 });
      const button = live.locator('button').first();
      if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
      await check(`${detail}: live reasoning preserves state and provider words`, async () => {
        if (detail === 'focused') {
          await live.locator(`${sel('reasoning-step')}[data-open="true"]`).waitFor();
        } else {
          if ((await live.locator(sel('reasoning-step')).count()) !== 0) throw new Error('Detailed unexpectedly segmented');
          if (!(await live.innerText()).includes('## Trust boundary')) throw new Error('Detailed lost provider heading');
        }
        const bad = await outside(page, 'section.s2-chat');
        if (bad.length) throw new Error(bad.join('; '));
      });
      await page.screenshot({ path: path.join(OUT, `reasoning-live-${detail}-1024.png`) });
      for (const response of streams) response.write(sse([say('Verified from the supplied tool evidence.')]));
      await live.waitFor({ state: 'detached', timeout: 10000 });
      await check(`${detail}: answering settles the reasoning tail`, async () => {
        if ((await page.locator(`${sel('reasoning-step')}[data-open="true"]`).count()) !== 0) throw new Error('settled tail remains live');
        if (!(await page.locator('section.s2-chat').innerText()).includes('Verified from the supplied tool evidence.')) throw new Error('answer missing');
      });
      await page.screenshot({ path: path.join(OUT, `reasoning-settled-${detail}-1024.png`) });
    }
    hang.closeAllConnections();
    hang.close();
  },
  { routes: { '/api/sessions': SESSIONS, '/api/status': STATUS } },
);
