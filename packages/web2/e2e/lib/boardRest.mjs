import { settle } from './harness.mjs';

/**
 * WAIT FOR THE BOARD TO BE AT REST, ON ITS OWN STATE, NEVER ON A DURATION.
 *
 * The root of `[data-testid="board"]` says four things a suite can wait on (Board.tsx):
 *   data-arranged   "true" once the first real arrangement for the current layout key is applied. `data-layout`
 *                   alone reads "idle" on the seed arrangement, before ELK has answered, so it cannot say this.
 *   data-layout     not "laying-out".
 *   data-animating / data-cam-animating   the cards' glide, and the camera ease.
 *   data-fit-gen    a counter of EVERY camera fit, eased or not. The board re-fits on its own (a layout answer, a
 *                   near/far band crossing, a resize) and that jump is instant, so no animating flag marks it.
 * At rest means: arranged, not laying out, nothing animating, and the fit counter unchanged across two consecutive
 * animation frames. When that never comes the call THROWS, naming the state that did not, so a failure points at the
 * condition and not at whatever assertion happened to run next.
 */
export async function boardAtRest(page, rootTestid, label = 'the board') {
  const probe = ([root]) => {
    const el = document.querySelector(`[data-testid="${root}"]`);
    if (!el) return { ok: false, why: 'the board root is not in the document' };
    const gen = el.getAttribute('data-fit-gen') ?? '0';
    const w = window;
    if (w.__restGen !== gen) {
      w.__restGen = gen;
      w.__restRun = 0;
    } else {
      w.__restRun = (w.__restRun ?? 0) + 1;
    }
    if (el.getAttribute('data-arranged') !== 'true') return { ok: false, why: 'data-arranged never became "true" (no arrangement applied)' };
    if (el.getAttribute('data-layout') === 'laying-out') return { ok: false, why: 'data-layout stayed "laying-out"' };
    if (el.hasAttribute('data-cam-animating')) return { ok: false, why: 'data-cam-animating never ended' };
    if (el.getAttribute('data-animating') === 'true') return { ok: false, why: 'data-animating (card glide) never ended' };
    if (w.__restRun < 2) return { ok: false, why: 'data-fit-gen kept changing between frames' };
    return { ok: true, why: '' };
  };
  /* The settle counters live on window: start each call from zero so a previous call's run cannot satisfy this one. */
  await page.evaluate(() => {
    window.__restGen = undefined;
    window.__restRun = 0;
  });
  const deadline = Date.now() + 15_000;
  let last = { ok: false, why: 'never probed' };
  while (Date.now() < deadline) {
    last = await page.evaluate(probe, [rootTestid]);
    if (last.ok) {
      await settle(page);
      return;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  }
  throw new Error(`${label} never came to rest within 15 s: ${last.why}`);
}
