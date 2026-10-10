#!/usr/bin/env node
/**
 * R12 lane onboard: first run (agent list, then straight into the chat), the
 * project and workspace icons in the sidebar, and every Settings tab.
 * Dark and light, 1024 and 1440. Shots go to $SHOTS
 * (default /mnt/project-files/sequence/cloud-pass/shots/r12/onboard).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r12/onboard';
fs.mkdirSync(OUT, { recursive: true });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const SHOP = path.join(REPO, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');
const CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
if (!fs.existsSync(CLI)) {
  console.error('[r12-onboard-shots] ERROR: the analyzer is not built (pnpm --filter @sequence/analyzer build)');
  process.exit(2);
}
const GRAPH_OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r12-onboard-')), 'archgraph.json');
execFileSync(process.execPath, [CLI, 'scan', SHOP, '--out', GRAPH_OUT], { stdio: ['ignore', 'ignore', 'pipe'], cwd: REPO });
const GRAPH = JSON.parse(fs.readFileSync(GRAPH_OUT, 'utf8'));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const P = (id, label, state, extra = {}) => ({ id, label, installed: state !== 'install', version: '1.0.0', state, signInCommand: `${id} login`, installHint: `npm i -g ${id}`, ...extra });
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

/**
 * A fake engine that remembers: unattached until /api/attach, then attached; no agents registered until a
 * connect. `ready` is the list of providers the first-run screen finds ready.
 */
async function engine(page, { ready, attached = false, repos = [] }) {
  const st = { attached, agents: [], clicks: 0, attachCalls: 0, connectCalls: 0, runCalls: 0 };
  const providers = [
    ...ready.map(([id, label, plan]) => P(id, label, 'ready', { plan })),
    ...(ready.length < 2 ? [P('codex', 'Codex', 'signIn')] : []),
    P('other', 'Local model', 'install'),
  ];
  await page.route('**/archgraph.json', (r) => (st.attached ? json(r, GRAPH) : json(r, { error: 'none' }, 404)));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    if (p === '/api/status') return json(route, st.attached ? { attached: true, repoName: 'shopfront', root: '/home/dev/shopfront' } : { attached: false });
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
    if (p === '/api/ai-config' && method === 'GET') return json(route, { configured: true, provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '\u2022\u2022\u2022\u20224f2a', profiles: [{ id: 'p1', name: 'Sonnet, daily', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '\u2022\u2022\u2022\u20224f2a' }, { id: 'p2', name: 'Local, cheap', provider: 'openai-compatible', model: 'qwen3:4b', baseUrl: 'http://localhost:11434/v1' }], defaultProfileId: 'p1' });
    if (p === '/api/local/setup') return json(route, { outcome: 'ready', model: 'qwen3:4b', bytes: 2600000000, machine: { totalMemoryBytes: 17179869184, freeMemoryBytes: 8589934592, cpus: 10 } });
    if (p === '/api/local/pull') return json(route, { state: 'idle' });
    if (p === '/api/auto-approve') return json(route, { root: '/home/dev/shopfront', trusted: false, on: false, refusal: 'auto-approve is off for this repository.' });
    if (p === '/api/repo-trust') return json(route, { root: '/home/dev/shopfront', trusted: false });
    if (p === '/api/hooks') return json(route, { events: [], blocking: [], declared: {}, trusted: false });
    if (p === '/api/permissions') return json(route, { path: '.sequence/permissions.json', exists: false, document: { version: 1, default: 'allow', denyStreak: 3, deny: [], ask: [], allow: [] }, text: '{\n  "version": 1\n}\n', warnings: [] });
    if (p === '/api/mcp') return json(route, { path: '.sequence/mcp.json', exists: true, document: { servers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } } }, text: '{}', warnings: [] });
    if (p === '/api/skills') return json(route, { dir: '.sequence/skills', skills: [{ slug: 'deploy', name: 'Deploy', description: 'Ship to staging' }], warnings: [], trusted: true, instructions: { file: 'AGENTS.md', bytes: 1800, truncated: false } });
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

