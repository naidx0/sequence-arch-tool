#!/usr/bin/env node
/**
 * R12 agents lane shots, dark and light at 1024 and 1440: the Agents surface with a live run
 * (no stray accent tab, tabs fold to icons under 1200px), the Workflows tab with a looping
 * workflow open (graph, back-edge, Commandable/Locked), and the Architecture board toolbar.
 * Fakes /api/acp/runs, /api/program/runs and its detail; no agent runs. Shots go to $SHOTS
 * (default /mnt/project-files/sequence/cloud-pass/shots/r12/agents).
 */
import fs from 'node:fs';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r12/agents';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [
    { id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) },
    { id: 'c2', title: 'Rename the session store', titleEdited: false, createdAt: at(3), updatedAt: at(4) },
  ] },
  scope: 'workspace',
  repos: [],
};
const tool = (id, title, toolKind, status, s, e, extra = {}) => ({ id, title, toolKind, status, startedAt: s, endedAt: e, ...extra });
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const runsC1 = (NOW = Date.now()) => ({ runs: [
  { id: 't1', agentRef: 'claude', prompt: 'Why does the limiter return 200?', text: 'The window is keyed on `req.ip`.', status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 120_000, endedAt: NOW - 80_000, model: 'claude-sonnet-5', nodeId: null,
    tools: [tool('task', 'Task', 'other', 'done', NOW - 119_000, NOW - 110_000, { subagent: 'Explore: find where the limiter reads the client address' })],
    usage: { input: 18400, output: 2100, cacheRead: 61200, cacheWrite: 0, thought: 0, total: 20500 } },
  { id: 't2', agentRef: 'claude', prompt: 'Now add a test for the proxy case', text: '', status: 'running', error: null, stopReason: null, startedAt: NOW - 30_000, endedAt: null, model: 'claude-sonnet-5', nodeId: null,
    tools: [tool('e', 'Task', 'other', 'running', NOW - 25_000, null, { subagent: 'general-purpose: draft the failing proxy test' })] },
] });
const RUNS_C2 = () => { const NOW = Date.now(); return { runs: [{ id: 'u1', agentRef: 'codex', prompt: 'Rename SessionStore', text: 'Renamed.', status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 200_000, endedAt: NOW - 190_000, model: null, nodeId: null, tools: [] }] }; };

const node = (id, title, kind, extra = {}) => ({ id, title, kind, ...extra });
const edge = (id, from, to, kind, label) => ({ id, from, to, kind, ...(label ? { label } : {}) });
const PROGRAM = {
  id: 'prog-fix', name: 'Fix until green',
  nodes: [node('start', 'Start', 'start'), node('plan', 'Plan the fix', 'agent'), node('loop', 'Until tests pass', 'loop', { loop: { condition: { left: 'green', op: 'falsy' }, maxIterations: 4 } }),
    node('edit', 'Edit the code', 'agent'), node('test', 'Run the tests', 'agent'), node('check', 'Verify against the graph', 'checker'), node('end', 'Finish', 'end')],
  edges: [edge('e1', 'start', 'plan', 'seq'), edge('e2', 'plan', 'loop', 'seq'), edge('e3', 'loop', 'edit', 'loop-body'), edge('e4', 'edit', 'test', 'seq'), edge('e5', 'test', 'loop', 'loop-back'), edge('e6', 'loop', 'check', 'seq'), edge('e7', 'check', 'end', 'seq')],
};
const summary = (runId, name, status, NOW = Date.now()) => ({ runId, programId: 'prog-fix', programName: name, status, startedAt: NOW - 600_000, lastEventSeq: 8, steps: 5, nodesTotal: 7, nodesDone: 4, nodesError: 0 });
const programRuns = () => ({ runs: [summary('run-m1a2b3-0001abcd', 'Fix until green', 'running'), { ...summary('run-m1a2b3-0002abcd', 'Docs pass', 'completed'), finishedAt: Date.now() - 100_000 }] });
const ev = (seq, nodeId, status) => ({ seq, at: Date.now() - 500_000 + seq * 1000, type: 'node:status', nodeId, status });
const DETAIL = (runId, status) => ({
  run: { ...summary(runId, 'Fix until green', status), program: PROGRAM, state: {}, nodeResults: {}, notes: [], checkpoint: status === 'running' ? undefined : { completed: [] } },
  events: [ev(1, 'start', 'done'), ev(2, 'plan', 'done'), ev(3, 'loop', 'running'), ev(4, 'edit', 'done'), ev(5, 'test', 'done'), ev(6, 'edit', 'running')],
});

async function fresh(page, base, theme) {
  await page.goto(base);
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.reload();
  await page.evaluate((t) => { try { localStorage.setItem('seq.theme', t); } catch {} document.documentElement.setAttribute('data-theme', t); }, theme);
  await page.waitForSelector(sel('shell'));
  await page.waitForTimeout(600);
}

