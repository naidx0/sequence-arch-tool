#!/usr/bin/env node
/*
 * FIRST RUN (round 12) — launch with no repo attached and count the way to a chat.
 *
 * First run is the agent list only: a ready agent has "Start chatting", which
 * connects it and lands in the default workspace chat with the composer
 * focused. No project picker, no attach, no reload. Opening a project is a
 * separate, optional second step (the sidebar's Open project), measured apart.
 *
 * Each run builds its OWN home: a temp dir with three git repos at depths 1, 2
 * and 4 (copies of the shopfront fixture), and a temp bin dir holding fake
 * `claude` (signed out until `claude auth login` runs) and `codex` (signed in,
 * ChatGPT) put first on PATH. USERPROFILE, HOME and SEQUENCE_HOME point at
 * that home, so nothing on the real machine is read or changed. The fakes are
 * scripts of ours; no real claude or codex binary is ever started.
 *
 * Records per run:
 *   listsMs     page navigation -> the first-run screen shows its agent cards
 *               AND every provider card has left "checking" and Start chatting exists
 *   clicks      clicks from that screen to a focused composer (5 expected: option, Start chatting, two setup skips, Done)
 *   chatMs      click on Start chatting -> the composer field holds focus
 *   composerFocused  the composer field holds focus once the screen has left
 *   attachCalls  /api/attach requests seen (0 expected: first run attaches nothing)
 * With --signin it first sets Claude up, records the command echoed by the
 * terminal and whether the pill turned Ready, and starts with claude. The
 * isolated home has NO bridge (claude-agent-acp) by default, as on a clean
 * machine: the card must offer one combined step ("Install bridge and sign
 * in"), which runs a fake `npm` of ours that drops a stub bridge in the fake
 * bin dir (no network, nothing global). --stub-bridge puts the stub bridge on
 * PATH up front instead (the bridge-already-installed path: Sign in only).
 * setupClicks counts the clicks before Start chatting; clicks counts Start chatting.
 * --bundled-bridge points the server at the bridge that ships inside the app (dist/claude-agent-acp.mjs,
 * built by the analyzer build) instead of "this install has none": no Install bridge step exists, so a
 * signed-out Claude shows plain "Sign in" and a signed-in one is Ready on arrival. --presigned starts
 * the fake claude already signed in (the common case: the person already uses Claude Code), so the
 * setup is the bridge alone (before) or nothing (after).
 * --download-bridge is the default product path: nothing is bundled, so the server fetches the pinned
 * bridge closure on first use. The npm registry is replaced by a local mirror of the SAME tarballs
 * (fetched once through curl, so a proxy works), which makes the time local; the bytes are the real
 * compressed size, and downloadSecondsAt25Mbps is that size over a 25 Mbit/s line. Records
 * preparingFirstPill (e.g. "Setting up Claude… 3.1 MB"), downloadMB and preparingMs (page -> Ready). setupMs is the setup click -> Ready.
 * With --open-project it then opens deep-repo through the sidebar's Open project
 * and records, apart from the chat numbers: projectClicks, boardMs (click -> first
 * board node), clippedNodes (board nodes outside the board viewport).
 * With --shots <dir> it writes PNGs at 1440x900 and 1024x700.
 * With --real it skips the isolated home and opens against the real home,
 * reading the agent cards only (no click).
 *
 *   node tools/measure/first-run.mjs [--runs 5] [--signin [--stub-bridge | --bundled-bridge] [--presigned]] [--open-project] [--shots dir] [--real] [--out file.json]
 *
 * Calls no model. Needs playwright-core (a web2 dev dependency) and a Chromium.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolatedEnv } from './lib/isolatedEnv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const RUNS = Number(arg('--runs', '5'));
const SIGNIN = process.argv.includes('--signin');
const STUB_BRIDGE = process.argv.includes('--stub-bridge');
const BUNDLED = process.argv.includes('--bundled-bridge');
const PRESIGNED = process.argv.includes('--presigned');
const DOWNLOAD = process.argv.includes('--download-bridge');
const REAL = process.argv.includes('--real');
const OPEN_PROJECT = process.argv.includes('--open-project');
const SHOTS = arg('--shots');
const OUT = arg('--out');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
/* The fake npm answers only the real install command: a package rename fails loudly here, not as "unknown". */
const { CLAUDE_ACP_PACKAGE } = await import(pathToFileURL(path.join(ROOT, 'packages', 'analyzer', 'dist', 'server', 'providerProbe.js')).href);
const BUNDLED_FILE = path.join(ROOT, 'packages', 'analyzer', 'dist', 'claude-agent-acp.mjs');
let MIRROR = '';
let mirrorBytes = 0;
async function startMirror() {
  const { CLAUDE_BRIDGE_CLOSURE } = await import(pathToFileURL(path.join(ROOT, 'packages', 'analyzer', 'dist', 'server', 'claudeBridgeClosure.js')).href);
  const dir = path.join(os.tmpdir(), 'seq-bridge-mirror');
  fs.mkdirSync(dir, { recursive: true });
  for (const p of CLOSURE_FILES(CLAUDE_BRIDGE_CLOSURE)) {
    const f = path.join(dir, p.file);
    if (!fs.existsSync(f)) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      execFileSync('curl', ['-sS', '--fail', '-o', f, p.resolved]);
    }
    mirrorBytes += fs.statSync(f).size;
  }
  const server = (await import('node:http')).createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(dir) || !fs.existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200).end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  MIRROR = `http://127.0.0.1:${server.address().port}`;
  return server;
}
const CLOSURE_FILES = (closure) => closure.map((p) => ({ resolved: p.resolved, file: new URL(p.resolved).pathname }));
const FIXTURE = path.join(ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');
const NODE_SEL = '.react-flow__node';

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const FAKE = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [name, ...args] = process.argv.slice(2);
const a = args.join(' ');
const marker = path.join(here, name + '.signed-in');
const out = (s) => process.stdout.write(s);
const stub = (p) => {
  if (process.platform === 'win32') fs.writeFileSync(p + '.cmd', '@exit /b 0\\r\\n');
  else { fs.writeFileSync(p, '#!/bin/sh\\nexit 0\\n'); fs.chmodSync(p, 0o755); }
};
if (a === '--version') out(name === 'claude' ? '2.1.280 (Claude Code)\\n' : 'codex-cli 0.153.4\\n');
else if (name === 'claude' && a === 'auth status --json') { const ok = fs.existsSync(marker); out(JSON.stringify({ loggedIn: ok, authMethod: ok ? 'claude.ai' : 'none' })); process.exitCode = ok ? 0 : 1; }
else if (name === 'claude' && a === 'auth login') { out('FAKE-CLAUDE ran: claude auth login\\n'); fs.writeFileSync(marker, '1'); }
else if (name === 'codex' && a === 'login status') out('Logged in using ChatGPT\\n');
else if (name === 'npm' && a === 'install -g ${CLAUDE_ACP_PACKAGE}') { out('added 1 package (FAKE npm)\\n'); stub(path.join(here, 'claude-agent-acp')); }
else { process.stderr.write('unknown ' + a); process.exitCode = 2; }
`;

function makeHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-first-run-home-')));
  const repos = ['shopfront', 'Projects/premai-lite', 'OneDrive/Documents/GitHub/deep-repo'];
  for (const rel of repos) {
    const dir = path.join(home, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.cpSync(FIXTURE, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p) });
    execFileSync('git', ['init', '-q'], { cwd: dir });
  }
  const bin = path.join(home, '.fake-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'fake.mjs'), FAKE);
  for (const name of ['claude', 'codex', 'npm']) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(bin, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake.mjs" ${name} %*\r\n`);
    } else {
      const p = path.join(bin, name);
      fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'fake.mjs')}" ${name} "$@"\n`);
      fs.chmodSync(p, 0o755);
    }
  }
  if (PRESIGNED) fs.writeFileSync(path.join(bin, 'claude.signed-in'), '1');
  if (STUB_BRIDGE) {
    const p = path.join(bin, 'claude-agent-acp');
    if (process.platform === 'win32') fs.writeFileSync(p + '.cmd', '@exit /b 0\r\n');
    else {
      fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(p, 0o755);
    }
  }
  return { home, bin, repos };
}

