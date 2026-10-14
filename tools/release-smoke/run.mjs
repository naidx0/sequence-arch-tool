#!/usr/bin/env node
/*
 * THE RELEASE SMOKE - drives the SHIPPED app the way a new person meets it, after `pnpm desktop:dist`.
 *
 *   pnpm test:release                      # every step and budget against packages/desktop/release
 *   node tools/release-smoke/run.mjs --app <Sequence.exe> --out <dir> --only a,b,server-size --keep-temp
 *
 * Owner, 0.1.8.1: "find a way to test after as well so we don't keep running into these errors". The unit suites
 * test the source; this tests the installer's output: `release/win-unpacked/Sequence.exe` (or its mac/linux
 * sibling), launched through Playwright's Electron driver with a FRESH temp userData (`--user-data-dir`), a FRESH
 * fake HOME/USERPROFILE, `SEQUENCE_USER_DIR` inside that home, and a PATH of system folders plus git, so no agent
 * CLI, API key or profile of the person running it is visible. The real %APPDATA%/Sequence and ~/.sequence are never
 * read or written; a launch whose userData is not the temp one aborts the run.
 *
 * Steps a..j each take a screenshot into the output dir (default tmp-shots/release-smoke/<version>/) and report
 * PASS/FAIL/SKIP with a reason; the budgets do the same. Exit 0 only when every step and every budget PASSes: a SKIP
 * (offline, a hook this build lacks) is never a pass. Exit 2 when the run could not start (no packaged app, no
 * playwright-core). Every process this starts is tracked by pid and creation time and killed at the end; nothing is
 * ever killed by image name, so a Sequence the person has open is never touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BUDGETS,
  FAKE_KEY,
  SLOW_SCAN_DELAY_MS,
  SLOW_SCAN_HOOK,
  STEPS,
  buildEnv,
  descendants,
  dirSize,
  envLeaks,
  formatTable,
  internalWordsIn,
  keyFileVerdict,
  keyFilesVerdict,
  norm,
  packagedCandidates,
  parseArgs,
  releaseNotesVerdict,
  repoSecretsVerdict,
  resourcesDir,
  serverSizeVerdict,
  slowScanSurvival,
  slowScanVerdict,
  verdict,
  windowShownVerdict,
  writeScaleRepo,
  writeSmallRepo,
} from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESKTOP = path.join(ROOT, 'packages', 'desktop');
const PLATFORM = process.platform;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(line + '\n');

/* ── processes we started, and only those ────────────────────────────────── */

/** Every process on the machine as {pid, ppid, name, created}. */
function processTable() {
  if (PLATFORM === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    );
    try {
      return JSON.parse(r.stdout).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, created: String(p.CreationDate) }));
    } catch {
      return [];
    }
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'lstart=', '-o', 'comm='], { encoding: 'utf8' });
  return String(r.stdout)
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3], name: m[4] }));
}

/** A launch's process tree, remembered as it grows so a parent that exits first still leaves its children known. */
class Tracked {
  constructor(rootPid) {
    this.rows = new Map();
    const me = processTable().find((p) => p.pid === rootPid);
    if (me) this.rows.set(rootPid, me);
    this.rootPid = rootPid;
  }
  snapshot() {
    const table = processTable();
    for (const r of [...table.filter((p) => p.pid === this.rootPid), ...descendants(table, this.rootPid)]) this.rows.set(r.pid, r);
    /* Grandchildren whose parent already left this table are still ours if their parent was. */
    for (const r of table) if (this.rows.has(r.ppid) && !this.rows.has(r.pid)) this.rows.set(r.pid, r);
  }
  /** Kill what is still alive with the same pid AND creation time: a reused pid is someone else's process. */
  killRemaining() {
    const table = processTable();
    const killed = [];
    for (const r of this.rows.values()) {
      const now = table.find((p) => p.pid === r.pid);
      if (!now || now.created !== r.created) continue;
      if (PLATFORM === 'win32') spawnSync('taskkill', ['/PID', String(r.pid), '/F'], { windowsHide: true });
      else {
        try {
          process.kill(r.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
      killed.push(`${r.name}:${r.pid}`);
    }
    return killed;
  }
}

/* ── preflight ───────────────────────────────────────────────────────────── */

function findGitDir() {
  const r = spawnSync(PLATFORM === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8', windowsHide: true });
  const hits = String(r.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const preferred = hits.find((h) => /[\\/]cmd[\\/]git(\.exe)?$/i.test(h)) ?? hits[0];
  return preferred ? path.dirname(preferred) : null;
}

function appVersion(resDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(resDir, 'server', 'build-info.json'), 'utf8')).version;
    if (typeof v === 'string') return v;
  } catch {
    /* fall through */
  }
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

/** Does the bundled engine read the slow-scan hook at all? A string search over the shipped analyzer dist. */
function bundleHasHook(resDir) {
  const dist = path.join(resDir, 'server', 'packages', 'analyzer', 'dist');
  const stack = [dist];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(c?js)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes(SLOW_SCAN_HOOK)) return true;
    }
  }
  return false;
}

async function localModelAnswers() {
  const ports = [11434, 1234];
  const up = [];
  for (const port of ports) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      up.push(port);
    } catch {
      /* nothing listening */
    }
  }
  return up;
}

/* ── a fresh profile per launch ──────────────────────────────────────────── */

function freshProfile(tmpRoot, label, gitDir, extraEnv = {}) {
  const base = path.join(tmpRoot, label);
  const home = path.join(base, 'home');
  const userData = path.join(base, 'userData');
  for (const d of [home, userData, path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'Local'), path.join(home, '.sequence')]) fs.mkdirSync(d, { recursive: true });
  const env = buildEnv({ base: process.env, platform: PLATFORM, fakeHome: home, gitDir, extra: extraEnv });
  const leaks = envLeaks(env, os.homedir());
  if (leaks.length) throw new Error(`refusing to launch: ${leaks.join('; ')}`);
  return { base, home, userData, env, store: env.SEQUENCE_USER_DIR };
}

