#!/usr/bin/env node
/**
 * THE MODEL PICKER MOVES LIKE THE SURFACE SWITCH (0.1.6 G2, item c).
 *
 * Owner: the picker needs a "smoothing animation like the surface switch". The surface switch
 * is the sliding indicator under the top bar (transform 220ms cubic-bezier(.2,.8,.2,1)). The
 * picker, open and close, must run on that same duration and curve, from a first frame that
 * is already moving (opacity 0 and an offset transform: no pop, no clipped first frame), and
 * the closing menu must stay on the page for its exit. Real animations are read off the DOM
 * (getAnimations), which jsdom has not got.
 */
import { is, resize, sel, settle, suite } from './lib/harness.mjs';

await suite('g2-picker-motion', async ({ page, base, check, log }) => {
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);

  /* The surface switch: the indicator's transform transition. */
  const sw = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="s2-surfaces"]');
    const ind = bar.querySelector('.s2-sp-ind');
    bar.setAttribute('data-ind', 'on');
    const cs = getComputedStyle(ind);
    const props = cs.transitionProperty.split(',').map((s) => s.trim());
    const i = props.indexOf('transform');
    return {
      dur: cs.transitionDuration.split(',')[i].trim(),
      ease: cs.transitionTimingFunction.split(/,(?![^(]*\))/)[i].trim(),
    };
  });
  log('surface switch', JSON.stringify(sw));

  const toMs = (s) => (s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000);

  await page.locator(sel('v3-model-trigger')).click();
  await page.waitForSelector('[data-testid="s2-model-menu"]');
  /* Read the opening animation straight away, before it ends. */
  const open = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="s2-model-menu"]');
    const a = m.getAnimations().find((x) => x.animationName);
    if (!a) return { none: true };
    const t = a.effect.getTiming();
    a.pause();
    a.currentTime = 0;
    const cs = getComputedStyle(m);
    const f0 = { opacity: cs.opacity, transform: cs.transform };
    a.play();
    return { name: a.animationName, dur: t.duration, ease: cs.animationTimingFunction, f0 };
  });
  log('open', JSON.stringify(open));

  await check('opening plays a real animation on the surface-switch duration and curve', async () => {
    if (open.none) throw new Error('no animation on the opening menu');
    is(open.dur, toMs(sw.dur), 'open duration (ms)');
    is(open.ease.replace(/\s/g, ''), sw.ease.replace(/\s/g, ''), 'open easing');
  });
  await check('the first frame is already moving: transparent and offset', async () => {
    is(open.f0.opacity, '0', 'first-frame opacity');
    if (open.f0.transform === 'none') throw new Error('first frame has no transform: it would pop in');
  });

  await settle(page);
  await page.waitForTimeout(400);
  /* Close and read the exit straight away. */
  const closing = await page.evaluate(() => {
    document.querySelector('[data-testid="v3-model-trigger"]').click();
    return new Promise((res) => {
      requestAnimationFrame(() => {
        const m = document.querySelector('[data-testid^="s2-model-menu"]');
        if (!m) return res({ gone: true });
        const a = m.getAnimations().find((x) => x.animationName);
        if (!a) return res({ none: true, state: m.dataset.state });
        const t = a.effect.getTiming();
        res({ state: m.dataset.state, dur: t.duration, ease: getComputedStyle(m).animationTimingFunction, name: a.animationName });
      });
    });
  });
  log('close', JSON.stringify(closing));
  await check('closing stays on the page and plays on the same duration and curve', async () => {
    if (closing.gone || closing.none) throw new Error(`exit not animated: ${JSON.stringify(closing)}`);
    is(closing.state, 'closing', 'closing state');
    is(closing.dur, toMs(sw.dur), 'close duration (ms)');
    is(closing.ease.replace(/\s/g, ''), sw.ease.replace(/\s/g, ''), 'close easing');
  });
  await check('the closed menu is gone afterwards', async () => {
    await page.waitForTimeout(500);
    is(await page.locator('[data-testid^="s2-model-menu"]').count(), 0, 'menus left on the page');
  });
});