async function waitStatus(port, t0, capMs = 120000) {
  while (Date.now() - t0 < capMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (r.ok) return Date.now() - t0;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server never answered /api/status');
}

async function waitLists(page) {
  await page.waitForFunction(
    () => {
      const opts = [...document.querySelectorAll('[data-testid="first-run-option"][data-state]')];
      return opts.length > 0 && opts.every((c) => c.getAttribute('data-state') !== 'checking') && opts.some((c) => c.getAttribute('data-state') === 'ready');
    },
    null,
    { timeout: 30000, polling: 16 },
  );
}

async function shoot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[1440, 900], [1024, 700]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${w}x${h}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function oneRun(browser, i) {
  const iso = REAL ? null : makeHome();
  const port = await freePort();
  const env = { ...process.env };
  if (iso) {
    env.USERPROFILE = iso.home;
    env.HOME = iso.home;
    env.SEQUENCE_HOME = path.join(iso.home, '.sequence');
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[key] = iso.bin + path.delimiter + env[key];
    /* "none" = this install has no bundled bridge (the before); else the file the analyzer build wrote (the after). */
    if (DOWNLOAD) {
      delete env.SEQUENCE_CLAUDE_BRIDGE;
      env.SEQUENCE_NPM_REGISTRY = MIRROR;
    } else env.SEQUENCE_CLAUDE_BRIDGE = BUNDLED ? BUNDLED_FILE : 'none';
  } else {
    /* --real reads the real home's repos; the user store is still a temp dir. */
    env.SEQUENCE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-first-run-store-'));
  }
  const t0 = Date.now();
  const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port)], {
    env: isolatedEnv(env, { userDir: env.SEQUENCE_HOME }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    const serverMs = await waitStatus(port, t0);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const attaches = [];
    page.on('request', (rq) => {
      if (/\/api\/attach/.test(rq.url())) attaches.push(rq.url());
    });
    const n0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitLists(page);
    const listsMs = Date.now() - n0;
    const seen = await page.evaluate(() => ({
      providers: [...document.querySelectorAll('[data-testid="first-run-option"][data-state]')].map((c) => `${c.getAttribute('data-option')}:${c.querySelector('.fr-pill')?.textContent}`),
    }));
    const row = { run: i, serverMs, listsMs, ...seen };
    if (REAL) {
      await shoot(page, `first-run-real`);
      await ctx.close();
      return row;
    }
    if (i === 0) await shoot(page, 'first-run');

    let setupClicks = 0;
    if (SIGNIN) {
      /* Round 13: Claude starts signed out AND without its bridge. One button does both, in order. */
      await page.locator('[data-option="claude"]').click();
      const card = '[data-provider="claude"]';
      row.claudeBeforeSignin = await page.locator('[data-testid="first-run-provider-pill"]').textContent();
      row.claudeFirst = row.claudeBeforeSignin;
      row.claudeSay = await page.locator(`${card} [data-testid="first-run-provider-say"]`).textContent();
      /* One actionable step per card: the combined bridge + sign-in button when the bridge is missing, else Sign in; none when nothing is left. */
      const setup = page.locator('[data-testid="first-run-setup-agent"]');
      const expected = PRESIGNED && (BUNDLED || DOWNLOAD) ? 0 : 1;
      row.preparingFirstPill = DOWNLOAD ? row.claudeBeforeSignin : undefined;
      if ((await setup.count()) !== expected) throw new Error(`claude card offers ${await setup.count()} setup buttons, expected ${expected}`);
      row.setupButton = expected ? await setup.textContent() : null;
      if (/adapter|bridge/i.test(`${row.claudeSay}`) && BUNDLED) throw new Error(`claude card still talks about a bridge: ${row.claudeSay}`);
      if (/adapter/i.test(`${row.claudeBeforeSignin} ${row.claudeSay}`)) throw new Error(`claude card still says "adapter": ${row.claudeBeforeSignin}`);
      if (BUNDLED && /install bridge/i.test(row.setupButton ?? '')) throw new Error(`bundled bridge but the card offers "${row.setupButton}"`);
      if (i === 0 && !STUB_BRIDGE) await shoot(page, BUNDLED ? 'first-run-signin-bundled' : 'first-run-signin-no-bridge');
      if (DOWNLOAD && PRESIGNED) {
        await page.waitForFunction(() => /^Ready/.test(document.querySelector('[data-testid="first-run-provider-pill"]')?.textContent ?? ''), null, { timeout: 120000 }).catch(async (e) => {
          throw new Error(`never Ready: pill "${await page.locator('[data-testid="first-run-provider-pill"]').textContent()}"; server log: ${log.slice(-600)}; ${e.message}`);
        });
        row.preparingMs = Date.now() - n0;
      }
      if (expected) {
        const s0 = Date.now();
        await setup.click();
        setupClicks += 1;
        if (!PRESIGNED) {
          await page.waitForSelector('[data-testid="first-run-signin-terminal"]', { timeout: 10000 });
          await page.waitForFunction(() => /FAKE-CLAUDE ran: claude auth login/.test(document.querySelector('[data-testid="terminal-pane-surface"]')?.textContent ?? ''), null, { timeout: 20000 });
          if (i === 0) await shoot(page, 'first-run-signin');
          row.signinCommand = await page.locator('[data-testid="first-run-signin-command"]').textContent();
        }
        await page.waitForFunction(() => /^Ready/.test(document.querySelector('[data-testid="first-run-provider-pill"]')?.textContent ?? ''), null, { timeout: 20000 });
        row.setupMs = Date.now() - s0;
      }
      row.claudeAfterSignin = await page.locator('[data-testid="first-run-provider-pill"]').textContent();
      row.setupClicks = setupClicks;
      if (i === 0) await shoot(page, 'first-run-signed-in');
    }

    let clicks = 0;
    const c0 = Date.now();
    const who = SIGNIN ? 'claude' : 'codex';
    /* Welcome: the option (already open after a sign-in), Start chatting, then one tap per setup card and Done. */
    if (!SIGNIN) {
      await page.locator(`[data-option="${who}"]`).click();
      clicks += 1;
    }
    await page.locator('[data-testid="first-run-start"]').click();
    clicks += 1;
    for (const id of ['first-run-setup-project-skip', 'first-run-setup-trust-skip', 'first-run-setup-done-go']) {
      await page.locator(`[data-testid="${id}"]`).click();
      clicks += 1;
    }
    await page.waitForSelector('[data-testid="first-run"]', { state: 'detached', timeout: 30000 });
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'composer-field', null, { timeout: 30000, polling: 16 });
    row.chatMs = Date.now() - c0;
    row.clicks = clicks;
    row.composerFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'composer-field');
    row.attachCalls = attaches.length;
    if (attaches.length !== 0) throw new Error(`first run attached a project: ${attaches.join(', ')}`);
    if (i === 0) await shoot(page, 'first-run-chat');

    if (OPEN_PROJECT) {
      let projectClicks = 0;
      const p0 = Date.now();
      await page.locator('[data-testid="v3-rail-open-project"]').click();
      projectClicks += 1;
      const deep = path.join(iso.home, 'OneDrive', 'Documents', 'GitHub', 'deep-repo');
      await page.locator('[data-testid="attach-open-folder"]').click();
      projectClicks += 1;
      await page.locator('[data-testid="attach-path"]').fill(deep);
      await page.locator('[data-testid="attach-path-open"]').click();
      projectClicks += 1;
      await page.waitForSelector(NODE_SEL, { state: 'visible', timeout: 90000 });
      row.projectClicks = projectClicks;
      row.boardMs = Date.now() - p0;
      await page.waitForTimeout(1200);
      row.fit = await page.evaluate((sel) => {
        const flow = document.querySelector('.react-flow');
        if (!flow) return null;
        const box = flow.getBoundingClientRect();
        const nodes = [...document.querySelectorAll(sel)];
        const clipped = nodes.filter((n) => {
          const r = n.getBoundingClientRect();
          return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1;
        }).length;
        return { nodes: nodes.length, clipped, flowW: Math.round(box.width), flowH: Math.round(box.height) };
      }, NODE_SEL);
      if (i === 0) await shoot(page, 'first-run-board');
    }
    await ctx.close();
    return row;
  } finally {
    child.kill();
    if (iso) fs.rmSync(iso.home, { recursive: true, force: true, maxRetries: 5 });
  }
}

