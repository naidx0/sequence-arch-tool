#!/usr/bin/env node
/*
 * Re-record the 0.1.4 demo media: eleven short clips, key-frame stills and the
 * two stitched tours (hero cut and full). One script, one flag per clip.
 *
 *   node tools/demo/record-014.mjs --clip workspaces          one clip (video + its stills)
 *   node tools/demo/record-014.mjs --clip whiteboard-draw,files   several
 *   node tools/demo/record-014.mjs --all                      every clip, then the tour
 *   node tools/demo/record-014.mjs --tour                     only restitch the tour from site/public/demo/v014/*.mp4
 *   node tools/demo/record-014.mjs --all --no-stills          clips only
 *   node tools/demo/record-014.mjs --all --no-video           stills only
 *   node tools/demo/record-014.mjs --gate                     only run the gate (flicker-check.py) over every clip and tour
 *
 * Every run that writes video ends with the gate: tools/demo/flicker-check.py must report 0 flicker frames and a
 * poster equal to the first frame for each clip and both tours, or the run exits 1.
 *
 * Clips: workspaces, whiteboard-draw, ask-in-place, ask-chat, architecture, files,
 * terminal, agents-workflows, reasoning, chat-drawings, rewind.
 *
 * Output: site/public/demo/v014/<clip>.mp4 + <clip>.jpg (1920x1080 CSS px window captured at 2x, framed by the
 * scenario's rig.focus() camera, played SPEED/PERFORM faster than performed, dark, H.264
 * yuv420p at constant 60 fps, idle stretches cut to --hold seconds, default 0.6; see startCapture and
 * finishVideo for how and why),
 * site/public/demo/v014/stills/*.png (1440x900, some 1024x700 and light),
 * report/media/sequence-0.1.4-tour.mp4 (+ .jpg).
 *
 * WHAT IS REAL AND WHAT IS REPLAYED (the honest line, also in
 * site/public/demo/v014/MEDIA-NOTES.md):
 *   - The app is the real built app (packages/analyzer/dist/cli.js app), serving
 *     the real packages/web2 build, scanning a real repository: a neutral copy of
 *     the shopfront fixture (packages/analyzer/test/fixtures/shopfront) plus two
 *     small fixtures as extra workspaces. The architecture map, the Files tree,
 *     git status, markdown preview, the terminal (a real shell in the repo) and
 *     the whiteboard/board interactions are all live.
 *   - No model is called (no money is spent). Where an agent or model would
 *     answer, the answer is a recorded/scripted transcript replayed into the
 *     page through Playwright route mocks (agent run stream, ask stream,
 *     capabilities, runs, workflows). The page renders replayed events with the
 *     same code it uses for live ones; the text of those answers was written by
 *     hand for the demo and is NOT output of a model.
 *
 * Neutral by construction: everything lives under <work> (default C:/seqdemo)
 * with HOME/USERPROFILE and SEQUENCE_USER_DIR pointed inside it, so no real
 * path, history, account or credential is in any frame.
 *
 * Needs: the repo built (pnpm install && pnpm -r build), Chrome (found by
 * packages/web2/e2e/lib/chromium.mjs), ffmpeg (FFMPEG env or the winget link).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');
const { findChromium, launchOptions } = await import(url.pathToFileURL(path.join(ROOT, 'packages', 'web2', 'e2e', 'lib', 'chromium.mjs')).href);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : argv[i + 1];
};
const WORK = path.resolve(arg('--work', 'C:/seqdemo'));
const PORT = Number(arg('--port', '4190'));
const APP = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(arg('--out', path.join(ROOT, 'site', 'public', 'demo', 'v014')));
const STILLS = path.join(OUT, 'stills');
const TOUR_DIR = path.join(ROOT, 'report', 'media');
const RAW = path.join(WORK, 'raw');
const FFMPEG = process.env.FFMPEG ?? path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe');
const HOME = path.join(WORK, 'home');
const USER = path.join(WORK, 'user');
const REPO = path.join(HOME, 'shopfront');
const FIX = path.join(ROOT, 'packages', 'analyzer', 'test', 'fixtures');
const REPLAY = path.join(HERE, 'fixtures-014');
/* Video: 1920x1080 CSS px (zoomed out: the whole app on screen), captured 1:1, encoded at 60 fps. */
const VW = 1920;
const VH = 1080;
const FPS = 60;
/* terminal and reasoning are still defined but no longer in the set (owner, 2026-10-10: not needed on the site). */
const ALL = ['workspaces', 'connect-agent', 'architecture', 'ask-in-place', 'ask-chat', 'whiteboard-draw', 'research-whiteboard', 'files', 'agentic-workflow', 'agents-workflows', 'chat-drawings', 'rewind', 'zoom-stills'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
  return r.stdout;
};
const git = (cwd, ...a) => run('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', '-c', 'core.autocrlf=false', ...a], { cwd });

/* ───────────────────────── the neutral home ───────────────────────── */

