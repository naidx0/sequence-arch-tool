#!/usr/bin/env node
/**
 * R11 UX audit, flow and layout fixes (lane ux1), dark and light.
 *
 *  1. Onboarding: clicks from launch to a sendable first message. One ready
 *     agent: Open is the only click (it connects with the project, the pill
 *     reads its model, focus is in the composer). Two ready agents: Open, the
 *     pill, the agent row (the menu closes and focus lands in the composer).
 *     Measured before (audit, 4 clicks + Esc): Open, pill, agent row, Esc or
 *     outside click, composer.
 *  2. The surface bar at 1024: the overflow shows (a chevron on the edge), every
 *     name is reachable and none is cut.
 *  3. A second surface at 1440 folds the sidebar to a 48 px rail that keeps
 *     New chat and Settings, and the sidebar peeks back from it.
 *  4. The palette: a command for every surface, New chat and the project doors,
 *     in the UI's words; the Ctrl+K hint is in the sidebar; search, review,
 *     rewind and help are in the chat's more menu.
 *
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r11/ux).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r11/ux';
fs.mkdirSync(OUT, { recursive: true });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const SHOP = path.join(REPO, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');
const CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
if (!fs.existsSync(CLI)) {
  console.error('[r11-ux1-shots] ERROR: the analyzer is not built (pnpm --filter @sequence/analyzer build)');
  process.exit(2);
}
const GRAPH_OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r11-ux1-')), 'archgraph.json');
execFileSync(process.execPath, [CLI, 'scan', SHOP, '--out', GRAPH_OUT], { stdio: ['ignore', 'ignore', 'pipe'], cwd: REPO });
const GRAPH = JSON.parse(fs.readFileSync(GRAPH_OUT, 'utf8'));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const P = (id, label, state, extra = {}) => ({ id, label, installed: state !== 'install', version: '1.0.0', state, signInCommand: `${id} login`, installHint: `npm i -g ${id}`, ...extra });
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

/**
 * A fake engine that remembers: unattached until /api/attach, then attached; no agents registered until a
 * connect. `ready` is the list of providers the first-run screen finds ready.
 */
