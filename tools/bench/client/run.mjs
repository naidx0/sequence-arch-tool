#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE CLIENT BENCH - what a person feels in the PACKAGED desktop app
   tools/bench/client/run.mjs

     node tools/bench/client/run.mjs [--runs 10] [--throttle 1|4] [--fixture this|shopfront] [--out <json>]
                                     [--trace] [--build] [--exe <Sequence.exe>] [--cycles 50] [--only a,c,d,e,f]
                                     [--inject-block-ms 300] [--keep-temp]

   It measures, per run (see docs/bench/PERF-0.1.8.3.md for the method and what each number reads):
     a  cold start       process spawn to the composer accepting input, caches stripped
     b  warm start       a second launch on the same userData
     c  open time        Settings, Search, Help, Files, Board, Terminal: action to the first paint with the surface's
                         content on screen (first open, and the median of three reopenings)
     d  typing           60 characters typed into the composer while a fake answer streams; keystroke to paint
     e  frames           dropped frames scrolling a 500-turn transcript, and panning the board
     f  memory           renderer JS heap (after GC) and process-tree private bytes after N open/close cycles per overlay

   The app under test is the packaged one: `pnpm --filter @sequence/desktop exec electron-builder --dir --win`
   (--build does that), copied OUT of the repo to a temp dir because the repo's guard refuses to launch it from inside.
   Every launch has a scratch HOME, USERPROFILE, APPDATA, LOCALAPPDATA, userData and SEQUENCE_USER_DIR, fake
   claude/codex that exit 1 first on PATH, and no secret-looking variable. No real agent or account is reachable.
   ══════════════════════════════════════════════════════════════════════════ */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { reactHook } from './reacthook.mjs';
import os from 'node:os';
import path from 'node:path';

import { packagedCandidates } from '../../release-smoke/lib.mjs';
import { ROOT, PLATFORM, Tracked, arg, copyPackaged, findGitDir, freePort, machine, sameDir, scratchProfile, sleep, stripCaches, writeFakeBin, writeFixture } from './lib.mjs';
import { install } from './page.mjs';
import { droppedFrames, median, percentile, r1, summarize } from './stats.mjs';

const argv = process.argv.slice(2);
const RUNS = Number(arg(argv, '--runs', '10'));
const THROTTLE = Number(arg(argv, '--throttle', '1'));
const FIXTURE = arg(argv, '--fixture', 'shopfront');
const OUT = arg(argv, '--out', path.join(ROOT, 'tmp-shots', 'bench-client', `run-${FIXTURE}-x${THROTTLE}-${Date.now()}.json`));
const TRACE = argv.includes('--trace');
const BUILD = argv.includes('--build');
const CPUPROF = argv.includes('--cpuprofile');
const SETTLE_MS = Number(arg(argv, '--settle-ms', '10000'));
const REACTHOOK = argv.includes('--reacthook');
const KEEP = argv.includes('--keep-temp');
const CYCLES = Number(arg(argv, '--cycles', '50'));
const ONLY = new Set(String(arg(argv, '--only', 'a,b,c,d,e,f')).split(','));
const BLOCK_MS = Number(arg(argv, '--inject-block-ms', process.env.SEQUENCE_BENCH_BLOCK_MS ?? '0')) || 0;
const EXE_ARG = arg(argv, '--exe', null);
const log = (s) => process.stdout.write(`${s}\n`);
const dbg = (s) => process.env.BENCH_DEBUG && log(`  [${new Date().toISOString().slice(11, 23)}] ${s}`);

const need = (p) => {
  const require = createRequire(path.join(ROOT, p));
  return require('playwright-core');
};
const { chromium } = need('packages/web2/package.json');
const { makeTurns } = await import(new URL(`file:///${path.join(ROOT, 'tools/measure/lib/benchApp.mjs').replace(/\\/g, '/')}`).href);

/* ── the packaged app ─────────────────────────────────────────────────────── */

