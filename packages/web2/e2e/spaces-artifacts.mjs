import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../../analyzer/dist/server/repoServer.js';
import { drawTool } from '../../mcp/dist/boardTools.js';
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-spaces-artifacts-'));
const root = path.join(temp, 'project');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'compose.yaml'), 'services:\n  specimen:\n    image: alpine:3\n');
fs.writeFileSync(path.join(root, 'artifact.html'), '<!doctype html><html><body><h1>Delivered artifact</h1><p>Isolated HTML preview</p></body></html>');
const server = await createRepoServer(root, { webDist: path.resolve('packages/web2/dist'), browseRoot: temp, userConfigDir: path.join(temp, 'user'), recentStoreDir: path.join(temp, 'recent'), providerSearch: { pathValue: '', extraDirs: [] }, detectLocal: async () => [], terminalEnabled: false });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await (await loadPlaywright()).launch({ ...launchOptions(), executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const noScan = async () => { throw Error('No scan'); };
try {
  // Playwright also injects this into the opaque, sandboxed artifact frame.
  // Only the app's top-level document owns these shell preferences.
  await page.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('sequence.welcome.seen', 'true'); localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }], active: 'chat' })); });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('[data-testid="space-delivery"][data-ready="true"]')?.getAttribute('data-chat'));
  const chat = await page.locator('[data-testid="space-delivery"]').getAttribute('data-chat');
  assert.ok(chat, 'app attached its active chat and initialized artifact delivery while Spaces is closed');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'); g.fillStyle = '#2060a0'; g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#ffffff'; g.font = '24px sans-serif'; g.fillText('Delivered image', 40, 90);
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(path.join(root, 'artifact.png'), Buffer.from(png, 'base64'));
  const result = await drawTool({ repoPath: root, file: 'artifact.html', ops: [] }, noScan, { SEQUENCE_CHAT: chat });
  console.log('HTML_TOOL', JSON.stringify(result));
  assert.equal(JSON.parse(result.content[0].text).destination.surface, 'preview');
  const deliveries = () => JSON.parse(fs.readFileSync(path.join(root, '.sequence/boards/file-deliveries.json'), 'utf8'));
  assert.deepEqual(deliveries().find((d) => d.chat === chat), JSON.parse(result.content[0].text).delivery);
  const preview = page.locator('[data-testid="space-artifact-preview"]');
  await preview.waitFor({ state: 'visible', timeout: 10000 });
  await page.frameLocator('[data-testid="files-preview-frame"]').getByRole('heading', { name: 'Delivered artifact' }).waitFor();
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.screenshot({ path: path.join(temp, 'spaces-html.png') });
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  // Another chat's file delivery cannot open over this person's surface.
  const beforeForeign = await page.locator('[data-testid="space-delivery"]').getAttribute('data-update');
  await drawTool({ repoPath: root, file: 'artifact.html', ops: [] }, noScan, { SEQUENCE_CHAT: 'other-chat' });
  await page.waitForFunction((before) => document.querySelector('[data-testid="space-delivery"]')?.getAttribute('data-update') !== before, beforeForeign);
  assert.equal(await preview.count(), 0, 'another chat cannot reveal an artifact');
  await drawTool({ repoPath: root, file: 'artifact.png', ops: [] }, noScan, { SEQUENCE_CHAT: chat });
  await preview.waitFor({ state: 'visible' });
  const image = page.locator('[data-testid="files-preview-image"]');
  await image.waitFor({ state: 'visible' });
  await page.waitForFunction(() => { const img = document.querySelector('[data-testid="files-preview-image"]'); return img?.complete && img.naturalWidth === 320 && img.naturalHeight === 180; });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  const box = await image.boundingBox();
  console.log('IMAGE_BOUNDS', JSON.stringify(box));
  assert.ok(box && box.width >= 320 && box.height >= 180 && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900, 'decoded image is visibly on screen');
  assert.deepEqual(await image.evaluate((img) => { const c = document.createElement('canvas'); c.width = 1; c.height = 1; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return [...g.getImageData(0, 0, 1, 1).data]; }), [32, 96, 160, 255]);
  assert.equal(deliveries().find((d) => d.chat === chat).path, 'artifact.png');
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.screenshot({ path: path.join(temp, 'spaces-image.png') });
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: path.join(temp, 'spaces-artifact-failure.png') });
  throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  console.log('ISOLATED_INPUT', temp);
}
