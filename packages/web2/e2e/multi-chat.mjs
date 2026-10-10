#!/usr/bin/env node
/**
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

const NAME = 'multi-chat';
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
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-multichat-')));
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
    env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1', SEQUENCE_USER_DIR: userDir },
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
    const page = await context.newPage();
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

    /* ── 1. three chats, three agents, all running at once ── */
    const chats = {};
    chats.claude = await newAgentChat(AGENTS[0], prompt('MCA', 70));
    chats.codex = await newAgentChat(AGENTS[1], prompt('MCB', 70));
    chats.local = await newAgentChat(AGENTS[2], prompt('MCC', 200));
    log('chats', JSON.stringify(chats));
    await shot('1-three-running');

    await check('three chats are three different threads', async () => {
      const ids = new Set(Object.values(chats));
      if (ids.size !== 3) throw new Error(`expected 3 distinct chat ids, got ${[...ids].join(', ')}`);
    });

    await check('all three runs are running on the server at once', async () => {
      const states = await Promise.all(Object.values(chats).map(async (c) => (await lastRun(c))?.status ?? 'none'));
      if (states.some((s) => s !== 'running')) throw new Error(`server run states: ${states.join(', ')}`);
    });

    await check('the sidebar marks every running chat as running, not only the open one', async () => {
      await until('three running rows', async () => {
        const got = await Promise.all(Object.values(chats).map((c) => row(c).getAttribute('data-agent-run')));
        return got.every((g) => g === 'running') ? got : null;
      }, 4000).catch(async () => {
        const got = await Promise.all(Object.values(chats).map((c) => row(c).getAttribute('data-agent-run')));
        throw new Error(`data-agent-run per chat (claude, codex, local): ${got.join(', ')}`);
      });
    });

    /* ── 2. switch between them while they stream ── */
    const seen = {};
    for (const [name, id] of Object.entries(chats)) {
      await openChat(id);
      const tag = AGENTS.find((a) => a.id === name).tag;
      await until(`chat ${name} to show its own words`, async () => marks(await transcript(), tag) > 0, 10000).catch(() => {});
      const text = await transcript();
      seen[name] = marks(text, tag);
      await check(`chat ${name} shows only its own agent's words`, async () => {
        if (seen[name] === 0) throw new Error(`no ${tag} chunks on screen: ${text.slice(0, 200)}`);
        const foreign = ALL_TAGS.filter((t) => t !== tag && marks(text, t) > 0);
        if (foreign.length) throw new Error(`chat ${name} shows other chats' words: ${foreign.join(', ')}`);
      });
    }
    await shot('2-switched');

    /* Read on the page, not from the server's saved record: the record is written on a throttle and lags the stream. */
    await check('runs not on screen keep advancing (claude and codex grew while the reader was elsewhere)', async () => {
      for (const name of ['claude', 'codex']) {
        await openChat(chats[name]);
        const tag = AGENTS.find((a) => a.id === name).tag;
        const back = marks(await transcript(), tag);
        if (!(back > seen[name])) throw new Error(`${name}'s transcript did not move on while away: ${back} <= ${seen[name]}`);
      }
    });

    /* ── 4. Stop in one chat stops that chat only ── */
    await openChat(chats.local);
    await check('Stop in the local chat stops it', async () => {
      await T('composer-stop').click();
      const r = await until('the local run to stop on the server', async () => {
        const x = await lastRun(chats.local);
        return x && x.status !== 'running' ? x : null;
      }, 10000);
      if (r.status !== 'stopped') throw new Error(`local run ended as ${r.status}`);
      if ((r.text ?? '').includes('DONE-MCC')) throw new Error('the stopped run still finished');
    });
    await check('stopping the local chat left claude and codex running', async () => {
      for (const name of ['claude', 'codex']) {
        const r = await lastRun(chats[name]);
        if (r?.status !== 'running' && !(r?.status === 'done' && r.text.includes(`DONE-${AGENTS.find((a) => a.id === name).tag}`)))
          throw new Error(`${name} is ${r?.status} after local was stopped`);
      }
    });

    /* ── 3. finished in the background: the right chat says so ── */
    await check('claude and codex finish while the reader is in another chat', async () => {
      for (const name of ['claude', 'codex']) {
        const tag = AGENTS.find((a) => a.id === name).tag;
        await until(`${name} to finish`, async () => {
          const r = await lastRun(chats[name]);
          return r?.status === 'done' && r.text.includes(`DONE-${tag}`);
        }, 30000);
      }
    });
    await check('the sidebar marks the chats that finished unseen, and not the open one', async () => {
      await until('finished-unseen marks', async () => {
        const [a, b, c] = await Promise.all([chats.claude, chats.codex, chats.local].map((x) => row(x).getAttribute('data-agent-run')));
        return a === 'unseen' && b === 'unseen' && c !== 'running' && c !== 'unseen' ? true : null;
      }, 4000).catch(async () => {
        const got = await Promise.all([chats.claude, chats.codex, chats.local].map((x) => row(x).getAttribute('data-agent-run')));
        throw new Error(`data-agent-run (claude, codex, local): ${got.join(', ')}`);
      });
    });
    await shot('3-finished-unseen');
    await check('opening a finished chat shows its whole answer and clears its mark', async () => {
      await openChat(chats.codex);
      await until('codex DONE on screen', async () => (await transcript()).includes('DONE-MCB'), 10000);
      const text = await transcript();
      const foreign = ALL_TAGS.filter((t) => t !== 'MCB' && marks(text, t) > 0);
      if (foreign.length) throw new Error(`codex chat shows ${foreign.join(', ')}`);
      const mark = await row(chats.codex).getAttribute('data-agent-run');
      if (mark === 'unseen' || mark === 'running') throw new Error(`codex row still says ${mark}`);
      const other = await row(chats.claude).getAttribute('data-agent-run');
      if (other !== 'unseen') throw new Error(`claude row lost its mark when codex was opened: ${other}`);
    });

    /* ── 6. a reload mid-run keeps the run going, and the page follows it ── */
    await openChat(chats.claude);
    await send(prompt('MCA', 60));
    await until('the second claude run to start', async () => (await lastRun(chats.claude))?.prompt?.includes('STEPS:60'), 10000);
    await sleep(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await boot();
    await check('a reload mid-run does not stop the run', async () => {
      await sleep(4000);
      const r = await lastRun(chats.claude);
      if (r?.status !== 'running' && !(r?.status === 'done' && r.text.includes('DONE-MCA'))) throw new Error(`the claude run is ${r?.status} after the reload: ${(r?.error ?? '').slice(0, 120)}`);
    });
    await check('after the reload the sidebar still says the claude chat is running', async () => {
      await until('claude row running', async () => (await row(chats.claude).getAttribute('data-agent-run')) === 'running', 8000);
    });
    await check('after the reload the page follows the running chat to its end', async () => {
      await openChat(chats.claude);
      await until('the second claude answer to finish on screen', async () => {
        const text = await transcript();
        return (text.match(/DONE-MCA/g) ?? []).length >= 2;
      }, 30000);
    });

    /* ── 5. a second workspace while the first one's chat is running ── */
    await openChat(chats.codex);
    await send(prompt('MCB', 80));
    await until('the second codex run to start', async () => (await lastRun(chats.codex))?.prompt?.includes('STEPS:80'), 10000);
    const plain = page.locator(`${sel('s2-project')}`).filter({ hasText: 'plainapp' });
    await plain.locator(sel('s2-project-new')).click();
    await until('the page to open plainapp', async () => (await T('s2-crumb').textContent())?.includes('plainapp'), 30000);
    await boot();
    const chatB = await activeChatId();
    await pickAgent(AGENTS[2].model);
    await send(prompt('MCD', 30));
    await check('a chat in the second workspace runs its agent', async () => {
      await until('MCD to finish on screen', async () => (await transcript()).includes('DONE-MCD'), 30000);
      const text = await transcript();
      const foreign = ALL_TAGS.filter((t) => t !== 'MCD' && marks(text, t) > 0);
      if (foreign.length) throw new Error(`plainapp chat shows ${foreign.join(', ')}`);
    });
    await check("opening the second workspace did not stop the first workspace's running chat", async () => {
      const r = await until('the second codex run to end', async () => {
        const x = (await serverRunsIn(repoA, chats.codex)).at(-1);
        return x && x.status !== 'running' ? x : null;
      }, 30000);
      if (r.status !== 'done' || !r.text.includes('DONE-MCB')) throw new Error(`codex's run in shopfront ended as ${r.status}: ${(r.error ?? '').slice(0, 120)}`);
    });
    await check("the second workspace's run was saved in the second workspace", async () => {
      const r = (await serverRunsIn(repoB, chatB)).at(-1);
      if (!r || !r.text?.includes('DONE-MCD')) throw new Error(`plainapp chat ${chatB} has no saved MCD run`);
    });

    /* ── 7. everything restores after a reload ── */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await boot();
    await check('after a reload the plainapp chat still holds its own answer', async () => {
      await until('MCD restored', async () => (await transcript()).includes('DONE-MCD'), 15000);
    });
    /* Back to the first workspace: open its claude chat from the sidebar (a reload onto shopfront). */
    await row(chats.claude).locator('button').first().click();
    await until('the page to open shopfront', async () => (await T('s2-crumb').textContent())?.includes('shopfront'), 30000);
    await boot();
    for (const [name, id] of Object.entries(chats)) {
      const tag = AGENTS.find((a) => a.id === name).tag;
      await check(`after reloads, chat ${name} restores with only its own words`, async () => {
        await openChat(id);
        await until(`${name} restored`, async () => marks(await transcript(), tag) > 0, 15000);
        const text = await transcript();
        const foreign = ALL_TAGS.filter((t) => t !== tag && marks(text, t) > 0);
        if (foreign.length) throw new Error(`shows ${foreign.join(', ')}`);
        if (name !== 'local' && !text.includes(`DONE-${tag}`)) throw new Error(`no DONE-${tag}`);
      });
    }
    await shot('7-restored');

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
