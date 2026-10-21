// Built UI + real analyzer/repository shell, keyless loopback fake provider.
// Run from repo root with the no-real-binaries guard. Never launches an agent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChromium, launchOptions, loadPlaywright, closeBrowser } from './lib/chromium.mjs';
import { buildProblem } from './lib/serve.mjs';
import { settle } from './lib/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'tmp-shots/0184-traces');
const REPO = process.env.TRACE_REPO || ROOT;
const paragraphs = [
  '## Inspect the entry point\nI will read the repository entry point. The next paragraph will follow the caller.',
  'Follow the imports from the entry point.',
  'Keep each path tied to the repository evidence.',
  'Check whether the caller is exported.',
  'Inspect the tests for that caller.',
  'Read the configuration before drawing a conclusion.',
  'A long path should wrap: packages/web2/src/very-long-provider-exposed-path-without-spaces/another-long-segment/entry-point.ts',
  'Report the observed limits. Do not guess about files that were not read.',
];
const reasoning = paragraphs.join('\n\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(200); }
  throw new Error(`Timeout: ${label}`);
}
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const problem = buildProblem();
assert.equal(problem, null);
const executable = findChromium();
assert.ok(executable, 'Chromium required; SKIP is not a pass');
const chromium = await loadPlaywright();
assert.ok(chromium);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-traces-'));
const userDir = path.join(tmp, '.sequence');
fs.mkdirSync(userDir);
fs.mkdirSync(OUT, { recursive: true });
let finish;
let requests = 0;
const provider = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    if (req.url?.includes('/models')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'trace-fake', object: 'model' }] }));
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!body.stream) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Trace visual verification' } }] }));
      return;
    }
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const delta = (d) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: d }] })}\n\n`);
    // Genuine provider-format deltas; split mid-paragraph to exercise accumulation.
    for (let i = 0; i < reasoning.length; i += 47) {
      delta({ reasoning_content: reasoning.slice(i, i + 47) });
      await sleep(15);
    }
    await new Promise((resolve) => { finish = resolve; });
    delta({ content: '## Simulated provider answer\n\nThis run verifies the trace renderer against a real repository shell. The reasoning above is a scripted test payload.' });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
const providerPort = await listen(provider);
fs.writeFileSync(path.join(userDir, 'ai.json'), JSON.stringify({ profiles: [{ id: 'trace-fake', name: 'Trace fake (test)', provider: 'openai-compatible', model: 'trace-fake', baseUrl: `http://127.0.0.1:${providerPort}/v1` }], defaultProfileId: 'trace-fake' }));
fs.writeFileSync(path.join(userDir, 'agents.json'), JSON.stringify({ agents: [] }));
const reserve = http.createServer();
const port = await listen(reserve);
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'tools/test-guard/no-real-binaries.mjs')).href, path.join(ROOT, 'packages/analyzer/dist/cli.js'), 'app', '--no-open', '--port', String(port), '--repo', REPO], {
  cwd: ROOT,
  env: { ...process.env, SEQUENCE_USER_DIR: userDir, HOME: tmp, USERPROFILE: tmp },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (b) => { serverLog += b; });
child.stderr.on('data', (b) => { serverLog += b; });
const browser = await chromium.launch(launchOptions(executable));
let page;
try {
  await until('real repository attached', async () => {
    if (child.exitCode !== null) throw new Error(`Analyzer exited ${child.exitCode}: ${serverLog}`);
    try { return (await (await fetch(`${base}/api/status`)).json()).attached === true; } catch { return false; }
  }, 180000);
  const status = await (await fetch(`${base}/api/status`)).json();
  console.log('Real repository attached:', REPO);
  fs.writeFileSync(path.join(OUT, 'repo-status.json'), JSON.stringify({ repo: REPO, status }, null, 2));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/onboarding/providers*', (r) => r.fulfill({ json: { providers: [] } }));
  await context.addInitScript(() => { localStorage.setItem('sequence.toolDetail', 'focused'); });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const T = (id) => page.getByTestId(id);
  await page.goto(base);
  await T('composer-field').waitFor({ timeout: 60000 });
  // A first-run dialog is an actual control, not a CSS bypass.
  const close = page.getByRole('button', { name: /get started|continue|close|skip/i });
  if (await page.getByRole('dialog').count()) {
    console.log('dialog:', await page.getByRole('dialog').innerText());
    if (await close.count()) await close.first().click();
  }
  await T('composer-field').fill('Explain the entry point for this repository.');
  await T('composer-field').press('Enter');
  await until('provider reasoning', async () => Boolean(finish));
  await T('v3-thinking-fold').waitFor();
  assert.equal(await T('v3-thinking-fold').getAttribute('aria-expanded'), 'false');
  await T('v3-thinking-fold').click();
  await until('six visible steps', async () => await T('reasoning-step').count() === 6);
  await T('reasoning-more').focus();
  await page.keyboard.press('Enter');
  assert.equal(await T('reasoning-step').count(), 8);
  assert.equal(await T('v3-thinking-fold').getAttribute('aria-expanded'), 'true');
  const measurements = [];
  for (const theme of ['dark', 'light']) {
    for (const width of [1440, 900, 420]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await T('reasoning-trace').scrollIntoViewIfNeeded();
      await settle(page);
      const metrics = await T('reasoning-trace').evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, rect: el.getBoundingClientRect().toJSON() }));
      assert.ok(metrics.scroll <= metrics.client + 1, `trace overflows at ${width}/${theme}: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.rect.width > 100 && metrics.rect.x >= 0 && metrics.rect.right <= width, 'trace inside viewport');
      measurements.push({ theme, width, ...metrics });
      await page.screenshot({ path: path.join(OUT, `live-${width}-${theme}.png`) });
    }
  }
  finish();
  await T('v3-turn-thought').waitFor({ timeout: 30000 });
  assert.equal(await T('v3-turn-thought').getAttribute('aria-expanded'), 'false');
  await T('v3-turn-thought').click();
  await T('reasoning-more').click();
  assert.equal(await T('reasoning-step').count(), 8);
  assert.equal(await T('v3-turn-thought').getAttribute('aria-expanded'), 'true');
  await settle(page);
  await page.screenshot({ path: path.join(OUT, 'completed-420-light.png') });
  assert.equal(requests, 1, 'one fake provider turn');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(measurements, null, 2));
  console.log('PASS: actual provider-format reasoning deltas → real analyzer → built UI; live/completed folds, keyboard expand, 3 widths x 2 themes, no trace overflow/page errors.');
  console.log('Shots:', OUT);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(OUT, 'failure.png') });
  console.error(error);
  process.exitCode = 1;
} finally {
  finish?.();
  fs.writeFileSync(path.join(OUT, 'server.log'), serverLog);
  await closeBrowser(browser);
  child.kill();
  provider.closeAllConnections();
  provider.close();
}
