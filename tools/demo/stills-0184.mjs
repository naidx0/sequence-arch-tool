#!/usr/bin/env node
/*
 * The 0.1.8.4 stills: the real built app on a neutral copy of the shopfront fixture, dark and light, desktop and phone.
 *
 *   node tools/demo/stills-0184.mjs --out <dir> [--work <dir>] [--port 4292]
 *
 * The chat is a real connection to tools/measure/fake-openai.mjs, so the answer streams through the real ask pipeline; its text
 * is written below by hand and is NOT output of a model. Needs the repo built (pnpm build) and Chromium (PLAYWRIGHT_BROWSERS_PATH
 * or packages/web2/e2e/lib/chromium.mjs). Writes <name>.png (device scale 2) and <name>.webp (quality 85) per still.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');
const { findChromium, launchOptions } = await import(url.pathToFileURL(path.join(ROOT, 'packages', 'web2', 'e2e', 'lib', 'chromium.mjs')).href);
const { startFakeOpenAI } = await import(url.pathToFileURL(path.join(ROOT, 'tools', 'measure', 'fake-openai.mjs')).href);

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const OUT = path.resolve(arg('--out', path.join(ROOT, 'site', 'public', 'demo', 'v0184')));
const WORK = path.resolve(arg('--work', path.join(os.tmpdir(), 'seq-stills-0184')));
const PORT = Number(arg('--port', '4292'));
const APP = `http://127.0.0.1:${PORT}`;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

const QUESTION = 'Explain this architecture: the main services, how they talk to each other, and where the data lives.';
const ANSWER = [
  'Shopfront is a small storefront. **Edge** is the only public entry; it forwards to the **Gateway**, which routes each request to one of four services.',
  '',
  '- **Orders** (Python, FastAPI) takes the order and publishes `OrderCreated`.',
  '- **Shipping** (Go) and **Notifications** subscribe to `OrderCreated`.',
  '- **Payments** and **Invoices** are called by Orders over HTTP.',
  '- **Orders**, **Payments** and **Inventory** all read and write one Postgres database; Redis is configured but nothing connects to it.',
  '',
  'Source: gateway/src/index.ts:12, orders/app/main.py:31',
].join('\n');

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'home'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'user'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const REPO = path.join(WORK, 'home', 'shopfront');
fs.cpSync(path.join(ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront'), REPO, { recursive: true, filter: (s) => !/[\\/](\.sequence|node_modules)([\\/]|$)/.test(s) });
const git = (...a) => spawnSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', '-c', 'core.autocrlf=false', ...a], { cwd: REPO, encoding: 'utf8' });
git('init', '-q');
fs.appendFileSync(path.join(REPO, '.git', 'info', 'exclude'), '.sequence/\n');
git('add', '-A');
git('commit', '-q', '-m', 'initial');

const fake = await startFakeOpenAI(({ user }) => (/^Name this chat/i.test(user) ? 'Explaining the shopfront architecture' : ANSWER), { delayMs: 150 });
const app = spawn(process.execPath, [path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js'), 'app', '--repo', REPO, '--port', String(PORT), '--no-open'], {
  env: { ...process.env, HOME: path.join(WORK, 'home'), USERPROFILE: path.join(WORK, 'home'), SEQUENCE_USER_DIR: path.join(WORK, 'user') },
  cwd: path.join(WORK, 'home'),
  stdio: 'ignore',
});
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`${APP}/api/sessions`)).ok) break; } catch {}
  await sleep(500);
}

const written = [];
async function still(page, name) {
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish())).catch(() => {});
  await sleep(350);
  const png = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: png });
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '85', png.replace(/\.png$/, '.webp')]);
  written.push(name);
  console.log('  ', name);
}

const browser = await chromium.launch(launchOptions(findChromium()));
async function open(theme, w, h, { connect }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme, hasTouch: w < 600 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('seq.theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(APP);
  await tid(page, 'shell').waitFor({ timeout: 60000 });
  await tid(page, 'board-node').first().waitFor({ timeout: 90000 }).catch(() => {});
  await sleep(1500);
  return { ctx, page };
}

try {
  const put = await fetch(`${APP}/api/ai-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai-compatible', baseUrl: fake.baseUrl, model: 'demo-model', apiKey: 'demo' }) });
  if (!put.ok) throw new Error(`connect the stand-in model: ${put.status}`);

  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open(theme, 1440, 900, {});
    const t = theme;
    /* The dark pass leaves its chat in the project; the light pass starts from a fresh one so both read the same. */
    await tid(page, 's2-new-chat').click();
    await sleep(900);
    await still(page, `home-${t}`);
    const field = tid(page, 'composer-field').first();
    await field.click();
    await field.fill(QUESTION);
    await page.keyboard.press('Enter');
    await page.getByText('Source: gateway/src/index.ts').first().waitFor({ timeout: 30000 });
    await sleep(900);
    await still(page, `ask-answer-${t}`);
    for (const id of ['files', 'whiteboard', 'agents', 'terminal']) {
      await tid(page, `s2-tab-${id}`).click();
      await sleep(900);
      await still(page, `surface-${id}-${t}`);
    }
    await tid(page, 's2-tab-architecture').click();
    await sleep(700);
    for (const id of ['workflows', 'components', 'profiles', 'skills']) {
      await tid(page, `rail-nav-${id}`).click();
      await sleep(700);
      await still(page, `rail-${id}-${t}`);
    }
    await tid(page, 'v3-rail-settings').click();
    await sleep(1200);
    await still(page, `settings-${t}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await sleep(700);
    await still(page, `commands-${t}`);
    await page.keyboard.press('Escape');
    await tid(page, 'board-node-title').first().click();
    await sleep(700);
    await still(page, `board-node-${t}`);
    await tid(page, 'board-view-menu').click();
    await sleep(500);
    await still(page, `board-view-menu-${t}`);
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open(theme, 390, 844, {});
    await still(page, `phone-chat-${theme}`);
    await page.getByRole('button', { name: /sidebar|menu|open drawer/i }).first().click({ timeout: 4000 }).catch(() => {});
    await sleep(600);
    await still(page, `phone-drawer-${theme}`);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.getByText('Workspace', { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
    await sleep(900);
    await still(page, `phone-board-${theme}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'STILLS.json'), JSON.stringify({ app: 'built from this tree', model: 'tools/measure/fake-openai.mjs (hand-written answer, not model output)', stills: written }, null, 2));
} finally {
  await browser.close();
  app.kill();
  void fake.close();
}
process.exit(0);
