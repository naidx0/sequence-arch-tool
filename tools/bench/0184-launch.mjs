// Real Sequence source, exported once; only the disposable specimen receives scan state.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { isolatedEnv } from '../measure/lib/isolatedEnv.mjs';
import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const root = process.cwd();
const work = path.resolve(process.argv[2]);
const label = process.argv[3] ?? 'baseline';
const source = process.argv[4];
fs.mkdirSync(work, { recursive: true });
const repo = path.join(work, 'sequence');
const marker = path.join(work, '.0184-launch-specimen');
if (fs.existsSync(repo) && !fs.existsSync(marker)) throw new Error('refusing an existing directory without this benchmark\'s specimen marker');
if (!fs.existsSync(repo)) {
  fs.mkdirSync(repo);
  if (source) {
    const { IGNORE_DIRS } = await import('../../packages/analyzer/dist/ignoreDirs.js');
    const copy = (from, to) => {
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if ((e.name.startsWith('.') && e.name !== '.env') || (e.isDirectory() && IGNORE_DIRS.has(e.name))) continue;
        const dest = path.join(to, e.name);
        if (e.isDirectory()) { fs.mkdirSync(dest); copy(path.join(from, e.name), dest); }
        else if (e.isFile()) fs.copyFileSync(path.join(from, e.name), dest);
      }
    };
    copy(source, repo);
  } else {
  const archive = path.join(work, 'source.tar');
  execFileSync('git', ['archive', 'b6edb6e71', '-o', archive]);
  execFileSync('tar', ['-xf', archive, '-C', repo]);
  }
  fs.writeFileSync(marker, 'Disposable launch specimen; created by tools/bench/0184-launch.mjs\n');
}
const count = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) =>
  n + (e.name === '.sequence' ? 0 : e.isDirectory() ? count(path.join(dir, e.name)) : e.isFile() ? 1 : 0), 0);
// Each cold run removes ONLY this tool's disposable scan state.
fs.rmSync(path.join(repo, '.sequence'), { recursive: true, force: true });
const home = fs.mkdtempSync(path.join(work, 'home-'));
const args = ['--import', './tools/test-guard/no-real-binaries.mjs',
  path.join(root, 'packages/analyzer/dist/cli.js'), 'app', '--no-open', '--port', '4387', '--repo', repo];
const env = isolatedEnv({ ...process.env, HOME: home, USERPROFILE: home,
  SEQUENCE_SCAN_PROFILE: '1', SEQUENCE_BOOT_PROFILE: '1' }, { userDir: path.join(home, 'user') });
const result = { label, source: source ?? 'git archive b6edb6e71', input: repo, files: count(repo), node: process.version, command: [process.execPath, ...args], stages: [] };
let log = '';
const t0 = performance.now();
const mark = (stage, extra = {}) => { const m = { stage, ms: Math.round(performance.now() - t0), ...extra }; result.stages.push(m); console.log(JSON.stringify(m)); fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify(result, null, 2)); };
const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
child.stdout.on('data', (b) => { log += b; });
child.stderr.on('data', (b) => { log += b; fs.writeFileSync(path.join(work, `${label}.log`), log); });
const base = 'http://127.0.0.1:4387';
let browser;
try {
  const deadline = performance.now() + 25 * 60_000;
  let listening = false;
  while (performance.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(3000) });
      const s = await r.json();
      if (!listening) {
        listening = true;
        mark('server-ready', { status: s });
        const pw = await loadPlaywright();
        browser = await pw.launch(launchOptions(findChromium()));
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.on('pageerror', (e) => { result.browserErrors ??= []; result.browserErrors.push(e.message); });
        void (async () => {
          await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120_000 });
          mark('dom-ready');
          await page.screenshot({ path: path.join(work, `${label}-early.png`) });
          result.textareas = await page.locator('textarea').evaluateAll((els) => els.map((e) => ({ id: e.dataset.testid, parent: e.parentElement.dataset.testid })));
          const skip = page.locator('[data-testid="first-run-skip"]');
          if (await skip.isVisible()) { await skip.click(); mark('onboarding-dismissed'); }
          /* First-usable is the first moment the reader can type. The
             scan notice may still be in the corner; do not wait for
             `boot-scanning` to detach (that wait was the 20-minute window). */
          await page.locator('[data-testid="composer-field"]').waitFor({ state: 'visible', timeout: 30_000 });
          mark('composer-visible');
          await page.locator('[data-testid="composer-field"]').fill('launch measurement', { timeout: 30_000 });
          mark('first-usable');
          await page.screenshot({ path: path.join(work, `${label}.png`) });
        })().catch((e) => { result.browserFailure = e.message; });
      }
      if (s.attached) { mark('scan-attached', { status: s }); break; }
      if (s.attachFailure) throw new Error(JSON.stringify(s.attachFailure));
    } catch (e) { if (child.exitCode !== null) throw e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!result.stages.some((s) => s.stage === 'scan-attached')) throw new Error('attach deadline');
  const browserDeadline = performance.now() + 120_000;
  while (!result.stages.some((s) => s.stage === 'first-usable') && !result.browserFailure && performance.now() < browserDeadline)
    await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1000));
} finally {
  await browser?.close();
  child.kill();
  result.childExit = await exited;
  fs.writeFileSync(path.join(work, `${label}.log`), log);
  fs.writeFileSync(path.join(work, `${label}.json`), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
if (result.browserFailure || !result.stages.some((s) => s.stage === 'first-usable')) {
  throw new Error(result.browserFailure ?? 'browser never became usable');
}