function buildPackaged() {
  const desktop = path.join(ROOT, 'packages', 'desktop');
  log('building the packaged app: prepare-server, then electron-builder --dir');
  let r = spawnSync(process.execPath, ['scripts/prepare-server.mjs'], { cwd: desktop, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('prepare-server failed');
  r = spawnSync('pnpm', ['exec', 'electron-builder', '--dir', ...(PLATFORM === 'win32' ? ['--win'] : [])], { cwd: desktop, stdio: 'inherit', shell: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (r.status !== 0) throw new Error('electron-builder failed');
}

function findExe() {
  if (EXE_ARG) return path.resolve(EXE_ARG);
  const dir = path.join(ROOT, 'packages', 'desktop', 'release');
  return packagedCandidates(dir, PLATFORM).find((c) => fs.existsSync(c)) ?? null;
}

/* ── driving one launch ───────────────────────────────────────────────────── */

const isAppUrl = (u, cdpPort) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u) && !u.includes(`:${cdpPort}/`);

async function connect(cdpPort, child, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the app exited with ${child.exitCode} before it could be driven`);
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 3000 });
    } catch (e) {
      last = e;
      await sleep(40);
    }
  }
  throw new Error(`could not attach over CDP: ${last?.message}`);
}

/** Throttle every page the app has or opens. */
async function throttleAll(browser, rate, sessions) {
  const apply = async (page) => {
    if (sessions.has(page)) return;
    try {
      const s = await page.context().newCDPSession(page);
      sessions.set(page, s);
      if (rate > 1) await s.send('Emulation.setCPUThrottlingRate', { rate });
    } catch {
      sessions.delete(page);
    }
  };
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) await apply(p);
    ctx.on('page', (p) => void apply(p));
  }
}

export async function appPage(browser, cdpPort, timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (isAppUrl(p.url(), cdpPort)) return p;
    await sleep(25);
  }
  throw new Error('no app window with a local URL appeared');
}

const READY = () => {
  const f = document.querySelector('[data-testid="composer-field"]');
  if (!f || document.querySelector('[data-testid="first-run"]')) return false;
  const r = f.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || f.disabled || f.readOnly) return false;
  return performance.timeOrigin + performance.now();
};

export async function launch(exe, profile, { throttle, t0Holder }) {
  const cdpPort = await freePort();
  const t0 = Date.now();
  const child = spawn(exe, [`--user-data-dir=${profile.userData}`, `--remote-debugging-port=${cdpPort}`], { env: profile.env, stdio: 'ignore', windowsHide: false });
  const tracked = new Tracked(child.pid);
  const handle = { child, tracked, cdpPort, t0, browser: null, page: null, sessions: new Map() };
  try {
    handle.browser = await connect(cdpPort, child);
    await throttleAll(handle.browser, throttle, handle.sessions);
    handle.page = await appPage(handle.browser, cdpPort);
    handle.page.on('crash', () => (handle.crashed = true));
    if (t0Holder) t0Holder.t0 = t0;
  } catch (e) {
    await shutdown(handle);
    throw e;
  }
  return handle;
}

/** Wait for the composer to accept input; ms from spawn. */
export async function composerReady(h, timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const page = await appPage(h.browser, h.cdpPort, 5000);
      h.page = page;
      const at = await page.waitForFunction(READY, null, { polling: 8, timeout: Math.min(15000, until - Date.now()) }).then((x) => x.jsonValue());
      return { ms: at - h.t0, at };
    } catch {
      /* the page navigated under the wait, or it is not there yet: look again */
    }
  }
  throw new Error('the composer never accepted input');
}

export async function shutdown(h) {
  if (!h) return [];
  dbg('shutdown');
  h.tracked.snapshot();
  /* Let go of the driver, then ask the window to close like a person would (no /F): userData is flushed. */
  await Promise.race([h.browser?.close().catch(() => {}), sleep(3000)]);
  if (PLATFORM === 'win32') spawnSync('taskkill', ['/PID', String(h.child.pid)], { windowsHide: true });
  else h.child.kill('SIGTERM');
  for (let i = 0; i < 40 && h.child.exitCode === null; i++) await sleep(250);
  await sleep(1200);
  return h.tracked.killRemaining();
}

export async function pageReady(h) {
  await h.page.evaluate(install);
}

/** The app's own files are in OUR userData (it starts empty): positive control for the isolation. */
function usesUserData(profile) {
  try {
    return fs.readdirSync(profile.userData).length > 0;
  } catch {
    return false;
  }
}

/* ── the profile: attach, seed, snapshot ──────────────────────────────────── */

async function status(origin) {
  const r = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(5000) });
  return r.json();
}

async function skipFirstRun(page) {
  const fr = page.locator('[data-testid="first-run"]');
  if (!(await fr.isVisible().catch(() => false))) return;
  if (await page.locator('[data-testid="first-run-back"]').isVisible().catch(() => false)) await page.locator('[data-testid="first-run-back"]').click();
  await page.locator('[data-testid="first-run-skip"]').click({ timeout: 20000 });
  await fr.waitFor({ state: 'hidden', timeout: 20000 });
}

async function attachViaUi(page, dir) {
  await page.waitForSelector('[data-testid="composer-field"]', { timeout: 60000 });
  await sleep(1500);
  let opened = false;
  for (let attempt = 0; attempt < 5 && !opened; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    const btns = page.locator('[data-testid="v3-rail-open-project"]');
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      if (await btns.nth(i).isVisible().catch(() => false)) {
        await btns.nth(i).click().catch(() => {});
        break;
      }
    }
    opened = await page.locator('[data-testid="attach"]').waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
  }
  if (!opened) throw new Error('the "Open project" dialog never opened (v3-rail-open-project -> attach)');
  await page.locator('[data-testid="attach-path"]').fill(dir);
  await page.locator('[data-testid="attach-path-open"]').click();
  const origin = new URL(page.url()).origin;
  const until = Date.now() + 120000;
  while (Date.now() < until) {
    try {
      const st = await status(origin);
      if (st?.attached && st.root && sameDir(st.root, dir)) return st;
    } catch {
      /* the server restarts on a desktop attach */
    }
    await sleep(800);
  }
  throw new Error(`the app did not attach ${dir}`);
}

async function seedChats(origin) {
  const make = async (title, turns, codeLines) => {
    const r = await fetch(`${origin}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const id = (await r.json()).session.id;
    const put = await fetch(`${origin}/api/sessions/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { version: 2, sessionId: id, turns: makeTurns(title, turns, codeLines) }, title }) });
    if (!put.ok) throw new Error(`seed ${title}: ${put.status} ${await put.text()}`);
    return id;
  };
  return { short: await make('Bench short 40', 40, 14), long: await make('Bench long 500', 500, 14) };
}

/** First session on a fresh profile, not measured: skip onboarding, attach the fixture the app's own way, seed chats. */
async function buildSnapshot(exe, work, env0) {
  const live = path.join(work, 'live');
  const snap = path.join(work, 'snapshot');
  const profile = scratchProfile(live, env0);
  const fx = writeFixture(FIXTURE, path.join(profile.home, 'proj', FIXTURE));
  log(`fixture ${FIXTURE}: ${fx.dest} (${fx.topLevel} top-level entries)`);
  const h = await launch(exe, profile, { throttle: 1 });
  try {
    await h.page.waitForSelector('[data-testid="first-run"], [data-testid="shell"], [data-testid="composer-field"]', { timeout: 120000 });
    await skipFirstRun(h.page);
    await attachViaUi(h.page, fx.dest);
    await sleep(3000);
    const page = await appPage(h.browser, h.cdpPort);
    await page.waitForSelector('[data-testid="composer-field"]', { timeout: 60000 });
    const origin = new URL(page.url()).origin;
    const ids = await seedChats(origin);
    await sleep(1500);
    log(`seeded chats ${ids.short} (40 turns), ${ids.long} (500 turns)`);
    await shutdown(h);
    if (!usesUserData(profile)) throw new Error('ISOLATION: the app wrote nothing into the temp userData');
  } catch (e) {
    await shutdown(h);
    throw e;
  }
  stripCaches(profile.userData);
  fs.rmSync(snap, { recursive: true, force: true });
  fs.cpSync(live, snap, { recursive: true });
  return { live, snap, profile, fixture: fx };
}

function resetProfile(snapInfo) {
  fs.rmSync(snapInfo.live, { recursive: true, force: true });
  fs.cpSync(snapInfo.snap, snapInfo.live, { recursive: true });
  stripCaches(snapInfo.profile.userData);
}

/* ── the stream stand-in ──────────────────────────────────────────────────── */

/** Replace POST /api/acp/run-node in the page with a timed SSE stream (the same frames tools/measure/stream-bench.mjs plays). */
function fakeStream({ chunkMs, chunkChars }) {
  if (window.__fakeStream) return;
  window.__fakeStream = { runs: 0 };
  const real = window.fetch.bind(window);
  const answer = (n) => `Here is pass ${n}.\n\n- the cart is summed\n- the key is built\n- \`pay()\` runs\n\n\`\`\`ts\nexport function handler${n}(req: Request) {\n  const total = req.items.reduce((s, it) => s + it.price * it.qty, 0);\n  return pay(total, { retries: 3 });\n}\n\`\`\`\n\nThat is the path through **checkout**. `;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!(init?.method === 'POST' && url.includes('/api/acp/run-node'))) return real(input, init);
    const run = ++window.__fakeStream.runs;
    const enc = new TextEncoder();
    let timer = null;
    const stream = new ReadableStream({
      start(c) {
        const send = (e) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        send({ type: 'acp:session', resumed: false, threadId: `t${run}` });
        /* The frames a real Claude turn sends (packages/acp/src/replay/claudeFixtures.ts shapes): thought chunks, a
           tool call that runs and completes, then the answer's chunks. They enter the app's own agentRuns reducer and
           ThinkingMark / ToolCallCard / markdown render path; only the server and the model are missing. */
        const upd = (u) => send({ type: 'acp:update', update: { sessionId: `t${run}`, update: u } });
        let n = 0;
        let i = 0;
        let text = answer(0);
        let step = 0;
        const preamble = (k) => {
          const id = `tool_${run}_${k}`;
          upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `Looking at how checkout reaches payments, pass ${k}. ` } });
          upd({ sessionUpdate: 'tool_call', toolCallId: id, title: `Read \`src/checkout/handler${k}.ts\``, kind: 'read', status: 'pending', locations: [{ path: `src/checkout/handler${k}.ts` }], rawInput: { file_path: `src/checkout/handler${k}.ts` } });
          upd({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: `export function handler${k}() {}` } }] });
        };
        preamble(0);
        timer = setInterval(() => {
          if (i >= text.length) {
            n += 1;
            text = answer(n);
            i = 0;
            if (n % 3 === 0) preamble(n);
          }
          step += 1;
          upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: text.slice(i, i + chunkChars) } });
          i += chunkChars;
        }, chunkMs);
        init?.signal?.addEventListener('abort', () => {
          clearInterval(timer);
          try {
            c.close();
          } catch {
            /* closed */
          }
        });
      },
      cancel() {
        clearInterval(timer);
      },
    });
    window.__fakeStream.last = { run };
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  };
}

