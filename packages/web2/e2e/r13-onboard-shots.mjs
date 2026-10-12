#!/usr/bin/env node
/**
 * R13 lane O (onboarding and Settings): Welcome to Sequence, the swipe setup,
 * Models, toggles, notifications, AGENTS.md, Skills in Settings.
 * Dark and light, 1024 and 1440. Shots go to $SHOTS
 * (default /mnt/project-files/sequence/cloud-pass/shots/r13/onboard).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r13/onboard';
fs.mkdirSync(OUT, { recursive: true });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const SHOP = path.join(REPO, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');
const CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
if (!fs.existsSync(CLI)) {
  console.error('[r13-onboard-shots] ERROR: the analyzer is not built (pnpm --filter @sequence/analyzer build)');
  process.exit(2);
}
const GRAPH_OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r13-onboard-')), 'archgraph.json');
execFileSync(process.execPath, [CLI, 'scan', SHOP, '--out', GRAPH_OUT], { stdio: ['ignore', 'ignore', 'pipe'], cwd: REPO });
const GRAPH = JSON.parse(fs.readFileSync(GRAPH_OUT, 'utf8'));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const P = (id, label, state, extra = {}) => ({ id, label, installed: state !== 'install', version: '1.0.0', state, signInCommand: `${id} login`, installHint: `npm i -g ${id}`, ...extra });
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

/**
 * A fake engine that remembers: unattached until /api/attach, then attached; no agents registered until a
 * connect. `ready` is the list of providers the first-run screen finds ready.
 */