await suite('r12-agents-shots', async ({ page, base, check }) => {
  await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
  await page.route('**/api/acp/runs*', (r) => {
    const id = new URL(r.request().url()).searchParams.get('chatId');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id === 'c2' ? RUNS_C2() : runsC1()) });
  });
  await page.route('**/api/program/runs', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(programRuns()) }));
  await page.route('**/api/program/runs?*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(programRuns()) }));
  await page.route('**/api/program/runs/*', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith('/events')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    const id = u.pathname.split('/').pop();
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL(id, id === 'run-m1a2b3-0001abcd' ? 'running' : 'completed')) });
  });
  const shot = async (name, theme, w) => { await page.mouse.move(2, 2); await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${name}-${w}-${theme}.png` }); };

  for (const theme of ['dark', 'light']) {
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await fresh(page, base, theme);
      await page.getByText('Rate limiter returns 200 under load').first().click();
      await page.waitForTimeout(500);
      /* A live turn: the request never answers, so the agent stays running and its row shimmers. */
      await page.route('**/api/acp/run-node*', () => {});
      const box = page.locator('section.s2-chat textarea').first();
      await box.click();
      await box.fill('Run the gateway tests again');
      await box.press('Enter');
      await page.waitForTimeout(1200);
      await page.locator(sel('s2-tab-agents')).click();
      await page.locator(sel('agents-surface')).waitFor({ timeout: 10000 });
      await page.locator('.ags-label.shimmer-text').first().waitFor({ timeout: 15000 });
      await shot('agents-tree', theme, w);
      await check(`${theme} ${w}: a running agent shows a neutral shimmer and a spinner, with no accent colour`, async () => {
        const m = await page.locator('.ags-label.shimmer-text').first().evaluate((n) => getComputedStyle(n).backgroundImage);
        if (!/gradient/.test(m)) throw new Error(`no shimmer: ${m}`);
        const bar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--b-acc').trim());
        if (bar && m.includes(bar)) throw new Error('shimmer uses the accent');
      });
      await shot('agents-tree-running', theme, w);
      await check(`${theme} ${w}: tabs ${w < 1200 ? 'fold to icons with tooltips' : 'show words'}`, async () => {
        /* Round 13 ruling: the Agents Timeline tab is removed and folded into Tree; two tabs remain, and none is Timeline. */
        if (await page.locator(sel('agents-surface-tab-timeline')).count()) throw new Error('Timeline tab still there');
        for (const v of ['tree', 'workflows']) {
          const b = page.locator(sel(`agents-surface-tab-${v}`));
          const m = await b.evaluate((n) => ({ aria: n.getAttribute('aria-label'), title: n.getAttribute('title'), ico: getComputedStyle(n.querySelector('.ags-seg-ico')).display, word: n.querySelector('.ags-seg-t').getBoundingClientRect().width }));
          if (!m.aria || !m.title) throw new Error(`${v}: no aria/title`);
          if (w < 1200 && (m.ico === 'none' || m.word > 2)) throw new Error(`${v}: not icon-only ${JSON.stringify(m)}`);
          if (w >= 1200 && (m.ico !== 'none' || m.word < 10)) throw new Error(`${v}: not words ${JSON.stringify(m)}`);
        }
      });
      await page.locator(sel('agents-surface-tab-workflows')).click();
      await page.waitForTimeout(800);
      await shot('workflows-list', theme, w);
      await page.locator(sel('activity-row')).first().click();
      await page.locator(sel('activity-graph')).waitFor({ timeout: 8000 }).catch(async (e) => {
        console.log('DETAIL TEXT:', (await page.locator(sel('agents-surface')).innerText()).slice(0, 600));
        throw e;
      });
      await check(`${theme} ${w}: the workflow graph draws its steps and the loop as a back-edge; the run says Commandable`, async () => {
        const n = await page.locator(sel('activity-graph-node')).count();
        const l = await page.locator(sel('activity-graph-loop')).count();
        if (n !== 7 || l !== 1) throw new Error(`${n} nodes, ${l} loops`);
        const c = await page.locator(sel('activity-run-control')).getAttribute('data-control');
        if (c !== 'commandable') throw new Error(`control ${c}`);
      });
      await check(`${theme} ${w}: the graph fits the pane (no horizontal scroll), the loop label is inside it, a running step is neutral, nothing crosses`, async () => {
        const g = page.locator(sel('activity-graph-scroll'));
        const fit = await g.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }));
        if (fit.sw > fit.cw + 1) throw new Error(`graph ${fit.sw}px in ${fit.cw}px`);
        const lab = await page.locator('.ac-edge-word').first().evaluate((n) => { const r = n.getBoundingClientRect(); const p = n.closest('[data-testid="activity-graph-scroll"]').getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; });
        if (!lab) throw new Error('loop label outside the pane');
        const run = page.locator('[data-testid="activity-graph-node"][data-node-status="running"]').first();
        const col = await run.evaluate((n) => getComputedStyle(n).borderTopColor);
        const [r, gg, b] = col.match(/[\d.]+/g).map(Number);
        if (Math.max(r, gg, b) - Math.min(r, gg, b) > 40) throw new Error(`running step is coloured: ${col}`);
        const title = await page.locator('.ac-gnode-t', { hasText: 'Verify against the graph' }).first().innerText();
        if (/…|\.\.\./.test(title)) throw new Error('title truncated');
      });
      await shot('workflows-graph', theme, w);
      await page.locator(sel('activity-graph')).screenshot({ path: `${OUT}/workflows-graph-running-${w}-${theme}.png` });
    }
  }
}, { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': runsC1() } });