/** A phase gets `ms`; past that its error is recorded and the run goes on (the pending call is abandoned). */
async function phase(rec, h, name, ms, fn) {
  const t = Date.now();
  dbg(`phase ${name}`);
  let timer;
  try {
    return await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`phase ${name} exceeded ${Math.round(ms / 1000)}s`)), ms)))]);
  } catch (e) {
    rec.phaseErrors = { ...rec.phaseErrors, [name]: String(e.message ?? e).slice(0, 400) };
    const probe = await Promise.race([
      h.page.evaluate(() => {
        const f = document.querySelector('[data-testid="composer-field"]');
        const r = f?.getBoundingClientRect();
        const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
        return { fieldRect: r ? [r.x, r.y, r.width, r.height] : null, hit: hit ? hit.outerHTML.slice(0, 240) : null, scrim: document.querySelector('.v3-overlay-scrim')?.getAttribute('data-kind') ?? null, streams: window.__fakeStream?.runs ?? 0, long: window.__b?.long?.slice(-5) ?? null, text: document.body.innerText.slice(-300) };
      }),
      sleep(4000).then(() => 'page.evaluate did not answer in 4 s (renderer blocked)'),
    ]).catch((x) => `probe failed: ${x.message}`);
    rec.phaseErrors[name] += ' | page: ' + JSON.stringify(probe).slice(0, 900);
    const shot = OUT.replace(/\.json$/, '') + `.fail-run${rec.run}-${name}.png`;
    await Promise.race([h.page.screenshot({ path: shot, timeout: 5000 }).then(() => (rec.phaseErrors[name] += ` (screenshot ${path.basename(shot)})`)), sleep(6000)]).catch(() => {});
    log(`  phase ${name} failed after ${Math.round((Date.now() - t) / 1000)}s: ${String(e.message ?? e).split(String.fromCharCode(10))[0].slice(0, 200)}`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/* ── the measurements ─────────────────────────────────────────────────────── */

const SURFACES = [
  { id: 'settings', marker: '[data-testid="settings-body"]', absent: '[data-testid="settings-loading"]', overlay: true },
  { id: 'search', marker: '[data-testid="search-query"]', overlay: true },
  { id: 'help', marker: '[data-testid="help"]', overlay: true },
  { id: 'files', marker: '[data-testid="files-panel"]', tab: 'files' },
  { id: 'board', action: 'architecture', marker: '[data-testid="board"] .react-flow__node', tab: 'architecture' },
  { id: 'spaces', action: 'whiteboard', marker: '[data-testid="wb-canvas"]', tab: 'whiteboard' },
  { id: 'terminal', marker: '[data-testid="terminal-pane-surface"]', tab: 'terminal' },
];

async function openOnce(page, s) {
  await page.evaluate((k) => window.__b.prepare(k), s.action ?? s.id);
  /* let the prepare's own work settle off the timed path */
  await sleep(250);
  return page.evaluate(([k, m, a]) => window.__b.openTime(k, m, a), [s.action ?? s.id, s.marker, s.absent ?? null]);
}

async function resetSurface(page, s) {
  if (s.overlay) {
    const ok = await page.evaluate(() => window.__b.closeAny());
    await sleep(150);
    return ok;
  }
  /* a surface tab: go back to Files-less state by closing the pane with its tab, if the tab toggles; else pick another */
  const other = s.tab === 'agents' ? 'files' : 'agents';
  await page.evaluate((t) => document.querySelector(`[data-testid="s2-tab-${t}"]`)?.click(), other);
  await sleep(500);
  return true;
}

async function measureOpens(h) {
  const page = h.page;
  const out = {};
  for (const s of SURFACES) {
    dbg(`open ${s.id}`);
    if (s.tab) await resetSurface(page, s);
    const first = await openOnce(page, s);
    const reopen = [];
    await resetSurface(page, s);
    for (let i = 0; i < 3; i++) {
      const r = await openOnce(page, s);
      reopen.push(r.ms);
      await resetSurface(page, s);
    }
    out[s.id] = { first: first.ms, reopen: median(reopen), error: first.error };
  }
  await page.evaluate(() => window.__b.closeAny());
  return out;
}

async function selectChat(page, title) {
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate((t) => {
      const row = Array.from(document.querySelectorAll('[data-testid="s2-session"]')).find((r) => (r.querySelector('.s2-t')?.textContent ?? '').trim() === t);
      const hit = row?.querySelector('.s2-it-hit');
      if (!hit) return false;
      hit.click();
      return true;
    }, title);
    if (ok) {
      await sleep(1200);
      return true;
    }
    await sleep(250);
  }
  return false;
}

function focusComposer() {
  const f = document.querySelector('[data-testid="composer-field"]');
  if (!f) throw new Error('no composer-field');
  f.focus();
  return true;
}

function clearComposer() {
  const f = document.querySelector('[data-testid="composer-field"]');
  if (!f) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, '');
  f.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

async function measureTyping(h, title = 'Bench short 40') {
  const page = h.page;
  if (!(await selectChat(page, title))) return { error: `${title} not found in the rail` };
  await page.evaluate(fakeStream, { chunkMs: 50, chunkChars: 18 });
  /* no locators in the measured path: Playwright's locator world can wedge on this page; evaluate and raw input do not */
  await page.evaluate(focusComposer);
  await page.keyboard.type('go', { delay: 20 });
  await page.keyboard.press('Enter');
  await sleep(2500);
  const streaming = await page.evaluate(() => window.__fakeStream?.runs ?? 0);
  await page.evaluate(focusComposer);
  await page.evaluate(() => {
    window.__b.events.length = 0;
    window.__b.long.length = 0;
    window.__b.watchKeys(true);
    window.__b.startFrames();
  });
  const text = 'where does checkout call payments and why is retry three';
  const prof = CPUPROF ? [...h.sessions.values()][0] : null;
  if (REACTHOOK) await page.evaluate(() => window.__rc.reset());
  if (prof) {
    await prof.send('Profiler.enable');
    await prof.send('Profiler.setSamplingInterval', { interval: 200 });
    await prof.send('Profiler.start');
  }
  await page.keyboard.type(text.slice(0, 60).padEnd(60, '.'), { delay: 45 });
  await sleep(500);
  if (prof) {
    const { profile } = await prof.send('Profiler.stop');
    const fp = OUT.replace(/\.json$/, '') + `.${title.includes('long') ? 'long' : 'short'}.cpuprofile`;
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(profile));
  }
  if (REACTHOOK) {
    const rc = await page.evaluate(() => window.__rc.dump());
    const fp = OUT.replace(/\.json$/, '') + `.${title.includes('long') ? 'long' : 'short'}.react.json`;
    fs.writeFileSync(fp, JSON.stringify(rc, null, 1));
  }
  const r = await page.evaluate(() => {
    window.__b.watchKeys(false);
    return { keys: window.__b.keys.slice(), frames: window.__b.stopFrames(), events: window.__b.events.slice(), long: window.__b.long.slice() };
  });
  /* positive control: the stand-in's frames reached the transcript through the app's own path */
  const shown = await page.evaluate(() => {
    const t = document.body.innerText;
    return { answer: t.includes('Here is pass'), tool: /handler0\.ts/.test(t), thought: /Looking at how checkout/.test(t) };
  });
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await page.evaluate(clearComposer).catch(() => {});
  const keyEvents = r.events.filter((e) => e.name === 'keydown' || e.name === 'keypress' || e.name === 'keyup' || e.name === 'input');
  const byInteraction = new Map();
  for (const e of keyEvents) byInteraction.set(e.interactionId || `${e.name}-${e.start}`, Math.max(byInteraction.get(e.interactionId) ?? 0, e.duration));
  const inter = [...byInteraction.values()].sort((a, b) => b - a);
  return {
    streaming: streaming > 0,
    shown,
    keystrokes: r.keys.length,
    keyP50: r1(median(r.keys)),
    keyP95: r1(percentile(r.keys, 0.95)),
    keyMax: r1(Math.max(0, ...r.keys)),
    inpMs: inter.length ? r1(inter[Math.min(inter.length - 1, Math.floor(60 / 50))]) : 0,
    slowInteractions16: inter.length,
    frames: droppedFrames(r.frames, period(r.frames)),
    longTasks: r.long.length,
    longTaskMaxMs: r1(Math.max(0, ...r.long)),
  };
}

