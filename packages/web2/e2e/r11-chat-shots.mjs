#!/usr/bin/env node
/**
 * R11 chat shots, dark and light at 1440x900: the thinking shimmer, subagent
 * rows (with the centre-alignment check), the step timeline (dot, icon and
 * label centres), the diagram's hover film, the watchdog row, and the Agents
 * surface with two chats. Live turns are faked at /api/acp/run-node (no agent
 * runs). Shots go to $SHOTS (default
 * /mnt/project-files/sequence/cloud-pass/shots/r11/chat).
 */
import fs from 'node:fs';
import http from 'node:http';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r11/chat';
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
const MERMAID = ['```mermaid', 'flowchart LR', '  Client --> Proxy', '  Proxy -->|x-forwarded-for| Limiter', '  Limiter -->|over limit| Reject[429]', '```'].join('\n');
const RUNS_C1 = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why does the rate limiter return 200 under load?', text: 'The window is keyed on `req.ip`, which is the proxy for every request.\n\n' + MERMAID, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null,
      tools: [
        tool('task', 'Task', 'other', 'done', 9000, { subagent: 'Explore: find where the limiter reads the client address' }),
        tool('a', 'Read gateway/src/rate.ts', 'read', 'done', 1200, { parentId: 'task' }),
        tool('a2', 'Read gateway/src/proxy.ts', 'read', 'done', 800),
        tool('b', 'Grep x-forwarded-for', 'search', 'done', 1500),
        tool('c', 'Edit gateway/src/rate.ts', 'edit', 'done', 2100),
        tool('d', 'pnpm --filter @sequence/gateway test', 'execute', 'done', 26000),
      ],
      usage: usage(18400, 2100, 61200) },
    { id: 't2', agentRef: 'claude', prompt: 'Now add a test for the proxy case', text: 'Added.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 50_000, endedAt: 70_000, model: 'claude-sonnet-5', nodeId: null,
      tools: [tool('e', 'Task', 'other', 'done', 8000, { subagent: 'general-purpose: draft the failing proxy test' })], usage: usage(9300, 640, 28800) },
  ],
};
const RUNS_C2 = { runs: [{ id: 'u1', agentRef: 'codex', prompt: 'Rename SessionStore to ChatStore', text: 'Renamed in 14 files.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 20_000, endedAt: 30_000, model: null, nodeId: null, tools: [tool('f', 'Edit store.ts', 'edit', 'done', 900)] }] };


const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
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

async function send(page, text) {
  const box = page.locator('section.s2-chat textarea').first();
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

/** Vertical centres of the matched elements inside `root`, by selector; fails if one is missing. */
const centres = (root, selectors) =>
  root.evaluate((el, sels) => {
    const out = {};
    for (const s of sels) {
      const n = el.querySelector(s);
      if (!n) throw new Error(`missing ${s}`);
      const r = n.getBoundingClientRect();
      out[s] = r.top + r.height / 2;
    }
    return out;
  }, selectors);

function spread(c) {
  const v = Object.values(c);
  return Math.max(...v) - Math.min(...v);
}

await suite(
  'r11-chat-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + (window.__skew || 0);
    });
    const shot = (name, theme) => page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    const live = async (body) => {
      await page.unroute('**/api/acp/run-node*').catch(() => {});
      await page.route('**/api/acp/run-node*', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body }));
    };
    for (const theme of ['dark', 'light']) {
      /* Thinking: the request never answers, the turn is "starting"/"thinking" and its label shimmers. */
      await fresh(page, base, theme);
      await page.unroute('**/api/acp/run-node*').catch(() => {});
      await page.route('**/api/acp/run-node*', () => {});
      await send(page, 'Run the gateway tests again');
      await check(`${theme}: the working label shimmers (shared .shimmer-text, a moving gradient)`, async () => {
        const el = page.locator('section.s2-chat .shimmer-text').first();
        await el.waitFor({ timeout: 10000 });
        const m = await el.evaluate((n) => ({ anim: getComputedStyle(n).animationName, clip: getComputedStyle(n).backgroundClip || getComputedStyle(n).webkitBackgroundClip }));
        if (m.anim !== 'shimmer-text') throw new Error(`animation is ${m.anim}`);
      });
      await shot('thinking-shimmer', theme);
      await check(`${theme}: the shimmer is still, but tinted, under reduced motion`, async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const anim = await page.locator('section.s2-chat .shimmer-text').first().evaluate((n) => getComputedStyle(n).animationName);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        if (anim !== 'none') throw new Error(`animation is ${anim}`);
      });

      /* Watchdog row. */
      await page.evaluate(() => {
        window.__skew = 47_000;
      });
      await check(`${theme}: the watchdog row has a film, key fact in ink-1, detail beneath it in a quieter ink`, async () => {
        const w = page.locator(sel('agent-run-watchdog'));
        await w.waitFor({ timeout: 8000 });
        const m = await w.evaluate((n) => ({
          bg: getComputedStyle(n).backgroundColor,
          key: getComputedStyle(n.querySelector('.agnote-text')).color,
          detail: getComputedStyle(n.querySelector('.agnote-detail')).color,
        }));
        if (m.bg === 'rgba(0, 0, 0, 0)') throw new Error('no film behind the row');
        if (m.key === m.detail) throw new Error('no colour hierarchy');
        const c = await centres(w, ['.agnote-mark', '.agnote-text']);
        if (spread(c) > 1) throw new Error(`centres differ by ${spread(c).toFixed(2)}px: ${JSON.stringify(c)}`);
      });
      await shot('watchdog', theme);

      /* Subagent rows: chat card and rail. */
      await fresh(page, base, theme);
      await check(`${theme}: subagent card: chevron, status mark and label share a centre (within 1px)`, async () => {
        const card = page.locator(sel('agent-subagent-toggle')).first();
        await card.waitFor({ timeout: 10000 });
        const c = await centres(card, ['.agsub-chev', '.agsub-dot', '.agsub-name']);
        if (spread(c) > 1) throw new Error(`centres differ by ${spread(c).toFixed(2)}px: ${JSON.stringify(c)}`);
      });
      await page.locator(sel('agent-subagent-toggle')).first().click();
      await page.waitForTimeout(250);
      await shot('subagent-rows', theme);
      await check(`${theme}: rail sub-rows: status mark and label share a centre (within 1px)`, async () => {
        await page.locator(sel('rail-subagents-toggle')).first().click();
        const rows = page.locator(sel('rail-subagent'));
        await rows.first().waitFor({ timeout: 8000 });
        for (let i = 0; i < (await rows.count()); i++) {
          const c = await centres(rows.nth(i), ['.rsub-dot', '.rsub-name']);
          if (spread(c) > 1) throw new Error(`row ${i}: centres differ by ${spread(c).toFixed(2)}px`);
        }
      });
      await check(`${theme}: a running subagent shows the ASCII spinner and a shimmering label (live stream)`, async () => {
        /* A stream that stays open: a tiny local server writes one event and never ends. */
        const hang = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
          res.write(sse([{ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'task-9', title: 'Task', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'Explore', description: 'look at the proxy' } } } }]));
        });
        await new Promise((r) => hang.listen(0, '127.0.0.1', r));
        const port = hang.address().port;
        await page.unroute('**/api/acp/run-node*').catch(() => {});
        await page.route('**/api/acp/run-node*', (route) => route.continue({ url: `http://127.0.0.1:${port}/` }));
        await send(page, 'Look at the proxy');
        const card = page.locator(`${sel('agent-subagent')}[data-status="running"]`).first();
        await card.waitFor({ timeout: 10000 });
        if ((await card.locator(sel('s2-ascii-spinner')).count()) < 1) throw new Error('no spinner');
        if ((await card.locator('.agsub-name.shimmer-text').count()) !== 1) throw new Error('label does not shimmer');
        const c = await centres(card.locator(sel('agent-subagent-toggle')), ['.agsub-chev', '.agsub-dot', '.agsub-name']);
        if (spread(c) > 1) throw new Error(`running centres differ by ${spread(c).toFixed(2)}px`);
        await shot('subagent-running', theme);
        hang.closeAllConnections();
        hang.close();
      });

      /* The step timeline: dot, icon and label share a centre. */
      await fresh(page, base, theme);
      await page.locator(sel('agent-tool-fold-toggle')).first().click();
      await page.waitForTimeout(300);
      await check(`${theme}: timeline dot, step icon and label share a centre (within 1px)`, async () => {
        const cards = page.locator('.s2-agfold-body > .s2-agcard');
        const n = await cards.count();
        if (n < 2) throw new Error(`only ${n} steps`);
        for (let i = 0; i < n; i++) {
          const m = await cards.nth(i).evaluate((card) => {
            const r = card.getBoundingClientRect();
            const dot = getComputedStyle(card, '::before');
            const top = parseFloat(dot.top);
            const h = parseFloat(dot.height);
            const mid = (s) => {
              const q = card.querySelector(s).getBoundingClientRect();
              return q.top + q.height / 2;
            };
            return { dot: r.top + top + (dot.transform === 'none' ? h / 2 : 0), icon: mid('.s2-agmark'), label: mid('[data-testid="agent-card-title"]') };
          });
          if (spread(m) > 1) throw new Error(`step ${i}: ${JSON.stringify(m)}`);
        }
      });
      await shot('timeline-centres', theme);

      /* Diagram actions: a film that appears on hover and focus. */
      await fresh(page, base, theme);
      const dgm = page.locator(sel('chat-diagram')).first();
      await dgm.locator(sel('chat-diagram-art')).locator('svg').waitFor({ timeout: 20000 });
      await page.mouse.move(2, 2);
      await check(`${theme}: the diagram's buttons are hidden at rest, a transparent film on hover, and reachable by keyboard`, async () => {
        const btn = dgm.locator(sel('chat-diagram-toggle'));
        const op = () => btn.evaluate((n) => Number(getComputedStyle(n).opacity));
        if ((await op()) !== 0) throw new Error('visible at rest');
        const bg = await btn.evaluate((n) => getComputedStyle(n).backgroundColor);
        /* (lane cards v2) the actions are bare icons: transparent at rest, the hover state's film under the pointer. */
        if (!/rgba\(.*,\s*0(\.\d+)?\)|color\(|transparent/.test(bg)) throw new Error(`film is ${bg}`);
        await dgm.hover();
        await page.waitForTimeout(300);
        if ((await op()) !== 1) throw new Error('not shown on hover');
        await page.mouse.move(2, 2);
        await page.waitForTimeout(300);
        await btn.focus();
        await page.waitForTimeout(200);
        if ((await op()) !== 1) throw new Error('not shown on focus');
      });
      await dgm.hover();
      await page.waitForTimeout(300);
      await dgm.screenshot({ path: `${OUT}/diagram-hover-${theme}.png` });

      /* The Agents surface, two chats. */
      await fresh(page, base, theme);
      await page.getByText('Rename the session store').first().click();
      await page.waitForTimeout(800);
      await page.getByText('Rate limiter returns 200 under load').first().click();
      await page.waitForTimeout(500);
      await check(`${theme}: Agents sits right after Terminal in the surface bar`, async () => {
        const ids = await page.locator('[data-testid="s2-surfaces"] [data-tab-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab-id')));
        const t = ids.indexOf('terminal');
        if (t < 0 || ids[t + 1] !== 'agents') throw new Error(`bar order: ${ids.join(', ')}`);
      });
      await page.locator(sel('s2-tab-agents')).click();
      await check(`${theme}: the Agents surface shows both chats, their subagents and tokens (— where unknown)`, async () => {
        await page.locator(sel('agents-surface')).waitFor({ timeout: 10000 });
        const chats = await page.locator(sel('agents-surface-chat')).count();
        if (chats !== 2) throw new Error(`${chats} chats`);
        if ((await page.locator(sel('agents-surface-subagent')).count()) !== 2) throw new Error('want 2 subagents');
        const toks = await page.locator(sel('agents-surface-chat-tokens')).allInnerTexts();
        if (!toks.some((t) => t.startsWith('—'))) throw new Error(`no honest dash: ${toks}`);
        const total = await page.locator(sel('agents-surface-total')).innerText();
        if (!/Context[\s\S]*Output/.test(total)) throw new Error(total);
        const rows = page.locator('.ags-row');
        const n = await rows.count();
        for (let i = 0; i < n; i++) {
          const c = await centres(rows.nth(i), ['.ags-mark', '.ags-label']);
          if (spread(c) > 1) throw new Error(`row ${i}: centres differ by ${spread(c).toFixed(2)}px`);
        }
      });
      await shot('agents-surface', theme);
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await check(`${theme}: the timeline view draws a lane per chat`, async () => {
        if ((await page.locator(sel('agents-surface-lane')).count()) !== 2) throw new Error('want 2 lanes');
      });
      await shot('agents-surface-timeline', theme);
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS_C1 } },
);
