#!/usr/bin/env node
/**
 * FILES AND BOARDS (round 9, asks 20 and 24 as far as a real browser can see
 * them; the board asks 25-27 are covered at their own tier and shot below).
 *
 *   - ask 24: with a file open in Files and two more surfaces open, in a
 *     1024 window, the file's preview takes the whole pane (the tree is a
 *     drawer): it is as wide as its pane, and the drawer opens over it from
 *     the header toggle and closes when a file is chosen.
 *   - ask 20: the right-click menu opens on a file row with its seven actions,
 *     and dragging a file onto a folder posts a move to /api/file/op.
 *
 * Shots go to /mnt/project-files/sequence/cloud-pass/shots/cloud/ (SHOTS_DIR
 * overrides), dark and light.
 */
import fs from 'node:fs';
import path from 'node:path';

import { atLeast, is, sel, suite } from './lib/harness.mjs';

const SHOTS = process.env.SHOTS_DIR ?? '/mnt/project-files/sequence/cloud-pass/shots/cloud';
const shot = async (page, name, theme) => {
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `files-boards-${name}-${theme}.png`) });
  } catch (error) {
    console.log('[files-boards] no shot:', error.message);
  }
};

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (Number.isFinite(end)) a.finish();
    }
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const file = (p) => ({ path: p, name: p.split('/').pop(), type: 'file' });
const TREE = {
  path: '',
  name: 'shopfront',
  type: 'dir',
  children: [
    {
      path: 'services',
      name: 'services',
      type: 'dir',
      children: [file('services/gateway.ts'), file('services/orders.ts'), file('services/payments.ts')],
    },
    { path: 'docs', name: 'docs', type: 'dir', children: [file('docs/overview.md')] },
    file('README.md'),
    file('package.json'),
  ],
};
const README = '# Shopfront\n\nA storefront made of a gateway, an orders service and payments.\n\n- gateway: routes requests\n- orders: owns the order lifecycle\n- payments: talks to the processor\n';

await suite(
  'files-boards',
  async ({ page, base, check, log }) => {
    const ops = [];
    await page.route('**/api/file/op', async (route) => {
      ops.push(JSON.parse(route.request().postData() ?? '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.addInitScript(() => {
      try {
        const ids = window.name === 'wide' ? ['chat', 'files'] : ['chat', 'architecture', 'files'];
        localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: ids.map((id) => ({ id, minimized: false })), active: 'files' }));
      } catch {
        /* defaults */
      }
    });

    for (const theme of ['dark', 'light']) {
      ops.length = 0;
      await page.evaluate(() => {
        window.name = '';
      });
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.locator(sel('files-row')).first().waitFor({ state: 'visible', timeout: 15000 });

      await check(`${theme} 1024: with no file open the tree is the pane`, async () => {
        const r = await page.evaluate(() => {
          const side = document.querySelector('.files-side')?.getBoundingClientRect();
          const pane = document.querySelector('.files-scope')?.getBoundingClientRect();
          return { side: Math.round(side?.width ?? 0), pane: Math.round(pane?.width ?? 0) };
        });
        log('no file:', JSON.stringify(r));
        atLeast(r.side, r.pane - 2, 'the tree fills the pane');
      });

      await page.locator(`${sel('files-row')}[data-path="README.md"]`).click();
      await page.waitForTimeout(400);
      await settle(page);

      await check(`${theme} 1024: the open file's preview is the whole pane, beside two other surfaces`, async () => {
        const r = await page.evaluate(() => {
          const main = document.querySelector('.files-main')?.getBoundingClientRect();
          const pane = document.querySelector('.files-scope')?.getBoundingClientRect();
          const shut = document.querySelector('.files-scope')?.classList.contains('is-tree-shut');
          return { main: Math.round(main?.width ?? 0), pane: Math.round(pane?.width ?? 0), shut };
        });
        log('file open:', JSON.stringify(r));
        is(r.shut, true, 'the tree is put away when the file opens');
        atLeast(r.main, r.pane - 2, 'the preview takes the pane');
        atLeast(r.main, 260, 'the preview width');
      });
      await shot(page, 'preview-1024', theme);

      await check(`${theme} 1024: the toggle opens the tree over the file, and choosing a file puts it away`, async () => {
        await page.locator(sel('files-tree-toggle')).click();
        await settle(page);
        const open = await page.evaluate(() => {
          const side = document.querySelector('.files-side')?.getBoundingClientRect();
          const main = document.querySelector('.files-main')?.getBoundingClientRect();
          return { side: Math.round(side?.width ?? 0), main: Math.round(main?.width ?? 0), visible: getComputedStyle(document.querySelector('.files-side')).visibility };
        });
        log('drawer:', JSON.stringify(open));
        is(open.visible, 'visible', 'the drawer shows');
        atLeast(open.side, 200, 'the drawer is wide enough to read names');
        atLeast(open.main, 260, 'the file keeps its width under the drawer');
        await shot(page, 'drawer-1024', theme);
        await page.locator(`${sel('files-row')}[data-path="package.json"]`).click();
        await settle(page);
        const shut = await page.evaluate(() => document.querySelector('.files-scope')?.classList.contains('is-tree-shut'));
        is(shut, true, 'the drawer closes on choosing a file');
      });

      /* Ask 20 needs the tree: a wide window, where it sits beside the file. */
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.evaluate(() => {
        window.name = 'wide';
      });
      await page.reload();
      await page.waitForSelector(sel('shell'));
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.locator(sel('files-row')).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.locator(`${sel('files-row')}[data-path="services"]`).click();
      await settle(page);

      await check(`${theme}: right-click on a file row opens the whole menu`, async () => {
        const row = page.locator(`${sel('files-row')}[data-path="services/gateway.ts"]`);
        await row.waitFor({ state: 'visible', timeout: 5000 });
        await row.click({ button: 'right' });
        await page.locator(sel('files-ctx-menu')).waitFor({ state: 'visible', timeout: 3000 });
        for (const id of ['new-file', 'new-folder', 'rename', 'duplicate', 'copy-path', 'reveal', 'delete']) {
          is(await page.locator(sel(`files-ctx-${id}`)).count(), 1, `menu item ${id}`);
        }
        await shot(page, 'context-menu', theme);
        await page.keyboard.press('Escape');
        is(await page.locator(sel('files-ctx-menu')).count(), 0, 'Escape closes the menu');
      });

      await check(`${theme}: dragging a file onto a folder posts a move`, async () => {
        const src = page.locator(`${sel('files-row')}[data-path="README.md"]`);
        const dst = page.locator(`${sel('files-row')}[data-path="docs"]`);
        await src.dragTo(dst);
        await settle(page);
        log('ops:', JSON.stringify(ops));
        is(JSON.stringify(ops), JSON.stringify([{ op: 'move', path: 'README.md', to: 'docs/README.md' }]), 'the move request');
      });

      await check(`${theme}: Delete asks first`, async () => {
        const row = page.locator(`${sel('files-row')}[data-path="package.json"]`);
        await row.click({ button: 'right' });
        await page.locator(sel('files-ctx-delete')).click();
        await page.locator(sel('files-confirm-delete')).waitFor({ state: 'visible', timeout: 3000 });
        await shot(page, 'delete-confirm', theme);
        await page.locator(sel('files-confirm-delete-cancel')).click();
        is(ops.some((o) => o.op === 'delete'), false, 'cancel sends nothing');
      });
    }
  },
  { routes: { '/api/tree': TREE, '/api/file': README } },
);