/** The display's frame period: the median rAF delta, never under 16.6 ms. */
const period = (deltas) => Math.max(16.6, median(deltas) ?? 16.7);

async function measureFrames(h) {
  const page = h.page;
  const out = {};
  if (await selectChat(page, 'Bench long 500')) {
    await sleep(1500);
    const sc = await page.evaluate(() => window.__b.scroller('[data-testid="s2-chat"]'));
    if (sc) {
      await page.mouse.move(sc.x, sc.y);
      await page.evaluate(() => window.__b.startFrames());
      const before = await page.evaluate(() => window.__b.scrollTop());
      let mid = before;
      for (let i = 0; i < 120; i++) {
        await page.mouse.wheel(0, i < 60 ? -140 : 140);
        await sleep(12);
        if (i === 59) mid = await page.evaluate(() => window.__b.scrollTop());
      }
      await sleep(200);
      const frames = await page.evaluate(() => window.__b.stopFrames());
      const after = await page.evaluate(() => window.__b.scrollTop());
      out.transcript = { ...droppedFrames(frames, period(frames)), periodMs: r1(period(frames)), frameP95: r1(percentile(frames, 0.95)), frameMax: r1(Math.max(0, ...frames)), scrolledPx: Math.abs((mid ?? 0) - (before ?? 0)), room: sc.room };
    } else out.transcript = { error: 'no scrollable transcript found' };
  } else out.transcript = { error: 'long chat not found in the rail' };

  /* the board: the architecture graph of the attached repo, panned by dragging the pane */
  const clicked = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="s2-tab-architecture"]');
    if (!t) return false;
    t.click();
    return true;
  });
  if (clicked) {
    try {
      let box = null;
      for (let i = 0; i < 300 && !box; i++) {
        box = await page.evaluate(() => {
          const n = document.querySelector('[data-testid="board"] .react-flow__node');
          const bd = document.querySelector('[data-testid="board"]');
          if (!n || !bd) return null;
          const r = bd.getBoundingClientRect();
          return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
        });
        if (!box) await sleep(100);
      }
      if (!box) throw new Error('the board never showed a node');
      await sleep(1500);
      const probe = () => page.evaluate(() => document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null);
      const p0 = await probe();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height * 0.85;
      await page.evaluate(() => window.__b.startFrames());
      for (let k = 0; k < 6; k++) {
        const dir = k % 2 ? -1 : 1;
        await page.mouse.move(cx - dir * 150, cy);
        await page.mouse.down();
        for (let i = 1; i <= 30; i++) {
          await page.mouse.move(cx - dir * 150 + dir * i * 10, cy - i * 3);
          await sleep(8);
        }
        await page.mouse.up();
      }
      await sleep(200);
      const frames = await page.evaluate(() => window.__b.stopFrames());
      const p1 = await probe();
      out.boardPan = { ...droppedFrames(frames, period(frames)), periodMs: r1(period(frames)), frameP95: r1(percentile(frames, 0.95)), frameMax: r1(Math.max(0, ...frames)), moved: p0 !== p1 };
    } catch (e) {
      out.boardPan = { error: String(e).slice(0, 200) };
    }
  } else out.boardPan = { error: 'no board tab' };
  return out;
}

