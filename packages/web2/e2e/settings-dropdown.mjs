#!/usr/bin/env node
/**
 * THE SETTINGS DROPDOWN LOCK — a Settings dropdown opens fully visible, over the card, not behind its border.
 *
 * Owner, installed 0.1.6: "The pop out, the drop down in Settings for fonts ... just hides behind the borders."
 * MenuSelect rendered its listbox inside the row, and the card / group / scroller around it clip with overflow,
 * so the menu was cut at their edges. A jsdom test cannot see that (no layout, no clipping); this one can.
 *
 * What it reads: the listbox's and the trigger's real bounding rects, and document.elementFromPoint at the
 * centre of every option (a clipped option answers with whatever is painted over it, not the option).
 * Matrix: 1440x900 and 1024x700, dark and light, for the Fonts dropdown (App pane) and the Provider dropdown
 * (Models pane, API key form). Positive control: the same hit test on a deliberately clipped box must say "clipped".
 */
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';

const SIZES = [
  [1440, 900],
  [1024, 700],
];
const THEMES = ['dark', 'light'];

/** Rects and hit-test answers for the open listbox of `testid`. */
function probe(page, testid) {
  return page.evaluate((id) => {
    const trig = document.querySelector(`[data-testid="${id}"]`);
    const menu = document.querySelector(`[data-testid="${id}-menu"]`);
    if (!trig || !menu) return { error: `trigger ${!!trig} menu ${!!menu}` };
    const t = trig.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const opts = [...menu.querySelectorAll('[role="option"]')];
    const hits = opts.map((o) => {
      const r = o.getBoundingClientRect();
      // an option scrolled out of an inner-scrolling menu is judged only when it is inside the menu's own box
      const inside = r.top >= m.top - 0.5 && r.bottom <= m.bottom + 0.5;
      if (!inside) return { inside: false, ok: true };
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inside: true, ok: !!hit && (hit === o || o.contains(hit)) };
    });
    return {
      t: { l: t.left, r: t.right, top: t.top, b: t.bottom },
      m: { l: m.left, r: m.right, top: m.top, b: m.bottom, h: m.height },
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      side: menu.dataset.side,
      optionCount: opts.length,
      inner: hits.filter((h) => h.inside).length,
      allHit: hits.every((h) => h.ok),
      pos: getComputedStyle(menu).position,
    };
  }, testid);
}

function verdict(p) {
  if (p.error) throw new Error(p.error);
  const fails = [];
  if (p.m.l < 0 || p.m.top < 0 || p.m.r > p.vw + 0.5 || p.m.b > p.vh + 0.5) fails.push(`outside viewport ${JSON.stringify(p.m)} in ${p.vw}x${p.vh}`);
  if (!p.allHit) fails.push('an option centre is covered by something else (clipped)');
  if (p.inner < 1) fails.push('no option visible');
  if (p.pos !== 'fixed') fails.push(`position ${p.pos}, not fixed`);
  const aligned = Math.abs(p.m.l - p.t.l) <= 1.5 || Math.abs(p.m.r - p.t.r) <= 1.5 || p.m.l === 8;
  if (!aligned) fails.push(`not aligned to the trigger (menu ${p.m.l}-${p.m.r}, trigger ${p.t.l}-${p.t.r})`);
  const gapDown = Math.abs(p.m.top - p.t.b);
  const gapUp = Math.abs(p.t.top - p.m.b);
  const adjacent = p.side === 'up' ? gapUp <= 12 : gapDown <= 12;
  if (!adjacent) fails.push(`not next to the trigger (side ${p.side}, gap ${p.side === 'up' ? gapUp : gapDown})`);
  return fails;
}

