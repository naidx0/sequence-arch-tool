import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../../analyzer/dist/server/repoServer.js';
import { createBoardTool, drawTool } from '../../mcp/dist/boardTools.js';
import { visualTool } from '../../mcp/dist/visualTools.js';
import { findComponent } from '../../schema/dist/visual/index.js';
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-spaces-live-'));
const root = path.join(temp, 'project');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'README.md'), '# Isolated live Space delivery');
fs.writeFileSync(path.join(root, 'compose.yaml'), 'services:\n  specimen:\n    image: alpine:3\n');
const server = await createRepoServer(root, {
  webDist: path.resolve('packages/web2/dist'), browseRoot: temp,
  userConfigDir: path.join(temp, 'user'), recentStoreDir: path.join(temp, 'recent'),
  providerSearch: { pathValue: '', extraDirs: [] }, detectLocal: async () => [], terminalEnabled: false,
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const chromium = await loadPlaywright();
const browser = await chromium.launch({ ...launchOptions(), executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shots = process.env.SHOTS_DIR || temp;
fs.mkdirSync(shots, { recursive: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.addInitScript((closed) => {
    if (window !== window.top) return;
    if (!localStorage.getItem('v3.chromeTabs')) localStorage.setItem('v3.chromeTabs', JSON.stringify(closed ? { tabs: [{ id: 'chat', minimized: false }], active: 'chat' } : { tabs: [{ id: 'chat', minimized: false }, { id: 'whiteboard', minimized: false }], active: 'whiteboard' }));
    localStorage.setItem('sequence.welcome.seen', 'true');
  }, process.env.CLOSED_SPACES === '1');
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('[data-testid="space-delivery"][data-ready="true"]')?.getAttribute('data-chat'));
  const chat = await page.locator('[data-testid="space-delivery"]').getAttribute('data-chat');
  assert.ok(chat, 'app attached an active chat and learned its delivery snapshot');
  console.log('READY', page.url(), chat);
  const env = { SEQUENCE_CHAT: chat };
  if (process.env.CLOSED_SPACES === '1') {
    assert.equal(await page.locator('[data-testid="wb-boards"]').count(), 0, 'Spaces is initially closed');
  } else await page.locator('[data-testid="wb-boards"]').waitFor({ timeout: 30000 });
  const made = createBoardTool({ repoPath: root, name: 'Live delivery' }, env);
  const id = JSON.parse(made.content[0].text).created.id;
  const input = { repoPath: root, board: id, ops: [{ op: 'add', type: 'rect', id: 'delivery-box', x: 100, y: 100, w: 280, h: 160, text: 'Delivered live' }] };
  const result = await drawTool(input, async () => { throw Error('No scan needed'); }, env);
  console.log('INPUT', JSON.stringify(input), 'RETURN', JSON.stringify(result));
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.sequence/boards', `${id}.json`), 'utf8'));
  console.log('SAVED', JSON.stringify(saved));
  assert.equal(saved.items.length, 1);
  const payload = JSON.parse(result.content[0].text);
  assert.deepEqual(payload.destination, { project: root, chat, surface: 'whiteboard', board: id, saved: true, opened: false });
  const metadata = JSON.parse(fs.readFileSync(path.join(root, '.sequence/boards/index.json'), 'utf8')).boards.find((b) => b.id === id);
  assert.deepEqual(metadata.delivery, { chat, rev: saved.rev });
  await page.locator(`[data-testid="board-tab-${id}"]`).waitFor({ timeout: 10000 }).catch(async (error) => {
    await page.screenshot({ path: path.join(shots, 'spaces-live-delivery.png') });
    throw error;
  });
  await page.waitForFunction((id) => document.querySelector('[data-testid="wb-boards"]')?.getAttribute('data-board') === id, id, { timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: path.join(shots, 'spaces-live-delivery.png') });
  console.log('BROWSER', await page.locator('[data-testid="wb-boards"]').getAttribute('data-board'), 'screenshots', shots);
  assert.equal(await page.locator('[data-testid="wb-boards"]').getAttribute('data-board'), id, 'live tool drawing selects its destination');
  const rect = page.locator('[data-item-id="delivery-box"] rect[data-testid="wb-item"]');
  await rect.waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('Delivered live', { exact: true }).waitFor({ state: 'visible' });
  assert.deepEqual(await rect.evaluate((el) => ['x', 'y', 'width', 'height'].map((k) => el.getAttribute(k))), ['100', '100', '280', '160']);
  const bounds = await rect.boundingBox();
  assert.ok(bounds && bounds.width >= 279 && bounds.height >= 159 && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1440 && bounds.y + bounds.height <= 900, 'delivered SVG rectangle is on screen at its saved size');
  await page.screenshot({ path: path.join(shots, 'spaces-live-delivery.png') });
  // Active-board updates use the real board stream, including after the pane was opened by delivery.
  const updated = await drawTool({ repoPath: root, board: id, ops: [{ op: 'update', id: 'delivery-box', w: 320 }] }, async () => { throw Error('No scan needed'); }, env);
  assert.equal(updated.isError, undefined);
  await page.waitForFunction(() => document.querySelector('[data-item-id="delivery-box"] rect[data-testid="wb-item"]')?.getAttribute('width') === '320');
  // Another chat's explicit delivery must neither select nor display its board.
  const other = JSON.parse(createBoardTool({ repoPath: root, name: 'Other chat' }, { SEQUENCE_CHAT: 'other-chat' }).content[0].text).created.id;
  const refreshed = page.waitForResponse((r) => r.url().includes('/api/boards?chat=') && r.status() === 200);
  await drawTool({ repoPath: root, board: other, ops: [{ op: 'add', type: 'rect', id: 'private-box', x: 0, y: 0 }] }, async () => { throw Error('No scan needed'); }, { SEQUENCE_CHAT: 'other-chat' });
  // Wait for a completed scoped list refresh after the write, not a blind sleep.
  await refreshed;
  assert.equal(await page.locator('[data-testid="wb-boards"]').getAttribute('data-board'), id);
  assert.equal(await page.locator(`[data-testid="board-tab-${other}"]`).count(), 0);
  // Same chat and board identifiers in a different project cannot change this project's document.
  const otherRoot = path.join(temp, 'other-project');
  fs.mkdirSync(otherRoot);
  const foreign = JSON.parse(createBoardTool({ repoPath: otherRoot, name: 'Live delivery' }, env).content[0].text).created.id;
  assert.equal(foreign, id);
  const ownBytes = fs.readFileSync(path.join(root, '.sequence/boards', `${id}.json`), 'utf8');
  const foreignResult = await drawTool({ repoPath: otherRoot, board: foreign, ops: [{ op: 'add', type: 'rect', id: 'foreign-project-box', x: 20, y: 20 }] }, async () => { throw Error('No scan needed'); }, env);
  assert.equal(JSON.parse(foreignResult.content[0].text).destination.project, otherRoot);
  assert.equal(fs.readFileSync(path.join(root, '.sequence/boards', `${id}.json`), 'utf8'), ownBytes);
  const ownUpdate = await drawTool({ repoPath: root, board: id, ops: [{ op: 'update', id: 'delivery-box', w: 340 }] }, async () => { throw Error('No scan needed'); }, env);
  assert.equal(ownUpdate.isError, undefined);
  await page.waitForFunction(() => document.querySelector('[data-item-id="delivery-box"] rect[data-testid="wb-item"]')?.getAttribute('width') === '340');
  assert.equal(await page.locator('[data-item-id="foreign-project-box"]').count(), 0);
  // A generated image/chart has an explicit SVG object destination on a Space.
  const chart = JSON.parse(createBoardTool({ repoPath: root, name: 'Chart delivery' }, env).content[0].text).created.id;
  const visual = visualTool({ repoPath: root, board: chart, component: 'bar', spec: findComponent('bar').example }, env);
  assert.equal(visual.isError, undefined);
  await page.waitForFunction((id) => document.querySelector('[data-testid="wb-boards"]')?.getAttribute('data-board') === id, chart);
  const image = page.locator('[data-item-id^="visual-"] [data-kind="svg"] svg');
  await image.waitFor({ state: 'visible' });
  assert.ok(await image.locator('rect, path').count() > 0, 'chart SVG contains rendered marks');
  await page.screenshot({ path: path.join(shots, 'spaces-live-chart.png') });
  const imageBounds = await image.boundingBox();
  const tabsBounds = await page.locator(`[data-testid="board-tab-${chart}"]`).boundingBox();
  assert.ok(imageBounds.y > tabsBounds.y + tabsBounds.height, 'chart content clears the Spaces tab strip');
  const chartInk = await image.locator('text').first().evaluate((el) => getComputedStyle(el).fill);
  assert.notEqual(chartInk, 'rgb(27, 27, 31)', 'chart labels use the app theme rather than the light fallback on a dark canvas');
  // Legacy local scenes are read beside the saved objects; opening them cannot clear disk content.
  await page.locator(`[data-testid="board-tab-${id}"]`).click();
  const boardFile = path.join(root, '.sequence/boards', `${id}.json`);
  const beforeLegacy = fs.readFileSync(boardFile, 'utf8');
  const legacy = JSON.stringify({ version: 1, items: [{ kind: 'scene', id: 'legacy-scene', at: { x: 100, y: 350 }, w: 480, h: 260, duration: 0, keyframes: [null, { t: 'bad' }] }] });
  await page.evaluate(({ id, legacy, project }) => {
    localStorage.setItem(`sequence.scenes.${JSON.stringify([project, id])}`, legacy);
    localStorage.setItem(`sequence.scenes.${id}`, JSON.stringify({ version: 1, items: [{ kind: 'scene', id: 'unscoped-scene', at: { x: 100, y: 350 }, w: 480, h: 260, duration: 4000, keyframes: [] }] }));
  }, { id, legacy, project: root });
  const loadingWrites = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/boards\/[^/]+\/ops$/.test(r.url())) loadingWrites.push(r.url()); });
  await page.reload();
  await page.locator('[data-item-id="delivery-box"] rect[data-testid="wb-item"]').waitFor({ state: 'visible' });
  await page.locator('[data-item-id="legacy-scene"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-item-id="unscoped-scene"]').count(), 0, 'unassigned legacy scenes do not leak into a project');
  const oldBytes = await page.evaluate((id) => localStorage.getItem(`sequence.scenes.${id}`), id);
  const noticeBounds = await page.locator('[data-testid="wb-legacy-scenes"]').boundingBox();
  const stripBounds = await page.locator('[data-testid="board-tabs"]').boundingBox();
  assert.ok(noticeBounds.y >= stripBounds.y + stripBounds.height, 'legacy assignment clears the floating tabs');
  await page.screenshot({ path: path.join(shots, 'spaces-legacy-import.png') });
  await page.getByRole('button', { name: 'Import into this board', exact: true }).click();
  await page.locator('[data-item-id="unscoped-scene"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(shots, 'spaces-legacy-scene.png') });
  assert.equal(fs.readFileSync(boardFile, 'utf8'), beforeLegacy, 'opening a legacy scene preserves the populated board byte for byte');
  assert.deepEqual(loadingWrites, [], 'hydration sends no destructive or replacement ops');
  assert.equal(await page.evaluate((id) => localStorage.getItem(`sequence.scenes.${id}`), id), oldBytes);
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: path.join(shots, 'spaces-live-failure.png') });
  fs.writeFileSync(path.join(shots, 'spaces-live-dom.html'), await page.content());
  console.log('PAGE_ERRORS', errors);
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log('ISOLATED_INPUT', temp);
}
