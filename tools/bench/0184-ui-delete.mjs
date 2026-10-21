// UI half of the delete speed test: click "Delete" in the real built app, time until the row is gone.
// Isolated: a throwaway SEQUENCE_USER_DIR and a copy of the shopfront fixture repo under the OS temp dir, a fresh
// browser profile. It never reads or writes the user's own data.
// Needs: pnpm build (analyzer + web2 dist), and a Chromium (packages/web2/e2e/lib/chromium.mjs finds it).
// Usage: node tools/bench/0184-ui-delete.mjs <new-output-dir> [samples=12]
// Writes <out>/results.json and a before/after screenshot of the first sample of each kind.
//
// What is timed, in the PAGE'S own clock (performance.now), so the harness round trip is not in it:
//   t0  the Delete confirm button's click event (capture phase, before React sees it)
//   dom the first mutation after which the row is absent from the document
//   frame the next animation frame after that (the first frame that can paint without the row)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
const FIXTURE = path.join(REPO, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');
const out = process.argv[2] ? path.resolve(process.argv[2]) : '';
const samples = Number(process.argv[3] ?? 12);
if (!out || !Number.isSafeInteger(samples) || samples < 2) throw Error('name a NEW output directory and at least 2 samples');
if (fs.existsSync(out)) throw Error('refusing an existing output directory');
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, q) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * q) - 1)];
const round = (n) => Math.round(n * 10) / 10;
const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v));
};

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-uidel-')));
const userDir = path.join(tmp, 'home', '.sequence');
const repo = path.join(tmp, 'home', 'shopfront');
fs.mkdirSync(userDir, { recursive: true });
fs.cpSync(FIXTURE, repo, { recursive: true });
fs.writeFileSync(path.join(userDir, 'agents.json'), JSON.stringify({ agents: [] }));

/* Fixture: one keeper chat (the open one) and `samples` chats to delete; `samples` Spaces to delete. */
const now = new Date().toISOString();
const at = (i) => new Date(Date.now() - i * 60000).toISOString();
const chatIds = Array.from({ length: samples }, (_, i) => `ui-chat-${String(i).padStart(2, '0')}`);
const spaceIds = Array.from({ length: samples }, (_, i) => `ui-space-${String(i).padStart(2, '0')}`);
const sess = path.join(repo, '.sequence', 'sessions');
write(path.join(sess, 'index.json'), {
  version: 1,
  activeId: 'ui-keeper',
  sessions: [
    { id: 'ui-keeper', title: 'Keeper chat', createdAt: now, updatedAt: now },
    ...chatIds.map((id, i) => ({ id, title: `Delete me ${i}`, createdAt: at(i + 1), updatedAt: at(i + 1) })),
  ],
});
for (const id of ['ui-keeper', ...chatIds]) {
  write(path.join(sess, id, 'chat.json'), { version: 1, sessionId: id, turns: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'benchmark text '.repeat(40) })) });
}
const boards = path.join(repo, '.sequence', 'boards');
write(path.join(boards, 'index.json'), {
  version: 1,
  boards: [
    { id: 'architecture', name: 'Architecture', kind: 'architecture', rev: 0, createdAt: now, updatedAt: now },
    ...spaceIds.map((id, i) => ({ id, name: `Space ${i}`, kind: 'whiteboard', rev: 0, createdAt: at(i), updatedAt: at(i), chats: ['ui-keeper'] })),
  ],
});
for (const id of spaceIds) write(path.join(boards, `${id}.json`), { version: 1, id, rev: 0, items: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, kind: 'text', text: 'benchmark text', at: { x: i, y: i } })) });