async function engine(page, { ready, attached = false, repos = [], bridge = false }) {
  const st = { agentsMd: '# Agents\n\nRun pnpm test before you finish.\nKeep changes small.\n', agentsMdPuts: 0, attached, agents: [], clicks: 0, attachCalls: 0, connectCalls: 0, runCalls: 0 };
  const providers = [
    ...ready.map(([id, label, plan]) => (bridge && id === 'claude' ? P(id, label, 'signIn', { bridgeMissing: true, adapterInstall: 'npm i -g @zed-industries/claude-agent-acp' }) : P(id, label, 'ready', { plan }))),
    ...(ready.length < 2 ? [P('codex', 'Codex', 'signIn')] : []),
  ];
  await page.route('**/archgraph.json', (r) => (st.attached ? json(r, GRAPH) : json(r, { error: 'none' }, 404)));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    if (p === '/api/status') return json(route, st.attached ? { attached: true, repoName: 'shopfront', root: '/home/dev/shopfront' } : { attached: false });
    if (p === '/api/workspace') return json(route, { root: '/home/dev/.sequence/workspace', exists: true, entries: [], omitted: 0 });
    if (p === '/api/recent') return json(route, { recent: [] });
    if (p === '/api/attach' && method === 'POST') {
      st.attached = true;
      st.attachCalls += 1;
      return json(route, { attached: true, repoName: 'shopfront', root: '/home/dev/shopfront', graphSummary: { nodeCount: GRAPH.nodes.length, edgeCount: GRAPH.edges.length, repoName: 'shopfront' } });
    }
    if (p === '/api/onboarding/providers') return json(route, { providers });
    if (p === '/api/onboarding/repos') return json(route, { repos: [{ path: '/home/dev/shopfront', name: 'shopfront', lastActive: Date.now() - 3600_000, recent: true }], truncated: false });
    if (p === '/api/onboarding/setup') return json(route, { mcpServers: [], skills: [] });
    if (p === '/api/acp/agents' && method === 'GET') return json(route, { agents: st.agents.map((id) => ({ id, command: id })) });
    if (p === '/api/acp/agents/connect' && method === 'POST') {
      const b = JSON.parse(req.postData() ?? '{}');
      st.connectCalls += 1;
      if (!st.agents.includes(b.provider)) st.agents.push(b.provider);
      return json(route, { agent: { id: b.provider } });
    }
    if (p === '/api/sessions' && method === 'GET') {
      const at = new Date(Date.UTC(2026, 9, 8, 5)).toISOString();
      return json(route, { index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'New chat', titleEdited: false, createdAt: at, updatedAt: at }] }, scope: 'workspace', repos });
    }
    if (p === '/api/acp/capabilities') return json(route, CAPS);
    /* The Settings routes, so every tab draws real rows and not an error line. */
    if (p === '/api/ai-config' && method === 'GET') return json(route, { configured: true, provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '\u2022\u2022\u2022\u20224f2a', profiles: [{ id: 'p1', name: 'Claude Sonnet', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '\u2022\u2022\u2022\u20224f2a' }, { id: 'p2', name: 'qwen3:4b', provider: 'openai-compatible', model: 'qwen3:4b', baseUrl: 'http://localhost:11434/v1' }], defaultProfileId: 'p1', localProviders: [{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:4b', 'llama3.2:3b'] }] });
    if (p === '/api/local/setup') return json(route, { outcome: 'ready', model: 'qwen3:4b', bytes: 2600000000, machine: { totalMemoryBytes: 17179869184, freeMemoryBytes: 8589934592, cpus: 10 } });
    if (p === '/api/local/pull') return json(route, { state: 'idle' });
    if (p === '/api/auto-approve') return json(route, { root: '/home/dev/shopfront', trusted: false, on: false, refusal: 'auto-approve is off for this repository.' });
    if (p === '/api/repo-trust') return json(route, { root: '/home/dev/shopfront', trusted: false });
    if (p === '/api/hooks') return json(route, { events: [], blocking: [], declared: {}, trusted: false });
    if (p === '/api/permissions') return json(route, { path: '.sequence/permissions.json', exists: false, document: { version: 1, default: 'allow', denyStreak: 3, deny: [], ask: [], allow: [] }, text: '{\n  "version": 1\n}\n', warnings: [] });
    if (p === '/api/mcp') return json(route, { path: '.sequence/mcp.json', exists: true, document: { servers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } } }, text: '{}', warnings: [] });
    if (p === '/api/skills' && method === 'POST') {
      const b = JSON.parse(req.postData() ?? '{}');
      st.skillPosts = (st.skillPosts ?? []).concat([b]);
      return json(route, { imported: [...new Set(b.files.map((f) => f.path.split('/')[0]))] });
    }
    if (p === '/api/skills') return json(route, { dir: '.sequence/skills', skills: [{ slug: 'deploy', name: 'Deploy', description: 'Ship to staging' }, ...(st.skillPosts ?? []).flatMap((b) => b.files.filter((f) => /^[^/]+\/SKILL\.md$/.test(f.path)).map((f) => ({ slug: f.path.split('/')[0], name: /name:\s*(.+)/.exec(f.content)?.[1] ?? f.path.split('/')[0], description: /description:\s*(.+)/.exec(f.content)?.[1] ?? '' })))], warnings: [], trusted: true, instructions: { file: 'AGENTS.md', bytes: 1800, truncated: false } });
    if (p === '/api/file' && (method === 'PUT' || url.searchParams.get('path') === 'AGENTS.md')) {
      if (method === 'PUT') {
        st.agentsMd = JSON.parse(req.postData() ?? '{}').content;
        st.agentsMdPuts += 1;
        return json(route, { ok: true });
      }
      return route.fulfill({ status: 200, contentType: 'text/plain', body: st.agentsMd });
    }
    if (p === '/api/worktree-settings') return json(route, { cap: 8, setupCommand: null, suggestion: 'pnpm install' });
    if (p === '/api/acp/run-node') {
      st.runCalls += 1;
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: '' });
    }
    return json(route, { error: `not mocked ${p}` }, 404);
  });
  return st;
}

async function themeIt(page, theme) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('theme', t);
      localStorage.setItem('seq.theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

async function boot(page, base, theme, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(base);
  await page.evaluate(
    ([t]) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('theme', t);
        localStorage.setItem('seq.theme', t);
        localStorage.setItem('v3.railCollapsed', '0');
        localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'architecture', minimized: false }], active: 'architecture' }));
      } catch {}
    },
    [theme],
  );
  await page.reload();
  await page.waitForSelector(sel('shell'));
  await page.waitForTimeout(500);
}

/* ────────────────────────────────────────────────────────────────────────── */


/** A fresh page on the fake engine: first run (nothing remembered) or the shell with first run skipped. */
async function open(page, base, { theme, width, ready, attached = false, firstRun = false, bridge = false }) {
  await page.unroute('**/api/**').catch(() => {});
  await page.unroute('**/archgraph.json').catch(() => {});
  const st = await engine(page, { ready, attached, bridge });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(base);
  await page.evaluate(
    ([t, fr]) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('theme', t);
      localStorage.setItem('seq.theme', t);
      localStorage.setItem('v3.railCollapsed', '0');
      if (!fr) localStorage.setItem('sequence.onboarding.skip', '1');
    },
    [theme, firstRun],
  );
  await page.reload();
  return st;
}

