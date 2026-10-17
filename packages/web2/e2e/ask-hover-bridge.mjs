import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CHAT } from './lib/anchors.mjs';
import { is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/** Exit 2, never 1: "the analyzer is not built" is the harness unable to run. */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[ask-hover-bridge] ERROR: the analyzer is not built, nothing to scan');
    console.error('[ask-hover-bridge] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'web2-askhover-e2e-')),
    'archgraph.json',
  );
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[ask-hover-bridge] ERROR: sequence scan failed:', error.message);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const graph = scanRealRepo();

const AFF = '[data-testid="ask-affordance"]';
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

/* ASK HOVER BRIDGE. Owner: "I hover over and it says ask, and then I hover over
   to the ask and it disappears." The Ask button sits a few pixels off the item,
   so the pointer crosses empty board to reach it. Moved in steps, element ->
   gap -> button, the button must be visible at every step and clickable at the
   end. jsdom has no layout and no real pointer travel, so this is a browser test. */
await suite(
  'ask-hover-bridge',
  async ({ page, base, check }) => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector(sel('s2-tab-whiteboard'), { timeout: 20000 });
    await page.click(sel('s2-tab-whiteboard'));
    await settle(page);
    await page.waitForSelector(sel('wb-canvas'), { timeout: 15000 });
    const canvas = await page.locator(sel('wb-canvas')).boundingBox();
    const at = (dx, dy) => [canvas.x + canvas.width / 2 + dx, canvas.y + canvas.height / 2 + dy];

    await check('the Ask button stays while the pointer travels item -> gap -> button, and can be clicked', async () => {
      await page.click('[data-testid="wb-shapes-trigger"]');
      await page.click(sel('wb-tool-rect'));
      const [x1, y1] = at(-160, -80);
      const [x2, y2] = at(-20, 20);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();
      await settle(page);
      await page.click(sel('wb-tool-select'));
      /* Select it by clicking the box. */
      const item = await page.locator(sel('wb-item')).first().boundingBox();
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      /* An unfilled box is hit on its outline, not its middle. */
      const edgeY = item.y + 1;
      await page.mouse.click(cx, edgeY);
      await page.mouse.move(cx + 2, edgeY, { steps: 3 });
      await page.waitForSelector(AFF, { timeout: 3000 });
      const btn = await page.locator(AFF).boundingBox();
      is(btn !== null, true, 'the Ask button appears over the selected item');
      /* The path: from the item's right edge, across the gap, onto the button. */
      const startX = item.x + item.width - 2;
      const endX = btn.x + btn.width / 2;
      const endY = btn.y + btn.height / 2;
      await page.mouse.move(startX, edgeY, { steps: 2 });
      const seen = [];
      const steps = 12;
      for (let i = 1; i <= steps; i += 1) {
        const x = startX + ((endX - startX) * i) / steps;
        const y = edgeY + ((endY - edgeY) * i) / steps;
        await page.mouse.move(x, y);
        await page.waitForTimeout(60);
        seen.push({ i, x: Math.round(x), visible: (await page.locator(AFF).count()) === 1 });
      }
      const gone = seen.filter((s) => !s.visible);
      is(gone.length, 0, 'the Ask button was visible at every step, missing at: ' + JSON.stringify(gone));
      await page.waitForTimeout(700);
      is(await page.locator(AFF).count(), 1, 'the button is still there after resting on it');
      /* The button's pointer area must not cover the item's own edge: dragging from the outline moves the item. */
      const outlineHit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="ask-affordance"]') !== null, [item.x + item.width - 1, item.y + 15]);
      is(outlineHit, false, 'the item outline right edge is not under the Ask button');
      await page.locator(AFF).click({ timeout: 2000 });
      await page.waitForSelector(sel('ask-pop'), { timeout: 3000 }).catch(() => {});
      is(await page.locator('.ask-pop').count() > 0, true, 'clicking the button opens the ask box');
      const pop = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('[data-testid="ask-pop-input"]'));
        return [s.fontSize, s.lineHeight, s.paddingBottom];
      });
      is(JSON.stringify(pop), JSON.stringify(['13px', '18px', '8px']), 'ask-pop-input fs/lh/pb');
    });

    await check('dragging the selected item by its right outline moves it and does not open Ask', async () => {
      await page.keyboard.press('Escape');
      const a = await page.locator(sel('wb-item')).first().boundingBox();
      await page.mouse.click(a.x + a.width / 2, a.y + 1);
      for (let x = a.x + a.width / 2; x <= a.x + a.width - 2; x += 8) await page.mouse.move(x, a.y + 1);
      await page.mouse.move(a.x + a.width - 1, a.y + 15);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width + 36, a.y + 55, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const m = await page.locator(sel('wb-item')).first().boundingBox();
      is(Math.abs(m.x - a.x) > 10 || Math.abs(m.y - a.y) > 10, true, 'the item moved: ' + JSON.stringify([m.x - a.x, m.y - a.y]));
      is(await page.locator('.ask-pop').count(), 0, 'no Ask box opened by the drag');
    });

    await check('the whiteboard ask field and the popover field have the composer-scale type and padding', async () => {
      await page.click(sel('wb-ask'));
      await page.waitForSelector(sel('wb-ask-panel'));
      const wb = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('[data-testid="wb-ask-note"]'));
        return [s.fontSize, s.lineHeight, s.paddingBottom];
      });
      is(JSON.stringify(wb), JSON.stringify(['13px', '18px', '8px']), 'wb-ask-note fs/lh/pb');
    });
  },
  { routes: { '/archgraph.json': graph, ...Object.fromEntries(REFUSED.map((r) => [r, null])) } },
);