const mirror = DOWNLOAD ? await startMirror() : null;
const exe = findChromium();
if (!exe) {
  console.log('first-run: no Chromium found; set CHROMIUM_PATH. Skipping.');
  process.exit(0);
}
const browser = await chromium.launch({ executablePath: exe, headless: true });
const rows = [];
for (let i = 0; i < (REAL ? 1 : RUNS); i++) {
  const r = await oneRun(browser, i);
  rows.push(r);
  console.log(JSON.stringify(r));
}
await browser.close();
mirror?.close();
const med = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const summary = {
  runs: rows.length,
  listsMs: med(rows.map((r) => r.listsMs)),
  listsMsRange: [Math.min(...rows.map((r) => r.listsMs)), Math.max(...rows.map((r) => r.listsMs))],
  clicks: med(rows.map((r) => r.clicks)),
  ...(SIGNIN ? { bridge: DOWNLOAD ? 'downloaded on first use (local mirror of the registry tarballs)' : BUNDLED ? 'bundled in the app' : STUB_BRIDGE ? 'stub on PATH' : 'none (fake npm installs a stub)', presigned: PRESIGNED, ...(DOWNLOAD ? { downloadMB: +(mirrorBytes / 1e6).toFixed(1), downloadSecondsAt25Mbps: Math.round((mirrorBytes * 8) / 25e6), preparingFirstPill: rows[0]?.preparingFirstPill, preparingMsLocal: med(rows.map((r) => r.preparingMs)) } : {}), setupMs: med(rows.map((r) => r.setupMs)), setupButton: rows[0]?.setupButton, setupClicks: med(rows.map((r) => r.setupClicks)), claudeBeforeSignin: rows[0]?.claudeBeforeSignin, readyAfterSetup: rows.filter((r) => /^Ready/.test(r.claudeAfterSignin ?? '')).length } : {}),
  chatMs: med(rows.map((r) => r.chatMs)),
  composerFocused: rows.filter((r) => r.composerFocused).length,
  attachCalls: rows.map((r) => r.attachCalls ?? null),
  ...(OPEN_PROJECT ? { projectClicks: med(rows.map((r) => r.projectClicks)), boardMs: med(rows.map((r) => r.boardMs)), clippedNodes: rows.map((r) => r.fit?.clipped ?? null) } : {}),
};
console.log('SUMMARY ' + JSON.stringify(summary));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