async function heapMB(h) {
  const s = [...h.sessions.values()][0];
  await s.send('HeapProfiler.enable').catch(() => {});
  for (let i = 0; i < 3; i++) await s.send('HeapProfiler.collectGarbage').catch(() => {});
  const u = await s.send('Runtime.getHeapUsage');
  return u.usedSize / 1048576;
}

/** Chromium's own counters, after GCs: DOM nodes, documents and JS event listeners alive in the renderer. */
async function domCounters(h) {
  const s = [...h.sessions.values()][0];
  for (let i = 0; i < 3; i++) await s.send('HeapProfiler.collectGarbage').catch(() => {});
  const c = await s.send('Memory.getDOMCounters');
  return { nodes: c.nodes, listeners: c.jsEventListeners, documents: c.documents };
}

async function measureMemory(h) {
  const page = h.page;
  if (![...h.sessions.values()].length) await throttleAll(h.browser, 1, h.sessions);
  const out = {};
  for (const s of SURFACES.filter((x) => x.overlay)) {
    await page.evaluate(() => window.__b.closeAny());
    const heap0 = await heapMB(h);
    const dom0 = await domCounters(h);
    const nodes0 = (await page.evaluate(() => window.__b.memory())).nodes;
    const mem0 = h.tracked.privateBytes();
    const fails = await page.evaluate(([k, m, ab, n]) => window.__b.cycles(k, m, ab, n), [s.action ?? s.id, s.marker, s.absent ?? null, CYCLES]);
    await sleep(500);
    const heap1 = await heapMB(h);
    const dom1 = await domCounters(h);
    const nodes1 = (await page.evaluate(() => window.__b.memory())).nodes;
    const mem1 = h.tracked.privateBytes();
    out[s.id] = {
      heapBeforeMB: r1(heap0),
      heapAfterMB: r1(heap1),
      heapDeltaMB: r1(heap1 - heap0),
      domNodesDelta: nodes1 - nodes0,
      counterNodesDelta: dom1.nodes - dom0.nodes,
      listenersDelta: dom1.listeners - dom0.listeners,
      documentsDelta: dom1.documents - dom0.documents,
      privateAfterMB: r1(mem1.privateBytes / 1048576),
      privateDeltaMB: r1((mem1.privateBytes - mem0.privateBytes) / 1048576),
      processes: mem1.processes,
      cycles: CYCLES,
      failedOpens: fails,
    };
  }
  return out;
}

