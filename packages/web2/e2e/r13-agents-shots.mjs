#!/usr/bin/env node
/**
 * R13 agents lane shots (A1 to A8). Based on the r12 script; adds the board toolbar, the dots at low zoom and the
 * workflow editor. Original header: R12 agents lane shots, dark and light at 1024 and 1440: the Agents surface with a live run
 * (no stray accent tab, tabs fold to icons under 1200px), the Workflows tab with a looping
 * workflow open (graph, back-edge, Commandable/Locked), and the Architecture board toolbar.
 * Fakes /api/acp/runs, /api/program/runs and its detail; no agent runs. Shots go to $SHOTS
 * (default /mnt/project-files/sequence/cloud-pass/shots/r13/agents).
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanIconCentres } from './lib/iconCentre.mjs';
import { applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes } from '@sequence/schema';
import { sel, suite } from './lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GRAPH = (() => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r13-agents-')), 'archgraph.json');
  execFileSync(process.execPath, [path.join(REPO, 'packages/analyzer/dist/cli.js'), 'scan', REPO, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'], cwd: REPO });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
})();

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r13/agents';
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

await suite('r13-agents-shots', async ({ page, base, check }) => {
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
  /* The saved-workflow store, stateful, applying the real ops and compiling the real program. */
  const store = new Map();
  const wview = (d) => { const c = checkWorkflow(d); return { ...d, program: c.program, valid: c.ok, errors: c.errors, notes: workflowNotes(d) }; };
  await page.route('**/api/workflows**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const parts = u.pathname.split('/').filter(Boolean).slice(2);
    if (parts.length === 0 && req.method() === 'GET') return json(200, { workflows: [...store.values()].map(wview) });
    if (parts.length === 0 && req.method() === 'POST') {
      const b = req.postDataJSON();
      const d = { version: 1, id: b.name.toLowerCase().replace(/\W+/g, '-'), name: b.name, blocks: b.from === 'empty' ? [{ id: 'b1', kind: 'finish', title: 'Finish' }] : freshWorkflowBlocks(), rev: 1, createdAt: '', updatedAt: '' };
      store.set(d.id, d);
      return json(201, wview(d));
    }
    const d = store.get(parts[0]);
    if (!d) return json(404, { error: 'no such workflow' });
    if (parts[1] === 'ops') {
      try { const next = { ...d, ...applyWorkflowOps(d, req.postDataJSON().ops), rev: d.rev + 1 }; store.set(d.id, next); return json(200, wview(next)); } catch (e) { return json(400, { error: e.message }); }
    }
    return json(200, wview(d));
  });
  await page.route('**/api/acp/agents', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }] }) }));
  await page.route('**/api/acp/available', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }));
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
        for (const v of ['tree', 'workflows']) {
          const b = page.locator(sel(`agents-surface-tab-${v}`));
          const m = await b.evaluate((n) => ({ aria: n.getAttribute('aria-label'), title: n.getAttribute('title'), ico: getComputedStyle(n.querySelector('.ags-seg-ico')).display, word: n.querySelector('.ags-seg-t').getBoundingClientRect().width }));
          if (!m.aria || !m.title) throw new Error(`${v}: no aria/title`);
          if (w < 1200 && (m.ico === 'none' || m.word > 2)) throw new Error(`${v}: not icon-only ${JSON.stringify(m)}`);
          if (w >= 1200 && (m.ico !== 'none' || m.word < 10)) throw new Error(`${v}: not words ${JSON.stringify(m)}`);
        }
      });
      await check(`${theme} ${w}: N2 no Timeline tab; a row's twist opens its clock strip; N3 the running row is stronger than a finished one`, async () => {
        if (await page.locator(sel('agents-surface-tab-timeline')).count()) throw new Error('Timeline tab still there');
        await page.locator(sel('agents-surface-twist')).first().click();
        await page.locator(sel('agents-surface-detail')).first().waitFor({ timeout: 3000 });
        const m = await page.evaluate(() => {
          const wt = (q) => { const n = document.querySelector(q); return n ? { w: Number(getComputedStyle(n).fontWeight), s: parseFloat(getComputedStyle(n).fontSize), c: getComputedStyle(n).color } : null; };
          return { run: wt("li[data-state='running'] > .ags-row .ags-label"), done: wt("li[data-state='done'] > .ags-row .ags-label") };
        });
        if (m.run && m.done && !(m.run.s > m.done.s || m.run.w > m.done.w)) throw new Error(`running not emphasised ${JSON.stringify(m)}`);
        const dur = await page.locator(sel('agents-surface-tree')).innerText();
        if (/\d{5,}m/.test(dur)) throw new Error(`absurd duration: ${dur}`);
        if (/\b0ms\b/.test(dur)) throw new Error(`a 0ms duration is drawn: ${dur}`);
        /* every number in a tree row (tokens, steps, time) is whole: its text is not cut by its own box or by the row */
        for (const o of ['.ags-tree']) {
          const cut = await page.evaluate((q) => {
            const root = document.querySelector(q); const rb = root.getBoundingClientRect(); const bad = [];
            root.querySelectorAll('.ags-meta').forEach((n) => { const b = n.getBoundingClientRect(); if (n.scrollWidth > n.clientWidth + 1 || b.right > rb.right + 1) bad.push(`${n.textContent} (${Math.round(b.right)} > ${Math.round(rb.right)})`); });
            return bad;
          }, o);
          if (cut.length) throw new Error(`clipped duration or count: ${cut.join(', ')}`);
        }
      });
      await shot('agents-tree-detail', theme, w);
      await check(`${theme} ${w}: the tree row titles keep their width (not cut to a few letters)`, async () => {
        const t = await page.evaluate(() => { const l = document.querySelector('.ags-row-chat .ags-label'); return l ? { w: l.getBoundingClientRect().width, sw: l.scrollWidth } : null; });
        if (t && t.sw > t.w && t.w < 90) throw new Error(`title squeezed to ${t.w}px of ${t.sw}`);
      });
      await check(`${theme} ${w}: re-review: every detail line is one line with its full text on hover; subagent names are whole; the Tokens head is one line`, async () => {
        /* open every row's detail, not just the first */
        const closed = page.locator(`${sel('agents-surface-twist')}[aria-expanded='false']`);
        for (let i = 0; i < 20 && (await closed.count()) > 0; i += 1) await closed.first().click();
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => {
          const lines = (n) => { const r = document.createRange(); r.selectNodeContents(n); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
          const details = [...document.querySelectorAll('.ags-detail-t')].map((n) => ({ text: n.textContent, title: n.getAttribute('title'), lines: lines(n), h: n.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(n).fontSize) * 2 }));
          const subs = [...document.querySelectorAll('[data-testid="agents-surface-subagent"] > .ags-row .ags-label')].map((n) => { const r = document.createRange(); r.selectNodeContents(n); const ink = Math.max(...[...n.querySelectorAll('*'), n].map((e) => e.scrollWidth)); return { text: n.textContent, cut: ink > n.getBoundingClientRect().width + 1 || [...n.querySelectorAll('*'), n].some((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1), w: Math.round(n.getBoundingClientRect().width) }; });
          const total = document.querySelector('.ags-total');
          return { details, subs, total: { lines: lines(total), h: total.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(total).fontSize) * 2, text: total.textContent } };
        });
        if (m.details.length < 3) throw new Error(`only ${m.details.length} detail lines opened`);
        for (const d of m.details) {
          if (d.lines > 1 || d.h > d.lh) throw new Error(`detail line wraps: ${JSON.stringify(d)}`);
          if (d.title !== d.text) throw new Error(`detail hover is not the full text: ${JSON.stringify(d)}`);
        }
        const names = m.subs.map((x) => x.text).sort();
        if (JSON.stringify(names) !== JSON.stringify(['Explore', 'general-purpose'])) throw new Error(`subagent names: ${names}`);
        for (const x of m.subs) if (x.cut) throw new Error(`subagent name cut: ${JSON.stringify(x)}`);
        /* spans at different baselines count as two tops, so one line is judged by height */
        if (m.total.h > m.total.lh) throw new Error(`Tokens head is not one line: ${JSON.stringify(m.total)}`);
      });
      await shot('agents-tree-detail-all', theme, w);
      await page.locator(sel('agents-surface-tab-workflows')).click();
      await page.waitForTimeout(800);
      await shot('workflows-list', theme, w);
      await check(`${theme} ${w}: A1 the Workflows title and its two buttons share the head; the buttons stay together`, async () => {
        const m = await page.evaluate(() => {
          const r = (q) => document.querySelector(q)?.getBoundingClientRect();
          const t = r('.ac-scope[data-embedded] .ac-title'), a = r('[data-testid="activity-refresh"]'), b = r('[data-testid="activity-new-run"]');
          return { t, a, b };
        });
        const mid = (x) => x.top + x.height / 2;
        if (Math.abs(mid(m.a) - mid(m.b)) > 1) throw new Error('Refresh and Start are on different lines');
        if (m.b.left < m.a.right - 1) throw new Error('buttons overlap');
        if (w >= 1200 && Math.abs(mid(m.t) - mid(m.a)) > 2) throw new Error('title and buttons not on one row at wide width');
        if (w < 1200 && m.t.width > 2) throw new Error('N4: the big Workflows title is still drawn at 1024');
        if (w < 1200 && (m.a.width > 40 || m.b.height > 34)) throw new Error(`N4: buttons not compact ${m.a.width}x${m.b.height}`);
        if (w >= 1200 && m.t.right > m.a.left + 1 && Math.abs(mid(m.t) - mid(m.a)) < 4) throw new Error('title overlaps buttons');
      });
      await check(`${theme} ${w}: the Workflows title, buttons, status line and rows start at the Agents header's left edge; the filter chips are one row`, async () => {
        const m = await page.evaluate(() => {
          const L = (q) => Math.round(document.querySelector(q).getBoundingClientRect().left);
          const chips = [...document.querySelectorAll('.ac-bucket')].map((n) => Math.round(n.getBoundingClientRect().top));
          return { agents: L('.ags-title'), titleW: document.querySelector('.ac-scope[data-embedded] .ac-title').getBoundingClientRect().width, title: L('.ac-scope[data-embedded] .ac-title'), needs: L('.ac-needs'), chips: new Set(chips).size, firstChip: L('.ac-bucket'), row: L('.ac-row') };
        });
        if ((m.titleW > 2 && Math.abs(m.title - m.agents) > 1) || Math.abs(m.needs - m.agents) > 1) throw new Error(`inset ${JSON.stringify(m)}`);
        if (Math.abs(m.firstChip - m.agents) > 1) throw new Error(`chips inset ${JSON.stringify(m)}`);
        if (m.chips !== 1) throw new Error(`chips wrap to ${m.chips} rows`);
        const one = await page.evaluate(() => { const n = document.querySelector('.ac-needs'); const b = document.querySelector('[data-testid="activity-open-editor"]'); const nb = n.getBoundingClientRect(), bb = b.getBoundingClientRect(); return { h: nb.height, cut: n.scrollWidth > n.clientWidth + 1, text: n.textContent, sameRow: Math.abs((nb.top + nb.height / 2) - (bb.top + bb.height / 2)) < 6, btn: bb.width }; });
        if (one.h > 24 || one.cut) throw new Error(`the status line is not one whole line: ${JSON.stringify(one)}`);
        if (!one.sameRow || one.btn < 30) throw new Error(`the status line and the editor button are not one row: ${JSON.stringify(one)}`);
      });
      await check(`${theme} ${w}: A3 the header reads Context and Output; A4 no Done/in-progress words beside the icon`, async () => {
        await page.locator(sel('agents-surface-tab-tree')).click();
        const t = await page.locator(sel('agents-surface-total')).innerText();
        if (!/Context[\s\S]*Output/.test(t) || /total|tokens/i.test(t)) throw new Error(`header: ${t}`);
        const ti = await page.locator(sel('agents-surface-total')).getAttribute('title');
        if (!/Input processed across/i.test(ti)) throw new Error(`hover: ${ti}`);
        await page.locator(sel('agents-surface-tab-workflows')).click();
        await page.waitForTimeout(500);
        const vis = await page.evaluate(() => [...document.querySelectorAll('.ac-state, .ac-hint')].filter((n) => n.getBoundingClientRect().width > 2).map((n) => n.textContent));
        if (vis.some((x) => /^(Done|Running|in progress|finished cleanly)$/.test(x))) throw new Error(`redundant words visible: ${vis}`);
      });
      await check(`${theme} ${w}: A2 the head is one row`, async () => {
        await page.locator(sel('agents-surface-tab-tree')).click();
        const h = await page.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return [r('.ags-title'), r('.ags-total'), r('.ags-seg')].map((x) => x.top + x.height / 2); });
        /* Under the 340px container rule the figures take their own line; the title and the tabs stay on one row, and nothing overflows. */
        const narrow = await page.evaluate(() => document.querySelector('.ags').clientWidth <= 340);
        const rowOf = narrow ? [h[0], h[2]] : h;
        if (Math.max(...rowOf) - Math.min(...rowOf) > 2) throw new Error(`head stacks: ${h}`);
        const over = await page.evaluate(() => { const e = document.querySelector('.ags-head'); return e.scrollWidth - e.clientWidth; });
        if (over > 0) throw new Error(`head overflows by ${over}px`);
        await page.locator(sel('agents-surface-tab-workflows')).click();
        await page.waitForTimeout(300);
      });
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
      /* A8: the workflow editor pop-up. */
      await check(`${theme} ${w}: A8 the editor's open button is visible, Start fresh makes the ready-made blocks, a block takes an agent and a model, the chat agent's edit appears`, async () => {
        store.clear();
        const open = page.locator(sel('activity-open-editor'));
        await open.waitFor({ timeout: 5000 });
        const bb = await open.boundingBox();
        if (!bb || bb.width < 30 || bb.height < 20) throw new Error('open button not visible');
        await open.click();
        await page.locator(sel('wfe')).waitFor({ timeout: 5000 });
        await page.locator(sel('wfe-start-fresh')).click();
        await page.locator(sel('wfe-block')).first().waitFor();
        const kinds = await page.locator(sel('wfe-block')).evaluateAll((n) => n.map((x) => x.dataset.kind));
        if (kinds.join() !== 'agent,checker,test,finish') throw new Error(`blocks ${kinds}`);
        await page.locator(sel('wfe-block-open')).first().click();
        await page.locator(sel('wfe-f-agent')).selectOption('claude');
        await page.waitForTimeout(400);
        await page.locator(sel('wfe-add-loop')).click();
        await page.waitForTimeout(400);
        if (await page.locator(sel('wfe-note')).filter({ hasText: 'nothing inside' }).count()) throw new Error('a clicked Loop is empty');
        if (await page.locator(sel('wfe-run')).isDisabled()) throw new Error('Run disabled though the loop wraps a block');
        for (const r of await page.locator(sel('wfe-block')).all()) {
          const lines = await r.evaluate((n) => { const t = n.querySelector('.wfe-bt'), u = n.querySelector('.wfe-bs'); return { h: n.getBoundingClientRect().height, same: !u || Math.abs(t.getBoundingClientRect().top - u.getBoundingClientRect().top) < 8, raw: u ? u.textContent : '' }; });
          if (!lines.same) throw new Error(`a block row is two lines: ${JSON.stringify(lines)}`);
          if (/claude-sonnet|codex, /.test(lines.raw) && /^(codex|claude)(,|$)/.test(lines.raw)) throw new Error(`a block row shows a raw id: ${lines.raw}`);
        }
        /* drag the palette's Test runner to the top of the list (real HTML5 drag) */
        await page.locator(sel('wfe-add-test')).dragTo(page.locator(sel('wfe-block')).first());
        await page.waitForTimeout(500);
        const after = await page.locator(sel('wfe-block')).evaluateAll((n) => n.map((x) => x.dataset.kind));
        if (after[0] !== 'test') throw new Error(`drag did not place the block: ${after}`);
        const box = await page.locator(sel('wfe')).boundingBox();
        const vp = page.viewportSize();
        if (box.x < 0 || box.y < 0 || box.x + box.width > vp.width + 1) throw new Error(`editor overflows the window ${JSON.stringify(box)}`);
        await shot('workflow-editor', theme, w);
        /* our own edits never read as an agent's: a full poll passes after them with no banner */
        await page.waitForTimeout(3200);
        if (await page.locator(sel('wfe-agent-edit')).count()) throw new Error('the agent-edit banner flashed after our own edit');
        /* the chat agent edits the same file through the same ops: the open editor shows it on its next poll */
        const d = store.get('new-workflow');
        store.set(d.id, { ...d, ...applyWorkflowOps(d, [{ op: 'update', id: 'b1', title: 'Edit the failing test', model: 'claude-sonnet-5' }]), rev: d.rev + 1 });
        await page.locator(sel('wfe-agent-edit')).waitFor({ timeout: 8000 });
        const titles = await page.locator(sel('wfe-block')).evaluateAll((n) => n.map((x) => x.querySelector('.wfe-bt').textContent));
        if (!titles.includes('Edit the failing test')) throw new Error(`agent edit not shown: ${titles}`);
        await shot('workflow-editor-agent-edit', theme, w);
        await page.keyboard.press('Escape');
        await page.locator(sel('wfe')).waitFor({ state: 'detached' });
      });
      /* A6, A7: the Architecture board's toolbar and its dots. */
      await page.locator(sel('s2-tab-architecture')).click();
      await page.locator(sel('board-controls')).waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      await shot('board-toolbar', theme, w);
      await check(`${theme} ${w}: A6 the toolbar is one uniform line at the top, no Architecture title when narrow, icons centred`, async () => {
        const m = await page.evaluate(() => {
          const row = document.querySelector('[data-testid="board-controls"]');
          const rr = row.getBoundingClientRect();
          const kids = [...row.querySelectorAll(':scope > *, :scope .btag, :scope .btag-add, :scope .vt, :scope .bbtn, :scope .bfind')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(n).display !== 'none'; });
          const mids = kids.filter((n) => n.matches('.btag, .btag-add, .vt, .bbtn, .bfind')).map((n) => { const r = n.getBoundingClientRect(); return { h: Math.round(r.height), mid: Math.round((r.top + r.height / 2) * 2) / 2, cls: n.className.toString().slice(0, 20) }; });
          const stack = document.querySelector('[data-testid="board-stack"]').getBoundingClientRect();
          return { top: rr.top - stack.top, mids, chip: [...document.querySelectorAll('.btag-t')].filter((n) => n.getBoundingClientRect().width > 2).map((n) => n.textContent), menu: !!document.querySelector('[data-testid="board-view-menu"]') && getComputedStyle(document.querySelector('[data-testid="board-view-menu"]').parentElement).display !== 'none' };
        });
        if (m.top > 20) throw new Error(`toolbar not at the top: ${m.top}`);
        const hs = new Set(m.mids.map((x) => x.h)), cs = new Set(m.mids.map((x) => x.mid));
        if (hs.size > 1) throw new Error(`mixed heights ${JSON.stringify(m.mids)}`);
        if (cs.size > 1) throw new Error(`not on one line ${JSON.stringify(m.mids)}`);
        if (w < 1200 && m.chip.includes('Architecture')) throw new Error('Architecture title still shown at 1024');
        if (w < 1200 && !m.menu) throw new Error('no view dropdown on the narrow board');
        const r = await page.evaluate(scanIconCentres, { rootSelector: '[data-testid="board-controls"]', tolerance: 0.5 });
        if (r.off.length) throw new Error(`icons off centre: ${JSON.stringify(r.off)}`);
        if (r.measured < 2) throw new Error(`measured ${r.measured}`);
      });
      await check(`${theme} ${w}: N5 the Find glyph is centred in its box`, async () => {
        const m = await page.evaluate(() => {
          const f = document.querySelector('.bfind'); const i = f.querySelector('svg');
          const a = f.getBoundingClientRect(), b = i.getBoundingClientRect();
          return { dx: Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)), dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) };
        });
        if (m.dx > 0.6 || m.dy > 0.6) throw new Error(`find glyph off centre ${JSON.stringify(m)}`);
      });
      if (w < 1200) {
        await page.locator(sel('board-view-menu')).click();
        await page.waitForTimeout(250);
        await shot('board-toolbar-menu', theme, w);
        await check(`${theme} ${w}: A6 the dropdown lists Map, Grid, Diff`, async () => {
          for (const v of ['map', 'grid', 'diff']) if (!(await page.locator(sel(`board-view-menu-${v}`)).count())) throw new Error(`no ${v}`);
        });
        await page.keyboard.press('Escape');
      }
      await check(`${theme} ${w}: A7 zoomed out, the dots are fewer and fainter`, async () => {
        const read = () => page.evaluate(() => { const b = document.querySelector('[data-testid="board"]'); return { z: Number(b.style.getPropertyValue('--board-cam-z')), step: Number(b.style.getPropertyValue('--board-field-step')), fade: Number(b.style.getPropertyValue('--board-field-fade')), size: parseFloat(getComputedStyle(b).backgroundSize) }; });
        for (let i = 0; i < 12; i++) { const z = page.locator(sel('board-zoom-out')); if (await z.isDisabled()) break; await z.click(); }
        await page.waitForTimeout(400);
        const lo = await read();
        if (lo.size < 9.5) throw new Error(`dots ${lo.size}px apart at zoom ${lo.z}`);
        if (lo.fade >= 0.7) throw new Error(`fade ${lo.fade}`);
        await shot('board-zoomed-out', theme, w);
      });
    }
  }
}, { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': runsC1(), '/archgraph.json': GRAPH } });
