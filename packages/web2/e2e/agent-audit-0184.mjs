import fs from 'node:fs';
import { sel, settle, suite } from './lib/harness.mjs';

const phase = process.argv[2] ?? 'before';
const out = `tmp-shots/agent-audit-0184/${phase}`;
fs.mkdirSync(out, { recursive: true });
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
await suite('agent-audit-0184', async ({ page, base, log, check }) => {
  let probeFails = false;
  await page.route('**/api/**', r => r.fulfill(json({ error: 'Controlled audit: endpoint unavailable' }, 503)));
  await page.route('**/api/acp/agents', r => r.fulfill(json({ agents: [] })));
  await page.route('**/api/acp/catalog', r => r.fulfill(json({ agents: [], registryFetchedAt: null })));
  await page.route('**/api/onboarding/providers*', r => r.fulfill(probeFails ? json({ error: 'Probe unavailable' }, 503) : json({ providers: [
    { id: 'codex', label: 'Codex', installed: true, version: '1', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: '' },
    { id: 'claude', label: 'Claude Code', installed: false, version: null, state: 'install', signInCommand: 'claude auth login', installHint: 'npm install -g @anthropic-ai/claude-code' },
  ] })));
  for (const width of [390, 1024, 1440]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.evaluate(t => localStorage.setItem('seq.theme', t), theme);
    await page.reload();
    const shot = async name => { await settle(page); const p = `${out}/${width}-${theme}-${name}.png`; await page.screenshot({ path: p }); log(p); };
    await shot('overview');
    await page.locator(sel('v3-model-trigger')).first().click();
    await page.locator(sel('s2-connect-line-claude')).waitFor();
    await shot('connect');
    await page.keyboard.press('Escape');
    if (!(await page.locator(sel('v3-rail-settings')).count())) await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
    await page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first().click();
    for (const tab of ['agents', 'models', 'skills', 'app', 'safety', 'workspace']) {
      await page.locator(sel(`settings-nav-${tab}`)).click();
      await page.waitForTimeout(350);
      await shot(`settings-${tab}`);
    }
    // Reload removes the overlay, keeping browser storage owned by this test.
    await page.reload();
    probeFails = true;
    await page.locator(sel('v3-model-trigger')).first().click();
    await page.waitForTimeout(350);
    await shot('probe-failed');
    log('probe failure menu text:', await page.locator('[role="menu"]').first().innerText());
    probeFails = false;
    if (phase !== 'before') {
      await check(`${width} ${theme}: failed discovery is visible and Retry restores Connect`, async () => {
        const failure = page.locator(sel('s2-connect-read-failure'));
        await failure.waitFor();
        const bounds = await failure.boundingBox();
        if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width) throw new Error('failure outside viewport');
        await failure.getByRole('button', { name: 'Retry' }).click();
        await page.locator(sel('s2-connect-go-codex')).waitFor();
        if (await failure.count()) throw new Error('failure remained after recovery');
      });
    }
  }
});