function prepareHome() {
  rm(HOME);
  rm(USER);
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(USER, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  for (const [name, fixture] of [['shopfront', 'shopfront'], ['notes-app', 'plainapp'], ['dashboard', 'spa-dashboard']]) {
    const dest = path.join(HOME, name);
    fs.cpSync(path.join(FIX, fixture), dest, { recursive: true, filter: (s) => !/[\\/](\.sequence|node_modules)([\\/]|$)/.test(s) });
  }
  /* A markdown guide with a diagram, for the Files preview. */
  fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(REPO, 'docs', 'guide.md'),
    [
      '# Shopfront guide',
      '',
      'Shopfront is a small storefront: a gateway in front of orders, payments, shipping and invoices.',
      '',
      '## How an order flows',
      '',
      '```mermaid',
      'flowchart LR',
      '  Gateway --> Orders',
      '  Orders --> Payments',
      '  Orders -. OrderCreated .-> Shipping',
      '```',
      '',
      '## Services',
      '',
      '| Service | Language | Role |',
      '| --- | --- | --- |',
      '| gateway | TypeScript | public HTTP entry |',
      '| orders | Python | creates orders, publishes OrderCreated |',
      '| payments | JavaScript | charges and records payments |',
      '| shipping | Go | consumes OrderCreated |',
      '',
      '- Start everything with `docker compose up`.',
      '- Orders publish `OrderCreated`; shipping subscribes.',
      '',
    ].join('\n'),
  );
  for (const name of ['shopfront', 'notes-app', 'dashboard']) {
    const d = path.join(HOME, name);
    git(d, 'init', '-q');
    fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.sequence/\n');
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'initial');
  }
  /* Two real parallel working trees (git worktrees) beside the main checkout: the Agents tab's territories. */
  git(REPO, 'worktree', 'add', '-q', '-b', 'feature/request-ids', path.join(HOME, 'shopfront-request-ids'));
  git(REPO, 'worktree', 'add', '-q', '-b', 'fix/payment-retry', path.join(HOME, 'shopfront-payment-retry'));
  /* A change and a new file in the working tree, so Files shows its status colours. */
  fs.appendFileSync(path.join(REPO, 'gateway', 'src', 'index.ts'), '\n// TODO: add request ids to every proxied call\n');
  fs.writeFileSync(path.join(REPO, 'gateway', 'src', 'routes', 'health.ts'), "export const health = () => ({ ok: true });\n");
  fs.appendFileSync(path.join(REPO, 'docs', 'guide.md'), '- Health check: `GET /health` on the gateway.\n');
  fs.writeFileSync(path.join(REPO, 'orders', 'app', 'main.py.orig'), '# scratch\n');
  fs.rmSync(path.join(REPO, 'orders', 'app', 'main.py.orig'));
}

function seedSessions(repoName, sessions) {
  const dir = path.join(HOME, repoName, '.sequence', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const at = (m) => new Date(Date.now() - m * 60_000).toISOString();
  const index = { version: 1, activeId: sessions[0].id, sessions: sessions.map((s, i) => ({ id: s.id, title: s.title, createdAt: at(300 - i * 40), updatedAt: at(120 - i * 30) })) };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  for (const s of sessions) {
    fs.mkdirSync(path.join(dir, s.id), { recursive: true });
    fs.writeFileSync(path.join(dir, s.id, 'chat.json'), JSON.stringify({ version: 1, sessionId: s.id, turns: [] }));
    fs.writeFileSync(path.join(dir, s.id, 'meta.json'), JSON.stringify({}));
  }
}

/* ───────────────────────── the app process ───────────────────────── */

let appProc = null;
async function startApp() {
  rm(path.join(REPO, '.sequence'));
  const env = { ...process.env, HOME, USERPROFILE: HOME, SEQUENCE_USER_DIR: USER };
  appProc = spawn(process.execPath, [path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js'), 'app', '--repo', REPO, '--port', String(PORT), '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: HOME });
  appProc.stdout.on('data', () => {});
  appProc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try {
      const ok = await new Promise((res) => http.get(`${APP}/api/sessions`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
      if (ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('the app did not start');
}
async function stopApp() {
  if (!appProc) return;
  const p = appProc;
  appProc = null;
  p.kill();
  try { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(800);
}

/* ───────────────────────── replay (the mocks) ───────────────────────── */

const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const upd = (u) => ({ type: 'acp:update', update: { sessionId: 's', update: u } });
export const R = {
  say: (text) => upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }),
  think: (text) => upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } }),
  tool: (id, title, kind, status, extra = {}) => upd({ sessionUpdate: status === 'in_progress' ? 'tool_call' : 'tool_call_update', toolCallId: id, title, kind, status, ...extra }),
  ctx: (used, size = 200000) => upd({ sessionUpdate: 'usage_update', used, size, cost: null }),
  done: (text = '') => ({ type: 'acp:result', stopReason: 'end_turn', text }),
};
const CAPS = {
  models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', isDefault: true }],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  commands: [],
  skills: [],
};
const AI_CONFIG = {
  configured: true,
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  profiles: [{ id: 'p1', name: 'Sonnet 5', provider: 'anthropic', model: 'claude-sonnet-5', params: { reasoningEffort: 'medium' } }],
  defaultProfileId: 'p1',
};
/* A tiny local SSE server: the page's agent/ask request is re-pointed at it so the replayed events arrive paced
   (a recorded transcript, delivered at the speed it was written, not all at once). */
let replayServer = null;
const replayQueue = [];
async function ensureReplayServer() {
  if (replayServer) return replayServer.address().port;
  replayServer = http.createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    req.resume();
    const out = replayQueue.shift() ?? { events: [R.done('')] };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...cors });
    await sleep(out.delay ?? 400);
    let i = 0;
    for (const e of out.events) {
      if (e && e.__wait) { await sleep(e.__wait); continue; }
      res.write(`data: ${JSON.stringify(e)}

`);
      await sleep(typeof out.gap === 'function' ? out.gap(i) : (out.gap ?? 250));
      i++;
    }
    if (!out.hold) res.end();
  });
  await new Promise((r) => replayServer.listen(0, '127.0.0.1', r));
  return replayServer.address().port;
}
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(REPLAY, f), 'utf8'));

