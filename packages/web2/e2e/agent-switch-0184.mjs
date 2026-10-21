/** Built app + real analyzer + throwaway user/repo + fake ACP agents. Probe is intercepted; no vendor binary/login/spend. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';

assert.equal(buildProblem(), null, 'Build current sources first');
const root = path.resolve(WEB2, '../..');
const shots = path.join(root, 'tmp-shots/0184-switch');
fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-switch-0184-'));
const userDir = path.join(tmp, '.sequence');
const repo = path.join(tmp, 'shopfront');
fs.mkdirSync(userDir);
fs.cpSync(path.join(root, 'packages/analyzer/test/fixtures/shopfront'), repo, { recursive: true });
const agents = ['claude', 'codex'].map(id => ({ id, label: `${id} (fake)`, command: process.execPath, args: [path.join(WEB2, 'e2e/fixtures/fake-agents/fake-acp-agent.mjs'), '--as', 'local'] }));
fs.writeFileSync(path.join(userDir, 'agents.json'), JSON.stringify({ agents }));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'packages/analyzer/dist/cli.js'), 'app', '--no-open', '--port', String(port), '--repo', repo], {
  cwd: root, env: { ...process.env, SEQUENCE_USER_DIR: userDir, HOME: tmp, USERPROFILE: tmp, SEQUENCE_BIND_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', b => { serverOutput += b; });
server.stderr.on('data', b => { serverOutput += b; });
async function until(label, fn, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { try { if (await fn()) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${label}`);
}
const chromium = await loadPlaywright();
assert.ok(chromium && findChromium(), 'Chromium required; no silent skip');
const browser = await chromium.launch(launchOptions(findChromium()));
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log(`ok ${checks} - ${name}`); };
try {
  await until('attached', async () => (await (await fetch(`${base}/api/status`)).json()).attached, 60000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let codexReady = true;
  await context.route('**/api/onboarding/providers*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: agents.map(a => ({ id: a.id, state: a.id === 'codex' && !codexReady ? 'signIn' : 'ready', installed: true, version: 'fake', label: a.label })) }) }));
  const page = await context.newPage();
  const errors = [];
  const sentTo = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/acp/run-node') sentTo.push(r.postDataJSON().agentRef); });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('switch-seeded')) {
      localStorage.setItem('sequence.welcome.seen', '1');
      sessionStorage.setItem('switch-seeded', '1');
    }
  });
  await page.goto(base);
  const T = id => page.getByTestId(id);
  await until('composer', () => T('composer-field').isVisible(), 30000);
  // Existing welcome dialogs are dismissed through their visible controls.
  for (const label of ['Get started', 'Continue', 'Skip for now', 'Close']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.isVisible().catch(() => false)) await button.click();
  }
  await until('active chat', () => page.locator('[data-testid="s2-session"] button[aria-current="true"]').count());
  const send = async text => { await T('composer-field').fill(text); await T('composer-field').press('Enter'); };
  const chipText = () => T('switch-countdown').textContent();
  await check('guarded immediate switch selects a ready registered agent', async () => {
    await send('/switch claude');
    await until('claude selected', async () => (await T('switch-notice').textContent()).includes('now uses claude'));
  });
  await check('20-turn rule appears and persists at desktop width', async () => {
    await T('v3-model-trigger').click();
    await page.locator('[data-testid="s2-agent-row"][data-agent="codex"]').click();
    await T('schedule-agent-switch').click();
    assert.equal(await T('composer-field').inputValue(), '/switch codex 20');
    assert.equal(await T('switch-countdown').count(), 0, 'menu seeds the editable command without executing');
    await T('composer-field').press('Enter');
    await until('countdown 20', async () => (await chipText()).includes('20 successful turns'));
    await page.screenshot({ path: path.join(shots, 'desktop-countdown.png') });
    assert.ok(await page.evaluate(() => localStorage.getItem('sequence.chatAgentPicks.v1').includes('switchRule')));
  });
  await check('real fake-provider prompt decrements once and reload does not replay', async () => {
    await send('SWITCH-FAKE-ONE');
    await until('countdown 19', async () => (await chipText()).includes('19 successful turns'), 30000);
    await page.reload();
    await until('restored countdown 19', async () => (await chipText()).includes('19 successful turns'));
  });
  await check('compact countdown and cancel fit and work', async () => {
    await page.setViewportSize({ width: 420, height: 900 });
    await page.screenshot({ path: path.join(shots, 'compact-countdown.png') });
    const box = await T('switch-countdown').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 421);
    await page.getByRole('button', { name: 'Cancel scheduled agent switch' }).click();
    assert.equal(await T('switch-countdown').count(), 0);
    await page.screenshot({ path: path.join(shots, 'compact-cancelled.png') });
  });
  await check('unready and unknown targets refuse without replacing selection', async () => {
    codexReady = false;
    await send('/switch codex');
    await until('not ready refusal', async () => (await T('switch-notice').textContent()).includes('not ready'));
    await send('/switch missing');
    await until('unknown refusal', async () => (await T('switch-notice').textContent()).includes('not connected'));
    codexReady = true;
  });
  await check('exactly two successful turns switch; next prompt targets the new agent', async () => {
    await send('/switch codex 2');
    await until('countdown 2', async () => (await chipText()).includes('2 successful turns'));
    await send('SWITCH-FAKE-TWO');
    await until('countdown 1', async () => (await chipText()).includes('1 successful turn'));
    await send('SWITCH-FAKE-THREE');
    await until('switched', async () => (await T('switch-notice').textContent()).includes('now uses codex'));
    assert.equal(await T('switch-countdown').count(), 0);
    await send('SWITCH-FAKE-FOUR');
    await until('next turn settled', () => T('composer-send').isVisible().catch(() => false), 30000);
    assert.deepEqual(sentTo, ['claude', 'claude', 'claude', 'codex']);
    assert.ok(await page.getByText(/was given this chat so far/).isVisible(), 'existing full-context handoff notice arrives on the new agent turn');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(shots, 'desktop-switched.png') });
  });
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
  console.log(`PASS ${checks}/${checks}; screenshots ${shots}; isolated specimen ${tmp}`);
} finally {
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(tmp, 'server.log'), serverOutput);
}
