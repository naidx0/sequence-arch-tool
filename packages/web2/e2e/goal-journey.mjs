#!/usr/bin/env node
/**
 * THE GOAL JOURNEY, IN THE REAL UI, WITH A FAKE AGENT.
 *
 * Owner, 2026-10-15: "agentics first all the way e2e". An Opus reviewer drove goal runs through the real app and
 * found nine ways the journey broke. This is those findings as one script, each against the REAL analyzer serving
 * web2's dist, a throwaway user store, and the fake goal agent (packages/acp/src/test/fixtures/goal-agent.mjs: a mock
 * ACP agent that ticks through the real Sequence MCP `goal` tool). No account, no network, no spend, no real claude/codex.
 *
 * What it asserts, in the reader's seat:
 *   1. HAPPY PATH   `/goal <text>` in Smart starts a run; the goal turns appear in the OPEN chat while it works (no
 *                   reload); the status bar says the run is working on the agent, not Idle / Default model; the run
 *                   ends audited and the plan is ticked.
 *   2. A FAILED RUN SHOWS ITS REASON   a run that wrote no plan leaves the bar saying why (not Idle | Work on goal), and
 *                   the plan list has somewhere to write the steps; a step written there is saved.
 *   3. STOP, THEN RESTART WITHIN A SECOND   the second run's ticks are accepted and it ends audited.
 *   4. A BLOCKED PORT   an app started on --port 4190 (a port the Fetch spec refuses) runs an agent goal.
 *   5. `/goal` MID-TURN   typed while a turn runs it sets the goal; it is never sent to the agent as text.
 *   6. COPY   the disabled button's tooltip names modes the menu has (Smart / Full auto), not "Build".
 *
 * Exit 0 pass (or skip: no Chromium), 1 product wrong, 2 harness broken.
 * Run: node --import ../../tools/test-guard/no-real-binaries.mjs e2e/goal-journey.mjs   (from packages/web2)
 * SHOTS=<dir> writes screenshots of the goal bar states at 1440 and 420.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';
import { sel } from './lib/harness.mjs';

const NAME = 'goal-journey';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const FIXTURES = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures');
const GOAL_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'goal-agent.mjs');
const MCP_SERVER = path.join(REPO_ROOT, 'packages', 'mcp', 'dist', 'server.js');
const SHOTS = process.env.SHOTS || null;
/* ONLY=happy|failed|restart|port|midturn runs one scenario while debugging. */
const ONLY = process.env.ONLY || null;
const want = (name) => ONLY === null || ONLY === name;
const BLOCKED_PORT = 4190;