/**
 * Install the replay. `mode` 'ask' puts the page on a configured model (the
 * ask stream answers), 'agent' puts it on a connected agent (the run stream
 * answers). `script(prompt, ctx)` returns the events for a prompt; it is called
 * with the request body and may delay by returning { events, pace } where pace
 * is ms between events (the body is delivered at once, so pace is ignored by
 * route.fulfill; use `live` to stream through a local server instead).
 */
async function installReplay(page, { mode, script, runs = () => [], onRewind, agents = [{ id: 'claude', label: 'Claude Code' }] } = {}) {
  await page.route('**/api/acp/capabilities*', (r) => r.fulfill(json(CAPS)));
  await page.route('**/api/acp/available', (r) => r.fulfill(json({ available: true })));
  await page.route('**/api/onboarding/providers', (r) => r.fulfill(json({ providers: [{ id: 'claude', label: 'Claude Code', installed: true, version: '', state: 'ready', signInCommand: '', installHint: '' }] })));
  if (mode === 'agent') {
    await page.route('**/api/acp/agents', (r) => r.fulfill(json({ agents })));
    await page.route('**/api/ai-config', (r) => r.fulfill(json({ configured: false })));
  } else {
    await page.route('**/api/acp/agents', (r) => r.fulfill(json({ agents: [] })));
    await page.route('**/api/ai-config', (r) => (r.request().method() === 'GET' ? r.fulfill(json(AI_CONFIG)) : r.fulfill(json(AI_CONFIG))));
  }
  await page.route('**/api/acp/runs*', (r) => r.fulfill(json({ runs: runs(new URL(r.request().url()).searchParams.get('chatId')) })));
  if (script) {
    const port = await ensureReplayServer();
    const handler = async (route) => {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
      const prompt = String(body.prompt ?? body.question ?? '');
      const out = await script(prompt, body);
      if (!out) return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([R.done('')]) });
      replayQueue.push(out);
      await route.continue({ url: `http://127.0.0.1:${port}/replay` });
    };
    await page.route('**/api/acp/run-node*', handler);
    await page.route('**/api/ask/stream', handler);
  }
  if (onRewind) await page.route('**/api/sessions/*/rewind**', onRewind);
}

/* ───────────────────────── recording helpers ───────────────────────── */

const CURSOR = `(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const d = document.createElement('div');
    d.id = '__cur';
    d.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px);will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))';
    d.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7 13.2 L9.8 19 L12.4 17.8 L9.7 12.2 L15.2 12 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div');
    ring.id = '__ring';
    ring.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(120,170,255,.9);pointer-events:none;z-index:2147483646;opacity:0;transition:opacity .35s,transform .35s';
    /* While the cursor is in transit (data-seq-glide), nothing under it takes hover: a row it crosses must not light up for one frame. */
    const st = document.createElement('style');
    st.textContent = 'html[data-seq-glide] body * { pointer-events: none !important; }';
    (document.head || document.documentElement).append(st);
    (document.body || document.documentElement).append(ring, d);
    addEventListener('mousemove', (e) => { d.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; }, true);
    addEventListener('mouseup', (e) => { window.__btn = e.buttons; }, true);
    addEventListener('mousedown', (e) => { window.__btn = e.buttons; ring.style.transition = 'none'; ring.style.opacity = '1'; ring.style.transform = 'scale(.5)'; requestAnimationFrame(() => { ring.style.transition = 'opacity .45s,transform .45s'; ring.style.opacity = '0'; ring.style.transform = 'scale(1.3)'; }); }, true);
  };
  if (document.readyState !== 'loading') mk(); else addEventListener('DOMContentLoaded', mk);
  if (document.documentElement) new MutationObserver(mk).observe(document.documentElement, { childList: true });
})();`;

/**
 * The scenario's handle on the browser. In a video pass pauses are real and the
 * cursor is drawn; in a stills pass pauses are short and snap() writes a PNG.
 */
