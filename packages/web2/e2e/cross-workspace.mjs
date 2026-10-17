#!/usr/bin/env node
/**
 * SWITCHING BETWEEN CHATS OF TWO WORKSPACES WHILE BOTH STREAM.
 *
 * Owner walkthrough (0.1.5, G5): switching to a chat in ANOTHER project was
 * "very hard": the switch reloads the page, and the reload stopped every agent
 * running in the workspace being left. A chat in each workspace runs a long
 * fake agent; the reader switches A, B, A, B from the sidebar; each switch must
 * land on the chat clicked, in its workspace, with only its own words, inside a
 * time budget, while the other workspace's run keeps running and its row says so.
 *
 * (The rest of this header is shared with multi-chat.mjs, which this spec's
 * harness was taken from.)
 *
 * MANY CHATS, MANY AGENTS, AT ONCE.
 *
 * Owner: "Have multiple chats open, right? Make sure we test for that and fix
 * that if any problems happening." Several chats each running an agent in the
 * background (Claude Code, Codex, a local model) without stepping on each other.
 *
 * Boots the REAL analyzer over web2's dist with a throwaway user store
 * (SEQUENCE_USER_DIR) and two workspaces, and registers three FAKE agents
 * (fixtures/fake-agents): an ACP agent classified as Claude's bridge, a
 * `codex app-server`, and a plain ACP agent standing in for a local model.
 * No account, no network, no spend. The provider probe (which would run the
 * real `claude` / `codex` on this machine) is answered empty by the browser.
 *
 * What it asserts, in the reader's seat:
 *   1. three chats in one workspace, each running a different agent at once;
 *   2. switching between them while they stream: each transcript holds only
 *      its own agent's words, and the ones not on screen keep advancing;
 *   3. the sidebar says which chats are running, and which finished while
 *      the reader was elsewhere (and stops saying it once the chat is opened);
 *   4. Stop in one chat stops that chat only;
 *   5. a chat in a second workspace runs while the first workspace's chat
 *      keeps running (opening another workspace reloads the page);
 *   6. a reload mid-run keeps the run going and the page follows it again;
 *   7. after everything, a reload restores every chat with its own words;
 *   8. no server error, no 5xx, no uncaught page error along the way.
 *
 * Exit 0 pass (or skip: no Chromium), 1 product wrong, 2 harness broken.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';
import { sel } from './lib/harness.mjs';

const NAME = 'cross-workspace';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const FIXTURES = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures');
const FAKES = path.join(HERE, 'fixtures', 'fake-agents');
const SHOTS = process.env.SHOTS || null;

const log = (...args) => console.log(`[${NAME}]`, ...args);
const failHarness = (msg) => {
  console.error(`[${NAME}] ERROR: ${msg}`);
  process.exit(2);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* The three agents: id, the model row the menu shows, and the tag every chunk of its answer carries. */
const AGENTS = [
  { id: 'claude', model: 'fake-claude-model', tag: 'MCA', args: [path.join(FAKES, 'fake-acp-agent.mjs'), '--as', 'claude-code-acp'] },
  { id: 'codex', model: 'fake-codex-model', tag: 'MCB', args: [path.join(FAKES, 'codex', 'codex.js')] },
  { id: 'local', model: 'fake-local-model', tag: 'MCC', args: [path.join(FAKES, 'fake-acp-agent.mjs'), '--as', 'local'] },
];
const ALL_TAGS = ['MCA', 'MCB', 'MCC', 'MCD', 'MCE'];