const log = (...args) => console.log(`[${NAME}]`, ...args);
const failHarness = (msg) => {
  console.error(`[${NAME}] ERROR: ${msg}`);
  process.exit(2);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A request over node:http: `fetch` refuses the ports the Fetch spec blocks (4190 among them), and this harness talks to an app on one. */
function request(url, init = {}) {
  return new Promise((resolve, reject) => {
    const body = init.body === undefined ? null : Buffer.from(init.body);
    const req = http.request(url, { method: init.method ?? 'GET', headers: { ...(init.headers ?? {}), ...(body ? { 'content-length': String(body.length) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, json: async () => JSON.parse(text), text: async () => text });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Wait until `fn` returns a truthy value, or throw `what` after `ms`. */
async function until(what, fn, ms = 20000, every = 150) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
}

async function main() {
  const problem = buildProblem();
  if (problem) failHarness(`${problem} — run: pnpm --filter @sequence/web2 build`);
  if (!fs.existsSync(ANALYZER_CLI)) failHarness('analyzer not built — run: pnpm --filter @sequence/analyzer build');
  if (!fs.existsSync(MCP_SERVER)) failHarness('mcp not built — run: pnpm --filter @sequence/mcp build');
  if (!fs.existsSync(GOAL_AGENT)) failHarness(`the fake goal agent is missing: ${GOAL_AGENT}`);

  const executablePath = findChromium();
  if (!executablePath) {
    log('SKIP: no Chromium found. Searched:', cacheRoots().join(', '));
    process.exit(0);
  }
  const chromium = await loadPlaywright();
  if (!chromium) {
    log('SKIP: playwright-core is not installed');
    process.exit(0);
  }
  if (!(await portFree(BLOCKED_PORT))) failHarness(`port ${BLOCKED_PORT} is in use: the blocked-port check needs it`);

  const failures = [];
  let passes = 0;
  const check = async (label, fn) => {
    try {
      await fn();
      passes += 1;
      log('ok  ', label);
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      log('FAIL', label, '—', e.message);
    }
  };

  const baseOpts = launchOptions(executablePath);
  /* Chromium itself refuses to open a page on 4190 (ERR_UNSAFE_PORT): the app runs there, the browser is told it may. */
  const browser = await chromium.launch({ ...baseOpts, args: [...baseOpts.args, `--explicitly-allowed-ports=${BLOCKED_PORT}`] });
  const pageErrors = [];
  const scenarios = [];

  /* ── one app per scenario: its own home, user store, repo, and ONE registered fake agent (so the chat takes it by default) ── */
  async function boot(label, { mode, port: wantPort, width = 1440 }) {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `seq-goal-${label}-`)));
    const home = path.join(tmp, 'home');
    const userDir = path.join(home, '.sequence');
    const repo = path.join(home, 'plainapp');
    fs.mkdirSync(userDir, { recursive: true });
    fs.cpSync(path.join(FIXTURES, 'plainapp'), repo, { recursive: true });
    const agentLog = path.join(tmp, 'agent.jsonl');
    fs.writeFileSync(
      path.join(userDir, 'agents.json'),
      JSON.stringify({ agents: [{ id: 'mock', command: process.execPath, args: [GOAL_AGENT, `--mode=${mode}`, `--log=${agentLog}`], label: 'Mock goal agent' }] }, null, 2),
    );
    fs.writeFileSync(path.join(userDir, 'recent.json'), JSON.stringify([repo]));
    const port = wantPort ?? (await freePort());
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [ANALYZER_CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
      cwd: REPO_ROOT,
      env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1', SEQUENCE_USER_DIR: userDir, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let serverOut = '';
    child.stdout.on('data', (b) => (serverOut += b.toString('utf8')));
    child.stderr.on('data', (b) => (serverOut += b.toString('utf8')));
    await until('the server', async () => (await request(`${base}/api/acp/agents`).catch(() => null))?.ok, 30000, 250).catch((e) => {
      failHarness(`${label}: ${e.message}\n${serverOut.slice(-800)}`);
    });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    /* The provider probe would run this machine's real `claude` and `codex`: answer it empty. */
    await context.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
    const s = {
      label,
      base,
      page,
      repo,
      agentEvents: () => (fs.existsSync(agentLog) ? fs.readFileSync(agentLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
      serverOut: () => serverOut,
      T: (id) => page.locator(sel(id)),
      api: async (p, init) => {
        const r = await request(`${base}${p}`, init);
        if (!r.ok) throw new Error(`${p} answered ${r.status}`);
        return r.json();
      },
      activeChatId: () => page.evaluate(() => document.querySelector('[data-testid="s2-session"] button[aria-current="true"]')?.closest('[data-testid="s2-session"]')?.getAttribute('data-session-id') ?? null),
      chatText: () => page.locator(sel('s2-chat')).innerText().catch(() => ''),
      barText: async (id) => (await page.locator(sel(id)).first().textContent().catch(() => null)) ?? '',
      shot: async (name) => {
        if (!SHOTS) return;
        fs.mkdirSync(SHOTS, { recursive: true });
        for (const w of [1440, 420]) {
          await page.setViewportSize({ width: w, height: 900 });
          await sleep(300);
          await page.screenshot({ path: path.join(SHOTS, `${NAME}-${label}-${name}-${w}.png`) });
        }
        await page.setViewportSize({ width, height: 900 });
        await sleep(200);
      },
      close: async () => {
        await context.close().catch(() => {});
        child.kill();
        await sleep(300);
      },
    };
    scenarios.push(s);
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await until('the sidebar', async () => (await s.T('s2-new-chat').count()) > 0, 30000);
    await until('the active chat', s.activeChatId, 15000);
    await until('the static shell to go', async () => (await page.locator('#static-shell').count()) === 0, 15000);
    /* The chat takes the only registered agent by itself; wait until the pill says so. */
    await until('the chat to have its agent', async () => !/connect/i.test((await s.T('v3-model-trigger').textContent().catch(() => 'connect')) ?? 'connect'), 20000);
    await settleChat(s);
    return s;
  }

  /** The chat the page shows is the chat the server holds, and has been for a while: boot creates and prunes empty chats, and a
   *  command typed in that window lands on a chat that is about to be pruned. */
  async function settleChat(s) {
    const attempt = async (ms) => {
      let stable = 0;
      let last = '';
      await until('the open chat to be the chat of the server, and to stay it', async () => {
        const open = await s.activeChatId();
        const ids = ((await s.api('/api/sessions').catch(() => ({}))).index?.sessions ?? []).map((x) => x.id);
        const key = `${open}|${ids.join(',')}`;
        stable = open && ids.includes(open) && key === last ? stable + 1 : 0;
        last = key;
        return stable >= 4;
      }, ms, 500);
    };
    /* The page's open chat is one the server holds from first paint (connect.tsx re-reads the list when the startup attach lands): no workaround. */
    await attempt(20000);
  }

  async function typeCommand(s, text) {
    await s.T('composer-field').click();
    await s.page.keyboard.type(text);
    await s.page.keyboard.press('Enter');
  }
  const runState = async (s, chat) => s.api(`/api/sessions/${chat}/goal-run`);
  const planOf = async (s, chat) => ((await s.api(`/api/sessions/${chat}`)).plan ?? []).map((p) => `${p.status}:${p.text}`);
  /** The run that started after `prev` (its start stamp), once it has ended. A row read before the run began is the last run's. */
  const endedRun = async (s, chat, prev, ms = 120000) =>
    until('the goal run to end', async () => {
      const r = await runState(s, chat);
      return !r.running && r.startedAt && r.startedAt !== prev ? r : null;
    }, ms, 400);
  const THREE = ['alpha step one', 'beta step two', 'gamma step three'];

  try {
    /* ══ 1. THE HAPPY PATH, LIVE IN THE OPEN CHAT ══ */
    if (want('happy')) {
      const s = await boot('happy', { mode: 'tick' });
      const chat = await s.activeChatId();
      await typeCommand(s, '/goal do three small things');
      await check('the bar appears and the run starts: the button becomes Stop', async () => {
        await until('the goal bar', async () => (await s.T('v3-goalbar').count()) > 0, 15000);
        await until('a running run', async () => (await runState(s, chat)).running, 20000);
      });

      let sawLive = null;
      let sawStatusBar = null;
      let sawPill = null;
      let sawStatusBarState = null;
      let sawStatusBarModel = null;
      await check('the goal turns appear in the open chat WHILE the run works, with no reload', async () => {
        const end = Date.now() + 90000;
        while (Date.now() < end) {
          const r = await runState(s, chat);
          const text = await s.chatText();
          if (r.running && /Goal run:/.test(text)) {
            sawLive = text;
            sawStatusBar = await s.barText('s2-status-state');
            sawStatusBarState = await s.T('s2-status-state').getAttribute('data-state');
            sawStatusBarModel = await s.barText('s2-status-model');
            sawPill = await s.barText('v3-goalbar-status');
            break;
          }
          if (!r.running) break;
          await sleep(250);
        }
        if (!sawLive) {
          const saved = ((await s.api(`/api/sessions/${chat}`)).chat?.turns ?? []).map((t) => `${t.role}: ${String(t.text).slice(0, 60)}`);
          throw new Error(`no "Goal run:" turn was on screen while the run was still going. On screen: ${(await s.chatText()).slice(0, 200)} | saved on the server: ${JSON.stringify(saved)}`);
        }
      });
      await check('while it works the status bar says so and names the agent: not Idle, not Default model', async () => {
        if (/^Idle$/.test(sawStatusBar.trim()) || sawStatusBar.trim() === '') throw new Error(`status bar said "${sawStatusBar}"`);
        if (sawStatusBarState !== 'working') throw new Error(`status bar state was "${sawStatusBarState}" while the run worked`);
        if (/default model/i.test(sawStatusBarModel)) throw new Error(`status bar model said "${sawStatusBarModel}"`);
        if (!/Running/.test(sawPill)) throw new Error(`the goal bar pill said "${sawPill}"`);
      });
      await s.shot('running');

      const end = await endedRun(s, chat);
      await check('the run ends audited and every step is ticked', async () => {
        if (end.lastStopReason !== 'audited_pass') throw new Error(`ended ${end.lastStopReason}: ${end.lastStopSentence}`);
        const plan = await planOf(s, chat);
        if (plan.length !== 3 || plan.some((p) => !p.startsWith('done:'))) throw new Error(`plan: ${plan.join(' | ')}`);
        const refused = s.agentEvents().filter((e) => e.ev === 'tick' && e.r?.isError);
        if (refused.length) throw new Error(`${refused.length} ticks were refused`);
      });
      await check('the finished chat shows every goal turn, and the bar says how it ended', async () => {
        await until('the bar to settle', async () => /audited PASS/.test(await s.barText('v3-goalbar-step')), 15000);
        const text = await s.chatText();
        const turns = (text.match(/Goal run:/g) ?? []).length;
        if (turns < 4) throw new Error(`only ${turns} goal turns on screen`);
      });
      await s.shot('finished');
      await s.close();
    }

    /* ══ 2. A FAILED RUN SHOWS ITS REASON, AND THE PLAN LIST CAN BE WRITTEN ══ */
    if (want('failed')) {
      const s = await boot('failed', { mode: 'never' });
      const chat = await s.activeChatId();
      await typeCommand(s, '/goal do something vague');
      const end = await endedRun(s, chat);
      await check('a run that wrote no plan ends no_plan_written', async () => {
        if (end.lastStopReason !== 'no_plan_written') throw new Error(`ended ${end.lastStopReason}: ${end.lastStopSentence}`);
      });
      await check('the bar says WHY, not "Idle | Work on goal"', async () => {
        const text = await until('the reason in the bar', async () => {
          const t = await s.barText('v3-goalbar-step');
          return /none was written/.test(t) ? t : null;
        }, 15000);
        if (!/plan list/.test(text)) throw new Error(`the sentence does not point at the plan list: ${text}`);
        if (/yourself/.test(text)) throw new Error(`the sentence still says to write the steps yourself: ${text}`);
      });
      await s.shot('no-plan');
      await check('the plan list has somewhere to write a step, and the step is saved', async () => {
        await s.T('v3-goal-add-input').fill('write the parser guard');
        await s.T('v3-goal-add-save').click();
        await until('the step on the server', async () => (await planOf(s, chat)).includes('open:write the parser guard'), 10000);
      });
      await check('the written step survives a reload and can be edited and removed', async () => {
        await s.page.reload({ waitUntil: 'domcontentloaded' });
        await until('the goal bar', async () => (await s.T('v3-goalbar').count()) > 0, 20000);
        await s.T('v3-goalbar-disclosure').click();
        const stepId = await until('the step', async () => s.page.evaluate(() => document.querySelector('[data-testid^="v3-goal-step-"]')?.getAttribute('data-testid')?.replace('v3-goal-step-', '') ?? null), 15000);
        await s.T(`v3-goal-edit-${stepId}`).click();
        await s.T(`v3-goal-edit-input-${stepId}`).fill('write the parser guard, then test it');
        await s.T(`v3-goal-edit-save-${stepId}`).click();
        await until('the edit on the server', async () => (await planOf(s, chat)).includes('open:write the parser guard, then test it'), 10000);
        await s.T(`v3-goal-remove-${stepId}`).click();
        await until('the removal on the server', async () => (await planOf(s, chat)).length === 0, 10000);
      });
      await check('the disabled Work on goal button names modes the menu has', async () => {
        /* Plan mode disables the button; its tooltip is the only place the reason appears. */
        await s.T('v3-goalbar-work').waitFor({ timeout: 10000 });
        await s.page.keyboard.press('Escape');
        await s.T('composer-field').click();
        await s.page.keyboard.type('/plan');
        await s.page.keyboard.press('Enter');
        await until('the button to be disabled by Plan mode', async () => s.T('v3-goalbar-work').isDisabled(), 10000);
        const title = (await s.T('v3-goalbar-work').getAttribute('title')) ?? '';
        if (/Build/.test(title)) throw new Error(`the tooltip still says Build: ${title}`);
        if (!/Smart/.test(title) || !/Full auto/.test(title)) throw new Error(`the tooltip does not name Smart / Full auto: ${title}`);
      });
      await s.close();
    }

    /* ══ 3. STOP, THEN RESTART WITHIN A SECOND ══ */
    if (want('restart')) {
      const s = await boot('restart', { mode: 'slowfirst' });
      const chat = await s.activeChatId();
      await s.api(`/api/sessions/${chat}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'do three small things', plan: THREE.map((text, i) => ({ id: `s${i + 1}`, text, status: 'open' })) }) });
      await s.page.reload({ waitUntil: 'domcontentloaded' });
      await until('the goal bar', async () => (await s.T('v3-goalbar').count()) > 0, 20000);
      await until('the chat to have its agent', async () => !/connect/i.test((await s.T('v3-model-trigger').textContent().catch(() => 'connect')) ?? 'connect'), 20000);
      let stoppedBarText = '';
      await check('Work on goal, Stop within a second, Work on goal again: the second run ticks and ends audited', async () => {
        /* A page opens in Plan; a run needs Smart (or Full auto). */
        await typeCommand(s, '/smart');
        await until('Work on goal to be enabled', async () => !(await s.T('v3-goalbar-work').isDisabled()), 10000);
        await s.T('v3-goalbar-work').click();
        await until('a running run', async () => (await runState(s, chat)).running, 15000);
        await sleep(300);
        await until('the button to be Stop', async () => (await s.T('v3-goalbar-work').getAttribute('data-action')) === 'stop', 10000);
        await s.T('v3-goalbar-work').click();
        await until('the run to stop', async () => !(await runState(s, chat)).running, 10000);
        await until('the button to offer a restart', async () => (await s.T('v3-goalbar-work').getAttribute('data-action')) === 'start', 10000);
        stoppedBarText = await until('the bar to say how the run ended', async () => {
          const t = await s.barText('v3-goalbar-step');
          return /stopped by hand/.test(t) ? t : null;
        }, 10000);
        await s.shot('stopped');
        const firstStamp = (await runState(s, chat)).startedAt;
        await s.T('v3-goalbar-work').click();
        const end = await endedRun(s, chat, firstStamp);
        if (end.lastStopReason !== 'audited_pass') throw new Error(`the second run ended ${end.lastStopReason}: ${end.lastStopSentence}`);
        const plan = await planOf(s, chat);
        if (plan.some((p) => !p.startsWith('done:'))) throw new Error(`plan: ${plan.join(' | ')}`);
        const refused = s.agentEvents().filter((e) => e.ev === 'tick' && e.r?.isError);
        if (refused.length) throw new Error(`${refused.length} ticks were refused: ${JSON.stringify(refused[0].r)}`);
      });
      await check('the bar said Stopped, not Finished, for the run that was stopped', async () => {
        if (!/^Stopped/.test(stoppedBarText) || /^Finished/.test(stoppedBarText)) throw new Error(`the bar said: ${stoppedBarText}`);
      });
      await s.shot('restarted');
      await s.close();
    }

    /* ══ 4. AN APP ON A PORT THE FETCH SPEC BLOCKS ══ */
    if (want('port')) {
      const s = await boot('port', { mode: 'tick', port: BLOCKED_PORT });
      const chat = await s.activeChatId();
      await check(`an app on --port ${BLOCKED_PORT} runs an agent goal to the end`, async () => {
        await typeCommand(s, '/goal do three small things');
        const end = await endedRun(s, chat);
        if (end.lastStopReason !== 'audited_pass') throw new Error(`ended ${end.lastStopReason}: ${end.lastStopSentence}`);
        const plan = await planOf(s, chat);
        if (plan.length !== 3 || plan.some((p) => !p.startsWith('done:'))) throw new Error(`plan: ${plan.join(' | ')}`);
        if (/bad port|fetch failed/i.test(s.serverOut())) throw new Error(`the server logged: ${s.serverOut().slice(-300)}`);
      });
      await s.close();
    }

    /* ══ 5. /goal WHILE A TURN RUNS IS THE COMMAND ══ */
    if (want('midturn')) {
      const s = await boot('midturn', { mode: 'slowfirst' });
      const chat = await s.activeChatId();
      await check('/goal typed while a turn runs sets the goal and is never sent to the agent as text', async () => {
        const steers = [];
        s.page.on('request', (r) => {
          if (r.url().includes('/api/acp/steer')) steers.push(r.url());
        });
        await typeCommand(s, 'please wait a moment');
        await until('the agent turn to start', async () => s.agentEvents().some((e) => e.ev === 'slow-start'), 30000);
        await typeCommand(s, '/goal tidy the readme');
        await until('the goal on the server', async () => (await s.api(`/api/sessions/${chat}`)).goal === 'tidy the readme', 15000);
        await sleep(500);
        if (steers.length) throw new Error(`the command was steered: ${steers.join(', ')}`);
        const prompts = s.agentEvents().filter((e) => e.ev === 'prompt');
        if (prompts.length > 1) throw new Error(`the agent received ${prompts.length} prompts`);
        await s.shot('midturn');
      });
      await s.close();
    }
  } catch (e) {
    failures.push(`harness: ${e.stack ?? e.message}`);
  } finally {
    for (const s of scenarios) await s.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (pageErrors.length) failures.push(`uncaught page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  log(`${passes} checks passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => failHarness(e.stack ?? String(e)));