class Rig {
  constructor(page, { video, theme, w, h, clip, stillsOnly }) {
    Object.assign(this, { page, video, theme, w, h, clip });
    this.t0 = 0;
    this.posterAt = null;
    this.mx = w / 2;
    this.my = h / 2;
    this.stillNames = [];
    this.stillsOnly = stillsOnly;
    this.pace = 1;
  }
  /** A pause that is real in the video and brief in a stills pass. */
  async pause(ms) { await sleep(this.video ? ms * this.pace * PERFORM : Math.min(ms, 350)); }
  /** Wait for something to arrive (a replayed answer): real in the stills pass, paced in the video. */
  async settle(ms) { if (!this.video) await sleep(ms); }
  /** Mark the start of what the viewer should see: everything before it is trimmed off. */
  start() { this.t0 = Date.now(); }
  /**
   * Frame the camera on something: a locator, a {x, y, w, h} box in CSS px, or 'full' for the whole window. The camera
   * eases there from wherever it is (zoom capped at CAM_MAX, CAM_PAD margin around the box). opts.zoom forces a zoom.
   */
  async focus(target, opts = {}) {
    if (!this.video) return;
    let box = target === 'full' ? { x: 0, y: 0, w: this.w, h: this.h } : target;
    if (target && typeof target.boundingBox === 'function') {
      /* A locator that matches several elements frames all of them (up to 60). */
      const boxes = [];
      for (const el of (await target.all().catch(() => [])).slice(0, 60)) {
        const b = await el.boundingBox().catch(() => null);
        if (b && b.width > 0) boxes.push(b);
      }
      if (!boxes.length) return;
      const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const fit = Math.min(this.w / (box.w * CAM_PAD), this.h / (box.h * CAM_PAD));
    const z = Math.max(1, Math.min(CAM_MAX, opts.zoom ?? fit));
    const half = [this.w / z / 2, this.h / z / 2];
    const cx = Math.max(half[0], Math.min(this.w - half[0], box.x + box.w / 2 + (opts.dx ?? 0)));
    const cy = Math.max(half[1], Math.min(this.h - half[1], box.y + box.h / 2 + (opts.dy ?? 0)));
    (this.shots ??= []).push({ wall: Date.now(), z: Number(z.toFixed(4)), cx: Math.round(cx), cy: Math.round(cy) });
  }
  /** Mark the frame to use as the poster. */
  poster() { this.posterAt = Date.now(); }
  /** Play what follows faster (a wait on a replayed answer) until fastEnd(): its frames are kept, their time divided by FAST. */
  fastStart() { if (this.video) this.fastMarks = [...(this.fastMarks ?? []), [Date.now(), Infinity]]; }
  fastEnd() { const m = this.fastMarks?.[this.fastMarks.length - 1]; if (m && m[1] === Infinity) m[1] = Date.now(); }
  /** Move the cursor to (x,y) in an eased glide. */
  async glide(x, y, ms = 700) {
    if (!this.video) { await this.page.mouse.move(x, y); this.mx = x; this.my = y; return; }
    ms *= this.pace * PERFORM;
    /* Time-based ease-in-out (cubic): one step per ~16 ms, so the screencast gets a new cursor position every 60 fps frame. */
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const sx = this.mx, sy = this.my;
    /* No hover in transit (see CURSOR), unless a button is held: a drag must keep its target. */
    const guard = await this.page.evaluate(() => { if (window.__btn) return false; document.documentElement.setAttribute('data-seq-glide', ''); return true; }).catch(() => false);
    const t0 = Date.now();
    for (;;) {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const f = ease(p);
      await this.page.mouse.move(sx + (x - sx) * f, sy + (y - sy) * f);
      if (p >= 1) break;
      await sleep(14);
    }
    if (guard) {
      /* Arrived: hover comes back, and a last move lets the target take it. */
      await this.page.evaluate(() => document.documentElement.removeAttribute('data-seq-glide')).catch(() => {});
      await this.page.mouse.move(x + 0.01, y);
    }
    this.mx = x; this.my = y;
  }
  async center(loc) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box for ' + loc);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  }
  async hover(loc, ms = 700) { const c = await this.center(loc); await this.glide(c.x, c.y, ms); }
  async click(loc, ms = 700, opts = {}) {
    const c = await this.center(loc);
    await this.glide(c.x, c.y, ms);
    await this.pause(120);
    await this.page.mouse.click(c.x, c.y, opts);
  }
  async type(loc, text, delay = 38) {
    await this.click(loc, 500);
    if (this.video) await this.page.keyboard.type(text, { delay: delay * PERFORM });
    else await this.page.keyboard.insertText(text);
  }
  /** Save a still (stills pass only). opts: small (also 1024x700), light (also light theme), name already kebab-case. */
  async snap(name, opts = {}) {
    if (this.video) return;
    await this.page.mouse.move(this.mx, this.my);
    await sleep(350);
    if (this.theme === 'light' && !opts.light) return;
    if (this.w === 1024 && !opts.small) return;
    const file = this.theme === 'light' ? `${name}-light.png` : this.w === 1024 ? `${name}-1024.png` : `${name}.png`;
    fs.mkdirSync(STILLS, { recursive: true });
    await this.page.screenshot({ path: path.join(STILLS, file) });
    this.stillNames.push(file);
  }
}

/*
 * Video capture: CDP Page.startScreencast, not Playwright's recordVideo.
 *
 * recordVideo writes a fixed ~25 fps webm and drops in-between frames, which is
 * what made the old clips choppy. The screencast hands over every compositor
 * frame the page paints (measured ~48 fps while the cursor glides, one frame per
 * input step), each with its wall-clock timestamp. Those frames are written as
 * JPEGs and laid on a 60 fps timeline by ffmpeg's concat demuxer using the real
 * timestamps, so motion keeps its true timing and a static stretch is one frame
 * held. In headless Chrome the screencast frame is always CSS-pixel sized
 * (deviceScaleFactor 2 gave byte-identical 1920x1080 frames), so the viewport is
 * the output size: 1920x1080 CSS px at 1:1, no resampling, no blur.
 */
async function startCapture(context, page, clip) {
  const dir = path.join(RAW, clip);
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const writes = [];
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, t: f.metadata.timestamp * 1000 });
    writes.push(fs.promises.writeFile(file, Buffer.from(f.data, 'base64')));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
    },
  };
}

