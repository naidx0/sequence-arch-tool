#!/usr/bin/env node
/**
 * AN AGENT TURN, END TO END, IN THE REAL UI.
 *
 * Owner, 2026-10-15: "agentics first all the way e2e". An Opus reviewer drove agent turns in the real app with fake
 * agents and found the places the chat did not tell the truth. This walks the same turns and asserts what a reader
 * sees, each check built from the reported shape and each one failing on the build that was reviewed.
 *
 * Boots the REAL analyzer over web2's dist with a throwaway user store and a throwaway git repo, registers two FAKE
 * agents (fixtures/fake-agents: a plain ACP agent, listed FIRST, and a `codex app-server` that really writes the file
 * a turn says it writes) and a scripted keyless OpenAI-compatible model (fixtures/mock-llm.mjs). No account, no
 * network, no spend. The provider probe (which would run this machine's real `claude` / `codex`) is answered empty
 * by the browser. Run it with the guard: node --import ../../tools/test-guard/no-real-binaries.mjs e2e/agent-turn-journey.mjs
 *
 * What it asserts, in the reader's seat:
 *   1. Files shows a file an agent just created, within 2 s, with no reload and no scan;
 *   2. a permission prompt shows ONE set of controls (the composer takeover), and answering it works;
 *   3. words steered into a running turn appear in the transcript as the user's message, marked as sent mid-turn;
 *   4. sending a turn scrolls the chat to the latest, even from the top of a long chat;
 *   5. a board action runs on the agent the chat is set to (not the first one registered), leaves no node chip
 *      behind, and with a built-in model chosen goes through that model instead of switching to an agent;
 *   6. a reload draws the turn in the order it was lived and keeps "Turn details";
 *   7. Rewind lists the turn it can revert, and after Revert to here the chat says the turn was reverted;
 *   8. New chat in an empty chat makes no second empty chat;
 *   9. the registered label names the agent, and a long default name is cut at a word;
 *  10. no server error, no 5xx, no uncaught page error along the way.
 * Screenshots (SHOTS, default tmp-shots/019-chatux) at 1440 and at 420 wide.
 *
 * Exit 0 pass (or skip: no Chromium), 1 product wrong, 2 harness broken.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';
import { sel } from './lib/harness.mjs';

const NAME = 'agent-turn-journey';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const FIXTURES = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures');
const FAKES = path.join(HERE, 'fixtures', 'fake-agents');
const MOCK_LLM = path.join(HERE, 'fixtures', 'mock-llm.mjs');
const SHOTS = process.env.SHOTS || path.join(REPO_ROOT, 'tmp-shots', '019-chatux');

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
async function until(what, fn, ms = 20000, every = 100) {
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
  if (problem) failHarness(`${problem} - run: pnpm --filter @sequence/web2 build`);
  if (!fs.existsSync(ANALYZER_CLI)) failHarness('analyzer not built - run: pnpm --filter @sequence/analyzer build');
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

  /* ── the specimen: a home with a user store, a git repo, two fake agents and a mock model ── */
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-turnjourney-')));
  const home = path.join(tmp, 'home');
  const userDir = path.join(home, '.sequence');
  const repo = path.join(home, 'shopfront');
  fs.mkdirSync(userDir, { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'shopfront'), repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), '# ticketing-scaffold\n');
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'e2e@example.test');
    git('config', 'user.name', 'e2e');
    git('add', '-A');
    git('commit', '-qm', 'init');
  } catch (e) {
    failHarness(`git is needed for this walk: ${e.message}`);
  }
  const mockPort = await freePort();
  const mockLog = path.join(tmp, 'mock-llm.log');
  fs.writeFileSync(mockLog, '');
  fs.writeFileSync(
    path.join(userDir, 'agents.json'),
    JSON.stringify(
      {
        agents: [
          /* LISTED FIRST on purpose: the first registered agent is what a board action used to pick. */
          { id: 'alpha', command: process.execPath, args: [path.join(FAKES, 'fake-acp-agent.mjs'), '--as', 'local'], label: 'Alpha (fake, first registered)' },
          { id: 'codex', command: process.execPath, args: [path.join(FAKES, 'codex-actions', 'codex.js')], label: 'Fake codex' },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userDir, 'ai.json'),
    JSON.stringify({ profiles: [{ id: 'saved-1', name: 'mock-model', provider: 'openai-compatible', model: 'mock-model', baseUrl: `http://127.0.0.1:${mockPort}/v1` }], defaultProfileId: 'saved-1' }),
  );
  fs.writeFileSync(path.join(userDir, 'recent.json'), JSON.stringify([repo]));
  fs.mkdirSync(SHOTS, { recursive: true });

  const mock = spawn(process.execPath, [MOCK_LLM, String(mockPort), mockLog], { stdio: 'ignore' });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [ANALYZER_CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
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
      log('FAIL', label, '-', e.message);
    }
  };

  const api = async (p, init) => {
    const r = await fetch(`${base}${p}`, init);
    if (!r.ok) throw new Error(`${p} answered ${r.status}`);
    return r.json();
  };
  const serverRuns = async (chatId) => (await api(`/api/acp/runs?chatId=${encodeURIComponent(chatId)}`)).runs ?? [];
  const mockRequests = () => fs.readFileSync(mockLog, 'utf8').split('\n').filter((l) => l.includes('chat/completions')).length;

  const browser = await chromium.launch(launchOptions(executablePath));
  const pageErrors = [];
  const badResponses = [];
  try {
    await until('the server', async () => (await fetch(`${base}/api/acp/agents`)).ok, 30000, 250);
    /* The repository is attached a moment after the port opens: a page that loads before it lands in the home workspace's chat. */
    await until('the repository to be attached', async () => (await (await fetch(`${base}/api/status`)).json()).attached === true, 60000, 250);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 500 && r.url().startsWith(base)) badResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(base.length)}`);
    });

    const T = (id) => page.locator(sel(id));
    const shot = async (name) => page.screenshot({ path: path.join(SHOTS, `${NAME}-${name}.png`) });
    const activeChatId = () => page.evaluate(() => document.querySelector('[data-testid="s2-session"] button[aria-current="true"]')?.closest('[data-testid="s2-session"]')?.getAttribute('data-session-id') ?? null);
    const rowCount = () => page.locator(sel('s2-session')).count();
    const chatText = () => page.evaluate(() => document.querySelector('[data-testid="s2-chat"]')?.innerText ?? '');

    const boot = async () => {
      await until('the sidebar', async () => (await T('s2-new-chat').count()) > 0, 30000);
      await until('the active chat', activeChatId, 15000);
      await until('the static shell to go', async () => (await page.locator('#static-shell').count()) === 0, 15000);
      await sleep(600);
    };
    async function send(text) {
      await T('composer-field').click();
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    }
    async function pickCodex() {
      await T('v3-model-trigger').click();
      const agentRow = page.locator(`${sel('s2-agent-row')}[data-agent="codex"], ${sel('s2-agent-row')}[data-agent$=":codex"]`).first();
      await until('the codex row in the model menu', async () => (await agentRow.count()) > 0, 20000);
      await agentRow.click();
      const item = page.locator(`${sel('agent-model')}[data-model="fake-codex-model"]`);
      await until('the fake codex model row', async () => (await item.count()) > 0, 20000);
      await item.click();
      await page.keyboard.press('Escape');
    }
    async function pickMock() {
      await T('v3-model-trigger').click();
      await until('the saved model row', async () => (await T('v3-model-row').count()) > 0, 20000);
      await T('v3-model-row').first().click();
      await page.keyboard.press('Escape');
    }
    async function smartMode() {
      await T('s2-mode-trigger').click();
      await T('s2-quickmode-smart').click();
      await sleep(300);
    }
    async function newChat() {
      const before = await activeChatId();
      await T('s2-new-chat').click();
      return until('a new chat to open', async () => {
        const now = await activeChatId();
        return now && now !== before ? now : null;
      }, 15000);
    }
    const scrollerState = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-transcript-scroller]');
        return el ? { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight, fromEnd: el.scrollHeight - el.scrollTop - el.clientHeight } : null;
      });
    const visible = async (testid) => page.locator(sel(testid)).evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length);

    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await boot();
    const chat = await activeChatId();
    const indexNow = async () => JSON.stringify((await api('/api/sessions')).index.sessions.map((s) => `${s.id}:${s.title}:${s.mode ?? '-'}`));
    log('chats at boot', await indexNow());
    await pickCodex();
    await smartMode();

    /* ── 9. the registered label names the agent ── */
    await check('the model menu names an agent by the label it was registered with', async () => {
      await T('v3-model-trigger').click();
      await until('the agent rows', async () => (await T('s2-agent-row').count()) >= 2, 15000);
      const names = (await T('s2-agent-row').allInnerTexts()).join(' | ');
      await page.keyboard.press('Escape');
      if (!/Alpha \(fake, first registered\)/.test(names)) throw new Error(`the first agent's label is not shown: ${names}`);
      if (!/Fake codex/.test(names)) throw new Error(`the second agent's label is not shown: ${names}`);
    });

    /* ── 1. Files shows a file an agent just created ── */
    await T('s2-tab-files').click();
    await until('the Files tree', async () => (await page.locator(`${sel('files-row')}[data-path="docker-compose.yml"]`).count()) > 0, 20000);
    const wrote = path.join(repo, 'agent-wrote.txt');
    await check('a file an agent creates is in the Files tree within 2 s, with no reload', async () => {
      if ((await page.locator(`${sel('files-row')}[data-path="agent-wrote.txt"]`).count()) !== 0) throw new Error('the file was there before the turn');
      await send('WRITE the file please');
      await until('the agent to write the file', () => fs.existsSync(wrote), 30000, 20);
      const wroteAt = Date.now();
      await until('the file row in Files', async () => (await page.locator(`${sel('files-row')}[data-path="agent-wrote.txt"]`).count()) > 0, 6000, 50);
      const took = Date.now() - wroteAt;
      log(`      the file appeared ${took} ms after it was written`);
      if (took > 2000) throw new Error(`it took ${took} ms`);
    });
    await until('the WRITE turn to end', async () => /Created agent-wrote\.txt/.test(await chatText()), 20000);
    await shot('1-files-after-agent-write-1440');

    /* ── 6a. the turn as it was lived: prose, the edit, prose ── */
    const runOrder = () =>
      page.evaluate(() => {
        const run = [...document.querySelectorAll('[data-testid="agent-run"]')].find((r) => /WRITE the file please/.test(r.textContent ?? ''));
        if (!run) return null;
        const kinds = [];
        for (const el of run.querySelectorAll('[data-testid="v3-prose"], [data-testid="agent-card-diff"], [data-testid="agent-card-tool"]')) {
          const k = el.getAttribute('data-testid') === 'v3-prose' ? 'prose' : 'tool';
          if (kinds[kinds.length - 1] !== k) kinds.push(k);
        }
        return { kinds, details: !!document.querySelector('[data-testid="agent-run-log"]') };
      });
    const lived = await runOrder();

    /* ── 2. one set of permission controls ── */
    await send('CMD install it');
    await until('the approval takeover', async () => (await T('s2-takeover-yes').count()) > 0, 20000);
    await sleep(400);
    await check('a permission prompt shows ONE set of controls, the composer takeover', async () => {
      const inline = (await visible('agent-allow')) + (await visible('agent-deny')) + (await visible('agent-always')) + (await visible('agent-approval-allow')) + (await visible('agent-approval-deny')) + (await visible('agent-approval-always'));
      const docked = (await visible('s2-takeover-yes')) + (await visible('s2-takeover-no'));
      if (docked !== 2) throw new Error(`the takeover shows ${docked} of its two answers`);
      if (inline !== 0) throw new Error(`the card shows ${inline} answer buttons of its own beside the takeover`);
      if ((await visible('agent-toast')) !== 0) throw new Error('a toast shows the same question again');
    });
    await shot('2-one-set-of-permission-controls-1440');
    await T('s2-takeover-yes').click();
    await check('Yes on the takeover answers it: the command ran and the takeover goes', async () => {
      await until('cmd-ran.txt', () => fs.existsSync(path.join(repo, 'cmd-ran.txt')), 20000);
      await until('the takeover to go', async () => (await T('s2-takeover-yes').count()) === 0, 10000);
    });
    await until('the CMD turn to end', async () => /Command ran\./.test(await chatText()), 20000);

    /* ── 3. a mid-turn steer is the user's message ── */
    await send('SLOW work please');
    await until('the slow turn to be streaming', async () => /slow work starting/.test(await chatText()), 20000);
    await T('composer-field').click();
    await page.keyboard.type('use the other file instead');
    await page.keyboard.press('Enter');
    await check('words steered into a running turn appear as the user\'s message, marked as sent mid-turn', async () => {
      const bubble = await until('the steer in the transcript', async () => ((await T('agent-run-steer').count()) > 0 ? T('agent-run-steer').first() : null), 8000);
      const text = await bubble.innerText();
      if (!/use the other file instead/.test(text)) throw new Error(`the bubble says: ${text}`);
      if (!/sent mid-turn/i.test(text)) throw new Error(`it is not marked as sent mid-turn: ${text}`);
      const asUser = await bubble.evaluate((e) => e.classList.contains('s2-user'));
      if (!asUser) throw new Error('it is not drawn as a user message');
    });
    await shot('3-steer-as-user-message-1440');
    await T('composer-stop').click();
    await until('the slow turn to stop', async () => (await T('composer-stop').count()) === 0, 15000);

    /* ── 5. a board action runs where the chat is ── */
    await T('s2-tab-architecture').click().catch(() => {});
    await until('a board node', async () => (await T('board-node').count()) > 0, 20000);
    const node = T('board-node').first();
    const nodeId = await node.getAttribute('data-node-id');
    const runsBefore = await T('agent-run').count();
    await node.click({ button: 'right' });
    await T('board-menu-agent-callers').click();
    await check('Find callers runs on the agent the chat is set to, not the first one registered', async () => {
      await until('the board action run in the chat', async () => (await T('agent-run').count()) > runsBefore, 20000);
      /* The fake codex echoes the question ("fake codex echo: ..."); the first registered agent says "local answering". */
      const answered = await until('the answer', async () => {
        const t = await T('agent-run').last().innerText();
        return /fake codex echo|answering/.test(t) ? t : null;
      }, 20000);
      if (!/fake codex echo/.test(answered)) throw new Error(`the run was answered by another agent: ${answered.slice(0, 160)}`);
      const label = await T('v3-model-label').textContent();
      if (!/codex/i.test(label ?? '')) throw new Error(`the composer now says ${label}`);
    });
    await until('the board action run to end', async () => (await T('composer-stop').count()) === 0, 20000);
    await check('the node pinned for the run leaves the composer when the run ends', async () => {
      await until('the chip to go', async () => (await page.locator(`${sel('composer-chips')} [data-ref="${nodeId}"], ${sel('composer-chips')} :text("${nodeId}")`).count()) === 0, 8000);
    });
    await shot('5-board-action-on-selected-agent-1440');

    /* ── 6b. a reload draws the turn in the order it was lived, and keeps Turn details ── */
    log('chats before the reload', await indexNow(), 'open', await activeChatId());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await boot();
    log('chats after the reload', await indexNow(), 'open', await activeChatId());
    await until('the saved turns', async () => /WRITE the file please/.test(await chatText()), 20000);
    await shot('6-after-reload-1440');
    await check('after a reload the agent turn reads in the same order and "Turn details" is still there', async () => {
      const reloaded = await until('the reloaded turn', async () => {
        const r = await runOrder();
        return r && r.kinds.length > 0 && r.details ? r : null;
      }, 15000).catch(async () => runOrder());
      if (!lived || !reloaded) throw new Error(`no run to compare: ${JSON.stringify({ lived, reloaded })}`);
      if (JSON.stringify(lived.kinds) !== JSON.stringify(reloaded.kinds)) throw new Error(`lived ${lived.kinds.join(' > ')} but reloaded ${reloaded.kinds.join(' > ')}`);
      if (lived.details && !reloaded.details) throw new Error('"Turn details" disappeared');
    });

    /* ── 7. Rewind agrees with itself and the chat marks the reverted turn ── */
    await T('s2-chat-quick-overlay.rewind').click();
    await until('the Rewind panel', async () => (await T('rewind-panel').count()) > 0, 10000);
    await until('an agent turn row', async () => (await T('agent-turn').count()) > 0, 15000);
    await check('Rewind lists the agent turns and says nothing that contradicts them', async () => {
      const text = await T('rewind-panel').innerText();
      if (/No agent turns yet/.test(text)) throw new Error('"No agent turns yet" above a listed turn');
      if (/\b0 files\b/.test(text)) throw new Error('a row says "0 files"');
    });
    await shot('7-rewind-1440');
    await check('Revert to here is answered in the panel, and the chat says the turn was reverted', async () => {
      /* Newest first: the last row is the oldest turn, the one that wrote the file. */
      await T('agent-turn-revert').last().click();
      await until('the revert to be reported', async () => (await T('agent-turns-reverted').count()) > 0, 15000);
      await page.keyboard.press('Escape');
      await until('the overlay to close', async () => (await page.locator('[data-kind="rewind"]').count()) === 0, 8000).catch(async () => {
        await page.locator('[data-kind="rewind"]').first().click({ position: { x: 4, y: 4 } });
      });
      await until('the overlay to be gone', async () => (await page.locator('[data-kind="rewind"]').count()) === 0, 8000);
      await until('a Reverted mark in the chat', async () => (await T('turn-reverted').count()) > 0, 10000);
    });
    await T('turn-reverted').first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await shot('7-reverted-turn-1440');

    /* ── 8. New chat in an empty chat makes no second empty chat ── */
    await check('New chat pressed twice makes one chat, not two empty ones', async () => {
      const before = await rowCount();
      const first = await newChat();
      const afterOne = await rowCount();
      if (afterOne !== before + 1) throw new Error(`the first press made ${afterOne - before} chats`);
      await T('s2-new-chat').click();
      await sleep(1200);
      await T('s2-new-chat').click();
      await sleep(1200);
      const afterThree = await rowCount();
      if (afterThree !== afterOne) throw new Error(`pressing New chat in the empty chat made ${afterThree - afterOne} more`);
      if ((await activeChatId()) !== first) throw new Error('the open chat changed');
    });

    /* ── 5b. a built-in model chosen: a board action goes through it, no agent run, no switch ── */
    await pickMock();
    const builtIn = await activeChatId();
    await T('s2-tab-architecture').click().catch(() => {});
    await until('a board node', async () => (await T('board-node').count()) > 0, 20000);
    const requestsBefore = mockRequests();
    await T('board-node').first().click({ button: 'right' });
    await T('board-menu-agent-callers').click();
    await check('with a built-in model chosen, Find callers goes through that model and does not switch the chat to an agent', async () => {
      await until('the model to be asked', async () => mockRequests() > requestsBefore, 25000);
      const label = await T('v3-model-label').textContent();
      if (!/mock-model/.test(label ?? '')) throw new Error(`the composer now says ${label}`);
      const agentRuns = await serverRuns(builtIn);
      if (agentRuns.length !== 0) throw new Error(`${agentRuns.length} agent run(s) were started in the chat`);
    });
    await until('that turn to end', async () => (await T('composer-stop').count()) === 0, 40000).catch(() => {});

    /* ── 4. sending scrolls to the latest (a built-in chat: its answers are long) ── */
    for (let i = 0; i < 4; i += 1) {
      await send(`TURN${i} tell me something`);
      await until(`answer ${i}`, async () => new RegExp(`Answer for turn ${i}`).test(await chatText()) && (await T('composer-stop').count()) === 0, 30000);
    }
    await check('sending a turn scrolls the chat to the latest, from the top of a long chat', async () => {
      const before = await scrollerState();
      if (!before || before.height <= before.client + 200) throw new Error(`the chat is not long enough to scroll: ${JSON.stringify(before)}`);
      await page.evaluate(() => {
        document.querySelector('[data-transcript-scroller]').scrollTop = 0;
      });
      await until('Jump to latest', async () => (await T('v3-jump-latest').count()) > 0, 5000);
      await shot('4-long-chat-scrolled-up-1440');
      await send('TURN9 now scroll to me');
      await until('the chat at its end', async () => {
        const s = await scrollerState();
        return s && s.fromEnd <= 80;
      }, 6000, 100).catch(async () => {
        throw new Error(`the chat stayed where it was: ${JSON.stringify(await scrollerState())}`);
      });
      await until('"Jump to latest" to go', async () => (await T('v3-jump-latest').count()) === 0, 4000).catch(() => {
        throw new Error('"Jump to latest" is still showing after a send');
      });
    });
    await shot('4-after-send-at-latest-1440');
    await until('that turn to end', async () => (await T('composer-stop').count()) === 0, 40000).catch(() => {});

    /* ── 420 wide: the same states, narrow ── */
    await page.setViewportSize({ width: 420, height: 860 });
    await sleep(600);
    await pickCodex().catch(() => {});
    await shot('8-narrow-chat-420');
    await send('CMD again at narrow width');
    await until('the takeover at 420', async () => (await T('s2-takeover-yes').count()) > 0, 25000);
    await check('at 420 wide the takeover is reachable and the card shows no second set', async () => {
      const box = await T('s2-takeover-yes').boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 420) throw new Error(`Yes is at ${JSON.stringify(box)}`);
      const inline = (await visible('agent-allow')) + (await visible('agent-deny'));
      if (inline !== 0) throw new Error(`${inline} inline answer buttons`);
    });
    await shot('9-narrow-takeover-420');
    await T('s2-takeover-yes').click();
    await until('that turn to end', async () => (await T('composer-stop').count()) === 0, 25000);
    await send('SLOW narrow');
    await until('the slow turn to stream', async () => /slow work starting/.test(await chatText()), 25000);
    await T('composer-field').click();
    await page.keyboard.type('narrow steer');
    await page.keyboard.press('Enter');
    await until('the steer at 420', async () => (await T('agent-run-steer').count()) > 0, 8000);
    await shot('10-narrow-steer-420');
    await T('composer-stop').click();
    await page.setViewportSize({ width: 1440, height: 900 });

    /* ── 10. nothing broke along the way ── */
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
    await browser.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(SHOTS, `${NAME}-stopped.png`) }).catch(() => {});
    log('FAIL', 'the walk stopped:', e.message);
  } finally {
    await browser.close().catch(() => {});
    child.kill();
    mock.kill();
    await sleep(300);
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows may hold a file a moment longer */
    }
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
