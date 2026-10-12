#!/usr/bin/env node
/**
 * CHAT-ONLY IS NOT A NARROW STRIP (0.1.6 G2, item a).
 *
 * Owner: the chat-only view "condenses the chat too narrow". With no surface
 * open at 1440x900 the chat column must be at least 900 px, the message text
 * keeps a reading width inside it (a planted assistant turn, .s2-asst, is measured, since the
 * suite has no model to answer), and the composer is the same width as the text.
 * Layout only a browser can answer (jsdom has none).
 */
import { atLeast, is, resize, sel, settle, suite, within } from './lib/harness.mjs';

await suite('g2-chat-only-width', async ({ page, base, check, log }) => {
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  /* No surface: close whatever the default workspace opened. */
  for (let i = 0; i < 6; i++) {
    const x = page.locator('.s2-sp-x').first();
    if (!(await x.count())) break;
    await x.click();
    await settle(page);
  }

  await check('stage is none (chat-only)', async () => {
    is(await page.locator('.s2-row').getAttribute('data-stage'), 'none', 'data-stage');
  });

  let chatW = 0;
  await check('chat column is >= 900 px wide at 1440', async () => {
    chatW = (await page.locator('.s2-chat').boundingBox()).width;
    log('chat column', chatW);
    atLeast(chatW, 900, 'chat column width');
  });

  await check('message text keeps a reading width; composer matches it', async () => {
    const m = await page.evaluate(() => {
      const t = document.querySelector('.v3-transcript');
      const msg = document.createElement('div');
      msg.className = 's2-asst chat-scope';
      msg.innerHTML = '<div class="prose">' + 'word '.repeat(400) + '</div>';
      t.appendChild(msg);
      const mw = msg.getBoundingClientRect().width;
      msg.remove();
      /* The virtualised long chat lays each row in a .v3-vrow: its text column is its content box. */
      const wrap = document.querySelector('.v3-transcript-wrap') || t.parentElement;
      const vrow = document.createElement('div');
      vrow.className = 'v3-vrow';
      vrow.innerHTML = '<div>' + 'word '.repeat(400) + '</div>';
      const list = document.createElement('div');
      list.style.cssText = 'width:100%';
      list.appendChild(vrow);
      t.parentElement.appendChild(list);
      const cs = getComputedStyle(vrow);
      const vw = vrow.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      list.remove();
      void wrap;
      const c = document.querySelector('.s2-comp').getBoundingClientRect();
      return { mw, cw: c.width, vw };
    });
    log('message', m.mw, 'composer', m.cw);
    atLeast(m.mw, 640, 'message width (comfortable)');
    if (m.mw > 900) throw new Error(`message line runs ${m.mw} px wide: not a reading width`);
    within(m.cw, m.mw, 1.5, 'composer width vs message width');
    within(m.vw, m.mw, 1.5, 'virtualised row text width vs message width');
  });
});