async function openPage(browser, { video, w, h, theme, clip, dsf = 1 }) {
  const ctxOpts = video ? { viewport: null, colorScheme: theme } : { viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: dsf };
  rm(path.join(RAW, clip));
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript((t) => { try { localStorage.setItem('seq.theme', t); } catch {} }, theme);
  if (video) await context.addInitScript(CURSOR);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn('  pageerror:', String(e).slice(0, 160)));
  if (video) {
    const size = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    if (size[0] !== w || size[1] !== h || size[2] !== 2) throw new Error(`video window is ${size.join('x')}, not ${w}x${h} at 2x: adjust --window-size`);
  }
  const capture = video ? await startCapture(context, page, clip) : null;
  return { context, page, capture };
}

async function ffmpeg(args) {
  run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}
const FFPROBE = path.join(path.dirname(FFMPEG), 'ffprobe.exe');
const probeDuration = (f) => Number(run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());
/* Longest a frame may stand still in a clip (seconds) before the idle time is cut, and the hold kept on the last frame. */
const HOLD = Number(arg('--hold', '0.6'));
const END_HOLD = 1.0;
/* How much faster a fastStart()/fastEnd() stretch plays (a wait on a replayed answer, the spinner turning). */
const FAST = 4;
/* Every clip plays this much faster than it was performed (cursor, typing, answers alike). */
const SPEED = Number(arg('--speed', '2'));
/* The clips should end up NET times faster than the old pacing. The 4K screencast delivers a frame about every 27 ms, so the
   rig performs PERFORM times slower than that pacing (more frames per movement) and SPEED plays it back faster: net
   SPEED / PERFORM = NET, with about 2x the captured frames per second of output motion. */
const NET = Number(arg('--net', '1.45'));
const PERFORM = SPEED / NET;
/* The camera: how long a move between two framings takes (s), the most it zooms in (2 = 1:1 with the 2x capture), and the
   margin kept around a framed element. */
const CAM_MOVE = 0.55;
const CAM_MAX = 2;
const CAM_PAD = 1.25;
/* The final encode: H.264 high, yuv420p, constant 60 fps, faststart, no audio. */
const X264 = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '21', '-maxrate', '6000k', '-bufsize', '12000k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'];

/** Stretches where the picture stands still (freezedetect), as [start, end] seconds; end is null when it runs to the end. */
function stillStretches(file) {
  /* -86 dB is ~5e-5 mean difference: a blinking caret stays below it, a 22 px cursor moving one step is above it. */
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-vf', `scale=1920:-2,freezedetect=n=-86dB:d=${HOLD}`, '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const out = [];
  for (const line of r.stderr.split('\n')) {
    const s = line.match(/freeze_start: ([\d.]+)/);
    if (s) out.push([Number(s[1]), null]);
    const e = line.match(/freeze_end: ([\d.]+)/);
    if (e && out.length) out[out.length - 1][1] = Number(e[1]);
  }
  return out;
}

/**
 * The camera as one perspective warp over the 2x (3840x2160) frames, output 1920x1080. A shot is { t, z, cx, cy }: zoom 1 shows the
 * whole window, zoom 2 a quarter of it at 1:1; (cx, cy) is the centre in CSS px of the 1920x1080 window. Between shots the
 * camera eases (smoothstep) over CAM_MOVE seconds, starting at the shot's time; before the first shot it holds the first.
 */
/** When the camera is moving, as [start, end] seconds: the flicker gate skips these frames (see flicker-check.py). */
function cameraMoves(shots) {
  const list = [...shots].sort((a, b) => a.t - b.t);
  const out = [];
  for (let k = 1; k < list.length; k++) {
    const a = list[k - 1], b = list[k];
    if (a.z === b.z && a.cx === b.cx && a.cy === b.cy) continue;
    const D = Math.max(0.05, Math.min(CAM_MOVE, k + 1 < list.length ? list[k + 1].t - b.t : CAM_MOVE));
    out.push([b.t, b.t + D]);
  }
  return out;
}
const movesFile = (name) => path.join(RAW, `${name}.moves.json`);

function cameraFilter(shots) {
  const list = shots.length ? [...shots].sort((a, b) => a.t - b.t) : [{ t: 0, z: 1, cx: VW / 2, cy: VH / 2 }];
  const piece = (key) => {
    let expr = String(list[list.length - 1][key]);
    for (let k = list.length - 1; k >= 1; k--) {
      const a = list[k - 1][key], b = list[k][key], T = list[k].t;
      const D = Math.max(0.05, Math.min(CAM_MOVE, k + 1 < list.length ? list[k + 1].t - T : CAM_MOVE));
      const p = `clip(((in/${FPS})-${T.toFixed(3)})/${D.toFixed(3)},0,1)`;
      const seg = a === b ? String(a) : `(${a}+(${b - a})*${p}*${p}*(3-2*${p}))`;
      const next = k + 1 < list.length ? `if(lt((in/${FPS}),${list[k + 1].t.toFixed(3)}),${seg},${expr})` : seg;
      expr = next;
    }
    return list.length > 1 ? `if(lt((in/${FPS}),${list[1].t.toFixed(3)}),${list[0][key]},${expr})` : String(list[0][key]);
  };
  /* perspective rather than zoompan: it samples the source quad with sub-pixel accuracy, where zoompan rounds its crop to
     whole pixels. The quad is the visible window in input pixels (2x), kept inside the frame; the result is scaled to the
     output size. */
  if (!shots.length) return `scale=${VW}:${VH}:flags=lanczos`;
  const Z = `(${piece('z')})`;
  const X0 = `max(0,min(W-W/${Z},2*(${piece('cx')})-W/${Z}/2))`;
  const Y0 = `max(0,min(H-H/${Z},2*(${piece('cy')})-H/${Z}/2))`;
  const X1 = `${X0}+W/${Z}`;
  const Y2 = `${Y0}+H/${Z}`;
  return `perspective=x0='${X0}':y0='${Y0}':x1='${X1}':y1='${Y0}':x2='${X0}':y2='${Y2}':x3='${X1}':y3='${Y2}':interpolation=cubic:eval=frame,scale=${VW}:${VH}:flags=lanczos`;
}