function setLastRepo(profile, repo) {
  fs.writeFileSync(path.join(profile.store, 'last-place.json'), JSON.stringify({ repo }, null, 2));
}

function sameDir(a, b) {
  const n = (p) => {
    let r = path.resolve(p);
    try {
      r = fs.realpathSync.native(r);
    } catch {
      /* not there */
    }
    return PLATFORM === 'win32' ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
}

/* ── budget: window shown (smoke mode spawn, the app's own launch marks) ─── */

async function runSmokeLaunch(exe, profile, timeoutMs = 150_000) {
  const launchedAt = Date.now();
  const child = spawn(exe, [`--user-data-dir=${profile.userData}`], {
    env: { ...profile.env, SEQUENCE_DESKTOP_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const tracked = new Tracked(child.pid);
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (out += b));
  const poll = setInterval(() => tracked.snapshot(), 2000);
  const exit = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ code: null, timedOut: true }), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, timedOut: false });
    });
  });
  clearInterval(poll);
  await sleep(1500);
  const killed = tracked.killRemaining();
  const line = out.split(/\r?\n/).find((l) => l.startsWith('SEQUENCE_DESKTOP_SMOKE '));
  let detail = null;
  try {
    detail = line ? JSON.parse(line.slice(line.indexOf('{'))) : null;
  } catch {
    detail = null;
  }
  return { launchedAt, exit, line, detail, out, killed };
}

async function budgetWindowShown(exe, tmpRoot, gitDir, synthRepoFor) {
  const profile = freshProfile(tmpRoot, 'window-shown', gitDir);
  const repo = synthRepoFor(profile);
  setLastRepo(profile, repo);
  const r = await runSmokeLaunch(exe, profile);
  /* POSITIVE CONTROL for the isolation itself: the app wrote its log into OUR userData. */
  const isolated = fs.existsSync(path.join(profile.userData, 'logs', 'main.log'));
  const ready = r.detail?.marks?.readyToShow;
  const ms = typeof ready === 'number' ? ready - r.launchedAt : undefined;
  const v = windowShownVerdict(ms);
  if (ms === undefined) v.reason += `; app said: ${r.line ? r.line.slice(0, 300) : `nothing (exit ${r.exit.code}${r.exit.timedOut ? ', timed out' : ''})`}`;
  return { result: { id: 'window-shown', ...v }, isolated, profile };
}

/* ── Playwright session helpers ──────────────────────────────────────────── */

function loadElectronDriver() {
  for (const from of [path.join(ROOT, 'package.json'), path.join(ROOT, 'packages', 'web2', 'package.json')]) {
    try {
      return createRequire(from)('playwright-core')._electron;
    } catch {
      /* next */
    }
  }
  return null;
}

async function withTimeout(promise, ms, what) {
  let t;
  try {
    return await Promise.race([promise, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${what}: no answer within ${ms} ms`)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

async function launchSession(electron, exe, profile) {
  const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${profile.userData}`], env: profile.env, timeout: 120_000 });
  const tracked = new Tracked(app.process().pid);
  const state = { closed: false, crashed: false };
  app.on('close', () => (state.closed = true));
  const userData = await withTimeout(app.evaluate(({ app: a }) => a.getPath('userData')), 30_000, 'userData');
  if (!sameDir(userData, profile.userData)) {
    tracked.snapshot();
    tracked.killRemaining();
    throw new Error(`ISOLATION: the app's userData is ${userData}, not the temp ${profile.userData}; stopped`);
  }
  tracked.snapshot();
  return { app, tracked, state };
}

async function closeSession(s) {
  if (!s) return [];
  s.tracked.snapshot();
  try {
    await withTimeout(s.app.close(), 20_000, 'close');
  } catch {
    /* killed below */
  }
  await sleep(2000);
  return s.tracked.killRemaining();
}

async function firstPage(s, timeout = 90_000) {
  const page = await s.app.firstWindow({ timeout });
  page.on('crash', () => (s.state.crashed = true));
  return page;
}

async function status(page) {
  const origin = new URL(page.url()).origin;
  const r = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(5000) });
  return r.json();
}

async function visibleCount(page, selector) {
  return page.$$eval(selector, (els) => els.filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }).length);
}

async function firstVisible(page, selector) {
  const all = page.locator(selector);
  const n = await all.count();
  for (let i = 0; i < n; i++) if (await all.nth(i).isVisible()) return all.nth(i);
  return null;
}

async function setWindowSize(app, w, h) {
  return app.evaluate(({ BrowserWindow }, [width, height]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    if (win.isMaximized()) win.unmaximize();
    win.setMinimumSize(Math.min(600, width), Math.min(500, height));
    win.setSize(width, height);
    return win.getSize();
  }, [w, h]);
}

async function waitForApp(page, timeout = 90_000) {
  await page.waitForSelector('[data-testid="first-run"], [data-testid="shell"]', { timeout });
}

/** Past first run, for a step run on its own (--only): Skip, as a person who has been here before would. */
async function pastOnboarding(page) {
  const fr = page.locator('[data-testid="first-run"]');
  if (!(await fr.isVisible().catch(() => false))) return;
  if (await page.locator('[data-testid="first-run-back"]').isVisible().catch(() => false)) await page.locator('[data-testid="first-run-back"]').click();
  await page.locator('[data-testid="first-run-skip"]').click({ timeout: 15_000 });
  await fr.waitFor({ state: 'hidden', timeout: 15_000 });
}

/** Open a folder by typing its path into the Open project dialog; answers the status once it is attached (or not). */
async function attachViaUi(page, dir) {
  await openAttach(page);
  await page.locator('[data-testid="attach-path"]').fill(dir);
  await page.locator('[data-testid="attach-path-open"]').click();
  const st = await waitAttached(page, dir, 90_000);
  await page.waitForLoadState('load').catch(() => {});
  await waitForApp(page, 60_000).catch(() => {});
  return st;
}