await suite(
  'r12-onboard-shots',
  async ({ page, base, check, log }) => {
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 1024]) {
        const tag = `${theme}-${width}`;
        /* 1. first run: one ready agent, two ready agents (a choice), none ready. */
        for (const scenario of [
          { name: 'one-ready', ready: [['claude', 'Claude Code', 'Max']] },
          { name: 'two-ready', ready: [['claude', 'Claude Code', 'Max'], ['codex', 'Codex', 'ChatGPT']] },
        ]) {
          await check(`${tag}: first run, ${scenario.name}`, async () => {
            await page.unroute('**/api/**').catch(() => {});
            await page.unroute('**/archgraph.json').catch(() => {});
            const st = await engine(page, { ready: scenario.ready });
            await page.setViewportSize({ width, height: 800 });
            await page.goto(base);
            await page.evaluate((t) => {
              localStorage.clear();
              sessionStorage.clear();
              localStorage.setItem('theme', t);
              localStorage.setItem('seq.theme', t);
            }, theme);
            await page.reload();
            /* Round 13 ruling O1/O2 (Welcome: four options, pick one, Start chatting, then the swipe setup):
               the agent list is the four options; a ready agent is Start chatting one click after its option,
               then the setup, which Skip setup leaves. This replaces r12's single Start chatting click. */
            await page.waitForSelector(sel('first-run-option'), { timeout: 15000 });
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${OUT}/firstrun-1-agents-${scenario.name}-${tag}.png` });
            await page.locator('[data-option="claude"]').click();
            await page.locator('[data-provider="claude"]').locator(sel('first-run-start')).click();
            await page.waitForSelector(sel('first-run-setup-skipall'), { timeout: 15000 });
            await page.locator(sel('first-run-setup-skipall')).click();
            await page.waitForSelector(sel('s2-pillbar'), { timeout: 15000 });
            await page.waitForTimeout(800);
            const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
            if (focus !== 'composer-field') throw new Error(`focus is on ${focus}`);
            if (st.attachCalls !== 0) throw new Error('first run attached a project');
            await page.screenshot({ path: `${OUT}/firstrun-2-chat-${scenario.name}-${tag}.png` });
            /* r12 rule kept: once an agent exists, first run never returns. */
            await page.reload();
            await page.waitForSelector(sel('shell'), { timeout: 15000 });
            await page.waitForTimeout(600);
            if (await page.locator(sel('first-run')).count()) throw new Error('first run came back after an agent connected');
          });
        }
        /* 2. the sidebar's project and workspace icons, and every Settings tab. */
        await check(`${tag}: sidebar icons and Settings tabs`, async () => {
          await page.unroute('**/api/**').catch(() => {});
          await page.unroute('**/archgraph.json').catch(() => {});
          await engine(page, { ready: [['claude', 'Claude Code', 'Max']] });
          await page.setViewportSize({ width, height: 800 });
          await page.goto(base);
          await page.evaluate((t) => {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem('sequence.onboarding.skip', '1');
            localStorage.setItem('theme', t);
            localStorage.setItem('seq.theme', t);
            localStorage.setItem('v3.railCollapsed', '0');
          }, theme);
          await page.reload();
          await page.waitForSelector(sel('shell'), { timeout: 15000 });
          await page.waitForTimeout(800);
          await page.screenshot({ path: `${OUT}/sidebar-icons-${tag}.png` });
          const rail = page.locator('.s2-side, [data-testid="s2-panel"]').first();
          if (await rail.count()) await rail.screenshot({ path: `${OUT}/sidebar-icons-crop-${tag}.png` }).catch(() => {});
          await page.locator(sel('v3-rail-settings')).click();
          await page.waitForSelector(sel('settings-panel'), { timeout: 10000 });
          for (const tab of ['agents', 'models', 'app', 'safety', 'workspace']) {
            await page.locator(sel(`settings-nav-${tab}`)).click();
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${OUT}/settings-${tab}-${tag}.png` });
          }
        });
      }
    }
    /* E16 proof: the sidebar with attached projects, and with a chat worktree (the branch badge). */
    for (const theme of ['dark', 'light']) {
      for (const kind of ['repo', 'worktree']) {
        await check(`${theme}-1440: sidebar icons, ${kind}`, async () => {
          await page.unroute('**/api/**').catch(() => {});
          await page.unroute('**/archgraph.json').catch(() => {});
          const at = new Date(Date.UTC(2026, 9, 8, 5)).toISOString();
          const chat = (id, title, extra = {}) => ({ id, title, titleEdited: true, createdAt: at, updatedAt: at, ...extra });
          const wt = { id: 'w1', path: '/home/dev/shopfront-wt', branch: 'sequence/rate-limit-1a2b', baseBranch: 'main', baseCommit: 'abc1234', createdAt: at };
          const repos = [
            { path: '/home/dev/shopfront', name: 'shopfront', index: { version: 1, activeId: 'r1', sessions: [chat('r1', kind === 'worktree' ? 'Rate limiting' : 'Checkout total', kind === 'worktree' ? { worktree: wt } : {})] } },
            { path: '/home/dev/billing', name: 'billing', index: { version: 1, activeId: 'b1', sessions: [chat('b1', 'Invoice totals')] } },
            ...(kind === 'worktree' ? [{ path: wt.path, name: 'shopfront-wt', index: { version: 1, activeId: 'w1', sessions: [chat('w2', 'Rate limiting')] } }] : []),
          ];
          await engine(page, { ready: [['claude', 'Claude Code', 'Max']], attached: true, repos });
          await page.setViewportSize({ width: 1440, height: 800 });
          await page.goto(base);
          await page.evaluate((t) => {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem('theme', t);
            localStorage.setItem('seq.theme', t);
            localStorage.setItem('v3.railCollapsed', '0');
            localStorage.setItem('s2.projectsOpen', JSON.stringify({ '/home/dev/billing': true, '/home/dev/shopfront-wt': true }));
          }, theme);
          await page.reload();
          await page.waitForSelector(sel('shell'), { timeout: 15000 });
          await page.waitForSelector(sel('s2-project'), { timeout: 15000 });
          await page.waitForTimeout(800);
          const glyphs = await page.locator('.s2-proj-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-glyph')));
          if (!glyphs.length || glyphs.some((g) => g !== 'folder')) throw new Error(`project glyphs: ${JSON.stringify(glyphs)}`);
          if (kind === 'worktree' && !(await page.locator('.s2-proj-row[data-worktree="true"] .s2-rail-badge').count())) throw new Error('no worktree badge');
          await page.screenshot({ path: `${OUT}/sidebar-icons-${kind}-${theme}-1440.png` });
          const rail = page.locator('.s2-side, [data-testid="s2-panel"]').first();
          if (await rail.count()) await rail.screenshot({ path: `${OUT}/sidebar-icons-${kind}-crop-${theme}-1440.png` }).catch(() => {});
        });
      }
    }
  },
  { routes: {} },
);