async function finishVideo(clip, rig, context, capture) {
  const endMs = Date.now();
  await capture.stop();
  await context.close();
  const from = rig.t0 - 100;
  const all = capture.frames.filter((f) => f.t <= endMs);
  if (!all.length) throw new Error(`${clip}: the screencast delivered no frames`);
  let i0 = all.findIndex((f) => f.t > from);
  i0 = i0 === -1 ? all.length - 1 : Math.max(0, i0 - 1);
  const sel = all.slice(i0);
  /* Wall-clock ms to seconds on the clip's timeline: a fastStart()/fastEnd() stretch runs FAST times quicker. */
  const marks = (rig.fastMarks ?? []).map(([a, b]) => [a, b === Infinity ? endMs : b]);
  const squeeze = (t) => {
    let x = (t - from) / 1000;
    for (const [a, b] of marks) x -= ((Math.max(from, Math.min(t, b)) - Math.max(from, Math.min(t, a))) / 1000) * (1 - 1 / FAST);
    return x / SPEED;
  };
  /* 1. The frames on their real timeline, resampled to constant 60 fps (a near-lossless intermediate). */
  const lines = ['ffconcat version 1.0'];
  sel.forEach((f, k) => {
    const start = Math.max(from, f.t);
    const next = k + 1 < sel.length ? sel[k + 1].t : endMs;
    lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, squeeze(next) - squeeze(start)).toFixed(4)}`);
  });
  lines.push(`file '${sel[sel.length - 1].file.replace(/\\/g, '/')}'`);
  const list = path.join(RAW, `${clip}.ffconcat`);
  fs.writeFileSync(list, lines.join('\n'));
  const raw60 = path.join(RAW, `${clip}-60.mp4`);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=in_range=full:out_range=tv,format=yuv420p`, '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-an', raw60]);
  /* 2. Cut idle time: any stretch where nothing moves keeps HOLD seconds (END_HOLD at the end), the rest goes. */
  const rawDur = probeDuration(raw60);
  const cuts = [];
  for (const [s, e] of stillStretches(raw60)) {
    if (e === null || e >= rawDur - 0.05) cuts.push([s + END_HOLD, rawDur + 1]);
    else if (e - s > HOLD) cuts.push([s + HOLD, e]);
  }
  const keep = cuts.length ? `select='not(${cuts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')})',setpts=N/${FPS}/TB,` : '';
  fs.mkdirSync(OUT, { recursive: true });
  const mp4 = path.join(OUT, `${clip}.mp4`);
  /* 3. The camera: the scenario's focus() marks, moved onto the cut timeline, drive the warp over the 2x frames. */
  const mapT = (t) => t - cuts.reduce((acc, [a, b]) => acc + Math.max(0, Math.min(t, b) - a), 0);
  const shots = (rig.shots ?? []).map((k) => ({ ...k, t: Math.max(0, mapT(squeeze(k.wall))) }));
  const script = path.join(RAW, `${clip}.filter`);
  fs.writeFileSync(script, `${keep}${cameraFilter(shots)},format=yuv420p`);
  fs.writeFileSync(movesFile(clip), JSON.stringify(cameraMoves(shots)));
  await ffmpeg(['-i', raw60, '-filter_script:v', script, '-r', String(FPS), ...X264, mp4]);
  /* 4. The poster is the clip's first frame, so the site's swap from poster to playing video does not jump.
        (rig.poster() marks are no longer used for the clip posters.) */
  const dur = probeDuration(mp4);
  await ffmpeg(['-i', mp4, '-frames:v', '1', '-q:v', '3', path.join(OUT, `${clip}.jpg`)]);
  const span = (sel[sel.length - 1].t - sel[0].t) / 1000;
  /* While something moves, how often a new frame arrived: the capture cadence behind the 60 fps timeline. */
  const gaps = sel.slice(1).map((f, k) => f.t - sel[k].t).filter((g) => g < 100).sort((a, b) => a - b);
  const cadence = gaps.length ? ` motion cadence p50 ${gaps[gaps.length >> 1].toFixed(1)} ms, p90 ${gaps[Math.floor(gaps.length * 0.9)].toFixed(1)} ms` : '';
  console.log(`  ${clip}.mp4  ${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB  ${dur.toFixed(2)} s (raw ${rawDur.toFixed(1)} s, ${cuts.length} idle cuts; ${sel.length} frames captured over ${span.toFixed(1)} s;${cadence})`);
}

