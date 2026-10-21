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

  /* 0.1.x narrow (019): at 420 px the Chat/Workspace switcher shows ONE view. With Chat showing, the chat column
     fills the window (it was a 182 px strip at 45% with 230 px empty beside it: "Connect agent" clipped, the status
     bar 182 px wide), and the context ring's panel opens inside the viewport (it opened at left = -219). */
  await resize(page, 420, 860);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);

  await check('420 px: Chat showing -> the chat column is >= 90% of the viewport', async () => {
    is(await page.locator('.s2-row').getAttribute('data-view'), 'chat', 'data-view');
    const w = (await page.locator('.s2-chat').boundingBox()).width;
    log('chat column at 420', w);
    atLeast(w, 420 * 0.9, 'chat column width at 420');
  });

  await check('420 px: composer controls and the status bar lie inside the viewport', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      const vw = document.documentElement.clientWidth;
      const els = [...document.querySelectorAll('.s2-comp button, .s2-comp textarea, .s2-status')];
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${e.className || e.tagName} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      const st = document.querySelector('.s2-status')?.getBoundingClientRect();
      if (st && st.width < vw * 0.9) out.push(`status bar only ${Math.round(st.width)} px wide`);
      return out;
    });
    if (bad.length) throw new Error(`outside the viewport: ${bad.join('; ')}`);
  });

  await check('420 px: the context ring panel opens inside the viewport', async () => {
    await page.locator(sel('composer-context')).first().click();
    await page.waitForSelector(sel('composer-context-breakdown'));
    const r = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="composer-context-breakdown"]').getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
    });
    log('ring panel at 420', JSON.stringify(r));
    if (r.l < 0 || r.t < 0 || r.r > r.vw || r.b > r.vh) throw new Error(`panel box outside the viewport: ${JSON.stringify(r)}`);
  });
});
