#!/usr/bin/env node
/**
 * SOFT EDGES: A NAME THAT IS CUT FADES OUT, ONE THAT FITS IS NOT TOUCHED (0.1.6 C6 item 2).
 *
 * Owner: "a long file name doesn't blend between the borders. Let's add some nice blending and smoothing there. Same
 * with some of the status bar elements."
 *
 * Each check has a positive control (a name forced too long for its box gets data-cut and a mask) and a negative one
 * (a name that fits has neither: a mask on a short name would fade its own last letters). Fail on the base build,
 * which has no data-cut and no mask on these. C6_BASE=<url> runs it against a served build.
 */
import { is, resize, sel, settle, suite } from './lib/harness.mjs';

await suite('c6-soft-edges', async ({ page, base, check, log }) => {
  await page.addInitScript(() => {
    window.sequence = { openRepo: async () => null, shell: async () => ({ maximized: false }) };
  });
  const url = process.env.C6_BASE || base;
  await resize(page, 1280, 700);
  await page.goto(url);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  const nudge = async (w) => {
    await page.setViewportSize({ width: w + 40, height: 700 });
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(400);
  };
  const state = (css) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { cut: el.getAttribute('data-cut'), mask: cs.maskImage || cs.webkitMaskImage || 'none', over: el.scrollWidth > el.clientWidth + 1, textOverflow: cs.textOverflow };
    }, css);

  await check('status bar: a name that fits is not masked; one that is cut fades (no ellipsis) and keeps its title', async () => {
    const fits = await state(sel('s2-status-state'));
    log('state', JSON.stringify(fits));
    is(fits.cut, null, 'fitting state word data-cut');
    is(fits.mask, 'none', 'fitting state word mask');
    /* force the state word's box too small for it */
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="s2-status-state"]');
      el.style.maxWidth = '10px';
      el.style.display = 'inline-block';
      /* the bar's own box changes (what the ResizeObserver hears); a resize of the window need not change it */
      document.querySelector('[data-testid="s2-status"]').style.paddingRight = '33px';
    });
    await page.waitForTimeout(500);
    const cut = await state(sel('s2-status-state'));
    log('state cut', JSON.stringify(cut));
    is(cut.over, true, 'precondition: the word overflows its box');
    is(cut.cut, 'true', 'data-cut');
    if (cut.mask === 'none') throw new Error('a cut name has no fade');
    is(cut.textOverflow, 'clip', 'text-overflow (no ellipsis beside a fade)');
    const title = await page.evaluate(() => document.querySelector('[data-testid="s2-status-state"]').closest('.s2-sb-x').getAttribute('title'));
    if (!title) throw new Error('the full text is not on the title');
  });

  await check('crumb: a name that fits is clean; the crumb name cut by its pill fades (the pill border stays)', async () => {
    /* The crumb is drawn only where the main column is wide enough (it hides at 640 px and under). */
    await resize(page, 1700, 700);
    await page.goto(url);
    await page.waitForSelector(sel('shell'));
    await settle(page);
    if (!(await page.locator('.s2-crumb').count())) throw new Error('no crumb at 1700');
    await nudge(1700);
    const fits = await state('.s2-crumb-p');
    is(fits.cut, null, 'fitting crumb data-cut');
    is(fits.mask, 'none', 'fitting crumb mask');
    await page.evaluate(() => {
      const c = document.querySelector('.s2-crumb');
      c.style.cssText += ';flex:none;width:44px;min-width:44px;max-width:44px';
    });
    await nudge(1700);
    const cut = await state('.s2-crumb-p');
    log('crumb cut', JSON.stringify(cut), await page.evaluate(() => { const c = document.querySelector('.s2-crumb'); const r = c.getBoundingClientRect(); return [c.scrollWidth, c.clientWidth, r.width, getComputedStyle(c).display, c.innerText, c.getAttribute('style')]; }));
    is(cut.over, true, 'precondition: the crumb overflows');
    is(cut.cut, 'true', 'crumb data-cut');
    if (cut.mask === 'none') throw new Error('a cut crumb has no fade');
    /* the pill's own border is never masked: the fade is on the text inside it */
    is((await state('.s2-crumb')).mask, 'none', 'the crumb pill itself (its border) is not masked');
  });

  await check('surface bar: fades only the edge that has more, and none when it fits', async () => {
    await resize(page, 1700, 700);
    await page.goto(url);
    await page.waitForSelector(sel('s2-surfaces'));
    await settle(page);
    const wide = await state(sel('s2-surfaces'));
    is(wide.over, false, 'precondition: the bar fits at 1700');
    is(wide.mask, 'none', 'fitting bar mask');
    await resize(page, 360, 700);
    await page.locator(sel('s2-narrow-stage')).click();
    await page.waitForTimeout(600);
    const narrow = await state(sel('s2-surfaces'));
    log('bar 360', JSON.stringify(narrow));
    is(narrow.over, true, 'precondition: the bar overflows at 360');
    if (narrow.mask === 'none') throw new Error('an overflowing bar has no fade');
  });
});
