#!/usr/bin/env node
/**
 * THE SURFACE SWITCH GLIDES AND THE MODEL MENU ANIMATES, SAMPLED FRAME BY FRAME (0.1.6 D1).
 *
 * Owner on 0.1.6: "no animation on the model picker; on the surface when you switch between things".
 * ROOT CAUSE (measured on fb23bccf): measureCompact hid the indicator (display:none), forced a layout, and showed it
 * again in the same task. An element that was display:none at the last style recalc has no before-change style, so the
 * transform/width change that follows starts no transition: the indicator JUMPED to the new pill.
 * This samples the indicator's rendered box over the frames after a switch, and the model menu's opacity.
 */
import { atLeast, resize, sel, settle, suite } from './lib/harness.mjs';

await suite('d1-surface-glide', async ({ page, base, check, log }) => {
  await page.addInitScript(() => { window.sequence = { openRepo: async () => null, shell: async () => ({ maximized: false }) }; });
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  for (const id of ['architecture', 'files']) { await page.locator(sel(`s2-tab-${id}`)).click(); await settle(page); }
  await page.waitForTimeout(600);

  const sampleInd = async (id) => page.evaluate(async (id) => {
    const ind = document.querySelector('[data-testid="s2-sp-ind"]');
    const out = [];
    const t0 = performance.now();
    document.querySelector(`[data-testid="s2-tab-${id}"]`).click();
    await new Promise((res) => {
      const f = () => {
        const r = ind.getBoundingClientRect();
        out.push({ t: Math.round(performance.now() - t0), x: Math.round(r.left * 10) / 10, w: Math.round(r.width * 10) / 10 });
        if (performance.now() - t0 > 420) res(); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    return out;
  }, id);

  const distinct = (s, k) => new Set(s.map((p) => p[k])).size;
  const a = await sampleInd('architecture');
  log('switch', JSON.stringify(a));
  await check('switching surface: the indicator interpolates over several frames (not a jump)', async () => {
    atLeast(distinct(a, 'x'), 4, 'distinct indicator x positions across frames');
  });
  await settle(page);
  const b = await sampleInd('files');
  await check('switching back: the indicator interpolates again', async () => {
    atLeast(distinct(b, 'x'), 4, 'distinct indicator x positions across frames');
  });

  await settle(page);
  await page.waitForTimeout(300);
  const menu = async (action) => page.evaluate(async (act) => {
    const out = [];
    const t0 = performance.now();
    document.querySelector('[data-testid="v3-model-trigger"]').click();
    await new Promise((res) => {
      const f = () => {
        const m = document.querySelector('[data-testid^="s2-model-menu"]');
        out.push(m ? Math.round(parseFloat(getComputedStyle(m).opacity) * 100) / 100 : null);
        if (performance.now() - t0 > 400) res(); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    return out;
  }, action);
  const o = await menu('open');
  log('menu open opacity', JSON.stringify(o));
  await check('opening the model menu fades in across frames', async () => {
    atLeast(new Set(o.filter((v) => v !== null && v > 0 && v < 1)).size, 2, 'distinct in-between opacities');
  });
  await page.waitForTimeout(300);
  const c = await menu('close');
  log('menu close opacity', JSON.stringify(c));
  await check('closing the model menu fades out across frames', async () => {
    atLeast(new Set(c.filter((v) => v !== null && v > 0 && v < 1)).size, 2, 'distinct in-between opacities');
  });
});
