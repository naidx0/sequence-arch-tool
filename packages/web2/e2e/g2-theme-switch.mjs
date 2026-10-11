#!/usr/bin/env node
/**
 * THE LIGHT / DARK SWITCH IS FAST AND SMOOTH (0.1.6 G2, item f).
 *
 * Owner: the switch is "rough, takes a lot of time". Measured on the base build at 1440 with the
 * architecture board open: the new colours reach the first frame in ~15 ms, but the ASCII backdrop
 * then redraws its whole mosaic on the main thread (two long tasks, ~120 ms and ~80 ms), each
 * control eases its own colour over 110 ms (so the screen changes in stages), and nothing blends
 * the old room into the new. Win: the new theme fully painted (first frame AND the backdrop) in
 * under 150 ms, no long task after the click, one cross-fade (View Transitions, with a fallback),
 * and reduced motion switches at once with no transition.
 *
 * Instrument: the real Settings > App > Theme buttons are clicked. "first frame" is the second
 * requestAnimationFrame after the click; "backdrop" is the moment data-room-drawn on the ASCII
 * backdrop names the new room; long tasks come from a PerformanceObserver. document.startViewTransition
 * is wrapped to count calls.
 */
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

await suite('g2-theme-switch', async ({ page, base, check, log }) => {
  await page.addInitScript(() => {
    window.__vt = 0;
    const orig = document.startViewTransition?.bind(document);
    if (orig) {
      document.startViewTransition = (...a) => {
        window.__vt += 1;
        return orig(...a);
      };
    }
    try {
      localStorage.setItem('seq.theme', 'dark');
    } catch {
      /* private mode */
    }
  });
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  await page.locator(sel('s2-tab-architecture')).click();
  await page.waitForTimeout(1500);
  await page.locator(sel('v3-rail-settings')).click();
  await page.locator(sel('settings-nav-app')).click();
  await page.waitForSelector('[data-theme-choice="light"]');
  /* The backdrop pre-draws the other room while idle; give it the time it has in real use. */
  await page.waitForTimeout(4000);

  await page.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([e.startTime, e.duration]))).observe({ entryTypes: ['longtask'] });
  });

  const toggle = (target) =>
    page.evaluate(
      (target) =>
        new Promise((resolve) => {
          const stage = document.querySelector('[data-testid="s2-ascii-backdrop"]');
          const btn = document.querySelector(`[data-theme-choice="${target}"]`);
          const out = { target, first: -1, backdrop: -1, settled: false };
          const t0 = performance.now();
          const lt0 = window.__lt.length;
          const mo = new MutationObserver(() => {
            if (stage?.getAttribute('data-room-drawn') === target && out.backdrop < 0) out.backdrop = performance.now() - t0;
          });
          if (stage) mo.observe(stage, { attributes: true, attributeFilter: ['data-room-drawn'] });
          btn.click();
          if (stage?.getAttribute('data-room-drawn') === target) out.backdrop = performance.now() - t0;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              out.first = performance.now() - t0;
              out.theme = document.documentElement.dataset.theme;
              setTimeout(() => {
                mo.disconnect();
                out.longTasks = window.__lt.slice(lt0).map(([s, d]) => Math.round(d));
                out.animations = document.getAnimations().length;
                resolve(out);
              }, 900);
            }),
          );
        }),
      target,
    );

  const runs = [];
  for (const t of ['light', 'dark', 'light', 'dark', 'light', 'dark']) runs.push(await toggle(t));
  for (const r of runs) log(JSON.stringify(r));
  const first = median(runs.map((r) => r.first));
  const backdrop = median(runs.map((r) => r.backdrop));
  const worstTask = Math.max(0, ...runs.flatMap((r) => r.longTasks));
  log(`median first frame ${first.toFixed(0)} ms, median backdrop ${backdrop.toFixed(0)} ms, worst long task ${worstTask} ms`);

  await check('every click lands the new theme', async () => {
    for (const r of runs) is(r.theme, r.target, 'theme after click');
  });
  await check('first frame with the new theme in under 150 ms (median of 6)', async () => {
    if (!(first < 150)) throw new Error(`median first frame ${first.toFixed(0)} ms`);
  });
  await check('the backdrop shows the new room in under 150 ms (median of 6): no redraw on the click path', async () => {
    if (!(backdrop >= 0 && backdrop < 150)) throw new Error(`median backdrop ${backdrop.toFixed(0)} ms`);
  });
  await check('no long task (> 50 ms) follows a click', async () => {
    if (worstTask > 50) throw new Error(`a ${worstTask} ms task ran after a click`);
  });
  await check('the switch cross-fades through a View Transition (one per click)', async () => {
    const n = await page.evaluate(() => window.__vt);
    is(n, 6, 'startViewTransition calls');
  });

  await check('reduced motion: the theme switches at once and no transition runs', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const before = await page.evaluate(() => window.__vt);
    const r = await toggle('light');
    is(r.theme, 'light', 'theme');
    atLeast(150, r.first, 'first frame (ms)');
    is(await page.evaluate(() => window.__vt), before, 'view transitions under reduced motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
});