/** Close Settings or any other overlay that would sit over the shell. */
async function closeOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const sel of ['.v3-overlay-close', '[data-testid="attach-close"]']) {
    const b = await firstVisible(page, sel).catch(() => null);
    if (b) await b.click().catch(() => {});
  }
}

async function openAttach(page) {
  await closeOverlays(page);
  if (await page.locator('[data-testid="attach"]').isVisible().catch(() => false)) return;
  const btn = await firstVisible(page, '[data-testid="v3-rail-open-project"]');
  if (!btn) throw new Error('no visible "Open project" control (v3-rail-open-project)');
  await btn.click();
  await page.locator('[data-testid="attach"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function waitAttached(page, dir, timeout) {
  const until = Date.now() + timeout;
  let last = null;
  while (Date.now() < until) {
    try {
      last = await status(page);
      if (last?.attached && last.root && sameDir(last.root, dir)) return last;
    } catch {
      /* the server restarts on a desktop attach */
    }
    await sleep(1000);
  }
  return last;
}

/* ── the steps ───────────────────────────────────────────────────────────── */

const CONNECT_TEXT = 'release smoke: explain the entry point';
const TERM_MARK = 'SEQSMOKE_MARK_0123456789';
const TERM_MARK2 = 'SEQSMOKE_AFTER_RESIZE_9876543210';

function makeSteps(ctx) {
  const { page, app, s } = ctx;
  return {
    async a() {
      const fr = page.locator('[data-testid="first-run"]');
      await fr.waitFor({ state: 'visible', timeout: 90_000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="first-run-options"]')?.getAttribute('aria-busy') !== 'true', null, { timeout: 45_000 }).catch(() => {});
      const opts = await page.$$eval('[data-testid="first-run-option"]', (els) => els.map((e) => ({ route: e.getAttribute('data-option'), state: e.getAttribute('data-state'), ready: e.getAttribute('data-ready') === 'true' })));
      if (s.state.crashed || s.state.closed) return { status: 'FAIL', reason: 'the window crashed or closed on first run' };
      const ready = opts.filter((o) => o.ready).map((o) => o.route);
      const desc = opts.map((o) => `${o.route}=${o.state ?? '-'}`).join(', ');
      if (ctx.localModels.length) return { status: 'SKIP', reason: `precondition broken: a local model server answers on ${ctx.localModels.join(', ')} (onboarding shown: ${desc})` };
      if (ready.length) return { status: 'SKIP', reason: `precondition broken: ${ready.join(', ')} reads as ready in a clean profile (environment leak); ${desc}` };
      return { status: 'PASS', reason: `onboarding shown with ${opts.length} options (${desc}), nothing ready, no crash` };
    },

    async b() {
      await page.locator('[data-testid="first-run-option"][data-option="claude"]').click();
      await page.locator('[data-testid="first-run-route"][data-route="claude"]').waitFor({ timeout: 15_000 });
      const model = page.locator('[data-testid="first-run-model"]');
      try {
        await model.waitFor({ state: 'visible', timeout: 20_000 });
      } catch {
        const st = await page.locator('[data-testid="first-run-provider"]').getAttribute('data-state').catch(() => null);
        return { status: 'FAIL', reason: `no "Connect a model" (first-run-model) on the Claude route (provider state ${st ?? 'unknown'})` };
      }
      await model.click();
      await sleep(700);
      const step = await page.locator('[data-testid="first-run"]').getAttribute('data-step');
      const route = await page.locator('[data-testid="first-run-route"]').getAttribute('data-route').catch(() => null);
      if (step === 'pick') return { status: 'FAIL', reason: '"Connect a model" returned to the picker (data-step=pick)' };
      if (route !== 'local' && route !== 'key') return { status: 'FAIL', reason: `"Connect a model" landed on step=${step} route=${route}, not the local/key model route` };
      return { status: 'PASS', reason: `"Connect a model" -> step=${step}, route=${route}` };
    },

    async c() {
      if (await page.locator('[data-testid="first-run-back"]').isVisible().catch(() => false)) await page.locator('[data-testid="first-run-back"]').click();
      await page.locator('[data-testid="first-run-skip"]').click({ timeout: 15_000 });
      await page.locator('[data-testid="first-run"]').waitFor({ state: 'hidden', timeout: 15_000 });
      const field = page.locator('[data-testid="composer-field"]').first();
      await field.waitFor({ state: 'visible', timeout: 30_000 });
      await field.click();
      await field.fill('');
      await page.keyboard.type(CONNECT_TEXT, { delay: 5 });
      await page.keyboard.press('Enter');
      const card = page.locator('[data-testid="connect-to-run"]').first();
      try {
        await card.waitFor({ state: 'visible', timeout: 8000 });
      } catch {
        const send = page.locator('[data-testid="composer-send"]').first();
        if (await send.isEnabled().catch(() => false)) await send.click();
        try {
          await card.waitFor({ state: 'visible', timeout: 15_000 });
        } catch {
          const banner = (await page.locator('body').innerText()).match(/AI provider not configured[^\n]*/)?.[0];
          return { status: 'FAIL', reason: `no "Connect a model to run this" card after send${banner ? `; the page says "${banner}"` : ''}` };
        }
      }
      const cardText = await card.innerText();
      const fieldValue = await field.inputValue().catch(() => '');
      const queued = await page.locator('[data-testid="composer-queued"]').innerText().catch(() => '');
      /* Kept means still on screen to run: in the field, the card, the queue, or as the waiting message in the chat. */
      const chat = await page.locator('[data-testid="s2-chat"]').first().innerText().catch(() => '');
      const kept = fieldValue.includes(CONNECT_TEXT) || cardText.includes(CONNECT_TEXT) || queued.includes(CONNECT_TEXT) || chat.includes(CONNECT_TEXT);
      if (!/connect a model/i.test(cardText)) return { status: 'FAIL', reason: `the card shows but does not say "Connect a model": "${cardText.slice(0, 120)}"` };
      return kept
        ? { status: 'PASS', reason: `card "${norm(cardText).slice(0, 60)}..." shown; the typed text is kept` }
        : { status: 'FAIL', reason: 'the card shows but the typed text is gone (not in the field, the card, the queue or the chat)' };
    },

    async d() {
      const st = await attachViaUi(page, ctx.smallRepo);
      const inside = Boolean(st?.attached && sameDir(st.root, ctx.smallRepo));
      await sleep(1500);
      await page.screenshot({ path: ctx.shot('d1-inside-home') }).catch(() => {});
      await openAttach(page);
      await page.locator('[data-testid="attach-path"]').fill(ctx.outsideDir);
      await page.locator('[data-testid="attach-path-open"]').click();
      const fail = page.locator('[data-testid="attach-failure"]');
      let refusal = '';
      try {
        await fail.waitFor({ state: 'visible', timeout: 20_000 });
        refusal = await fail.innerText();
      } catch {
        /* none */
      }
      const dialogText = await page.locator('[data-testid="attach"]').innerText().catch(() => '');
      const words = internalWordsIn(dialogText);
      const still = await status(page).catch(() => null);
      await page.locator('[data-testid="attach-close"]').click().catch(() => page.keyboard.press('Escape'));
      const why = [];
      if (!inside) why.push(`inside-home open did not attach (status root ${st?.root ?? 'none'})`);
      if (!refusal) why.push('outside-home showed no refusal');
      if (words.length) why.push(`internal words in the UI: ${words.join(', ')}`);
      if (refusal && !/home folder/i.test(refusal)) why.push(`the refusal does not say "home folder": "${norm(refusal).slice(0, 140)}"`);
      if (still?.root && !sameDir(still.root, ctx.smallRepo)) why.push(`outside-home attach changed the open repo to ${still.root}`);
      return why.length ? { status: 'FAIL', reason: why.join('; ') } : { status: 'PASS', reason: `inside-home attached; outside refused: "${norm(refusal).slice(0, 100)}"` };
    },

    async e() {
      if (!ctx.bare) return { status: 'FAIL', reason: 'no bare repo to clone (git not found)' };
      await openAttach(page);
      await page.locator('[data-testid="attach-clone-toggle"]').click();
      await page.locator('[data-testid="attach-clone-url"]').fill(ctx.bare.url);
      const destField = page.locator('[data-testid="attach-clone-dest"]');
      const hasDest = (await destField.count()) > 0;
      if (hasDest) await destField.fill(ctx.cloneDest);
      await page.locator('[data-testid="attach-clone-go"]').click();
      const until = Date.now() + 120_000;
      let failure = '';
      while (Date.now() < until) {
        if (fs.existsSync(path.join(ctx.cloneDest, '.git'))) break;
        if (await page.locator('[data-testid="attach-failure"]').isVisible().catch(() => false)) {
          failure = await page.locator('[data-testid="attach-failure"]').innerText().catch(() => '');
          break;
        }
        await sleep(1000);
      }
      const landed = fs.existsSync(path.join(ctx.cloneDest, 'README.md')) && fs.readFileSync(path.join(ctx.cloneDest, 'README.md'), 'utf8').includes(ctx.bare.marker);
      const elsewhere = landed ? null : findMarker(ctx.home, ctx.bare.marker, 4);
      await page.screenshot({ path: ctx.shot('e1-after-clone') }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForLoadState('load').catch(() => {});
      await waitForApp(page, 60_000).catch(() => {});
      if (!hasDest) return { status: 'FAIL', reason: `no destination field (attach-clone-dest) to choose a folder${elsewhere ? `; the clone went to ${elsewhere}` : failure ? `; the app said "${norm(failure).slice(0, 120)}"` : ''}` };
      if (landed) return { status: 'PASS', reason: `cloned ${ctx.bare.url} into exactly ${ctx.cloneDest}` };
      return { status: 'FAIL', reason: `the clone is not in ${ctx.cloneDest}${elsewhere ? ` (it is in ${elsewhere})` : ''}${failure ? `; the app said "${norm(failure).slice(0, 140)}"` : ''}` };
    },

    async f() {
      await page.keyboard.press('Escape').catch(() => {});
      const seq = ['files', 'whiteboard', 'terminal', 'agents'];
      const counts = [];
      const missing = [];
      for (const id of seq) {
        const tab = page.locator(`[data-testid="s2-tab-${id}"]`).first();
        if (!(await tab.isVisible().catch(() => false))) {
          missing.push(id);
          counts.push(null);
          continue;
        }
        await tab.click();
        await sleep(700);
        counts.push(await visibleCount(page, '[data-surface-pane]'));
      }
      const label = seq.map((id, i) => `${id}:${counts[i] ?? 'missing'}`).join(' ');
      if (missing.length) return { status: 'FAIL', reason: `tab not on screen: ${missing.join(', ')} (${label})` };
      const max = Math.max(...counts);
      const last = counts[counts.length - 1];
      return max <= 1 && last === 1 ? { status: 'PASS', reason: `panes after each click ${label}` } : { status: 'FAIL', reason: `panes after each click ${label} (want exactly one)` };
    },

    async g() {
      const tab = page.locator('[data-testid="s2-tab-terminal"]').first();
      const surface = page.locator('[data-testid="terminal-pane-surface"]').first();
      if (!(await surface.isVisible().catch(() => false))) await tab.click();
      if (!(await surface.isVisible().catch(() => false))) {
        await sleep(500);
        if (!(await surface.isVisible().catch(() => false))) await tab.click();
      }
      await surface.waitFor({ state: 'visible', timeout: 20_000 });
      const text = async () => (await surface.innerText().catch(() => '')).replace(/ /g, ' ');
      const until = Date.now() + 30_000;
      while (Date.now() < until && (await text()).trim() === '') await sleep(500);
      if ((await text()).trim() === '') return { status: 'FAIL', reason: 'the terminal never showed any text (no prompt within 30 s)' };
      await surface.click();
      await page.keyboard.type(`echo ${TERM_MARK}`, { delay: 15 });
      await page.keyboard.press('Enter');
      await sleep(2500);
      /* Two readings of "re-flows cleanly": the echoed output is one whole line, and the typed command is intact once
         the wrapped rows are joined. A stale fragment of the prompt inside the command (the audit's garbling) breaks
         the second. */
      const lineHasMark = async () => (await text()).split(/\r?\n/).some((l) => l.trim() === TERM_MARK);
      const commandIntact = async () => (await text()).replace(/\r?\n/g, '').includes(`echo ${TERM_MARK}`);
      const before = await lineHasMark();
      const typedOk = await commandIntact();
      const narrow = await setWindowSize(app, 780, 900);
      await sleep(2000);
      await page.screenshot({ path: ctx.shot('g1-terminal-780') }).catch(() => {});
      const aliveNarrow = await withTimeout(page.evaluate(() => 1), 5000, 'renderer').then(() => true, () => false);
      const textNarrow = (await text()).trim().length > 0;
      const wide = await setWindowSize(app, 1440, 900);
      await sleep(2000);
      const aliveWide = await withTimeout(page.evaluate(() => 1), 5000, 'renderer').then(() => true, () => false);
      const after = await lineHasMark();
      const typedAfter = await commandIntact();
      /* The audit's order too: keystrokes typed AFTER the resize arrive whole. */
      await surface.click().catch(() => {});
      await page.keyboard.type(`echo ${TERM_MARK2}`, { delay: 15 });
      await page.keyboard.press('Enter');
      await sleep(2500);
      const flat = (await text()).replace(/\r?\n/g, '');
      const typed2 = flat.includes(`echo ${TERM_MARK2}`) && (await text()).split(/\r?\n/).some((l) => l.trim() === TERM_MARK2);
      await page.screenshot({ path: ctx.shot('g2-terminal-1440') }).catch(() => {});
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setMinimumSize(960, 640)).catch(() => {});
      const why = [];
      if (!before) why.push(`"${TERM_MARK}" was not echoed on one line before the resize`);
      if (!aliveNarrow || !aliveWide || s.state.crashed) why.push('the renderer stopped answering');
      if (!textNarrow) why.push('no terminal text at 780');
      if (before && !after) why.push(`after 780 -> 1440 the echoed line is no longer intact (re-flow garbled)`);
      if (!typedOk) why.push(`the typed "echo ${TERM_MARK}" is not intact on screen (keystrokes garbled or a stale fragment inside it)`);
      else if (!typedAfter) why.push('after 780 -> 1440 the typed command is no longer intact (stale fragment)');
      if (!typed2) why.push(`"echo ${TERM_MARK2}" typed after the resize did not arrive whole (keystrokes dropped or garbled)`);
      return why.length
        ? { status: 'FAIL', reason: `${why.join('; ')} (sizes ${JSON.stringify(narrow)} -> ${JSON.stringify(wide)})` }
        : { status: 'PASS', reason: `alive at ${JSON.stringify(narrow)} and ${JSON.stringify(wide)}; the commands typed before and after are intact` };
    },

    async h() {
      const tab = page.locator('[data-testid="s2-tab-whiteboard"]').first();
      const canvas = page.locator('[data-testid="wb-canvas"]').first();
      if (!(await canvas.isVisible().catch(() => false))) await tab.click();
      try {
        await canvas.waitFor({ state: 'visible', timeout: 20_000 });
      } catch {
        return { status: 'FAIL', reason: 'the Spaces board (wb-canvas) did not open' };
      }
      const items = () => visibleCount(page, '[data-testid="wb-item"]');
      const start = await items();
      const box = await canvas.boundingBox();
      for (let k = 0; k < 2; k++) {
        await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.15);
        await page.keyboard.press('r');
        const x = box.x + box.width * (0.12 + k * 0.45);
        const y = box.y + box.height * 0.35;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + box.width * 0.3, y + Math.min(120, box.height * 0.2), { steps: 10 });
        await page.mouse.up();
        await sleep(400);
        await page.keyboard.press('Escape').catch(() => {});
      }
      const before = await items();
      if (before <= start) return { status: 'FAIL', reason: `could not draw shapes to test with (${start} -> ${before} items)` };
      await page.locator('[data-testid="wb-more"]').click();
      await page.locator('[data-testid="wb-more-clear"]').click();
      await sleep(600);
      const cleared = await items();
      await page.screenshot({ path: ctx.shot('h1-board-cleared') }).catch(() => {});
      if (cleared !== 0) return { status: 'FAIL', reason: `Clear board left ${cleared} of ${before} items` };
      let undo = page.locator('[data-testid="wb-cleared-undo"]').first();
      if (!(await undo.isVisible().catch(() => false))) {
        undo = page.locator('[role="status"]', { hasText: /cleared/i }).getByText(/undo/i).first();
      }
      try {
        await undo.waitFor({ state: 'visible', timeout: 4000 });
      } catch {
        return { status: 'FAIL', reason: `no "Board cleared · Undo" toast after Clear board (${before} items gone)` };
      }
      await undo.click();
      await sleep(800);
      const restored = await items();
      return restored === before ? { status: 'PASS', reason: `Clear removed ${before} items; Undo restored ${restored}` } : { status: 'FAIL', reason: `Undo restored ${restored} of ${before} items` };
    },

    async i() {
      await page.keyboard.press('Escape').catch(() => {});
      const field = page.locator('[data-testid="composer-field"]').first();
      await field.click();
      await field.fill('');
      await page.keyboard.type('/goal', { delay: 30 });
      const item = page.locator('[data-testid="v3-slash-item"][data-command="goal"], [data-testid="composer-slash-item"][data-command="goal"]').first();
      try {
        await item.waitFor({ state: 'visible', timeout: 10_000 });
      } catch {
        const shown = await page.$$eval('[data-testid="v3-slash-item"], [data-testid="composer-slash-item"]', (els) => els.map((e) => e.getAttribute('data-command')));
        return { status: 'FAIL', reason: `the slash menu shows no /goal item (it shows: ${shown.join(', ') || 'nothing'})` };
      }
      const hint = (await item.locator('.s2-slash-desc, .right').first().innerText().catch(() => '')) || (await item.innerText());
      await page.screenshot({ path: ctx.shot('i1-slash-menu') }).catch(() => {});
      await item.dispatchEvent('mousedown');
      await sleep(900);
      const chips = await page.$$eval('[data-testid="v3-focus-form"], [data-testid="composer-chips"], [data-testid="v3-goal"], [data-testid*="goal-chip"], [data-testid="composer-chip"]', (els) =>
        els.map((e) => [e.innerText, ...Array.from(e.querySelectorAll('input,textarea')).map((i) => `${i.getAttribute('placeholder') ?? ''} ${i.getAttribute('aria-label') ?? ''}`), e.getAttribute('title') ?? ''].join(' | ')),
      );
      await page.screenshot({ path: ctx.shot('i2-goal-chip') }).catch(() => {});
      await page.locator('[data-testid="v3-focus-cancel"]').click().catch(() => {});
      await field.fill('').catch(() => {});
      const chipText = chips.join(' || ');
      if (!norm(hint)) return { status: 'FAIL', reason: 'the /goal menu item has no text' };
      if (!chips.length) return { status: 'FAIL', reason: `picking /goal showed no chip or goal field (menu says "${hint}")` };
      return norm(chipText).includes(norm(hint))
        ? { status: 'PASS', reason: `menu and chip both say "${hint}"` }
        : { status: 'FAIL', reason: `menu says "${hint}", chip says "${norm(chipText).slice(0, 140)}"` };
    },

    async j() {
      await page.keyboard.press('Escape').catch(() => {});
      await app.evaluate(({ shell }) => {
        globalThis.__releaseSmokeOpened = [];
        shell.openExternal = async (u) => {
          globalThis.__releaseSmokeOpened.push(String(u));
        };
      });
      const btn = await firstVisible(page, '[data-testid="v3-rail-settings"], [data-testid="s2-iconrail-settings"]');
      if (!btn) return { status: 'FAIL', reason: 'no visible Settings control' };
      await btn.click();
      const overlay = page.locator('[data-testid="overlay-settings"]');
      await overlay.waitFor({ state: 'visible', timeout: 15_000 });
      await sleep(2500);
      const news = overlay.locator('[data-testid="settings-whatsnew"]');
      if (!(await news.isVisible().catch(() => false))) {
        const general = overlay.getByText(/^\s*General\s*$/).first();
        if (await general.isVisible().catch(() => false)) await general.click();
        await news.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      }
      if (!(await news.isVisible().catch(() => false))) return { status: 'FAIL', reason: "Settings shows no What's new section" };
      await news.scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: ctx.shot('j1-settings') }).catch(() => {});
      /* The app's own statement of its version (it can be four-part: build-info says 0.1.8 for a 0.1.8.1 build). */
      const versionText = await overlay.locator('[data-testid="settings-version-number"]').innerText().catch(() => '');
      const appVersion = /\d+\.\d+\.\d+(?:\.\d+)?/.exec(versionText)?.[0] ?? null;
      const items = await news.locator('[data-testid="settings-whatsnew-item"]').evaluateAll((els) =>
        els.map((e) => {
          const link = Array.from(e.querySelectorAll('a[href]')).find((x) => /read more/i.test(x.textContent ?? '') || x.getAttribute('data-testid')?.endsWith('-link'));
          return { version: e.getAttribute('data-version'), href: link ? link.href : null };
        }),
      );
      await closeOverlays(page);
      const own = items.find((it) => it.version === appVersion);
      const others = items.filter((it) => it.version && it.version !== appVersion);
      const published = [];
      for (const it of others) {
        if (!it.href) {
          published.push({ version: it.version, url: '(no link)', status: 0 });
          continue;
        }
        const r = await probeUrl(it.href);
        published.push({ version: it.version, url: it.href, status: r.status, error: r.error });
      }
      return releaseNotesVerdict({ appVersion, ownUrl: own?.href ?? null, published });
    },
  };
}

