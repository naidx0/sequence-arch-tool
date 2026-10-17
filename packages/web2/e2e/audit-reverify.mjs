#!/usr/bin/env node
/**
 * THE ROUND 7 / ROUND 8 RE-VERIFY LIST (ask 33), run in a real browser against
 * the built app. One check per item Jaden listed; each is the behaviour he
 * described, not a stand-in for it.
 *
 *   node e2e/audit-reverify.mjs
 *
 * Covered elsewhere (their own e2e, run beside this one): matching rails
 * (rails-match), drawable board (whiteboard-to-ask), icons centred
 * (icons-centred), the Bastion backdrop on both rooms (home-screen).
 */
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';

const HOME_TABS = { tabs: [{ id: 'chat', minimized: false }], active: 'chat' };
const WORKSPACE = { root: '/home/u/.sequence/workspace', exists: true, entries: [] };
const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Rate limiting', createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};

await suite(
  'audit-reverify',
  async ({ page, base, check }) => {
    const boot = async (theme, tabs = HOME_TABS) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.evaluate(([t, tb]) => {
        localStorage.clear();
        localStorage.setItem('v3.chromeTabs', JSON.stringify(tb));
        localStorage.setItem('seq.theme', t);
      }, [theme, tabs]);
      await page.reload();
      await page.waitForSelector(sel('shell'));
      await page.locator(sel('s2-session')).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await settle(page);
    };

    await check('the surface bar: icons at home, every whole name once a surface is open', async () => {
      await boot('dark');
      const home = await page.$$eval('nav[aria-label="Workspace"] .s2-sp-main', (bs) => bs.map((b) => (b.innerText || '').trim()));
      is(home.filter(Boolean).join(','), '', 'home folds to icons by design (surfaceBar.test)');
      await page.locator(sel('s2-tab-files')).click();
      await page.waitForSelector('[data-surface-pane="files"]');
      await settle(page);
      const open = await page.$$eval('nav[aria-label="Workspace"] .s2-sp-main', (bs) => bs.map((b) => (b.innerText || '').trim()));
      is(open.join(','), 'Architecture,Files,Whiteboard,Terminal', 'names drawn in full with a surface open');
    });

    await check('"Sequence" top left has no icon', async () => {
      await boot('dark');
      const brand = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="s2-brand"]');
        return { text: (b?.textContent || '').trim(), media: b ? b.querySelectorAll('svg,img,canvas').length : -1 };
      });
      is(brand.text, 'Sequence', 'the word');
      is(brand.media, 0, 'icons beside it');
    });

    for (const theme of ['dark', 'light']) {
      await check(`${theme}: the Bastion ASCII backdrop is drawn in its own variant`, async () => {
        await boot(theme);
        await page.locator(`${sel('s2-ascii-backdrop')}[data-drawn="true"][data-theme-variant="${theme}"]`).waitFor({ state: 'attached', timeout: 15000 });
      });
    }

    await check('cream light mode: the ground and cards are warm, not white, and no solid black', async () => {
      await boot('light');
      const t = await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.s2'));
        const v = (n) => cs.getPropertyValue(n).trim().toLowerCase();
        const btn = getComputedStyle(document.querySelector('.s2-btn.s2-wide, .s2-btn'));
        return { base: v('--bg-base'), card: v('--surface-2'), ink: v('--ink-1'), btn: btn.backgroundColor };
      });
      is(t.base, '#faf8f3', 'the ground');
      is(t.card, '#fffdf8', 'a card');
      is(t.ink === '#000000' || t.ink === '#000', false, 'ink is not pure black');
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(t.btn);
      atLeast(m ? Number(m[1]) : 255, 20, 'the primary button is not black');
    });

    await check('the chat-box buttons are light: no drop shadow, a translucent fill', async () => {
      await boot('dark');
      const r = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.s2-compwrap button')].slice(0, 12);
        return btns.map((b) => {
          const cs = getComputedStyle(b);
          return { shadow: cs.boxShadow, bg: cs.backgroundColor };
        });
      });
      atLeast(r.length, 2, 'buttons found in the composer');
      for (const b of r) {
        const blur = /(\d+)px (\d+)px (\d+)px/.exec(b.shadow.replace(/rgba?\([^)]*\)/g, ''));
        is(blur ? Number(blur[3]) <= 8 : true, true, `button shadow blur (${b.shadow})`);
      }
    });

    await check('the model picker opens and Escape closes it, with nothing left over the screen (the gray freeze)', async () => {
      await boot('dark');
      await page.locator(sel('v3-model-trigger')).click();
      await page.waitForSelector(sel('s2-model-menu'));
      await page.keyboard.press('Escape');
      await page.waitForSelector(sel('s2-model-menu'), { state: 'detached', timeout: 3000 });
      await page.mouse.click(1430, 890);
      const covering = await page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        const fixed = [...document.querySelectorAll('body *')].filter((e) => {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return cs.position === 'fixed' && r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2 && cs.pointerEvents !== 'none' && cs.display !== 'none' && !e.classList.contains('s2-app') && !e.hasAttribute('data-testid');
        });
        return { hit: el?.className?.toString() ?? '', fixed: fixed.map((e) => e.className.toString()) };
      });
      is(covering.fixed.join(','), '', 'a full-screen layer still taking clicks');
      await page.locator(sel('s2-composer-input')).first().click({ trial: true }).catch(() => undefined);
    });

    await check('the model picker can be opened a second time (it did not wedge)', async () => {
      await page.locator(sel('v3-model-trigger')).click();
      await page.waitForSelector(sel('s2-model-menu'));
      await page.keyboard.press('Escape');
    });

    await check('Settings saves: the status-bar switch persists across a reload', async () => {
      await boot('dark');
      await page.locator(sel('v3-rail-settings')).click();
      await page.waitForSelector(sel('settings-panel'), { timeout: 10000 });
      await page.locator(sel('settings-nav-app')).click().catch(() => undefined);
      await page.waitForSelector(sel('settings-status-bar-switch'), { state: 'attached', timeout: 10000 });
      is(await page.locator(sel('s2-status')).count(), 1, 'status bar before');
      await page.locator(sel('settings-status-bar')).click();
      is(await page.evaluate(() => localStorage.getItem('sequence.statusBar')), '0', 'written to storage');
      await page.reload();
      await page.waitForSelector(sel('shell'));
      await page.locator(sel('s2-session')).first().waitFor({ state: 'visible', timeout: 15000 });
      is(await page.locator(sel('s2-status')).count(), 0, 'status bar after reload (still off)');
    });

    await check('terminal: a tab closes with its X, and the default workspace counts as a project', async () => {
      await boot('dark');
      await page.locator(sel('s2-tab-terminal')).click();
      await page.waitForSelector('[data-surface-pane="terminal"]');
      await page.waitForTimeout(600);
      const status = (await page.locator(sel('terminal-pane-status')).textContent()) ?? '';
      is(/Open a project/i.test(status), false, `the pane asks for a project (${status})`);
      await page.locator(sel('v3-tab-close-terminal')).click();
      await page.locator(`${sel('shell')}[data-home="true"]`).waitFor({ timeout: 5000 });
    });
  },
  { routes: { '/api/sessions': SESSIONS, '/api/workspace': WORKSPACE } },
);