await suite('settings-dropdown', async ({ page, base, check }) => {
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));

  await check('control: the hit test flags an option hidden behind an overflow:hidden box', async () => {
    const r = await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:20px;overflow:hidden;z-index:9999;background:#fff';
      const o = document.createElement('button');
      o.setAttribute('role', 'option');
      o.style.cssText = 'display:block;margin-top:60px;height:30px;width:80px';
      box.appendChild(o);
      document.body.appendChild(box);
      const q = o.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      box.remove();
      return hit === o || o.contains(hit);
    });
    is(r, false, 'a clipped option answers elementFromPoint');
  });

  async function openSettings(w, h, theme, nav) {
    await resize(page, w, h);
    await page.goto(base);
    await page.evaluate((T) => localStorage.setItem('seq.theme', T), theme);
    await page.reload();
    await page.waitForSelector(sel('shell'));
    await settle(page);
    await page.locator(sel('v3-rail-settings')).click();
    await page.locator(sel(`settings-nav-${nav}`)).click();
    await settle(page);
  }

  const shot = async (name) => {
    if (process.env.SEQ_SHOTS) await page.screenshot({ path: `${process.env.SEQ_SHOTS}/${name}.png` });
  };

  for (const theme of THEMES) {
    for (const [w, h] of SIZES) {
      const tag = `${w}x${h} ${theme}`;
      await check(`${tag}: the font dropdown opens fully visible, aligned, unclipped`, async () => {
        await openSettings(w, h, theme, 'app');
        is(await page.evaluate(() => document.documentElement.dataset.theme), theme, 'theme applied');
        const trig = page.locator(sel('settings-font-select'));
        await trig.scrollIntoViewIfNeeded();
        await trig.click();
        await page.waitForSelector(sel('settings-font-select-menu'));
        await settle(page);
        const p = await probe(page, 'settings-font-select');
        atLeast(p.optionCount, 2, 'font options');
        await shot(`font-${w}-${theme}`);
        const fails = verdict(p);
        if (fails.length) throw new Error(fails.join('; '));
      });

      await check(`${tag}: the provider dropdown opens fully visible, aligned, unclipped`, async () => {
        await openSettings(w, h, theme, 'models');
        await page.locator(sel('settings-choice-toggle')).nth(1).click();
        const trig = page.locator(sel('settings-provider'));
        await trig.scrollIntoViewIfNeeded();
        await settle(page);
        await trig.click();
        await page.waitForSelector(sel('settings-provider-menu'));
        await settle(page);
        const p = await probe(page, 'settings-provider');
        atLeast(p.optionCount, 2, 'provider options');
        await shot(`provider-${w}-${theme}`);
        const fails = verdict(p);
        if (fails.length) throw new Error(fails.join('; '));
      });
    }
  }

  await check('keyboard: Escape closes only the menu and returns focus; the panel stays', async () => {
    await openSettings(1440, 900, 'dark', 'app');
    const trig = page.locator(sel('settings-font-select'));
    await trig.scrollIntoViewIfNeeded();
    await trig.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector(sel('settings-font-select-menu'));
    await settle(page);
    is(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'option', 'focus goes into the menu');
    await page.keyboard.press('ArrowDown');
    is(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'option', 'arrow stays on options');
    await page.keyboard.press('Escape');
    await settle(page);
    is(await page.locator(sel('settings-font-select-menu')).count(), 0, 'menu closed');
    is(await page.locator(sel('settings-panel')).count(), 1, 'Settings still open');
    is(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'settings-font-select', 'focus back on the trigger');
    await page.keyboard.press('Escape');
    await settle(page);
    is(await page.locator(sel('settings-panel')).count(), 0, 'a second Escape closes Settings');
  });

  await check('picking an option sets the value and closes the menu; Settings stays', async () => {
    await openSettings(1440, 900, 'dark', 'app');
    const trig = page.locator(sel('settings-font-select'));
    await trig.scrollIntoViewIfNeeded();
    await trig.click();
    await page.waitForSelector(sel('settings-font-select-menu'));
    const before = await trig.getAttribute('value');
    const other = page.locator(`${sel('settings-font-select-option')}:not([aria-selected="true"])`).first();
    const want = await other.getAttribute('data-value');
    await other.click();
    await settle(page);
    is(await page.locator(sel('settings-font-select-menu')).count(), 0, 'closed after picking');
    is(await trig.getAttribute('value'), want, 'value changed');
    is(await page.locator(sel('settings-panel')).count(), 1, 'Settings still open');
    if (before === want) throw new Error('the pick did not differ from the start');
  });

  await check('an outside press closes the menu', async () => {
    await openSettings(1440, 900, 'dark', 'app');
    const trig = page.locator(sel('settings-font-select'));
    await trig.scrollIntoViewIfNeeded();
    await trig.click();
    await page.waitForSelector(sel('settings-font-select-menu'));
    await page.locator(sel('settings-nav-agents')).click();
    await settle(page);
    is(await page.locator(sel('settings-font-select-menu')).count(), 0, 'closed by outside press');
  });

  await check('scrolling the Settings body re-places the open menu against its trigger', async () => {
    await openSettings(1024, 700, 'dark', 'app');
    const trig = page.locator(sel('settings-font-select'));
    await trig.scrollIntoViewIfNeeded();
    await trig.click();
    await page.waitForSelector(sel('settings-font-select-menu'));
    await settle(page);
    const moved = await page.evaluate(() => {
      const b = document.querySelector('.sb-body');
      if (!b) return -1;
      const before = b.scrollTop;
      b.scrollTop += 40;
      return b.scrollTop - before;
    });
    await settle(page);
    const p = await probe(page, 'settings-font-select');
    const gap = p.side === 'up' ? Math.abs(p.t.top - p.m.b) : Math.abs(p.m.top - p.t.b);
    if (gap > 12) throw new Error(`menu left behind by the scroll (scrolled ${moved}px): gap ${gap}`);
  });
});
