/* A rendered, isolated owner-walk: never opens the real desktop or user store. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './lib/isolatedEnv.mjs';
import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';
import { buildProblem } from '../../packages/web2/e2e/lib/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const problem = buildProblem();
if (problem) throw new Error(problem);
const source = path.resolve(arg('--repo', path.join(root, 'packages/analyzer/test/fixtures/shopfront')));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-completion-walk-'));
const repo = path.join(temp, 'repo');
fs.cpSync(source, repo, { recursive: true, filter: p => !/[\\/](node_modules|\.git|\.claude|\.sequence|dist|release|server-bundle)([\\/]|$)/.test(p.slice(source.length)) });
const shots = path.resolve(arg('--shots', path.join(root, 'tmp-shots/completion')));
fs.mkdirSync(shots, { recursive: true });
const tag = arg('--tag', 'current');
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const workspace = process.argv.includes('--workspace');
const child = spawn(process.execPath, [path.join(root, 'packages/analyzer/dist/cli.js'), 'app', '--no-open', '--port', String(port), ...(workspace ? [] : ['--repo', repo])], { env: isolatedEnv(process.env, { userDir: path.join(temp, 'user') }), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
child.stdout.on('data', data => { serverOutput += data; });
child.stderr.on('data', data => { serverOutput += data; });
const failures = [];
let browser;
const check = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); } };
try {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${serverOutput.slice(-1200)}`);
    try { if ((await fetch(`${base}/api/status`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`server startup timed out: ${serverOutput.slice(-1200)}`);
    await new Promise(r => setTimeout(r, 100));
  }
  const executablePath = findChromium();
  const chromium = await loadPlaywright();
  if (!executablePath || !chromium) throw new Error('Chromium or playwright-core unavailable');
  browser = await chromium.launch(launchOptions(executablePath));
  for (const theme of ['dark', 'light']) {
    for (const [width, height] of [[1440, 900], [1024, 700]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
      const page = await ctx.newPage();
      await page.addInitScript(({ theme }) => {
        localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{id:'chat', minimized:false}, {id:'architecture', minimized:true}, {id:'files', minimized:true}, {id:'whiteboard', minimized:true}, {id:'terminal', minimized:true}, {id:'browser', minimized:true}], active:'chat' }));
        localStorage.setItem('seq.theme', theme);
        sessionStorage.setItem('sequence.onboarding.skip', '1');
        document.documentElement.dataset.theme = theme;
      }, { theme });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid="s2-tab-architecture"]').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="shell"]'));
      await page.locator('#boot-splash').waitFor({ state:'hidden', timeout:10000 });
      await page.locator('#static-shell').waitFor({ state:'hidden', timeout:10000 });
      // Exercise the user's actual close-all gesture, not merely seeded storage.
      for (const close of await page.locator('[data-testid^="v3-tab-close-"]').all()) {
        if (await close.isVisible()) await close.click();
      }
      await page.waitForFunction(() => document.querySelector('.s2-row')?.getAttribute('data-stage') === 'none');
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'persisted theme survives application startup');
      await page.evaluate(async () => { await document.fonts.ready; for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });
      const id = `${tag}-${theme}-${width}`;
      await page.screenshot({ path: path.join(shots, `${id}-home.png`) });
      await check(`${id} home launcher opens architecture`, async () => {
        await page.locator('[data-testid="s2-tab-architecture"]').click({ timeout: 4000 });
        await page.locator('[data-surface-pane="architecture"]').waitFor({ state:'visible', timeout:6000 });
        if (!workspace) {
          await page.waitForFunction(() => {
            const board = document.querySelector('[data-testid="board"]');
            return board && board.getAttribute('data-layout') === 'idle' && Number(board.getAttribute('data-node-count')) > 0 && Number(board.getAttribute('data-zoom')) > 0 && board.getAttribute('data-animating') !== 'true';
          }, null, { timeout: 20000 });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
      });
      await check(`${id} Settings footer fits above status`, async () => {
        const values = await page.evaluate(() => {
          const foot = document.querySelector('.s2-panel-foot') ?? document.querySelector('[data-testid="s2-settings"]');
          const status = document.querySelector('[data-testid="s2-status"]') ?? document.querySelector('.s2-status');
          return { foot:foot?.getBoundingClientRect().bottom ?? null, status:status?.getBoundingClientRect().top ?? innerHeight, height:innerHeight };
        });
        if (values.foot === null) throw new Error('Settings footer missing');
        if (values.foot > Math.min(values.status, values.height) + 1) throw new Error(JSON.stringify(values));
      });
      await page.screenshot({ path: path.join(shots, `${id}-board.png`) });
      await ctx.close();
    }
  }
  console.log(JSON.stringify({ source, shots, failures }, null, 2));
} finally {
  await browser?.close();
  const exit = new Promise(resolve => { if(child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  child.kill();
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 3000))]);
  // Keep this owned temp specimen for reproducible failures; never delete the source repo.
}
if (failures.length) process.exitCode = 1;
