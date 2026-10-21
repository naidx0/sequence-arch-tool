#!/usr/bin/env node
/**
 * THE AGENTS WINDOW, LOOKED AT (0.1.8.4, lane B2)
 *
 * The agents window is the panel the owner opens to watch what the agents
 * are doing. jsdom has no layout, so the claims that are about LAYOUT live
 * here, in a real browser against the built app:
 *
 *   · the trace's status line is WHOLE (a summary that names four kinds of
 *     step is not cut to "ran 1…"), and the step in flight is named while
 *     the turn runs;
 *   · the focused step under the window is LINES: its own sentence, its
 *     output (one clamped line, the whole of it on the hover) and the paths
 *     it touched (a few named, the rest counted);
 *   · the roster names the step that has stalled;
 *   · nothing overflows the panel at 420px.
 *
 * The agent activity is faked at the wire (/api/agent-events), so no agent
 * runs and no binary is launched. The screenshots go to
 * docs/bench/0184-ux-agents/ (or $SHOTS), dark and light at 1440 and 420.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sel, suite } from './lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.env.SHOTS ?? path.join(REPO, 'docs', 'bench', '0184-ux-agents');
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: {
    version: 1,
    activeId: 'c1',
    sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }],
  },
  scope: 'workspace',
  repos: [],
};
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
const NOW = Date.now();
const SAVED = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why does the limiter return 200?', text: 'The window is keyed on `req.ip`.', status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 120_000, endedAt: NOW - 80_000, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(18400, 2100, 61200) },
    { id: 't2', agentRef: 'claude', prompt: 'Now add a test for the proxy case', text: '', status: 'running', error: null, stopReason: null, startedAt: NOW - 30_000, endedAt: null, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(9300, 640, 28800) },
  ],
};

/* The agent activity: a read whose output is a page of JSON, a sub-agent with
   a failed step, a failed command, and a read that never came back. */
let n = 0;
const ev = (dt, e) => ({ id: `e${++n}`, at: Date.now() + dt, source: 'acp', sessionId: 'c1', paths: [], status: 'done', ...e });
const hit = (p) => [{ path: p, fileNodeId: null, moduleId: null, serviceId: null, serviceLabel: null, touchedEdgeIds: [], liftedEdges: [] }];
const LONG = JSON.stringify({ rows: Array.from({ length: 6 }, (_, i) => ({ id: i, path: `src/very/long/path/module-${i}.ts`, ok: true })) });
const EVENTS = [
  ev(-300000, { kind: 'session_start', status: 'running', title: 'Rate limiter returns 200 under load' }),
  ev(-299000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'], board: hit('gateway/src/server.ts') }),
  ev(-298400, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'], board: hit('gateway/src/server.ts'), result: LONG }),
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

const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

/** The text of an element, whether the box shows all of it, and how many lines it takes. */
const whole = (page, testid) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 15;
    const h = el.getBoundingClientRect().height;
    return { text: el.textContent ?? '', fits: el.scrollHeight <= el.clientHeight + 1, h, lh, lines: h / lh };
  }, testid);

await suite(
  'agents-ux-0184',
  async ({ page, base, check, log }) => {
    await page.route('**/api/agent-events', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: EVENTS.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') }),
    );
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAVED) }));
    await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
    await page.route('**/api/acp/agents', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'claude', label: 'Claude Code' }] }) }));
    await page.route('**/api/acp/available', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }));

    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 420]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base);
        await page.evaluate((t) => {
          try {
            localStorage.setItem('theme', t);
          } catch {}
          document.documentElement.setAttribute('data-theme', t);
        }, theme);
        await page.waitForSelector(sel('shell'));

        /* THE AGENTS SURFACE (the Agents tab): the same data, read from the
           chat's saved runs. The stage's tabs are gone on a narrow window. */
        const tab = page.locator(sel('s2-tab-agents')).first();
        if (width >= 1024 && (await tab.count())) {
          await tab.click();
          await page.locator(sel('agents-surface')).waitFor({ timeout: 15000 });
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUT, `agents-surface-${width}-${theme}.png`) });
        }

        /* THE AGENTS WINDOW (the dock). */
        if (!(await page.locator(sel('agents-panel')).count())) {
          await page.locator(sel('s2-chat-more')).first().click();
          await page.locator(sel('v3-agents-toggle')).first().click();
        }
        if (width < 1024) {
          const narrow = page.locator(sel('s2-narrow-agents')).first();
          if (await narrow.count()) {
            await narrow.click();
            await page.waitForTimeout(300);
          }
        }
        await page.locator(sel('agents-tree')).waitFor({ timeout: 15000, state: 'attached' });
        await page.waitForTimeout(500);

        await check(`${theme} ${width}: the trace's status line is whole and names what the turn did`, async () => {
          const line = await whole(page, 'agents-trace-status');
          if (!line) throw new Error('no status line');
          if (!line.fits) throw new Error(`the status line is cut: ${JSON.stringify(line)}`);
          if (!/read 2 files/.test(line.text)) throw new Error(`the status line does not say what the turn did: ${line.text}`);
        });

        await check(`${theme} ${width}: the roster names the step that has stalled`, async () => {
          const tool = await page.locator(sel('agents-roster-row')).first().locator('.ag-tool').textContent();
          if (!/stalled/.test(tool ?? '')) throw new Error(`the roster does not name the stall: ${tool}`);
          if (!/Read/.test(tool ?? '')) throw new Error(`the roster does not name the step: ${tool}`);
        });

        await check(`${theme} ${width}: the focused step is lines, and its output is one line with the whole on the hover`, async () => {
          /* The step with a page of JSON is in the older turn, which starts
             folded: open it, then focus the step. */
          const turn = page.locator(`${sel('agents-tree-node')}:has-text("Turn 1")`).first();
          if (await turn.count()) {
            await turn.click();
            await page.waitForTimeout(250);
          }
          const step = page.locator(`${sel('agents-tree-node')}:has-text("Read gateway/src/server.ts")`).first();
          if (!(await step.count())) throw new Error('no read step to focus');
          await step.click();
          await page.waitForTimeout(250);
          const out = await whole(page, 'agents-detail-result');
          if (!out) throw new Error('no output line');
          if (out.lines > 1.5) throw new Error(`the output is not one line: ${JSON.stringify(out)}`);
          const title = await page.locator(sel('agents-detail-result')).getAttribute('title');
          if (!title || title.length < 100) throw new Error(`the whole output is not on the hover: ${String(title).length} chars`);
          const line = await whole(page, 'agents-detail-line');
          if (!line || /rows/.test(line.text)) throw new Error(`the output is glued to the sentence: ${JSON.stringify(line)}`);
        });

        await check(`${theme} ${width}: nothing overflows the panel`, async () => {
          const over = await page.evaluate(() => {
            const panel = document.querySelector('[data-testid="agents-panel"]');
            const pr = panel.getBoundingClientRect();
            const bad = [];
            for (const el of panel.querySelectorAll('*')) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              if (r.right > pr.right + 1 || r.left < pr.left - 1) bad.push(`${el.className} (${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(pr.left)}..${Math.round(pr.right)})`);
            }
            return bad;
          });
          if (over.length) throw new Error(`outside the panel: ${over.join(', ')}`);
        });

        await page.screenshot({ path: path.join(OUT, `agents-window-${width}-${theme}.png`) });
        log(`shot ${width} ${theme}`);
      }
    }
  },
  { routes: { '/api/sessions': SESSIONS } },
);