/* ── one run ──────────────────────────────────────────────────────────────── */

async function oneRun(index, exe, snapInfo, work) {
  const rec = { run: index + 1 };
  resetProfile(snapInfo);
  const profile = snapInfo.profile;
  let h = await launch(exe, profile, { throttle: THROTTLE });
  try {
    dbg('launched, waiting for the composer');
    const cold = await composerReady(h);
    dbg(`cold ready ${cold.ms}`);
    rec.coldStartMs = r1(cold.ms);
    h.readyAt = Date.now();
    if (!usesUserData(profile)) throw new Error('ISOLATION: the app wrote nothing into the temp userData');
    await sleep(1500);
    h.page = await appPage(h.browser, h.cdpPort);
    h.page.setDefaultTimeout(8000);
    await pageReady(h);
    if (REACTHOOK) {
      /* profiling build only: install the commit recorder before the app loads, then load it again */
      await h.page.addInitScript(reactHook);
      await h.page.reload();
      await composerReady(h);
      await sleep(1500);
      h.page = await appPage(h.browser, h.cdpPort);
      h.page.setDefaultTimeout(8000);
      await pageReady(h);
    }
    if (BLOCK_MS) await h.page.evaluate((ms) => localStorage.setItem('sequence.bench.blockMs', String(ms)), BLOCK_MS);
    if (TRACE && index === 0) await h.browser.startTracing(h.page, { categories: ['devtools.timeline', 'v8.execute', 'blink.user_timing', 'latencyInfo', 'disabled-by-default-devtools.timeline'] }).catch((e) => log(`trace not started: ${e.message}`));
    dbg('helper installed');
    if (ONLY.has('c')) rec.open = await phase(rec, h, 'open', 360000, () => measureOpens(h));
    /* The backdrop draws the other room's mosaic about 4 s after boot, sliced into idle time (AsciiStage); a typing or
       scroll window that catches it measures that, not the interaction. Start the interaction phases 10 s after ready. */
    const settle = () => sleep(Math.max(0, SETTLE_MS - (Date.now() - h.readyAt)));
    if (ONLY.has('d')) {
      await settle();
      rec.typing = await phase(rec, h, 'typing', 150000, () => measureTyping(h));
      rec.typingLong = await phase(rec, h, 'typingLong', 150000, () => measureTyping(h, 'Bench long 500'));
    }
    if (ONLY.has('e')) await settle();
    if (ONLY.has('e')) rec.frames = await phase(rec, h, 'frames', 180000, () => measureFrames(h));
    if (ONLY.has('f')) rec.memory = await phase(rec, h, 'memory', 40000 + CYCLES * 3 * 3000, () => measureMemory(h));
    if (TRACE && index === 0) {
      const buf = await h.browser.stopTracing().catch(() => null);
      if (buf) {
        const tp = OUT.replace(/\.json$/, '') + '.trace.json';
        fs.mkdirSync(path.dirname(tp), { recursive: true });
        fs.writeFileSync(tp, buf);
        rec.trace = tp;
      }
    }
    rec.crashed = !!h.crashed;
  } finally {
    rec.killedAfterCold = (await shutdown(h)).length;
  }
  if (ONLY.has('b')) {
    h = await launch(exe, profile, { throttle: THROTTLE });
    try {
      const warm = await composerReady(h);
      rec.warmStartMs = r1(warm.ms);
      await sleep(2500);
    } finally {
      rec.killedAfterWarm = (await shutdown(h)).length;
    }
  }
  return rec;
}

