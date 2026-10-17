#!/usr/bin/env node
/**
 * THE CHAT TRANSCRIPT'S SCROLLBAR IS AN OVERLAY (0.1.6 B4, item 3).
 *
 * Owner: "Do we need a scroll bar for the actual chat itself? ... If no, maybe we can stray away from that."
 *
 * MEASURED FIRST on the base build (f73f617f), a transcript tall enough to scroll: its 6 px thumb was always drawn
 * (rgba(255,255,255,.14) on dark, at rest) and the 6 px gutter came out of the messages' width.
 *
 * What this locks (the first, second and fourth fail on the base build):
 *   1. at rest the thumb is transparent (hidden), the bar is still the app's 6 px;
 *   2. while the transcript scrolls (a wheel notch) the thumb shows, then it hides again once scrolling stops;
 *   3. wheel and scripted scrolling still move the transcript (scrolling itself is untouched);
 *   4. the pointer over the transcript shows the thumb, leaving it hides it;
 *   5. the gutter is taken from the transcript's side padding, so a message is as wide as it was with no bar:
 *      padding-right is the old padding less the bar's 6 px, and the gutter is always reserved (stable).
 * B4_BASE=<url> runs the same checks against a served build (the base build for the fails-before proof).
 */
import { is, resize, settle, suite } from './lib/harness.mjs';