async function probeUrl(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (r.status === 405 || r.status === 403) r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    return { url, status: r.status };
  } catch (e) {
    return { url, error: e.cause?.code ?? e.message };
  }
}

function findMarker(root, marker, depth) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [d, k] = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && k < depth && e.name !== 'AppData' && e.name !== '.git') stack.push([p, k + 1]);
      else if (e.isFile() && e.name === 'README.md') {
        try {
          if (fs.readFileSync(p, 'utf8').includes(marker)) return path.dirname(p);
        } catch {
          /* unreadable */
        }
      }
    }
  }
  return null;
}

function makeBareRepo(dir, gitEnv) {
  const marker = `release-smoke-clone-${Date.now()}`;
  const work = path.join(dir, 'work');
  const bare = path.join(dir, 'source.git');
  fs.mkdirSync(work, { recursive: true });
  const git = (args, cwd) => {
    const r = spawnSync('git', ['-c', 'user.name=release-smoke', '-c', 'user.email=release-smoke@localhost', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  git(['init', '--bare', bare], dir);
  git(['init'], work);
  fs.writeFileSync(path.join(work, 'README.md'), `# cloned\n\n${marker}\n`);
  fs.mkdirSync(path.join(work, 'src'));
  fs.writeFileSync(path.join(work, 'src', 'index.ts'), 'export const hello = () => "world";\n');
  git(['add', '-A'], work);
  git(['commit', '-m', 'release smoke fixture'], work);
  git(['push', bare, 'HEAD:refs/heads/main'], work);
  return { url: pathToFileURL(bare).href, marker, path: bare };
}

/* ── the run ─────────────────────────────────────────────────────────────── */

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    log('usage: node tools/release-smoke/run.mjs [--app <exe> | --release-dir <dir>] [--out <dir>] [--only a,b,server-size] [--keep-temp]');
    return 0;
  }
  if (args.errors.length) {
    for (const e of args.errors) console.error(e);
    return 2;
  }
  const exe = args.app ? path.resolve(args.app) : packagedCandidates(args.releaseDir ? path.resolve(args.releaseDir) : path.join(DESKTOP, 'release'), PLATFORM).find((c) => fs.existsSync(c));
  if (!exe || !fs.existsSync(exe)) {
    console.error('NOT RUN  no packaged app: run `pnpm desktop:dist` first (or pass --app <path>)');
    return 2;
  }
  const electron = loadElectronDriver();
  if (!electron) {
    console.error('NOT RUN  playwright-core is not installed (pnpm install)');
    return 2;
  }
  const resDir = resourcesDir(exe, PLATFORM);
  const version = appVersion(resDir);
  const outDir = path.resolve(args.out ?? path.join(ROOT, 'tmp-shots', 'release-smoke', version));
  fs.mkdirSync(outDir, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-release-smoke-'));
  const gitDir = findGitDir();
  const wanted = (id) => !args.only || args.only.includes(id);
  const expected = [...STEPS, ...BUDGETS].map((x) => x.id).filter(wanted);
  const results = [];
  const record = (r) => {
    results.push(r);
    log(`${r.status.padEnd(4)}  ${r.id.padEnd(13)} ${r.reason}`);
  };
  const killedAll = [];
  log(`release smoke  ${exe}`);
  log(`version ${version}  shots ${outDir}  temp ${tmpRoot}`);

  /* The scale repo: a copy of this monorepo's real source, topped up to 3000 files (writeScaleRepo). */
  let scale = null;
  let scaleCount = 0;
  const synthRepoFor = (profile) => {
    const dest = path.join(profile.home, 'projects', 'scale-3k');
    if (!scale) {
      scale = path.join(tmpRoot, 'scale-3k-src');
      scaleCount = writeScaleRepo(scale, path.join(ROOT, 'packages'), 3000);
      log(`      scale repo: ${scaleCount} code files`);
    }
    fs.cpSync(scale, dest, { recursive: true });
    return dest;
  };

  try {
    /* ── budget: server size (static) ── */
    if (wanted('server-size')) {
      const serverDir = path.join(resDir, 'server');
      const exists = fs.existsSync(serverDir);
      record({ id: 'server-size', ...serverSizeVerdict(exists ? dirSize(serverDir) : 0, undefined, exists) });
    }

    /* ── budget: window shown, and the isolation control ── */
    if (wanted('window-shown')) {
      const w = await budgetWindowShown(exe, tmpRoot, gitDir, synthRepoFor);
      if (!w.isolated) {
        console.error(`ISOLATION  the app wrote no log under the temp userData ${w.profile.userData}; stopping before any interactive run`);
        record({ id: 'window-shown', status: 'FAIL', reason: 'isolation control failed: no main.log under the temp userData' });
        return finish();
      }
      record(w.result);
    }

    /* ── budget: never quits on a slow scan ── */
    if (wanted('slow-scan')) {
      const hookHonoured = bundleHasHook(resDir);
      const profile = freshProfile(tmpRoot, 'slow-scan', gitDir, hookHonoured ? { [SLOW_SCAN_HOOK]: String(SLOW_SCAN_DELAY_MS) } : {});
      setLastRepo(profile, synthRepoFor(profile));
      const started = Date.now();
      let s = null;
      let survived = false;
      let detail = '';
      const obs = { quit: false, mainAnswered: true, becameVisible: false, hiddenAfterShown: false, finalUrl: null, statusAnswered: false, bootTexts: [] };
      try {
        s = await launchSession(electron, exe, profile);
        /* The window shows a data: boot page while the engine scans (B1), so everything is read from the main
           process: visibility, the window's URL and the boot page's text. */
        const look = () =>
          withTimeout(
            s.app.evaluate(async ({ BrowserWindow }) => {
              const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
              if (!w) return { visible: false, url: null, text: '' };
              const text = await w.webContents.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => '');
              return { visible: w.isVisible(), url: w.webContents.getURL(), text: String(text).slice(0, 200) };
            }),
            8000,
            'main process',
          ).catch(() => null);
        const appStatus = async (url) => {
          try {
            const r = await fetch(`${new URL(url).origin}/api/status`, { signal: AbortSignal.timeout(5000) });
            return r.ok;
          } catch {
            return false;
          }
        };
        const deadline = started + SLOW_SCAN_DELAY_MS + 60_000;
        while (Date.now() < deadline) {
          s.tracked.snapshot();
          if (s.state.closed) {
            obs.quit = true;
            break;
          }
          const w = await look();
          if (w === null) {
            obs.mainAnswered = false;
            break;
          }
          if (w.visible) obs.becameVisible = true;
          else if (obs.becameVisible) obs.hiddenAfterShown = true;
          if (/Reading|Counting/.test(w.text)) obs.bootTexts.push(w.text.trim());
          obs.finalUrl = w.url;
          /* Past the delay, done once the window is on the app URL and the engine answers there. */
          if (Date.now() - started >= SLOW_SCAN_DELAY_MS && /^https?:\/\//.test(w.url ?? '') && (await appStatus(w.url))) {
            obs.statusAnswered = true;
            break;
          }
          await sleep(2000);
        }
        const page = s.app.windows()[0];
        if (page) await page.screenshot({ path: path.join(outDir, 'budget-slow-scan.png') }).catch(() => {});
      } catch (e) {
        obs.mainAnswered = false;
        obs.finalUrl = obs.finalUrl ?? `error: ${e.message}`;
      } finally {
        killedAll.push(...(await closeSession(s)));
      }
      ({ survived, detail } = slowScanSurvival(obs));
      record({ id: 'slow-scan', ...slowScanVerdict({ hookHonoured, survived, watchedMs: Date.now() - started, detail }) });
    }

    /* ── the steps, in one fresh profile ── */
    const stepIds = STEPS.map((x) => x.id).filter(wanted);
    const needSession = stepIds.length > 0 || wanted('repo-secrets') || wanted('key-file-mode');
    if (needSession) {
      const profile = freshProfile(tmpRoot, 'steps', gitDir);
      const smallRepo = writeSmallRepo(path.join(profile.home, 'projects', 'small-repo'));
      const outsideDir = writeSmallRepo(path.join(tmpRoot, 'outside-home', 'repo'));
      const cloneDest = path.join(profile.home, 'clones', 'landed-here');
      fs.mkdirSync(path.dirname(cloneDest), { recursive: true });
      let bare = null;
      try {
        bare = gitDir ? makeBareRepo(path.join(tmpRoot, 'git-src'), profile.env) : null;
      } catch (e) {
        log(`      (could not make the bare repo: ${e.message})`);
      }
      let s = null;
      try {
        s = await launchSession(electron, exe, profile);
        await s.app.evaluate(({ dialog }) => {
          /* No modal can block a run nobody is watching. */
          dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
          dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
          dialog.showErrorBox = (title, content) => console.log(`[release-smoke] error box: ${title}: ${content}`);
        });
        const page = await firstPage(s);
        await setWindowSize(s.app, 1440, 900);
        const shot = (name) => path.join(outDir, `${name}.png`);
        const ctx = { page, app: s.app, s, smallRepo, outsideDir, cloneDest, bare, home: profile.home, shot, localModels: await localModelAnswers() };
        const steps = makeSteps(ctx);
        await waitForApp(page).catch(() => {});
        for (const def of STEPS) {
          if (!wanted(def.id)) continue;
          let r;
          try {
            if (!['a', 'b', 'c'].includes(def.id)) await pastOnboarding(page);
            r = await withTimeout(steps[def.id](), 240_000, `step ${def.id}`);
          } catch (e) {
            r = { status: 'FAIL', reason: `error: ${String(e.message).split('\n')[0].slice(0, 300)}` };
          }
          if (s.state.crashed) r = { status: 'FAIL', reason: `the renderer crashed; ${r.reason}` };
          await page.screenshot({ path: shot(`${def.id}-${def.name.split(/[^a-z]+/i).filter(Boolean).slice(0, 4).join('-').toLowerCase()}`) }).catch(() => {});
          record({ id: def.id, ...r });
          if (s.state.closed) break;
        }

        /* ── budgets: a key saved through the app never lands in the repo ── */
        if (wanted('repo-secrets') || wanted('key-file-mode')) {
          await pastOnboarding(page).catch(() => {});
          let st = await status(page).catch(() => null);
          if (!st?.attached) st = await attachViaUi(page, smallRepo).catch(() => null);
          /* The worst case: a TRUSTED repo, where 0.1.8 wrote ai.json into <repo>/.sequence. */
          const trust = await page
            .evaluate(async () => (await fetch('/api/repo-trust', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trusted: true }) })).status)
            .catch(() => 0);
          const saved = await page
            .evaluate(async (key) => {
              const r = await fetch('/api/ai-config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', model: 'claude-release-smoke', apiKey: key }) });
              return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 200) };
            }, FAKE_KEY)
            .catch((e) => ({ ok: false, status: 0, text: e.message }));
          const roots = [...new Set([st?.root, smallRepo, cloneDest].filter(Boolean))];
          if (wanted('repo-secrets')) {
            record({
              id: 'repo-secrets',
              ...repoSecretsVerdict({
                attached: st?.attached ? st.root : null,
                trusted: trust >= 200 && trust < 300,
                trustReason: `HTTP ${trust}`,
                saved: saved.ok,
                savedReason: `HTTP ${saved.status} ${saved.text}`,
                dirs: roots.map((r) => path.join(r, '.sequence')),
              }),
            });
          }
          ctx.keySaved = saved.ok;
        }
      } catch (e) {
        log(`      session error: ${e.message}`);
        if (/^ISOLATION/.test(e.message)) {
          console.error(e.message);
          return finish(2);
        }
      } finally {
        killedAll.push(...(await closeSession(s)));
      }

      /* ── budget: the user-level key file is not readable by others ── */
      if (wanted('key-file-mode')) {
        const candidates = [path.join(profile.store, 'ai.json'), path.join(profile.userData, 'ai-keys.sealed')].filter((f) => fs.existsSync(f));
        const per = candidates.map((file) => {
          const content = fs.readFileSync(file).toString('latin1');
          const mode = PLATFORM === 'win32' ? undefined : fs.statSync(file).mode;
          const aclText = PLATFORM === 'win32' ? spawnSync('icacls', [file], { encoding: 'utf8', windowsHide: true }).stdout : undefined;
          return keyFileVerdict({ file, platform: PLATFORM, mode, aclText, content });
        });
        record({ id: 'key-file-mode', ...keyFilesVerdict(per) });
      }
    }
  } finally {
    /* Recorded per launch above; nothing here kills by name. */
  }
  return finish();

  function finish(forced) {
    const v = verdict(results, expected);
    const report = { version, app: exe, at: new Date().toISOString(), outDir, killed: killedAll, exitCode: forced ?? v.exitCode, rows: v.rows };
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    log('');
    log(formatTable(v.rows));
    log('');
    log(`${v.counts.PASS} pass, ${v.counts.FAIL} fail, ${v.counts.SKIP} skip  ->  exit ${forced ?? v.exitCode}   (report ${path.join(outDir, 'report.json')})`);
    if (killedAll.length) log(`killed our own leftovers: ${killedAll.join(', ')}`);
    if (args.keepTemp) log(`temp kept: ${tmpRoot}`);
    else {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 750 });
      } catch (e) {
        log(`temp not fully removed (${e.code}): ${tmpRoot}`);
      }
    }
    return forced ?? v.exitCode;
  }
}

process.exitCode = await main(process.argv.slice(2));