/* ───────────────────────── scenarios ───────────────────────── */

const SCENARIOS = {};
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const waitShell = async (page) => {
  await page.goto(APP);
  await tid(page, 'shell').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  /* The stylesheet occasionally fails to arrive on a cold start: reload until the page is styled. */
  for (let i = 0; i < 3; i++) {
    const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' && document.styleSheets.length > 0);
    if (styled) break;
    await page.reload();
    await tid(page, 'shell').waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
  }
};
const waitBoard = async (page) => {
  await tid(page, 'board-node').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
};

import { registerScenarios } from './record-014-scenarios.mjs';
import { registerReplayScenarios } from './record-014-replay-scenarios.mjs';
import { registerAgentScenarios } from './record-014-agents-scenarios.mjs';
import { registerChatScenarios } from './record-014-chat-scenarios.mjs';
import { registerV3Scenarios } from './record-014-v3-scenarios.mjs';
/* The 1920x1080 layout with a board open, for framing: sidebar, chat column, the working pane. */
const LAYOUT = { sidebar: { x: 0, y: 0, w: 245, h: 1080 }, chat: { x: 250, y: 0, w: 420, h: 1080 }, pane: { x: 678, y: 60, w: 1236, h: 990 } };
const SCN = { LAYOUT, SCENARIOS, R, tid, waitShell, waitBoard, installReplay, readJson, seedSessions, sleep, json, sse, STILLS, APP, REPO, HOME, WORK, fs, path };
registerScenarios(SCN);
registerReplayScenarios(SCN);
registerAgentScenarios(SCN);
registerChatScenarios(SCN);
registerV3Scenarios(SCN);

/* ───────────────────────── the runner ───────────────────────── */

async function recordClip(browser, clip, { video, stills }) {
  const sc = SCENARIOS[clip];
  if (!sc) throw new Error('no scenario ' + clip);
  const passes = [];
  /* A sharp-stills scenario (sc.sharp): one 1920x1080 pass at deviceScaleFactor 2, page.screenshot, 3840x2160 PNGs. */
  if (sc.sharp) { if (stills) passes.push({ video: false, w: 1920, h: 1080, theme: 'dark', dsf: 2 }); video = false; stills = false; }
  if (video) passes.push({ video: true, w: VW, h: VH, theme: 'dark' });
  if (stills) {
    passes.push({ video: false, w: 1440, h: 900, theme: 'dark' });
    if (sc.small) passes.push({ video: false, w: 1024, h: 700, theme: 'dark' });
    if (sc.light) passes.push({ video: false, w: 1440, h: 900, theme: 'light' });
  }
  for (const p of passes) {
    console.log(`${clip}: ${p.video ? `video ${VW}x${VH} @${FPS}` : `stills ${p.w}x${p.h} ${p.theme}`}`);
    await stopApp();
    await startApp();
    const { context, page, capture } = await openPage(browser, { ...p, clip });
    const rig = new Rig(page, { ...p, clip });
    rig.pace = sc.pace ?? 1;
    try {
      await sc.run(rig);
      /* Sharp stills also ship as WebP (quality 85) for the site. */
      if (sc.sharp) for (const n of rig.stillNames) await ffmpeg(['-i', path.join(STILLS, n), '-c:v', 'libwebp', '-quality', '85', path.join(STILLS, n.replace(/\.png$/, '.webp'))]);
    } finally {
      if (p.video) await finishVideo(clip, rig, context, capture).catch((e) => console.error('  finish failed', e));
      else await context.close();
    }
  }
}

/*
 * Two tours are cut from the clips. Each entry is [clip, start, length] in seconds of the (already idle-trimmed)
 * clip; a null length runs to the clip's end. A 0.3 s cross-fade joins the parts; there is no fade at either end,
 * so the first frame is the poster (the site swaps poster for video without a jump).
 *
 * TOUR_HIGHLIGHT is the hero cut (tour.mp4, report/media/sequence-0.1.4-tour.mp4): the best few seconds of each
 * feature, opening on the architecture map beside the chat. TOUR_FULL is every clip in full (tour-full.mp4).
 */