await suite('b4-chat-scrollbar', async ({ page, base, check, log }) => {
  await resize(page, 1440, 900);
  await page.goto(process.env.B4_BASE || base);
  await page.waitForSelector('[aria-label="Chat transcript"]');
  await settle(page);

  /* Plant enough rows to scroll (a fresh project has no chat), then wait for layout. */
  await page.evaluate(() => {
    const t = document.querySelector('[aria-label="Chat transcript"]');
    const filler = document.createElement('div');
    filler.setAttribute('data-b4-filler', '');
    filler.style.cssText = 'height:3000px;flex:none';
    t.appendChild(filler);
  });
  await settle(page);
  /* The planted rows make the transcript stick to its end: let that scroll's cue run out, and park the pointer away. */
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1400);

  const thumb = () =>
    page.evaluate(() => {
      const t = document.querySelector('[aria-label="Chat transcript"]');
      const cs = getComputedStyle(t, '::-webkit-scrollbar-thumb');
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [0, 0, 0, 0];
      const bar = getComputedStyle(t, '::-webkit-scrollbar');
      return { alpha: parts.length === 4 ? parts[3] : 1, bg: cs.backgroundColor, barW: bar.width, scrolling: t.hasAttribute('data-scrolling'), top: t.scrollTop, canScroll: t.scrollHeight > t.clientHeight };
    });

  const start = await thumb();
  log('rest', JSON.stringify(start));
  await check('precondition: the transcript scrolls (positive control for the scan)', async () => {
    is(start.canScroll, true, 'transcript overflows');
  });

  await check('at rest the thumb is hidden and the bar is still 6 px', async () => {
    const m = await thumb();
    is(m.alpha, 0, `thumb alpha at rest (${m.bg})`);
    is(m.barW, '6px', 'bar width');
  });

  await check('while it scrolls the thumb shows, then it hides again (wheel scrolling still works)', async () => {
    const box = await page.locator('[aria-label="Chat transcript"]').boundingBox();
    /* Park the pointer outside the chat so hover cannot be what shows it. */
    await page.mouse.move(2, 2);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(2, 2);
    await page.evaluate(() => {
      const t = document.querySelector('[aria-label="Chat transcript"]');
      t.scrollTop = 0;
    });
    await page.waitForTimeout(1300);
    const before = await thumb();
    is(before.alpha, 0, 'hidden before the scroll');
    /* The reader's own scroll: a wheel notch over the transcript (a programmatic scroll is not theirs, below). */
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    const during = await thumb();
    if (!(during.alpha > 0.05)) throw new Error(`thumb not shown while scrolling: ${during.bg}, data-scrolling ${during.scrolling}`);
    is(during.scrolling, true, 'data-scrolling');
    if (during.top <= before.top) throw new Error('the transcript did not scroll');
    await page.waitForTimeout(1300);
    const after = await thumb();
    is(after.alpha, 0, `thumb alpha after scrolling stopped (${after.bg})`);
  });

  await check('the pointer over the transcript shows the thumb; leaving it hides it', async () => {
    const box = await page.locator('[aria-label="Chat transcript"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    const over = await thumb();
    if (!(over.alpha > 0.05)) throw new Error(`thumb hidden under the pointer: ${over.bg}`);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    const off = await thumb();
    is(off.alpha, 0, `thumb alpha with the pointer away (${off.bg})`);
  });

  await check('a real wheel notch scrolls the transcript', async () => {
    const box = await page.locator('[aria-label="Chat transcript"]').boundingBox();
    const t0 = (await thumb()).top;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
    const t1 = (await thumb()).top;
    if (!(t1 > t0)) throw new Error(`wheel did not scroll: ${t0} -> ${t1}`);
  });

  await check('the gutter comes out of the side padding, not the messages', async () => {
    const m = await page.evaluate(() => {
      const t = document.querySelector('[aria-label="Chat transcript"]');
      const cs = getComputedStyle(t);
      return { gutter: cs.scrollbarGutter, pr: parseFloat(cs.paddingRight), pl: parseFloat(cs.paddingLeft) };
    });
    log('gutter', JSON.stringify(m));
    is(m.gutter, 'stable', 'scrollbar-gutter');
    is(m.pr, m.pl - 6, 'padding-right is the left padding less the 6 px bar');
  });
  await check('an answer streaming in (scrolling by itself) never shows the thumb; a wheel does (review B4 4)', async () => {
    const box = await page.locator('[aria-label="Chat transcript"]').boundingBox();
    await page.mouse.move(2, 2);
    await page.evaluate(() => {
      document.querySelector('[aria-label="Chat transcript"]').scrollTop = 0;
    });
    await page.waitForTimeout(1400);
    /* The stream: the transcript grows and sticks to its end, a scroll event on each chunk, for 1.6 s. */
    const seen = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const t = document.querySelector('[aria-label="Chat transcript"]');
          const filler = t.querySelector('[data-b4-filler]');
          const alphas = [];
          let n = 0;
          const tick = () => {
            filler.style.height = `${3000 + n * 40}px`;
            t.scrollTop = t.scrollHeight;
            const c = getComputedStyle(t, '::-webkit-scrollbar-thumb').backgroundColor;
            alphas.push({ c, on: t.hasAttribute('data-scrolling') });
            n += 1;
            if (n < 16) setTimeout(tick, 100);
            else resolve(alphas);
          };
          tick();
        }),
    );
    const shown = seen.filter((a) => a.on || !/rgba\(255, 255, 255, 0\)|rgba\(0, 0, 0, 0\)|transparent/.test(a.c));
    if (shown.length) throw new Error(`the thumb showed ${shown.length} of ${seen.length} times during the stream: ${JSON.stringify(shown[0])}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    const during = await thumb();
    if (!(during.alpha > 0.05)) throw new Error(`a wheel did not show the thumb: ${during.bg}`);
  });

  await check('chat only: the reading column sits centred over the composer, its gutter out of the right padding (review B4 5)', async () => {
    await page.locator('[data-testid="v3-tab-close-architecture"]').click();
    await settle(page);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const t = document.querySelector('[aria-label="Chat transcript"]');
      const f = t.querySelector('[data-b4-filler]');
      const comp = document.querySelector('.s2-comp');
      const fr = f.getBoundingClientRect();
      const cr = comp.getBoundingClientRect();
      return { stage: document.querySelector('.s2-row').getAttribute('data-stage'), gutter: t.offsetWidth - t.clientWidth, fl: fr.left, fr: fr.right, cl: cr.left, cr: cr.right };
    });
    log('chat-only', JSON.stringify(m));
    is(m.stage, 'none', 'chat-only mode');
    /* The text's left edge is the composer's; its right edge is the composer's less what the gutter did not take of the 6 px. */
    if (Math.abs(m.fl - m.cl) > 1) throw new Error(`left edges differ: text ${m.fl} composer ${m.cl}`);
    if (Math.abs(m.fr - m.cr - (6 - m.gutter)) > 1) throw new Error(`right edges: text ${m.fr} composer ${m.cr} gutter ${m.gutter}`);
  });
});
