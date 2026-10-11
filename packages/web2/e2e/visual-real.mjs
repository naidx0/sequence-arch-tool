#!/usr/bin/env node
/**
 * (lane visual, v3) The chat drawings against the REAL repo server with a repository attached: /api/drawings saves
 * (ids, file names, idempotent on reload), the linked-file card is drawn from the real /api/file, Reference puts the id
 * in the composer. Only the agent runs are faked. Shots go to $SHOTS (default .../t3gap/visual/shots/v3).
 * Needs `pnpm --filter @sequence/web2 build` and the analyzer built. Skips with no Chromium.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/harness-study/t3gap/visual/shots/v3';
fs.mkdirSync(OUT, { recursive: true });
const exe = findChromium();
const pw = await loadPlaywright();
if (!exe || !pw) {
  console.log('[visual-real] SKIP: no Chromium / playwright-core');
  process.exit(0);
}
process.env.SEQUENCE_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-vr-user-'));
const analyzer = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../analyzer/dist/index.js')).href);
const { createRepoServer } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../analyzer/dist/server/repoServer.js')).href);
void analyzer;
const sessions = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../analyzer/dist/server/sessionsStore.js')).href);

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-vr-repo-')));
fs.mkdirSync(path.join(repo, 'out'));
fs.writeFileSync(path.join(repo, 'out', 'chart.html'), '<style>b{color:var(--seq-accent)}</style><p style="margin:0">Written by the agent to <b>out/chart.html</b>, read through the real file route.</p>');
fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo"}');
const { id: chat } = sessions.createSession(repo);

const SVG = ['```svg', '<svg viewBox="0 0 360 120" xmlns="http://www.w3.org/2000/svg"><title>Request path</title>', '<rect x="10" y="40" width="80" height="40" rx="8" fill="none" stroke="currentColor"/><text x="50" y="65" text-anchor="middle" fill="currentColor" font-size="13">Client</text>', '<rect x="140" y="40" width="80" height="40" rx="8" fill="none" stroke="currentColor"/><text x="180" y="65" text-anchor="middle" fill="currentColor" font-size="13">Proxy</text>', '<rect x="270" y="40" width="80" height="40" rx="8" fill="none" stroke="currentColor"/><text x="310" y="65" text-anchor="middle" fill="currentColor" font-size="13">Limiter</text></svg>', '```'].join('\n');
const HTML = ['```html', '<title>Requests per window</title><style>.bar{height:14px;border-radius:7px;background:var(--seq-accent);margin:4px 0}.card{border:1px solid var(--seq-edge);background:var(--seq-surface);border-radius:10px;padding:10px 12px}small{color:var(--seq-muted)}</style>', '<div class="card"><b>Requests per window</b> <small>before and after the fix</small><div class="bar" style="width:92%"></div><div class="bar" style="width:31%"></div></div>', '```'].join('\n');
const TEXT = `The window is keyed on the proxy address. The path, then the effect of the fix.\n\n${SVG}\n\n${HTML}\n\nThe full chart is [chart.html](${path.join(repo, 'out', 'chart.html')}).`;
const run = { id: 't1', agentRef: 'claude', sessionId: chat, prompt: 'Draw why the rate limiter returns 200 under load', text: TEXT, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null, tools: [] };
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };

const webDist = path.resolve(import.meta.dirname, '../dist');
const server = await createRepoServer(repo, { webDist });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.launch(launchOptions(exe));
let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`[visual-real] ok   ${label}`);
  } catch (e) {
    failed += 1;
    console.log(`[visual-real] FAIL ${label}: ${e.message}`);
  }
};
const driDir = path.join(repo, '.sequence', 'drawings', `c-${chat}`);
try {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [run] }) }));
    await page.goto(base);
    await page.evaluate((t) => { try { localStorage.setItem('seq.theme', t); } catch {} document.documentElement.setAttribute('data-theme', t); }, theme);
    await page.reload();
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.locator('[data-testid="chat-html-frame"]').nth(1).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="chat-card-title"]')].filter((n) => /\nd\d+/.test(n.getAttribute('title') ?? '')).length >= 3, null, { timeout: 10000 });
    await page.waitForTimeout(800);
    await check(`${theme}: the linked file card is drawn from the real /api/file (repo attached)`, async () => {
      const docs = await page.locator('[data-testid="chat-html-frame"]').evaluateAll((els) => els.map((e) => e.getAttribute('srcdoc')));
      if (!docs.some((d) => d.includes('read through the real file route'))) throw new Error('no linked-file card');
    });
    /* (lane cards) the id and file name are in each card title's tooltip ("<Title>\nd3, 3-name.svg"). */
    await check(`${theme}: each block has an id and file name from the real store, and nothing is added by a reload`, async () => {
      const ids = (await page.locator('[data-testid="chat-card-title"]').evaluateAll((ns) => ns.map((n) => (n.getAttribute('title') ?? '').split('\n').pop())));
      if (ids.length < 2 || !ids.every((t) => /^d\d+(?: v\d+)?$/.test(t.trim()))) throw new Error(JSON.stringify(ids));
      const files = fs.readdirSync(driDir).sort();
      await page.reload();
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="chat-card-title"]')].filter((n) => /\nd\d+/.test(n.getAttribute('title') ?? '')).length >= 3, null, { timeout: 10000 });
      const again = fs.readdirSync(driDir).sort();
      if (JSON.stringify(files) !== JSON.stringify(again)) throw new Error(`files changed on reload: ${files} -> ${again}`);
      const ids2 = (await page.locator('[data-testid="chat-card-title"]').evaluateAll((ns) => ns.map((n) => (n.getAttribute('title') ?? '').split('\n').pop())));
      if (JSON.stringify(ids) !== JSON.stringify(ids2)) throw new Error(`ids changed: ${ids} -> ${ids2}`);
    });
    await page.waitForTimeout(600);
    await page.locator('[data-testid="chat-html-frame"]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/inline-visuals-${theme}.png` });
    await page.locator('[data-testid="chat-diagram"]').first().hover();
    await page.locator('[data-testid="chat-visual-reference"]').first().click({ force: true });
    await check(`${theme}: Reference puts @drawing:<id> in the composer and shows the tokens it adds`, async () => {
      const v = await page.locator('section.s2-chat textarea').first().inputValue();
      if (!/@drawing:d\d+ /.test(v)) throw new Error(`draft "${v}"`);
      const label = (await page.locator('[data-testid="chat-visual-reference"]').first().getAttribute('data-tip')) ?? '';
      if (!/adds ~\d+ tokens/.test(label)) throw new Error(label);
    });
    await page.locator('section.s2-chat textarea').first().type('make the boxes wider');
    await page.screenshot({ path: `${OUT}/reference-earlier-drawing-${theme}.png` });
    await check(`${theme}: the server serves the app with frame-src 'self'`, async () => {
      const h = (await page.request.get(base)).headers()['content-security-policy'];
      if (h !== "frame-src 'self'") throw new Error(String(h));
    });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `[visual-real] ${failed} FAILED` : '[visual-real] all checks passed');
process.exit(failed ? 1 : 0);