const TOUR_HIGHLIGHT = [
  ['architecture', 1.2, 2.8],
  ['connect-agent', 0.6, 1.8],
  ['research-whiteboard', 3.2, 3.0],
  ['agentic-workflow', 8.0, 3.8],
  ['ask-in-place', 2.8, 3.0],
  ['files', 4.2, 2.1],
];
const TOUR_FULL = [
  ['workspaces', 0, null],
  ['connect-agent', 0, null],
  ['architecture', 0, null],
  ['ask-in-place', 0, null],
  ['ask-chat', 0, null],
  ['whiteboard-draw', 0, null],
  ['research-whiteboard', 0, null],
  ['files', 0, null],
  ['agentic-workflow', 0, null],
  ['agents-workflows', 0, null],
  ['chat-drawings', 0, null],
  ['rewind', 0, null],
];
const XFADE = 0.3;
async function cutTour(parts, dest, crf, siteName) {
  const inputs = [];
  const moves = [];
  const lens = [];
  for (const [c, start, want] of parts) {
    const src = path.join(OUT, `${c}.mp4`);
    if (!fs.existsSync(src)) { console.log(`tour: ${c}.mp4 missing, skipped`); continue; }
    const len = Math.min(want ?? Infinity, probeDuration(src) - start);
    inputs.push('-ss', String(start), '-t', len.toFixed(3), '-i', src);
    lens.push(len);
    /* This part's camera moves, on the tour's timeline (each part starts XFADE before the previous one ends). */
    const at = lens.slice(0, -1).reduce((acc, l) => acc + l - XFADE, 0);
    const mv = fs.existsSync(movesFile(c)) ? JSON.parse(fs.readFileSync(movesFile(c), 'utf8')) : [];
    for (const [a, b] of mv) if (b > start && a < start + len) moves.push([at + Math.max(0, a - start), at + Math.min(len, b - start)]);
  }
  const chain = [];
  let prev = '0:v';
  let offset = 0;
  for (let k = 1; k < lens.length; k++) {
    offset += lens[k - 1] - XFADE;
    const out = k === lens.length - 1 ? 'vx' : `v${k}`;
    chain.push(`[${prev}]settb=1/${FPS},fps=${FPS}[a${k}];[${k}:v]settb=1/${FPS},fps=${FPS}[b${k}];[a${k}][b${k}]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[${out}]`);
    prev = out;
  }
  const graph = chain.length ? `${chain.join(';')};[vx]format=yuv420p[vout]` : '[0:v]format=yuv420p[vout]';
  await ffmpeg([...inputs, '-filter_complex', graph, '-map', '[vout]', '-r', String(FPS), ...X264.map((v) => (v === '21' ? String(crf) : v)), dest]);
  fs.writeFileSync(movesFile(path.basename(dest, '.mp4')), JSON.stringify(moves));
  fs.writeFileSync(movesFile(siteName), JSON.stringify(moves));
  /* The poster is the first frame. */
  const jpg = dest.replace(/\.mp4$/, '.jpg');
  await ffmpeg(['-i', dest, '-frames:v', '1', '-q:v', '3', jpg]);
  console.log(`tour: ${path.basename(dest)} ${(fs.statSync(dest).size / 1e6).toFixed(2)} MB  ${probeDuration(dest).toFixed(2)} s`);
  return jpg;
}
async function tour() {
  fs.mkdirSync(TOUR_DIR, { recursive: true });
  const hero = path.join(TOUR_DIR, 'sequence-0.1.4-tour.mp4');
  const full = path.join(TOUR_DIR, 'sequence-0.1.4-tour-full.mp4');
  await cutTour(TOUR_HIGHLIGHT, hero, 25, 'tour');
  await cutTour(TOUR_FULL, full, 25, 'tour-full');
  /* The site cannot read report/, so it gets copies. */
  for (const [from, to] of [[hero, 'tour'], [full, 'tour-full']]) {
    fs.copyFileSync(from, path.join(OUT, `${to}.mp4`));
    fs.copyFileSync(from.replace(/\.mp4$/, '.jpg'), path.join(OUT, `${to}.jpg`));
  }
}

/* The gate (tools/demo/flicker-check.py): no one-frame flicker in any clip or tour, and every poster is its video's first frame. */
function gate(files) {
  const r = spawnSync('python', ['-I', path.join(HERE, 'flicker-check.py'), '--moves', RAW, ...files], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(r.stdout ?? '');
  if (r.status !== 0) throw new Error('flicker-check failed: fix the clips above before committing');
}
const gateAll = () => gate([...fs.readdirSync(OUT).filter((n) => n.endsWith('.mp4')).map((n) => path.join(OUT, n)), ...['sequence-0.1.4-tour.mp4', 'sequence-0.1.4-tour-full.mp4'].map((n) => path.join(TOUR_DIR, n))]);

async function main() {
  if (flag('--gate')) return gateAll();
  if (flag('--tour')) { await tour(); return gateAll(); }
  const clips = flag('--all') ? ALL : String(arg('--clip', '')).split(',').filter(Boolean);
  if (!clips.length) { console.error('usage: --clip <name[,name]> | --all | --tour   (see the header)'); process.exit(2); }
  if (!flag('--keep-home')) prepareHome();
  const lo = launchOptions(findChromium());
  /* deviceScaleFactor comes from each context (the sharp stills use 2), not from a browser-wide flag. */
  /* The video pass needs 2x frames: a browser-wide scale factor with no per-context viewport override is the one way the
     screencast delivers 3840x2160 (a context deviceScaleFactor still screencasts at CSS size). The window size carries the
     headless frame's 16 x 95 px of chrome so the page itself is exactly VW x VH (checked in openPage). Stills passes set
     their own viewport and scale factor, which override this. */
  lo.args = [...lo.args.filter((a) => !a.startsWith('--force-device-scale-factor')), '--force-device-scale-factor=2', `--window-size=${VW + 16},${VH + 95}`];
  const browser = await chromium.launch(lo);
  try {
    for (const c of clips) await recordClip(browser, c, { video: !flag('--no-video'), stills: !flag('--no-stills') });
  } finally {
    await browser.close();
    await stopApp();
  }
  if (flag('--all')) { await tour(); gateAll(); }
  else if (!flag('--no-video')) { const vids = clips.filter((c) => !SCENARIOS[c].sharp); if (vids.length) gate(vids.map((c) => path.join(OUT, c + '.mp4'))); }
}
main().then(() => process.exit(0), (e) => { console.error(e); stopApp().finally(() => process.exit(1)); });