/* ── the summary ──────────────────────────────────────────────────────────── */

function flatten(rec) {
  const m = {};
  const put = (k, v) => {
    if (typeof v === 'number' && Number.isFinite(v)) m[k] = v;
  };
  put('coldStartMs', rec.coldStartMs);
  put('warmStartMs', rec.warmStartMs);
  for (const [id, o] of Object.entries(rec.open ?? {})) {
    put(`open.${id}.firstMs`, o.first);
    put(`open.${id}.reopenMs`, o.reopen);
  }
  for (const [name, t] of [['typing', rec.typing ?? {}], ['typingLong', rec.typingLong ?? {}]]) {
    for (const k of ['keyP50', 'keyP95', 'keyMax', 'inpMs', 'longTasks', 'longTaskMaxMs']) put(`${name}.${k}`, t[k]);
    put(`${name}.droppedFrames`, t.frames?.dropped);
  }
  for (const k of ['transcript', 'boardPan']) {
    const f = rec.frames?.[k] ?? {};
    put(`frames.${k}.dropped`, f.dropped);
    put(`frames.${k}.frameP95Ms`, f.frameP95);
    put(`frames.${k}.frameMaxMs`, f.frameMax);
  }
  for (const [id, o] of Object.entries(rec.memory ?? {})) {
    put(`memory.${id}.heapAfterMB`, o.heapAfterMB);
    put(`memory.${id}.heapDeltaMB`, o.heapDeltaMB);
    put(`memory.${id}.privateAfterMB`, o.privateAfterMB);
    put(`memory.${id}.privateDeltaMB`, o.privateDeltaMB);
    put(`memory.${id}.counterNodesDelta`, o.counterNodesDelta);
    put(`memory.${id}.listenersDelta`, o.listenersDelta);
    put(`memory.${id}.documentsDelta`, o.documentsDelta);
  }
  return m;
}

