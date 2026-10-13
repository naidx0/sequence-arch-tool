// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
// @ts-expect-error Existing Chromium helper is plain .mjs.
import { findChromium, launchOptions, loadPlaywright } from '../../../e2e/lib/chromium.mjs';

let server: Server;
let browser: any;
let page: any;
let base: string;
const shots = mkdtempSync(join(tmpdir(), 'seq-board-completion-shots-'));
const errors: string[] = [];
beforeAll(async () => {
  const binary = findChromium();
  if (!binary) throw new Error('Chromium required for this bounded rendered gate');
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const root = resolve(__dirname);
  const outDir = mkdtempSync(join(tmpdir(), 'seq-board-completion-build-'));
  await build({ root, configFile: false, logLevel: 'error', plugins: [react()], define: { __SEQUENCE_COMMIT__: JSON.stringify('specimen') }, build: { outDir, emptyOutDir: true, rollupOptions: { input: join(root, 'completionSpecimen.html') } } });
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const file = join(outDir, pathname === '/' ? 'completionSpecimen.html' : decodeURIComponent(pathname));
    if (!resolve(file).startsWith(resolve(outDir))) { res.writeHead(403).end(); return; }
    try { const body = readFileSync(file); res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${address.port}`;
  browser = await (await loadPlaywright()).launch(launchOptions(binary));
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('pageerror', (e: Error) => errors.push(e.message));
}, 180000); // a vite build plus a Chromium launch: setup, not the behaviour under test; 60 s timed out on a loaded machine
afterAll(async () => { await browser?.close(); await new Promise<void>(done => server ? server.close(() => done()) : done()); });

async function open(width = 900) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto(base);
  await page.waitForSelector('[data-testid="annot-capture"]');
  await page.evaluate(() => document.fonts.ready);
}
async function zoom(z: number) {
  await page.getByRole('button', { name: `Zoom ${z}`, exact: true }).click();
  await page.waitForFunction((z: number) => Number(document.querySelector('[data-testid="board"]')?.getAttribute('data-zoom')) === z, z);
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
async function coords(id: string) {
  return page.evaluate((id: string) => {
    const items = JSON.parse(document.querySelector('[data-testid="stored-marks"]')!.textContent!);
    const item = items.find((i: { id: string }) => i.id === id);
    return item.kind === 'shape' ? item.from : item.at;
  }, id);
}

it.each([.25, 1])('mounted Select drags SVG/text/sticky at zoom %s; preview and persisted delta agree', async z => {
  await open();
  await zoom(z);
  for (const id of ['rect', 'text', 'sticky']) {
    const mark = page.locator(`[data-annot-id="${id}"]`);
    const r = await mark.boundingBox();
    if (!r) throw new Error('no mark');
    const before = await coords(id);
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y + 15);
    const preview = await mark.boundingBox();
    expect(preview.x - r.x).toBeCloseTo(20, 0);
    expect(preview.y - r.y).toBeCloseTo(15, 0);
    await page.mouse.up();
    const after = await coords(id);
    expect(after.x - before.x).toBeCloseTo(20 / z, 4);
    expect(after.y - before.y).toBeCloseTo(15 / z, 4);
    const moved = await mark.boundingBox();
    expect(moved.x - r.x).toBeCloseTo(20, 0);
    expect(moved.y - r.y).toBeCloseTo(15, 0);
  }
  await page.screenshot({ path: join(shots, `drag-${z}.png`) });
  expect(errors).toEqual([]);
}, 20000);

it('camera and hidden pane cancel an in-progress mounted drag', async () => {
  await open();
  await zoom(1);
  for (const action of ['Zoom 0.25', 'Toggle pane']) {
    const mark = page.locator('[data-annot-id="rect"]');
    const r = await mark.boundingBox();
    const before = await coords('rect');
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 20, r.y + r.height / 2 + 10);
    /* A keyboard activation keeps pointer capture until the pane/camera changes. */
    await page.getByRole('button', { name: action, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.mouse.up();
    expect(await coords('rect')).toEqual(before);
    expect(await mark.getAttribute('data-annot-selected')).toBeNull();
  }
}, 15000);

it.each([900, 360])('all adjacent agent chips stay readable and clear of marks/cards at %s px', async width => {
  await open(width);
  for (const z of [1, .25]) {
    await zoom(z);
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    try { await page.waitForFunction(() => document.querySelectorAll('[data-agent-here="live"][data-agent-chip]').length === 3, undefined, { timeout: 3000 }); }
    catch {
      await page.screenshot({ path: join(shots, `chip-failure-${width}-${z}.png`) });
      throw new Error(JSON.stringify(await page.evaluate(() => ({ cards: Array.from(document.querySelectorAll('[data-testid="board-node"]')).map(el => el.outerHTML.slice(0, 600)), pane: document.querySelector('.react-flow')?.getBoundingClientRect().toJSON() }))) + ` screenshots: ${shots}`);
    }
    /* The chip is the card's ::after, counter-scaled to constant screen size and anchored above its card
       (board.css, THE AGENT CHIP): rebuild its screen box from the card's box and the pseudo's used style. */
    const measured = await page.evaluate(() => {
      const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const z = Number(document.querySelector('[data-testid="board"]')?.getAttribute('data-zoom') ?? 1);
      const k = z / Math.max(z, 0.25);
      const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-here="live"][data-agent-chip]')).map(el => {
        const cs = getComputedStyle(el, '::after');
        const px = (v: string) => parseFloat(v) || 0;
        const card = rect(el);
        const pad = cs.boxSizing === 'border-box' ? [0, 0] : [px(cs.paddingLeft) + px(cs.paddingRight), px(cs.paddingTop) + px(cs.paddingBottom)];
        const w = (px(cs.width) + pad[0]!) * k;
        const h = (px(cs.height) + pad[1]!) * k;
        const lift = (px(cs.bottom) - el.offsetHeight) * z;
        const x = el.getAttribute('data-agent-chip-side') === 'end' ? card.x + card.w - w : card.x;
        return { x, y: card.y - lift - h, w, h, card, text: el.getAttribute('data-agent-chip'), font: px(cs.fontSize) * k, hidden: el.getAttribute('data-agent-chip-hidden') === 'true' || cs.display === 'none' };
      });
      return { chips,
        evidence: Array.from(document.querySelectorAll('[data-testid="board-node"], [data-annot-id], [data-testid="board-edge-label"], .edgeline')).map(rect), pane: rect(document.querySelector('.react-flow')!) };
    });
    expect(measured.chips).toHaveLength(3);
    const intersects = (a: any, b: any) => a.x < b.x + b.w - .5 && a.x + a.w > b.x + .5 && a.y < b.y + b.h - .5 && a.y + a.h > b.y + .5;
    measured.chips.forEach((chip: any, i: number) => {
      expect(chip.hidden).toBe(false);
      expect(chip.font).toBeGreaterThanOrEqual(11);
      expect(chip.text).toContain('Main agent: editing');
      /* A chip hangs from its card: it must be inside the pane wherever its card is on screen. */
      if (chip.card.x < measured.pane.x + measured.pane.w - 1) {
        expect(chip.x).toBeGreaterThanOrEqual(measured.pane.x);
        expect(chip.x + chip.w).toBeLessThanOrEqual(measured.pane.x + measured.pane.w + .5);
      }
      expect(measured.chips.slice(i + 1).some((other: any) => intersects(chip, other))).toBe(false);
      /* The chip sits above its own card; no other card, mark or label may lie under it. */
      const same = (a: any, b: any) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
      expect(measured.evidence.filter((other: any) => !same(other, chip.card)).some((other: any) => intersects(chip, other))).toBe(false);
    });
    await page.screenshot({ path: join(shots, `chips-${width}-${z}.png`) });
  }
  await page.getByRole('button', { name: 'Empty board', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-agent-chip]').length === 0);
  expect(errors).toEqual([]);
  console.log(`Rendered screenshots: ${shots}`);
}, 20000);
