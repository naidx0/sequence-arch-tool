#!/usr/bin/env node
/** Browser is deliberately unshipped (chromeTabModel.SHIPPED_SURFACES).
 * Reject a persisted legacy browser layout; never launch a real provider or
 * fetch an external page to certify a surface the user cannot open.
 * BrowserPane's fetch rendering stays locked by browserPaneFetch0184.test.tsx.
 */
import { suite, sel, is, settle } from './lib/harness.mjs';

await suite('browser-pane', async ({ page, base, check, requests }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sequence.onboarding.skip', '1');
    localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'browser', minimized: false }], active: 'browser' }));
  });
  await page.goto(base);
  await page.locator(sel('shell')).waitFor();
  await settle(page);
  await check('the unshipped Browser surface has no tab, composer action or pane', async () => {
    for (const id of ['workspace-tab-browser', 's2-tab-browser', 'composer-browser', 'browser-pane']) is(await page.locator(sel(id)).count(), 0, id);
    is(await page.locator('[data-surface="browser"], [data-surface-pane="browser"]').count(), 0, 'browser surface');
  });
  await check('a legacy Browser layout is rejected and chat remains usable', async () => {
    await page.locator(sel('v3-composer-input')).fill('A fresh chat stays available.');
    is(await page.locator(sel('v3-composer-input')).inputValue(), 'A fresh chat stays available.', 'composer text');
    is(requests.filter(url => url.includes('/api/net-fetch')).length, 0, 'network fetches from hidden surface');
  });
}, { routes: { '/api/status': { attached: false, attaching: false }, '/api/sessions': { index: { version: 1, activeId: null, sessions: [] }, scope: 'workspace', repos: [] } } });