export function summarizeRuns(runs) {
  const series = {};
  for (const r of runs) for (const [k, v] of Object.entries(flatten(r))) (series[k] ??= []).push(v);
  return Object.fromEntries(Object.entries(series).map(([k, xs]) => [k, (({ n, median: m, p95, min, max }) => ({ n, median: r1(m), p95: r1(p95), min: r1(min), max: r1(max) }))(summarize(xs))]));
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main() {
  if (BUILD) buildPackaged();
  const exe0 = findExe();
  if (!exe0 || !fs.existsSync(exe0)) {
    console.error('NOT RUN  no packaged app: run with --build, or `pnpm --filter @sequence/desktop exec electron-builder --dir --win` (after prepare-server), or pass --exe');
    process.exit(2);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-clientbench-'));
  log(`scratch ${work}`);
  const exe = copyPackaged(exe0, work);
  const fakeBin = writeFakeBin(path.join(work, 'fakebin'));
  const env0 = { gitDir: findGitDir(), fakeBin };
  const meta = {
    when: new Date().toISOString(),
    args: { runs: RUNS, throttle: THROTTLE, fixture: FIXTURE, cycles: CYCLES, only: [...ONLY], injectBlockMs: BLOCK_MS, trace: TRACE },
    machine: machine(),
    git: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
    app: exe0,
    appBuiltAt: fs.statSync(exe0).mtime.toISOString(),
    notes: [
      'start metrics: t0 is just before spawn; CDP attaches within ~100 ms and the throttle is applied to the renderer from then on (main and server process are not throttled)',
      'typing/typingLong: a stand-in for POST /api/acp/run-node streams ACP frames (thought, tool_call, tool_call_update, 18-char message chunks every 50 ms) inside the page into the own agentRuns path of the app; no model, no agent. typing = 40-turn chat, typingLong = 500-turn chat',
    ],
  };
  const killed = [];
  const runs = [];
  try {
    const snapInfo = await buildSnapshot(exe, work, env0);
    for (let i = 0; i < RUNS; i++) {
      const t = Date.now();
      let rec;
      try {
        rec = await oneRun(i, exe, snapInfo, work);
      } catch (e) {
        rec = { run: i + 1, error: String(e.stack ?? e).slice(0, 800) };
      }
      runs.push(rec);
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT.replace(/\.json$/, '') + '.partial.json', JSON.stringify({ meta, runs }, null, 2));
      log(`run ${i + 1}/${RUNS} ${Math.round((Date.now() - t) / 1000)}s  cold ${rec.coldStartMs ?? '-'}  warm ${rec.warmStartMs ?? '-'}  ${rec.error ? 'ERROR ' + rec.error.split('\n')[0] : ''}`);
    }
  } finally {
    if (!KEEP) fs.rmSync(work, { recursive: true, force: true });
  }
  const good = runs.filter((r) => !r.error);
  const result = { meta, runs, summary: summarizeRuns(good), failedRuns: runs.length - good.length, killed };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`wrote ${OUT}`);
  for (const [k, v] of Object.entries(result.summary)) log(`${k.padEnd(34)} median ${String(v.median).padStart(8)}  p95 ${String(v.p95).padStart(8)}  min ${String(r1(v.min)).padStart(8)}  max ${String(r1(v.max)).padStart(8)}  n=${v.n}`);
  process.exit(result.failedRuns ? 1 : 0);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