const executablePath = findChromium();
const chromium = executablePath ? await loadPlaywright() : null;
if (!chromium) {
  throw Error('benchmark requires Chromium and playwright-core; no timings collected');
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
  cwd: REPO,
  env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1', SEQUENCE_USER_DIR: userDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.resume();
child.stderr.resume();

/** In the page: arm a one-shot probe for `rowSel` and the confirm button `okSel`; resolves with the two timings. */
const ARM = ([okSel, goneSel]) =>
  new Promise((resolve, reject) => {
    if (!document.querySelector(goneSel)) return reject(Error('timed row absent before confirmation'));
    window.__deleteProbeArmed = true;
    const gone = () => !document.querySelector(goneSel);
    const onClick = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(okSel)) return;
      document.removeEventListener('click', onClick, true);
      const t0 = performance.now();
      let timeout;
      const done = (dom) => {
        clearTimeout(timeout);
        requestAnimationFrame(() => resolve({ dom, frame: performance.now() - t0 }));
      };
      if (gone()) return done(0);
      const mo = new MutationObserver(() => {
        if (!gone()) return;
        mo.disconnect();
        done(performance.now() - t0);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      timeout = setTimeout(() => {
        mo.disconnect();
        resolve({ dom: null, frame: null });
      }, 8000);
    };
    document.addEventListener('click', onClick, true);
  }).then((r) => r);

const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPO, encoding: 'utf8'}).trim(), node: process.version, kind: 'real built app in Chromium, click to row gone, page clock; throwaway home; synthetic fixture', samples, rows: [] };
const browser = await chromium.launch(launchOptions(executablePath));
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/acp/agents`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }

  async function open(tabs, active, width = 1440) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) }));
    await ctx.addInitScript(([t, a]) => {
      localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: t.map((id) => ({ id, minimized: false })), active: a }));
      localStorage.setItem('v3.chatW', '480');
    }, [tabs, active]);
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { ctx, page };
  }

  /* ── chats ── */
  {
    const { ctx, page } = await open(['chat'], 'chat');
    await page.locator(`[data-testid="s2-session"][data-session-id="${chatIds[0]}"]`).waitFor({ state: 'visible', timeout: 30000 });
    const dom = [];
    const frame = [];
    for (let i = 0; i < samples; i++) {
      const id = chatIds[i];
      const row = page.locator(`[data-testid="s2-session"][data-session-id="${id}"]`);
      await row.scrollIntoViewIfNeeded();
      await row.hover();
      await row.locator('.s2-it-more').click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.locator('[data-testid="s2-confirm-delete"]').waitFor({ state: 'visible' });
      if (i === 0) await page.screenshot({ path: path.join(out, 'chat-before.png') });
      await page.evaluate(() => { window.__deleteProbeArmed = false; });
      const armed = page.evaluate(ARM, ['[data-testid="s2-confirm-delete-ok"]', `[data-session-id="${id}"]`]);
      await page.waitForFunction(() => window.__deleteProbeArmed === true);
      await page.locator('[data-testid="s2-confirm-delete-ok"]').click();
      const r = await armed;
      if (r.dom === null) throw Error(`chat ${id} row never went`);
      dom.push(r.dom);
      frame.push(r.frame);
      if (i === 0) await page.screenshot({ path: path.join(out, 'chat-after.png') });
      await sleep(300);
    }
    result.rows.push({ kind: 'chat', domMs: dom.map(round), frameMs: frame.map(round), medianDomMs: round(pct(dom, 0.5)), p95DomMs: round(pct(dom, 0.95)), medianFrameMs: round(pct(frame, 0.5)), p95FrameMs: round(pct(frame, 0.95)) });
    await ctx.close();
  }

  /* ── Spaces ── */
  {
    const { ctx, page } = await open(['chat', 'whiteboard'], 'whiteboard');
    await page.locator('[data-testid="wb-boards"]').waitFor({ state: 'visible', timeout: 30000 });
    await sleep(1500);
    const dom = [];
    const frame = [];
    for (let i = 0; i < samples; i++) {
      const id = spaceIds[i];
      if (i === 0) await page.screenshot({ path: path.join(out, 'space-start.png') });
      const direct = page.locator(`[data-testid="board-tab-delete-${id}"]`);
      if (!(await direct.isVisible())) {
        await page.locator('[data-testid="wb-boards"] [data-testid="board-tab-fold"]').click();
        await page.locator(`[data-testid="board-tab-fold-delete-${id}"]`).click();
      } else {
        await direct.click();
      }
      await page.locator('[data-testid="board-delete-confirm"]').waitFor({ state: 'visible' });
      if (i === 0) await page.screenshot({ path: path.join(out, 'space-before.png') });
      await page.evaluate(() => { window.__deleteProbeArmed = false; });
      const armed = page.evaluate(ARM, ['[data-testid="board-delete-ok"]', `[data-testid*="${id}"]`]);
      await page.waitForFunction(() => window.__deleteProbeArmed === true);
      await page.locator('[data-testid="board-delete-ok"]').click();
      const r = await armed;
      if (r.dom === null) throw Error(`space ${id} never went`);
      dom.push(r.dom);
      frame.push(r.frame);
      if (i === 0) await page.screenshot({ path: path.join(out, 'space-after.png') });
      await sleep(300);
    }
    result.rows.push({ kind: 'space', domMs: dom.map(round), frameMs: frame.map(round), medianDomMs: round(pct(dom, 0.5)), p95DomMs: round(pct(dom, 0.95)), medianFrameMs: round(pct(frame, 0.5)), p95FrameMs: round(pct(frame, 0.95)) });
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  for (const r of result.rows) console.log(JSON.stringify({ kind: r.kind, medianDomMs: r.medianDomMs, p95DomMs: r.p95DomMs, medianFrameMs: r.medianFrameMs, p95FrameMs: r.p95FrameMs }));
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