async function main() {
  const problem = buildProblem();
  if (problem) failHarness(`${problem} — run: pnpm --filter @sequence/web2 build`);
  if (!fs.existsSync(ANALYZER_CLI)) failHarness('analyzer not built — run: pnpm --filter @sequence/analyzer build');
  const { readAgentRuns } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'server', 'agentChatStore.js')).href);

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

  /* ── the specimen: a home with a user store, two workspaces, three fake agents ── */
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-xws-')));
  const home = path.join(tmp, 'home');
  const userDir = path.join(home, '.sequence');
  const repoA = path.join(home, 'shopfront');
  const repoB = path.join(home, 'plainapp');
  fs.mkdirSync(userDir, { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'shopfront'), repoA, { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'plainapp'), repoB, { recursive: true });
  fs.writeFileSync(
    path.join(userDir, 'agents.json'),
    JSON.stringify({ agents: AGENTS.map((a) => ({ id: a.id, command: process.execPath, args: a.args, label: `${a.id} (fake)` })) }, null, 2),
  );
  fs.writeFileSync(path.join(userDir, 'recent.json'), JSON.stringify([repoA, repoB]));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [ANALYZER_CLI, 'app', '--no-open', '--port', String(port), '--repo', repoA], {
    cwd: REPO_ROOT,
    env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1', SEQUENCE_USER_DIR: userDir, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  child.stdout.on('data', (b) => (serverOut += b.toString('utf8')));
  child.stderr.on('data', (b) => (serverOut += b.toString('utf8')));

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

  const api = async (p, init) => {
    const r = await fetch(`${base}${p}`, init);
    if (!r.ok) throw new Error(`${p} answered ${r.status}`);
    return r.json();
  };
  /** The chat's turns as the server keeps them. */
  const serverRuns = async (chatId) => (await api(`/api/acp/runs?chatId=${encodeURIComponent(chatId)}`)).runs ?? [];
  const lastRun = async (chatId) => (await serverRuns(chatId)).at(-1) ?? null;

  const browser = await chromium.launch(launchOptions(executablePath));
  const pageErrors = [];
  const badResponses = [];
  try {
    await until('the server', async () => (await fetch(`${base}/api/acp/agents`)).ok, 30000, 250);
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    /* The provider probe would run this machine's real `claude` and `codex`: answer it empty. */
    await context.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
    /* The switch is timed from the page's own click event, not from Playwright's click call: the call first waits for
       the row to be stable, which on a page busy streaming two runs took up to 370 ms that no reader ever waits. The
       time survives the switch's reload in sessionStorage. */
    await context.addInitScript(() => {
      document.addEventListener('click', () => {
        try {
          sessionStorage.setItem('xws.clickAt', String(Date.now()));
        } catch {
          /* no storage: the wall time stands in */
        }
      }, true);
    });
    const page = await context.newPage();
    const assetCache = [];
    page.on('response', (r) => {
      const m = /\/assets\/(index-[^/]+\.(js|css))$/.exec(r.url());
      if (m) assetCache.push({ url: m[1], cache: r.headers()['cache-control'] ?? null });
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 500 && r.url().startsWith(base)) badResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(base.length)}`);
    });

    const T = (id) => page.locator(sel(id));
    const row = (chatId) => page.locator(`${sel('s2-session')}[data-session-id="${chatId}"]`);
    const activeChatId = () => page.evaluate(() => document.querySelector('[data-testid="s2-session"] button[aria-current="true"]')?.closest('[data-testid="s2-session"]')?.getAttribute('data-session-id') ?? null);
    /** The words of every agent run on screen. */
    const transcript = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="s2-chat"] [data-testid="agent-run"]')].map((e) => e.textContent ?? '').join('\n'));
    const marks = (text, tag) => (text.match(new RegExp(`${tag}#\\d+`, 'g')) ?? []).length;
    const shot = async (name) => {
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${NAME}-${name}.png`) });
    };

    const boot = async () => {
      await until('the sidebar', async () => (await T('s2-new-chat').count()) > 0, 30000);
      await until('the active chat', activeChatId, 15000);
      /* The prerendered shell (index.html #static-shell) carries a New chat button that does nothing: wait for the app's. */
      await until('the static shell to go', async () => (await page.locator('#static-shell').count()) === 0, 15000);
    };

    async function openChat(chatId) {
      await row(chatId).locator('button').first().click();
      await until(`chat ${chatId} to be the open one`, async () => (await activeChatId()) === chatId, 15000);
    }

    async function pickAgent(model) {
      await T('v3-model-trigger').click();
      /* The menu lists the AGENTS (`s2-agent-row`); a model is chosen in the flyout that agent's row opens. */
      const agent = AGENTS.find((a) => a.model === model);
      const agentRow = page.locator(`${sel('s2-agent-row')}[data-agent="${agent.id}"], ${sel('s2-agent-row')}[data-agent$=":${agent.id}"]`).first();
      await until(`the ${agent.id} agent row in the model menu`, async () => (await agentRow.count()) > 0, 20000);
      await agentRow.click();
      const item = page.locator(`${sel('agent-model')}[data-model="${model}"]`);
      await until(`the ${model} row in the model menu`, async () => (await item.count()) > 0, 20000);
      await item.click();
      await page.keyboard.press('Escape');
    }

    async function send(text) {
      await T('composer-field').click();
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    }

    /** A new chat in the current workspace, talking to `agent`, asked `prompt`. Returns its id. */
    async function newAgentChat(agent, prompt) {
      /* The new chat is a row that was not there before, once it is the open one. The rail redraws its rows
         while the session list loads, so the rows are read once they include the open chat. */
      const known = await until('the rail rows', async () => {
        const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid="s2-session"]')].map((e) => e.getAttribute('data-session-id')));
        const open = await activeChatId();
        return open && ids.includes(open) ? new Set(ids) : null;
      });
      await T('s2-new-chat').click();
      const id = await until('a new chat to open', async () => {
        const now = await activeChatId();
        return now && !known.has(now) ? now : null;
      });
      await pickAgent(agent.model);
      await send(prompt);
      await until(`chat ${id} to show its run`, async () => (await transcript()).includes(`answering ${prompt.match(/MARK:(\w+)/)[1]}`), 20000);
      return id;
    }

    const prompt = (tag, steps, delay = 150) => `Multi chat check MARK:${tag} STEPS:${steps} DELAY:${delay}`;

    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await boot();

    /* ── a long run in a chat of each workspace ── */
    const chatA = await newAgentChat(AGENTS[0], prompt('MCA', 700, 100));
    /* The sidebar lists only the projects that have chats (projectList.ts), so a project with none is opened the
       way a reader opens it: the Workspaces + menu, Open a project, and its row under Recent. */
    await T('s2-workspaces-add').click();
    await T('s2-open-project').click();
    await page.locator(sel('attach-recent')).filter({ hasText: 'plainapp' }).locator('button').click();
    await until('the page to open plainapp', async () => (await T('s2-crumb').textContent())?.includes('plainapp'), 30000);
    await boot();
    const beforeB = await activeChatId();
    await T('s2-new-chat').click();
    const chatB = await until('a new chat in plainapp', async () => {
      const now = await activeChatId();
      return now && now !== beforeB ? now : null;
    }, 15000);
    await pickAgent(AGENTS[1].model);
    await send(prompt('MCB', 700, 100));
    await until('MCB on screen', async () => marks(await transcript(), 'MCB') > 0, 20000);
    log('chats', chatA, chatB);

    /* ── switch back and forth while both stream ── */
    const times = [];
    const walls = [];
    /* Six switches, so the budget is on the median, not on one sample of a noisy machine. */
    const legs = [0, 1, 2].flatMap(() => [['plainapp', chatB, 'MCB'], ['shopfront', chatA, 'MCA']]);
    legs.unshift(['shopfront', chatA, 'MCA']);
    legs.pop();
    for (const [ws, id, tag] of legs) {
      const other = tag === 'MCA' ? 'MCB' : 'MCA';
      await check(`the ${ws} chat is in the sidebar, reachable from the other workspace`, async () => {
        await until(`row ${id}`, async () => (await row(id).count()) > 0, 5000).catch(async () => {
          const fold = page.locator(sel('s2-project')).filter({ hasText: ws }).locator(sel('s2-project-fold'));
          if (await fold.count()) await fold.first().click();
          await until(`row ${id} after unfolding`, async () => (await row(id).count()) > 0, 5000);
          throw new Error(`the ${ws} chats were folded away; had to unfold the project to find it`);
        });
      });
      await page.evaluate(() => sessionStorage.removeItem('xws.clickAt'));
      assetCache.length = 0;
      /* A marker on the live document: a reload drops it, an in-place switch keeps it. */
      await page.evaluate(() => { window.__xwsMarker = 'live'; });
      const t0 = Date.now();
      await row(id).locator('button').first().click();
      let firstPaint = null;
      await check(`switching to the ${ws} chat lands on it, with only its words`, async () => {
        await until(`the ${ws} chat to show`, async () => {
          const crumb = (await T('s2-crumb').textContent().catch(() => '')) ?? '';
          const active = await activeChatId().catch(() => null);
          const text = await transcript().catch(() => '');
          if (firstPaint === null && active === id) firstPaint = Date.now() - t0;
          return crumb.includes(ws) && active === id && marks(text, tag) > 0 && marks(text, other) === 0;
        }, 20000, 25);
      });
      const landed = Date.now();
      const wall = landed - t0;
      const clickAt = Number(await page.evaluate(() => sessionStorage.getItem('xws.clickAt')).catch(() => null)) || t0;
      const ms = landed - clickAt;
      times.push(ms);
      walls.push(wall);
      /* One switch over 5 s is a regression whatever the machine; the fixture target is on the median, below. */
      await check(`switching to the ${ws} chat takes under 5 s`, async () => {
        if (ms > 5000) throw new Error(`${ms} ms`);
      });
      /* REPOINTED: workspaces switch IN PLACE since U31 (sessions/workspaceSwitch.ts switchWorkspaceInPlace,
         inPlaceSwitchEnabled), so the page is not reloaded and does not fetch the app again. This used to assert the
         reload's cache headers (immutable /assets/index-*); that reload no longer happens, and the property worth
         holding is that it does not: the document the reader was in is the document they are still in. */
      await check(`switching to the ${ws} chat does not reload the page`, async () => {
        const marker = await page.evaluate(() => window.__xwsMarker ?? null).catch(() => null);
        if (marker !== 'live') throw new Error('the document was replaced by the switch (the marker on window is gone)');
        const refetched = assetCache.splice(0);
        if (refetched.length > 0) throw new Error(`the switch fetched the app again: ${refetched.map((x) => x.url).join(', ')}`);
      });
      log(`switch to ${ws}: ${ms} ms from the click (${wall} ms from Playwright's call; active row after ${firstPaint} ms)`);
      await shot(`switch-${times.length}-${ws}`);
      await check(`the chat left in the other workspace is still running after switching to ${ws}`, async () => {
        const [root, cid, t] = tag === 'MCA' ? [repoB, chatB, 'MCB'] : [repoA, chatA, 'MCA'];
        const r = (await readAgentRuns(root, cid)).at(-1);
        if (r?.status !== 'running') throw new Error(`${t} is ${r?.status}`);
      });
      await check(`after switching to ${ws}, the sidebar still says the other workspace's chat is running`, async () => {
        const cid = tag === 'MCA' ? chatB : chatA;
        await until('running mark', async () => (await row(cid).getAttribute('data-agent-run').catch(() => null)) === 'running', 6000);
      });
    }
    log('switch times from the click', times.join(', '), '| from the call', walls.join(', '));
    /* 0.1.5 review: one switch against a 5 s budget measured nothing (536-5111 ms on one machine). The median of six,
       from the reader's click to their chat on screen with its own words, is held to the fixture target. */
    const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    await check(`the median of ${times.length} switches is under 1 s (median ${median} ms)`, async () => {
      if (times.length < 6) throw new Error(`only ${times.length} switches measured`);
      if (!(median < 1000)) throw new Error(`median ${median} ms of ${times.join(', ')}`);
    });

    /* ── 8. nothing broke along the way ── */
    await check('no uncaught page error', async () => {
      if (pageErrors.length) throw new Error(pageErrors.slice(0, 5).join(' | '));
    });
    await check('no 5xx from the server', async () => {
      if (badResponses.length) throw new Error(badResponses.slice(0, 8).join(' | '));
    });
    await check('no error in the server log', async () => {
      const bad = serverOut.split(/\r?\n/).filter((l) => /\b(error|exception|unhandled|uncaught|EADDRINUSE|ECONNRESET)\b/i.test(l));
      if (bad.length) throw new Error(bad.slice(0, 6).join(' | '));
    });
  } catch (e) {
    failures.push(`harness: ${e.stack ?? e.message}`);
    if (SHOTS) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(SHOTS, `${NAME}-stopped.png`) }).catch(() => {});
    log('FAIL', 'the walk stopped:', e.message);
  } finally {
    await browser.close().catch(() => {});
    child.kill();
    await sleep(300);
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows may hold a file a moment longer */
    }
  }

  /** A chat's runs read from its own workspace's store on disk (the server's route reads only the attached one). */
  async function serverRunsIn(root, chatId) {
    return readAgentRuns(root, chatId);
  }

  log(`${passes} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`[${NAME}]   - ${f}`);
    if (serverOut.trim()) console.error(`[${NAME}] server log tail:\n${serverOut.split(/\r?\n/).slice(-30).join('\n')}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => failHarness(e.stack ?? String(e)));
