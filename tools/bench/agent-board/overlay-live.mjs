#!/usr/bin/env node
/*
 * OVERLAY LIVE — a replayed Claude Code session lights the real board.
 *
 * Starts the built app (`sequence app --repo <copy>`) on a free port against a
 * private copy of the repository, opens it in Chromium at 1440x900, and posts
 * Claude Code hook payloads (PreToolUse + PostToolUse Edit, the documented
 * shapes) for files in the services the board shows. For each edit it records:
 *   sseMs   POST sent -> the update reaches a Node SSE subscriber
 *   domMs   POST sent -> the service's card carries data-agent-here (MutationObserver, page clock)
 * then waits out the fade and counts highlights left on (must be 0).
 *
 *   node tools/bench/agent-board/overlay-live.mjs [--repo dir] [--n 10] [--shots dir] [--out file.json]
 *
 * Calls no model.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');
const { findChromium } = await import(new URL('../../../packages/web2/e2e/lib/chromium.mjs', import.meta.url).href);

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SRC = path.resolve(arg('--repo', ROOT));
const N = Number(arg('--n', '10'));
const SHOTS = arg('--shots');
const OUT = arg('--out');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-overlay-live-'));
/* Filter on the path RELATIVE to the source: this worktree itself lives under `.claude/`. */
fs.cpSync(SRC, repo, {
  recursive: true,
  filter: (p) => !/(^|[\\/])(node_modules|\.git|\.sequence|dist|\.claude)([\\/]|$)/.test(path.relative(SRC, p)),
});
const port = await freePort();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-overlay-live-home-'));
const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
  env: { ...process.env, SEQUENCE_HOME: home, SEQUENCE_USER_DIR: home },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${port}`;

async function waitStatus() {
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never answered:\n${log}`);
}

const sseSeen = new Map();
function subscribe() {
  return new Promise((resolve) => {
    const req = http.get(`${base}/api/agent-events`, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        const at = Date.now();
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const e = JSON.parse(line.slice(6));
          { const id = `tool:${e.sessionId}:${e.toolUseId}`; if (e.kind === "tool_end" && !sseSeen.has(id)) sseSeen.set(id, at); }
        }
      });
      resolve(() => req.destroy());
    });
  });
}

