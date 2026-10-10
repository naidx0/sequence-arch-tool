// Headless browser only; no analyzer, user settings, desktop capture or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findChromium, launchOptions, loadPlaywright } from '../../e2e/lib/chromium.mjs';
import { buildProblem, serveDist } from '../../e2e/lib/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const out = path.join(root, 'tmp-shots/r9-shell');
fs.mkdirSync(out, { recursive: true });
assert(process.env.SEQUENCE_USER_DIR, 'SEQUENCE_USER_DIR must be isolated');
assert.equal(buildProblem(), null, 'build the current web2 source first');
const executable = findChromium();
assert(executable, 'a real Chromium binary is required; this gate must not skip');
const chromium = await loadPlaywright();
assert(chromium, 'playwright-core is required');
const server = await serveDist();
const browser = await chromium.launch({ ...launchOptions(executable), args: [...launchOptions(executable).args, '--disable-gpu'] });
const errors = [];
const tracked = execFileSync('git', ['ls-files', 'packages/web2/src', 'docs/brand/graphite/pages'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const previewPath = tracked.find(p => p.endsWith('.html'));
assert(previewPath, 'the real repository must have an HTML preview specimen');
// Real repository filenames at repository scale; every file remains filterable.
const tree = { name: '', path: '', type: 'directory', children: tracked.map(p => ({ name: path.basename(p), path: p, type: 'file' })) };
const sessions = Array.from({ length: 80 }, (_, i) => ({ id: `session-${i}`, title: `Architecture chat ${i}`, createdAt: '2026-10-07T09:00:00Z', updatedAt: '2026-10-07T09:00:00Z' }));
const index = { version: 1, activeId: sessions[0].id, sessions };
const routes = {
  '/api/sessions': { index, scope: 'workspace', repos: [] },
  '/api/status': { attached: false },
  '/api/workspace': { root: '/isolated/workspace', exists: true, entries: [] },
  '/api/tree': tree,
  '/api/recent': { recent: [] },
  '/api/browse': { root: root.replaceAll('\\', '/'), path: root.replaceAll('\\', '/'), parent: null, entries: [] },
};
const box = async locator => {
  const b = await locator.boundingBox();
  assert(b, 'expected a visible element');
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
};
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function closeAll(page) {
  const closes = page.locator('[data-testid^="v3-tab-close-"]');
  // Re-resolve first after each state change; nth locators shift on close.
  const bound = await page.locator('[data-tab-id]').count();
  for (let n = 0; await closes.count() > 0; n++) {
    assert(n < bound, 'close-all exceeded the derived surface count');
    await closes.first().click();
  }
}
try {
  for (const width of [1440, 1024]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 768 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let fileOperations = 0;
    page.setDefaultTimeout(10000);
    console.log(`STEP mounted home ${width} ${theme}`);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== server.base) { errors.push(`external request ${url.origin}`); return route.abort(); }
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/archgraph.json') return route.continue();
      if (url.pathname === '/api/file-op') {
        fileOperations++;
        assert.equal(route.request().method(), 'POST');
        const operation = route.request().postDataJSON();
        assert.equal(operation.op, 'move');
        assert.equal(operation.path, previewPath);
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Destination already exists' }) });
      }
      if (url.pathname === '/api/file' && url.searchParams.get('path') === previewPath) {
        return route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(path.join(root, previewPath), 'utf8') });
      }
      const body = routes[url.pathname];
      return route.fulfill({ status: body === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body ?? { error: 'not served in this isolated test' }) });
    });
    await page.addInitScript(theme => {
      localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }], active: 'chat' }));
      localStorage.setItem('seq.theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      window.sequence = { platform: 'win32', shell: async () => ({ maximized: false }) };
    }, theme);
    await page.goto(server.base);
    const skip = page.getByRole('button', { name: 'Continue without a project' });
    await skip.waitFor();
    await skip.click();
    await skip.waitFor({ state: 'hidden' });
    await page.getByTestId('s2-session').first().waitFor();
    await closeAll(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme, 'saved theme must survive startup');
    await settle(page);
    const footer = await box(page.getByTestId('v3-rail-settings'));
    const status = await box(page.locator('.s2-status'));
    assert(footer.bottom <= status.y, 'Settings must remain above status with 80 chats');
    const rows = await page.getByTestId('s2-session').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    assert(rows.every(h => h >= 28), `chat rows shrink: ${Math.min(...rows)}`);
    assert(await page.locator('.s2-groups').evaluate(el => el.scrollHeight > el.clientHeight), 'dense chats must scroll');
    const pills = await page.locator('[data-tab-id]').evaluateAll(els => els.map(el => el.dataset.tabId));
    for (const ctl of await page.getByTestId('shell-window-controls').locator('button').all()) {
      assert.equal(await ctl.evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag', 'native window controls are no-drag');
    }
    await page.screenshot({ path: path.join(out, `home-${width}-${theme}.png`) });
    for (const id of pills) {
      const pill = page.getByTestId(`s2-tab-${id}`);
      await pill.scrollIntoViewIfNeeded();
      const hit = await pill.evaluate(el => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const overlaps = [...document.querySelectorAll('.s2-drag')].some(d => {
          const b = d.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        });
        return { clickable: !!top && el.contains(top), overlaps, region: getComputedStyle(el).webkitAppRegion };
      });
      assert(hit.clickable && !hit.overlaps && hit.region !== 'drag', `${id}: blocked home control ${JSON.stringify(hit)}`);
      await pill.click();
      await page.locator(`[data-surface-pane="${id}"]`).waitFor();
      await settle(page);
      const pane = await box(page.locator(`[data-surface-pane="${id}"]`));
      assert(pane.bottom <= status.y + 1, `${id}: surface overlaps status`);
      const names = await page.locator('.s2-seg-l').evaluateAll(els => els.map(el => getComputedStyle(el).display));
      assert(names.every(d => d !== 'none'), `${id}: every surface name must be visible`);
      await page.getByTestId(`v3-tab-close-${id}`).click();
    }
    await page.getByTestId('s2-tab-architecture').click();
    console.log(`STEP fullscreen/split/preview ${width} ${theme}`);
    await page.getByTestId('s2-pane-full-architecture').click();
    assert(await page.getByTestId('s2-chat').isHidden(), 'fullscreen default workspace hides Chat');
    await page.waitForFunction(() => document.querySelector('[data-surface-pane="architecture"]')?.getBoundingClientRect().width >= window.innerWidth - 24);
    const full = await box(page.locator('[data-surface-pane="architecture"]'));
    assert(full.width >= width - 24, 'fullscreen default workspace uses the window width');
    await page.getByTestId('s2-pane-full-architecture').click();
    await page.getByTestId('s2-tab-files').click();
    await settle(page);
    if (width === 1024) {
      assert(await page.getByTestId('s2-chat').isHidden(), '1024 split must focus Workspace');
      await page.getByTestId('s2-focus-chat').click();
      assert(await page.getByTestId('s2-chat').isVisible(), 'Chat remains available');
      await page.getByTestId('s2-focus-workspace').click();
    }
    const stage = await box(page.locator('.s2-stage'));
    for (const value of ['0.25', '0.33', '0.5', '0.67', '0.75']) {
      await page.getByRole('combobox', { name: 'Split ratio' }).selectOption(value);
      await settle(page);
      const first = await box(page.locator('[data-surface-pane]').first());
      assert(Math.abs(first.width / (stage.width - 8) - Number(value)) < 0.01, `split ratio ${value}`);
    }
    await page.getByRole('combobox', { name: 'Split ratio' }).selectOption('0.5');
    await page.getByTestId('files-filter').fill(path.basename(previewPath));
    await page.locator(`[data-path="${previewPath}"]`).click();
    await page.getByTestId('files-preview-frame').waitFor();
    await settle(page);
    const preview = await box(page.getByTestId('files-preview-frame'));
    assert(preview.width >= 270, `preview is a tiny strip: ${preview.width}`);
    assert(preview.height >= 400, `preview height: ${preview.height}`);
    await page.screenshot({ path: path.join(out, `split-preview-${width}-${theme}.png`) });
    console.log(`STEP file organization refusal ${width} ${theme}`);
    await page.getByTestId('files-tree-toggle').click();
    await page.getByRole('tree', { name: 'Files' }).focus();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'New name' }).fill('../escape.html');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    assert.equal(fileOperations, 0, 'traversal must not reach the mutation route');
    await page.getByRole('textbox', { name: 'New name' }).fill('owner-seat-renamed.html');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByText('Destination already exists', { exact: true }).waitFor();
    assert.equal(fileOperations, 1);
    assert.equal(await page.locator(`[data-path="${previewPath}"]`).count(), 1, 'refused rename preserves its row');
    await page.screenshot({ path: path.join(out, `file-refusal-${width}-${theme}.png`) });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    console.log(`STEP close-all/Open project ${width} ${theme}`);
    await closeAll(page);
    if (await page.getByTestId('s2-sidebar-open').isVisible()) await page.getByTestId('s2-sidebar-open').click();
    await page.getByTestId('s2-open-project').click();
    await page.getByTestId('attach-path').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).count(), 1, 'Open project has one close control');
    const attach = await box(page.getByTestId('attach'));
    const attachHost = await box(page.getByTestId('v3-overlay-attach'));
    assert(Math.abs(attach.width - attachHost.width) <= 2, 'Open project must fill its single frame');
    await page.screenshot({ path: path.join(out, `open-project-${width}-${theme}.png`) });
    await page.keyboard.press('Escape');
    await context.close();
    console.log(`PASS home/rail/status ${width} ${theme}; ${tracked.length} real file paths, ${sessions.length} chats`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
console.log(`PASS screenshots: ${out}`);