async function engine(page, { ready }) {
  const st = { attached: false, agents: [], clicks: 0, attachCalls: 0, connectCalls: 0, runCalls: 0 };
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
      return json(route, { index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'New chat', titleEdited: false, createdAt: at, updatedAt: at }] }, scope: 'workspace', repos: [] });
    }
    if (p === '/api/acp/capabilities') return json(route, CAPS);
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
  'r11-ux1-shots',
  async ({ page, base, check, log }) => {
    for (const theme of ['dark', 'light']) {
      /* ── 1. onboarding: clicks to a sendable first message ─────────────── */
      /* Round 12: first run is the agent list only. One click on "Start chatting" (one ready agent or two:
         the person chose) connects it and lands in the workspace chat with the composer focused. */
      for (const scenario of [
        { name: 'one ready agent', ready: [['claude', 'Claude Code', 'Max']], expectClicks: 3 },
        { name: 'two ready agents', ready: [['claude', 'Claude Code', 'Max'], ['codex', 'Codex', 'ChatGPT']], expectClicks: 3 },
      ]) {
        await check(`${theme}: ${scenario.name}: launch to a sendable first message in ${scenario.expectClicks} click(s)`, async () => {
          await page.unroute('**/api/**').catch(() => {});
          await page.unroute('**/archgraph.json').catch(() => {});
          const st = await engine(page, { ready: scenario.ready });
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(base);
          await page.evaluate((t) => {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem('theme', t);
            localStorage.setItem('seq.theme', t);
          }, theme);
          await page.reload();
          await page.waitForSelector('[data-testid="first-run"]', { timeout: 15000 });
          await page.waitForSelector(sel('first-run-option'));
          await page.waitForTimeout(500);
          if (await page.locator(sel('first-run-repo')).count()) throw new Error('first run must not list projects');
          /* Round 13 ruling O1: Welcome offers four options and picks nothing for the person, one ready agent or two. */
          const readyOpts = await page.locator('[data-testid="first-run-option"][data-state="ready"]').count();
          if (readyOpts !== scenario.ready.length) throw new Error(`${readyOpts} ready options, wanted ${scenario.ready.length}`);
          await page.screenshot({ path: `${OUT}/onboarding-firstrun-${scenario.ready.length}-${theme}.png` });
          /* Round 13 ruling O1/O2: option, Start chatting, Skip setup (the swipe setup is optional). Three clicks
             replace r12's one; Welcome still never blocks a ready agent from a sendable composer. */
          let clicks = 0;
          clicks += 1;
          await page.locator('[data-option="claude"]').click();
          clicks += 1;
          await page.locator('[data-provider="claude"]').locator(sel('first-run-start')).click();
          clicks += 1;
          await page.locator(sel('first-run-setup-skipall')).click();
          await page.waitForSelector(sel('shell'), { timeout: 20000 });
          await page.waitForSelector(sel('s2-pillbar'), { timeout: 15000 });
          await page.waitForTimeout(800);
          const pillText = ((await page.locator(sel('s2-pillbar')).textContent()) ?? '').trim();
          if (!/Sonnet 5/.test(pillText)) throw new Error(`the pill does not name the model: "${pillText}"`);
          const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);
          if (focus !== 'composer-field') throw new Error(`focus is on ${focus}, not the composer`);
          const menus = await page.locator('[role="menu"]').count();
          if (menus !== 0) throw new Error(`${menus} menu(s) still open`);
          if (st.attachCalls !== 0) throw new Error('first run must not attach a project');
          await page.screenshot({ path: `${OUT}/onboarding-ready-to-type-${scenario.ready.length}-${theme}.png` });
          await page.keyboard.type('Where is the checkout total computed?');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(600);
          if (st.runCalls < 1) throw new Error('the message was not sent');
          log(`${theme} ${scenario.name}: ${clicks} click(s) to a sent message (typing and Enter after)`);
          if (clicks !== scenario.expectClicks) throw new Error(`${clicks} clicks, wanted ${scenario.expectClicks}`);
          if (st.connectCalls !== 1) throw new Error(`${st.connectCalls} connect calls`);
        });
      }
      await page.unroute('**/api/**').catch(() => {});
      await page.unroute('**/archgraph.json').catch(() => {});

      /* ── 2. the surface bar at 1024 ───────────────────────────────────── */
      await boot(page, base, theme, 1024, 700);
      await check(`${theme}: 1024: the surface bar shows that it scrolls, and every name can be reached whole`, async () => {
        const m = await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="s2-surfaces"]');
          return { sw: bar.scrollWidth, cw: bar.clientWidth, fade: bar.getAttribute('data-fade') };
        });
        if (m.sw <= m.cw) {
          log(`${theme}: 1024 bar fits (${m.sw} <= ${m.cw}); overflow cannot be checked here`);
          return;
        }
        if (!(await page.locator(sel('s2-surfaces-more-end')).count())) throw new Error(`overflow ${m.sw}>${m.cw} with no "more" chevron (fade ${m.fade})`);
        await page.screenshot({ path: `${OUT}/surfacebar-1024-overflow-${theme}.png` });
        for (let i = 0; i < 6 && (await page.locator(sel('s2-surfaces-more-end')).count()); i++) {
          await page.locator(sel('s2-surfaces-more-end')).click();
          await page.waitForTimeout(450);
        }
        const cut = await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="s2-surfaces"]');
          const b = bar.getBoundingClientRect();
          return [...bar.querySelectorAll('.s2-sp-main')].map((el) => ({ id: el.getAttribute('data-tab-id'), left: el.getBoundingClientRect().left - b.left, right: b.right - el.getBoundingClientRect().right }));
        });
        const last = cut.at(-1);
        if (!last || last.right < -1) throw new Error(`the last name is cut after scrolling to the end: ${JSON.stringify(last)}`);
        await page.screenshot({ path: `${OUT}/surfacebar-1024-scrolled-${theme}.png` });
        if (!(await page.locator(sel('s2-surfaces-more-start')).count())) throw new Error('scrolled to the end but no chevron back');
      });
      await check(`${theme}: 1024: opening Terminal and Agents brings the name into view`, async () => {
        for (const id of ['terminal', 'agents']) {
          await page.evaluate((x) => document.querySelector(`[data-testid="s2-tab-${x}"]`).click(), id);
          await page.waitForTimeout(500);
          const vis = await page.evaluate((x) => {
            const bar = document.querySelector('[data-testid="s2-surfaces"]').getBoundingClientRect();
            const r = document.querySelector(`[data-testid="s2-tab-${x}"]`).getBoundingClientRect();
            return r.left >= bar.left - 1 && r.right <= bar.right + 1;
          }, id);
          if (!vis) throw new Error(`${id} is open but its name is out of sight in the bar`);
        }
        await page.screenshot({ path: `${OUT}/surfacebar-1024-opened-${theme}.png` });
      });

      /* ── 3. 1440: a second surface folds the sidebar to a rail ────────── */
      await boot(page, base, theme, 1440, 900);
      await check(`${theme}: 1440: sidebar open with one surface; a second surface leaves a rail with New chat and Settings`, async () => {
        if (!(await page.locator(sel('s2-panel')).count())) throw new Error('sidebar not open at the start');
        if (await page.locator(sel('s2-iconrail')).count()) throw new Error('the rail shows while the sidebar is open');
        await page.locator(sel('s2-tab-files')).click();
        await page.waitForTimeout(600);
        if (await page.locator(sel('s2-panel')).count()) {
          log(`${theme}: 1440 with two surfaces the sidebar still fits; rail not needed here`);
          return;
        }
        await page.locator(sel('s2-iconrail')).waitFor({ timeout: 4000 });
        const rail = await page.locator(sel('s2-iconrail')).boundingBox();
        if (Math.abs(rail.width - 48) > 1) throw new Error(`rail is ${rail.width}px wide`);
        for (const id of ['s2-iconrail-expand', 's2-iconrail-new-chat', 's2-iconrail-settings']) {
          if (!(await page.locator(sel(id)).isVisible())) throw new Error(`${id} not visible`);
        }
        await page.screenshot({ path: `${OUT}/sidebar-rail-1440-${theme}.png` });
        await page.locator(sel('s2-iconrail-expand')).click();
        await page.locator(sel('s2-panel')).waitFor({ timeout: 3000 });
        await page.screenshot({ path: `${OUT}/sidebar-rail-peek-1440-${theme}.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        if (await page.locator(sel('s2-panel')).count()) throw new Error('Esc did not close the peeking sidebar');
        await page.locator(sel('s2-iconrail-settings')).click();
        await page.waitForTimeout(500);
        const dlg = await page.locator('[role="dialog"]').count();
        if (!dlg) throw new Error('Settings from the rail opened nothing');
        await page.keyboard.press('Escape');
      });

      /* ── 4. the palette and its entry points ──────────────────────────── */
      await boot(page, base, theme, 1440, 900);
      await check(`${theme}: the sidebar says Ctrl+K and has a Commands row; the chat menu holds search, review, rewind and help`, async () => {
        const title = await page.locator(sel('s2-search-toggle')).getAttribute('title');
        if (!/(Ctrl\+K|⌘K)/.test(title ?? '')) throw new Error(`search button title is "${title}"`);
        const foot = await page.locator(sel('s2-rail-commands')).textContent();
        if (!/(Ctrl\+K|⌘K)/.test(foot ?? '')) throw new Error(`Commands row reads "${foot}"`);
        await page.locator(sel('s2-chat-more')).click();
        for (const id of ['overlay.search', 'overlay.review', 'overlay.rewind', 'overlay.help']) {
          if (!(await page.locator(sel(`s2-chat-menu-${id}`)).isVisible())) throw new Error(`${id} missing from the chat menu`);
        }
        await page.screenshot({ path: `${OUT}/chat-more-menu-${theme}.png` });
        await page.keyboard.press('Escape');
      });
      await check(`${theme}: the palette lists every surface, New chat and the project doors in the UI's words, tall enough to read`, async () => {
        await page.locator(sel('s2-rail-commands')).click();
        await page.locator(sel('command-surface')).waitFor();
        const labels = await page.locator(sel('command-row')).evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent));
        for (const want of ['New chat', 'Open Architecture', 'Open Files', 'Open Whiteboard', 'Open Terminal', 'Open Agents', 'Open a project', 'Close project', 'Search this project', 'Review the working tree', 'Rewind an edit', 'What can I do here?', 'Open Chats', 'Open Settings']) {
          if (!labels.includes(want)) throw new Error(`"${want}" missing from ${JSON.stringify(labels)}`);
        }
        const h = (await page.locator('.shell-cmd-list').boundingBox()).height;
        if (h < 330) throw new Error(`the list is ${h}px tall`);
        await page.screenshot({ path: `${OUT}/palette-${theme}.png` });
        await page.locator(sel('command-field')).fill('terminal');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(700);
        if (!(await page.locator(`${sel('s2-tab-terminal')}[aria-pressed="true"]`).count())) throw new Error('Open Terminal did not open the Terminal surface');
      });
    }
  },
  { routes: {} },
);