const post = (body) =>
  fetch(`${base}/api/agent-event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};

let browser;
let stopSse = () => {};
let code = 1;
try {
  await waitStatus();
  browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="composer-field"]', { state: 'visible', timeout: 30000 });
  stopSse = await subscribe();
  const graphRes = await (await fetch(`${base}/archgraph.json`)).json();
  const graph = graphRes.graph ?? graphRes;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const topOf = (id) => {
    let c = byId.get(id);
    const seen = new Set();
    while (c && !seen.has(c.id)) {
      if (['service', 'datastore', 'topic'].includes(c.kind)) return c.id;
      seen.add(c.id);
      c = byId.get(c.parentId);
    }
    return null;
  };

  const NODE = '[data-testid="board-node"][data-node-id]';
  const landed = await page.waitForSelector('.react-flow__node', { state: 'visible', timeout: 30000 }).then(() => true, () => false);
  if (!landed) {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'overlay-landing.png') });
    /* Same fallback as tools/measure/first-board.mjs: open the Architecture tab. */
    const tab = page.locator('[role="tab"]:has-text("Architecture"), button:has-text("Architecture")').first();
    if (await tab.count()) await tab.click();
    await page.waitForSelector('.react-flow__node', { state: 'visible', timeout: 90000 }).catch(async (e) => {
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'overlay-fail.png') });
      console.error('[debug]', await page.evaluate(() => ({
        rf: document.querySelectorAll('.react-flow__node').length,
        bn: document.querySelectorAll('[data-testid="board-node"]').length,
        stack: document.querySelectorAll('[data-testid="board-stack"]').length,
        text: document.body.innerText.slice(0, 300),
      })));
      throw e;
    });
  }
  await page.waitForTimeout(1500);
  const onBoard = new Set(await page.$$eval('[data-testid="board-node"][data-node-id]', (els) => els.map((e) => e.getAttribute('data-node-id'))));
  /* Files whose service is a card on the board, cycling through the services. */
  const perService = new Map();
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || !n.path) continue;
    const t = topOf(n.id);
    if (!t || !onBoard.has(t)) continue;
    if (!perService.has(t)) perService.set(t, []);
    perService.get(t).push(n.path);
  }
  const services = [...perService.keys()];
  if (!services.length) throw new Error('no board service has files');
  await page.evaluate(() => {
    window.__lit = [];
    new MutationObserver((ms) => {
      for (const m of ms) {
        const el = m.target;
        if (m.attributeName === 'data-agent-here' && el.getAttribute('data-agent-here') === 'live') {
          window.__lit.push({ id: el.getAttribute('data-node-id'), at: Date.now() });
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-agent-here'] });
  });

  const rows = [];
  const sid = `overlay-live-${Date.now()}`;
  await post({ session_id: sid, hook_event_name: 'SessionStart', cwd: repo, source: 'startup' });
  for (let i = 0; i < N; i++) {
    const svc = services[i % services.length];
    const files = perService.get(svc);
    const rel = files[Math.floor(i / services.length) % files.length];
    const abs = path.join(repo, rel);
    /* Clear the mark first so every edit is a fresh transition the observer can time. */
    await page.evaluate((id) => document.querySelectorAll(`[data-node-id="${id}"]`).forEach((e) => e.removeAttribute('data-agent-here')), svc);
    const tool_input = { file_path: abs, old_string: 'a', new_string: 'a' };
    const common = { session_id: sid, transcript_path: path.join(home, 't.jsonl'), cwd: repo, permission_mode: 'acceptEdits', tool_name: 'Edit', tool_input, tool_use_id: `toolu_${i}` };
    const t0 = Date.now();
    await post({ ...common, hook_event_name: 'PreToolUse' });
    const t1 = Date.now();
    const reply = await post({ ...common, hook_event_name: 'PostToolUse', tool_output: { content: 'ok', isError: false } });
    const dom = await page
      .waitForFunction(([id, after]) => window.__lit.find((x) => x.id === id && x.at >= after)?.at, [svc, t0], { timeout: 5000 })
      .then((h) => h.jsonValue(), () => null);
    rows.push({
      i,
      service: svc,
      file: rel,
      domMs: dom === null ? null : dom - t0,
      sseMs: sseSeen.has(`tool:${sid}:toolu_${i}`) ? sseSeen.get(`tool:${sid}:toolu_${i}`) - t1 : null,
      context: reply?.hookSpecificOutput?.additionalContext?.length ?? 0,
    });
    if (i === Math.min(N - 1, services.length - 1) && SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'overlay-live.png') });
    }
  }
  const dom = rows.map((r) => r.domMs).filter((x) => x !== null);
  const sse = rows.map((r) => r.sseMs).filter((x) => x !== null);
  await page.waitForTimeout(11000);
  const leftOn = await page.$$eval('[data-agent-here],[data-agent-edge]', (els) => els.length);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'overlay-after-fade.png') });
  const summary = {
    n: rows.length,
    services: services.length,
    lit: dom.length,
    domP50: pct(dom, 0.5),
    domP95: pct(dom, 0.95),
    domMax: Math.max(...dom),
    sseP50: pct(sse, 0.5),
    sseP95: pct(sse, 0.95),
    withContext: rows.filter((r) => r.context > 0).length,
    leftOnAfterFade: leftOn,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
  code = dom.length === rows.length && summary.domMax < 1000 && leftOn === 0 ? 0 : 1;
} catch (e) {
  console.error(e);
} finally {
  stopSse();
  await browser?.close();
  child.kill();
  process.exit(code);
}
