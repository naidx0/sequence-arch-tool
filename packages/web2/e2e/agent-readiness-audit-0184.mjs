import fs from 'node:fs';
import { sel, settle, suite, is } from './lib/harness.mjs';

const out = 'tmp-shots/agent-audit-0184/readiness';
fs.mkdirSync(out, { recursive: true });
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
await suite('agent-readiness-audit-0184', async ({ page, base, check, log, consoleErrors }) => {
  let fail = false;
  let registered = true;
  let sockets = 0;
  const writes = [];
  page.on('request', r => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url()); });
  // No upstream server connection: the real sign-in UI talks only to this controlled socket.
  await page.routeWebSocket('**/*', ws => { sockets++; ws.onMessage(() => {}); });
  await page.route('**/api/**', r => r.fulfill(json({ error: 'Controlled audit unavailable' }, 503)));
  await page.route('**/api/acp/agents', r => r.fulfill(json({ agents: registered ? [{ id: 'codex', label: 'Codex' }] : [] })));
  await page.route('**/api/acp/catalog', r => r.fulfill(json({ agents: [] })));
  await page.route('**/api/acp/capabilities*', r => r.fulfill(json({ models: [], efforts: [], commands: [], skills: [] })));
  await page.route('**/api/onboarding/providers*', r => r.fulfill(fail ? json({ error: 'Controlled probe unavailable' }, 503) : json({ providers: [{ id: 'codex', label: 'Codex', installed: true, version: '1', state: 'signIn', signInCommand: 'codex login', installHint: '' }] })));
  const settings = async () => {
    if (!(await page.locator(sel('v3-rail-settings')).count())) await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
    await page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first().click();
    await page.locator(sel('settings-nav-agents')).click();
  };
  for (const width of [1440, 1024, 390]) for (const theme of ['dark', 'light']) {
    const shot = async name => { await settle(page); const path = `${out}/${width}-${theme}-${name}.png`; await page.screenshot({ path }); log(path); };
    fail = false; registered = true;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.evaluate(t => { localStorage.clear(); localStorage.setItem('seq.theme', t); }, theme);
    await page.reload();
    await page.locator(sel('v3-model-trigger')).click();
    await check(`${width} ${theme}: registered agent has one-click sign-in and cancel/retry`, async () => {
      const start = sockets;
      await page.locator(sel('s2-signin-codex')).click();
      is(await page.locator(sel('s2-agent-note')).innerText(), 'Registered', 'registration is not authentication');
      await page.locator(`${sel('first-run-signin-terminal')}[data-phase="waiting"]`).waitFor();
      is(sockets, start + 1, 'controlled socket opens');
      await shot('picker-signin');
      await page.locator(sel('first-run-signin-cancel')).click();
      await page.locator(sel('first-run-signin-retry')).waitFor();
      await page.locator(sel('first-run-signin-retry')).click();
      await page.locator(`${sel('first-run-signin-terminal')}[data-phase="waiting"]`).waitFor();
      is(sockets, start + 2, 'retry socket opens');
    });
    await page.reload();
    await settings();
    await check(`${width} ${theme}: Settings reports signed-out registration and opens sign-in`, async () => {
      await page.locator(sel('settings-agent-signin')).click();
      await page.locator(`${sel('first-run-signin-terminal')}[data-phase="waiting"]`).waitFor();
      is(await page.locator(sel('settings-agent-status')).innerText(), 'Needs sign-in', 'status');
      await shot('settings-signin');
    });
    fail = true; registered = false;
    await page.reload();
    await settings();
    await check(`${width} ${theme}: failed probe is not an empty result; Retry recovers`, async () => {
      await page.locator(sel('settings-agents-failure')).waitFor();
      is(await page.locator(sel('settings-agents-none')).count(), 0, 'false empty result');
      await shot('settings-probe-failed');
      fail = false;
      await page.locator(sel('settings-agents-retry')).click();
      await page.locator(sel('settings-agent-signin')).waitFor();
      is(await page.locator(sel('settings-agents-failure')).count(), 0, 'failure after recovery');
    });
  }
  await check('no connect/install/auth HTTP writes or uncaught errors', () => {
    is(writes.length, 0, 'API writes');
    is(consoleErrors.filter(e => e.startsWith('uncaught:')).length, 0, 'uncaught errors');
  });
});