/** The switch's thumb against its track, read from the browser: left gap, right gap, top gap, bottom gap. */
async function thumbGaps(page, testid) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    const track = el.getBoundingClientRect();
    const cs = getComputedStyle(el, '::before');
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    const left = parseFloat(cs.left);
    const top = parseFloat(cs.top);
    const tr = cs.translate && cs.translate !== 'none' ? parseFloat(cs.translate.split(' ')[0]) : 0;
    const bw = parseFloat(getComputedStyle(el).borderLeftWidth) || 0;
    const bh = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
    const x = left + tr;
    return { left: x, right: track.width - 2 * bw - x - w, top, bottom: track.height - 2 * bh - top - h, track: [track.width, track.height], thumb: [w, h] };
  }, testid);
}

await suite(
  'r13-onboard-shots',
  async ({ page, base, check }) => {
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 1024]) {
        const tag = `${theme}-${width}`;

        /* O1 + O2: Welcome, the route, Start chatting, then the swipe setup. */
        await check(`${tag}: first run, welcome to setup to chat`, async () => {
          const st = await open(page, base, { theme, width, ready: [['claude', 'Claude Code', 'Max']], firstRun: true });
          await page.waitForSelector(sel('first-run-option'), { timeout: 15000 });
          await page.waitForTimeout(400);
          const names = await page.locator('.fr-option-name').allTextContents();
          if (names.join('|') !== 'Claude Code|Codex|Local model|API key') throw new Error(`options: ${names}`);
          if ((await page.locator('h1').textContent()) !== 'Welcome to Sequence') throw new Error('no welcome title');
          const focus0 = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
          if (focus0 !== 'first-run-option') throw new Error(`focus on ${focus0}`);
          await page.screenshot({ path: `${OUT}/o1-welcome-${tag}.png` });
          await page.locator('[data-option="claude"]').click();
          await page.waitForSelector(sel('first-run-start'));
          const focus1 = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
          if (focus1 !== 'first-run-start') throw new Error(`ready agent: focus on ${focus1}`);
          await page.screenshot({ path: `${OUT}/o1-route-ready-${tag}.png` });
          await page.locator(sel('first-run-start')).click();
          await page.waitForSelector(sel('first-run-setup'));
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${OUT}/o2-setup-project-${tag}.png` });
          await page.locator(sel('first-run-setup-project-no')).click();
          await page.waitForTimeout(500);
          /* The clipped viewport must not drift out of step with the track. */
          const drift = await page.locator('.fr-viewport').evaluate((e) => e.scrollLeft);
          if (drift !== 0) throw new Error(`setup viewport scrolled by ${drift}`);
          await page.screenshot({ path: `${OUT}/o2-setup-trust-${tag}.png` });
          await page.locator(sel('first-run-setup-trust-no')).click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${OUT}/o2-setup-done-${tag}.png` });
          await page.locator(sel('first-run-setup-done-go')).click();
          await page.waitForSelector(sel('s2-pillbar'), { timeout: 15000 });
          await page.waitForTimeout(600);
          const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
          if (focus !== 'composer-field') throw new Error(`landing focus is on ${focus}`);
          if (st.attachCalls !== 0 || st.runCalls !== 0) throw new Error('first run attached or ran something');
        });

        /* Claude Code on a clean machine: signed out and no bridge, checked together; one button. */
        await check(`${tag}: first run, Claude Code needs the bridge and sign-in`, async () => {
          await open(page, base, { theme, width, ready: [['claude', 'Claude Code', 'Max']], firstRun: true, bridge: true });
          await page.waitForSelector(sel('first-run-option'), { timeout: 15000 });
          await page.locator('[data-option="claude"]').click();
          const btn = page.locator(sel('first-run-setup-agent'));
          await btn.waitFor();
          if ((await btn.getAttribute('data-needs')) !== 'bridge+signin') throw new Error(`needs ${await btn.getAttribute('data-needs')}`);
          if (!/Install bridge and sign in/.test(await btn.textContent())) throw new Error('button does not name both steps');
          if (/adapter/i.test(await page.locator('.fr-col').innerText())) throw new Error('the word adapter is on screen');
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${OUT}/o1-bridge-${tag}.png` });
        });

        /* O1: the two model routes. */
        await check(`${tag}: first run, local model and API key`, async () => {
          await open(page, base, { theme, width, ready: [], firstRun: true });
          await page.waitForSelector(sel('first-run-option'), { timeout: 15000 });
          await page.locator('[data-option="local"]').click();
          await page.waitForSelector(sel('first-run-local'));
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${OUT}/o1-local-${tag}.png` });
          await page.locator(sel('first-run-back')).click();
          await page.locator('[data-option="key"]').click();
          await page.waitForSelector(sel('first-run-key'));
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${OUT}/o1-key-${tag}.png` });
        });

        /* O3, O5, O6, O4, O7 in Settings. */
        await check(`${tag}: Settings, models, toggles, notification, AGENTS.md, Skills`, async () => {
          const st = await open(page, base, { theme, width, ready: [['claude', 'Claude Code', 'Max']] });
          await page.waitForSelector(sel('shell'), { timeout: 15000 });
          await page.waitForTimeout(600);
          /* O7: the sidebar has no Skills entry. */
          if (await page.locator(sel('s2-rail-skills')).count()) throw new Error('the sidebar still has a Skills entry');
          await page.screenshot({ path: `${OUT}/o7-sidebar-${tag}.png` });
          await page.locator(sel('v3-rail-settings')).click();
          await page.waitForSelector(sel('settings-panel'), { timeout: 10000 });
          /* O3 */
          await page.locator(sel('settings-nav-models')).click();
          await page.waitForSelector(sel('settings-choice'));
          await page.waitForTimeout(400);
          const words = await page.locator(sel('settings-panel')).innerText();
          if (/\b(daily|cheap)\b/i.test(words) || /\blocal\b[,.]? *cheap/i.test(words)) throw new Error('a role word is on the Models tab');
          await page.screenshot({ path: `${OUT}/o3-models-${tag}.png` });
          await page.locator(`${sel('settings-choice')}[data-choice="local"] ${sel('settings-choice-toggle')}`).click();
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${OUT}/o3-models-local-open-${tag}.png` });
          await page.locator(`${sel('settings-choice')}[data-choice="key"] ${sel('settings-choice-toggle')}`).click();
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${OUT}/o3-models-key-open-${tag}.png` });
          /* Every choice is one line: no label or header wraps (a wrapped one is taller than ~1.5 lines). */
          const wrapped = await page.evaluate(() =>
            [...document.querySelectorAll('.sb-choice-hd, .sb-choice .sb-tile')].filter((e) => {
              const lh = parseFloat(getComputedStyle(e).lineHeight) || 18;
              const t = e.querySelector('.sb-tile-t, .sb-choice-t') ?? e;
              return t.getBoundingClientRect().height > lh * 1.5 || t.scrollWidth > t.clientWidth + 1;
            }).map((e) => e.textContent),
          );
          if (wrapped.length) throw new Error(`wrapped or clipped choices: ${JSON.stringify(wrapped)}`);
          const said = (await page.locator(sel('settings-panel')).innerText()).match(/is running on this machine|Add a model\. Local ones|A model on this machine is ready/g);
          if (said) throw new Error(`repeated local sentence on Models: ${said}`);
          const add = await page.locator(sel('settings-profile-new')).evaluate((e) => getComputedStyle(e).backgroundColor);
          const accent = await page.evaluate(() => {
            const d = document.createElement('i');
            d.style.background = 'var(--accent-solid)';
            document.body.append(d);
            const c = getComputedStyle(d).backgroundColor;
            d.remove();
            return c;
          });
          if (add !== accent) throw new Error(`Add another model is ${add}, accent is ${accent}`);
          /* O6 + O5 */
          await page.locator(sel('settings-nav-app')).click();
          await page.waitForSelector(sel('settings-status-bar-switch'));
          await page.waitForTimeout(400);
          /* The thumb sits dead centre in the track, off and on, both axes. */
          for (const label of ['on', 'off']) {
            const g = await thumbGaps(page, 'settings-status-bar-switch');
            const on = await page.locator(sel('settings-status-bar-switch')).isChecked();
            if ((label === 'on') !== on) throw new Error(`switch state is not ${label}`);
            if (Math.abs(g.top - g.bottom) > 0.5) throw new Error(`thumb not centred vertically when ${label}: ${JSON.stringify(g)}`);
            const gap = on ? g.right : g.left;
            if (Math.abs(g.top - gap) > 0.5) throw new Error(`thumb gap to the end is ${gap}, to the top ${g.top} when ${label}: ${JSON.stringify(g)}`);
            const row = page.locator(sel('settings-status-bar'));
            await row.screenshot({ path: `${OUT}/o5-toggle-${label}-${tag}.png` });
            await page.locator(sel('settings-status-bar-switch')).click();
            await page.waitForTimeout(300);
          }
          /* O4: AGENTS.md, where it lives, edited in place. */
          await page.locator(sel('settings-nav-agents')).click();
          await page.waitForSelector(sel('settings-instructions-path'));
          const where = await page.locator(sel('settings-instructions-path')).textContent();
          if (!where.endsWith('/AGENTS.md')) throw new Error(`AGENTS.md path: ${where}`);
          await page.screenshot({ path: `${OUT}/o4-agents-md-${tag}.png` });
          /* N4: the connected agent's subscription models are listed read-only under it. */
          if (await page.locator(sel('settings-agent-connect')).count()) await page.locator(sel('settings-agent-connect')).first().click();
          await page.waitForSelector(sel('settings-agent-models'), { timeout: 4000 });
          {
            const names = await page.locator(sel('settings-agent-model')).allTextContents();
            if (!names.length) throw new Error('no subscription models listed');
            const row = page.locator(`${sel('settings-agent')}[data-status="connected"]`).first();
            if (await row.getByRole('button', { name: /^(Test|Edit|Remove)$/ }).count()) throw new Error('subscription models offer Test, Edit or Remove');
            await page.screenshot({ path: `${OUT}/n4-agent-models-${tag}.png` });
          }
          /* N5: import AGENTS.md from a file; it opens in the editor and is not written until Save. */
          await page.locator(sel('settings-instructions-file')).setInputFiles({ name: 'AGENTS.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported\n\nUse pnpm.\n') });
          await page.waitForSelector(sel('settings-instructions-imported'));
          if ((await page.locator(sel('settings-instructions-text')).inputValue()) !== '# Imported\n\nUse pnpm.\n') throw new Error('import did not fill the editor');
          if (st.agentsMdPuts !== 0) throw new Error('import wrote before Save');
          await page.screenshot({ path: `${OUT}/n5-agents-md-import-${tag}.png` });
          await page.locator(sel('settings-instructions-cancel')).click();
          await page.locator(sel('settings-instructions-edit')).click();
          await page.locator(sel('settings-instructions-text')).fill('# Agents\n\nEdited in place.\n');
          await page.screenshot({ path: `${OUT}/o4-agents-md-edit-${tag}.png` });
          await page.locator(sel('settings-instructions-save')).click();
          await page.waitForSelector(sel('settings-instructions-saved'));
          if (st.agentsMdPuts !== 1 || !st.agentsMd.includes('Edited in place')) throw new Error('AGENTS.md was not saved');
          /* O7: Skills is a Settings tab. */
          await page.locator(sel('settings-nav-skills')).click();
          await page.waitForSelector(sel('settings-skills'));
          await page.screenshot({ path: `${OUT}/o7-skills-tab-${tag}.png` });
          /* N6: import a skill folder; the server is asked once and the list is read again. */
          await page.locator(sel('settings-skills-file')).setInputFiles([{ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nversion: 1\nname: Shop\ndescription: x\nevidenceRunIds: [r]\n---\n') }]);
          await page.waitForSelector(sel('settings-skills-imported'));
          if (!(st.skillPosts ?? []).length) throw new Error('skills import did not reach the server');
          await page.waitForFunction(() => document.querySelectorAll('[data-testid="settings-skill-row"]').length === 2, null, { timeout: 4000 });
          if (!(await page.locator(sel('settings-skills-list')).innerText()).includes('Shop')) throw new Error('the imported skill is not listed');
          await page.screenshot({ path: `${OUT}/n6-skills-import-${tag}.png` });
          await page.locator(sel('settings-nav-app')).click();
          const note = await page.locator(sel('settings-notify')).innerText();
          if (!/notification/i.test(note)) throw new Error(`the run-finished setting does not say notification: ${note}`);
          await page.locator(sel('settings-notify')).scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${OUT}/o6-notification-${tag}.png` });
        });
      }
    }
  },
  { routes: {} },
);
