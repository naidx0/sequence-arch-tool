/* Shared pieces for the speed benches (switch-bench, stream-bench): start the built app on a copy of a
   fixture repo in an isolated home, seed chats through the real API, launch Chromium. No model is called. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './isolatedEnv.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(path.join(ROOT, 'packages/web2/package.json'));
export const { chromium } = require('playwright-core');

export const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : null;
};
export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};
export const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
    const p = path.join(root, d, rel);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function freePort() {
  return new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
}

export async function startApp({ agents = false } = {}) {
  const repoSrc = path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-speed-'));
  const repo = path.join(work, 'shopfront');
  fs.cpSync(repoSrc, repo, { recursive: true });
  const home = path.join(work, 'home');
  if (agents) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({ agents: [{ id: 'codex', command: 'codex', label: 'Codex' }] }));
  }
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'packages/analyzer/dist/cli.js'), 'app', '--no-open', '--port', String(port), '--repo', repo, ...(process.env.SPEED_WEB ? ['--web', process.env.SPEED_WEB] : [])], {
    env: isolatedEnv(process.env, { userDir: home }), stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(`${base}/api/status`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { base, repo, child, stop: () => { child.kill(); fs.rmSync(work, { recursive: true, force: true }); } };
}

const CODE = (n) => '```ts\n' + Array.from({ length: n }, (_, i) => `export function handler${i}(req: Request, ctx: Context): Promise<Result> {\n  const total = ctx.items.reduce((sum, it) => sum + it.price * it.qty, ${i}); // line ${i}\n  return ctx.pay(total, { retries: ${i % 5}, idempotencyKey: String(req.id) + '-${i}' });\n}`).join('\n') + '\n```';

/** A transcript of `turns` messages (half user, half assistant); each assistant has prose, a list and a code block. */
export function makeTurns(chat, turns, codeLines = 14) {
  const out = [];
  for (let i = 0; i < turns; i++) {
    const at = new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();
    if (i % 2 === 0) out.push({ role: 'user', text: `Question ${i / 2} in chat ${chat}: where does checkout call payments, and why is the retry count ${i % 5}?`, at });
    else {
      const last = i === turns - 1;
      out.push({
        role: 'assistant',
        text: `Checkout calls payments from \`gateway/checkout.ts\`, then **retries** on timeouts.\n\n- first, the cart total is summed\n- then the idempotency key is built\n- last, \`pay()\` runs with the retry count\n\n${CODE(codeLines)}\n\nThat is the whole path.${last ? ` END-${chat}` : ''}`,
        at,
      });
    }
  }
  return out;
}

export async function seedChats(base, { chats, turns, codeLines }) {
  const ids = [];
  for (let c = 0; c < chats; c++) {
    const r = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await r.json();
    const id = body.session.id;
    const t = makeTurns(c, turns, codeLines);
    const put = await fetch(`${base}/api/sessions/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { version: 2, sessionId: id, turns: t }, title: `Chat ${c}` }) });
    if (!put.ok) throw new Error(`seed PUT ${put.status} ${await put.text()}`);
    ids.push(id);
  }
  return ids;
}

export async function launch({ throttle = 1, viewport = { width: 1440, height: 900 } } = {}) {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { browser, page, cdp };
}
