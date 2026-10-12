#!/usr/bin/env node
/**
 * THE SURFACE BAR SCROLLS SMOOTHLY AND EVERY TAB IS REACHABLE (0.1.6 G2, item d).
 *
 * Owner: at 1024 wide, dragging the surface bar to reach Whiteboard and Agents is "very choppy".
 *
 * MEASURED FIRST, on the base build at 1024x700 (desktop bridge present so the window buttons take their room),
 * two surfaces open, Chromium 154, CPU throttled 6x to stand in for a slower machine:
 *   - the names overflow the bar by 42 px (natural 492, visible 450), Agents is cut at scrollLeft 0;
 *   - a drag wrote scrollLeft once per pointer event (60 events, 60 writes); a wheel notch jumped; a surface opened
 *     off the edge snapped; a release stopped dead;
*   - ROOT CAUSE: shell2.css gave the bar scroll-snap-type: x proximity with a snap point at each name; with 42 px of
 *     overflow it had two stops, so setting scrollLeft to 5, 20, 41 landed on 0, 0, 42: a drag could only jump
 *     between the ends and a wheel notch (30 px) went all the way to 42.
 *   - the JS was small (script 0.03 s of a 1.2 s drag at 1x) and layout nil: the time went to the main thread's
 *     style and paint work (program 1.67 s of 2.8 s in the profile) and to state updates, not to arithmetic.
 *     Under 6x throttle a 64-74 ms long task sat at the start of a drag, with 2-4 frames over 33 ms
 *     (setState on drag start and on every fade-edge crossing re-rendered the whole shell: board, panes, chat).
 *   - what could NOT be reproduced headless is the compositor / GPU cost on a real Electron window.
 *
 * What this locks (each fails on the base build):
 *   1. every tab can be brought fully into the bar (wheel, then drag);
 *   2. a burst of pointer events in one task makes at most 2 scrollLeft writes (rAF-coalesced), not one each;
 *   3. dragging 1:1 follows the pointer, and a fast release keeps gliding then settles;
 *   4. one wheel notch eases across several frames, not a jump;
 *   5. activating a tab that is cut off glides it fully into view;
 *   6. the click that ends a drag does not open or close a surface;
 *   7. (holds on the base too, kept as a guard) crossing a fade edge changes only the scroll cues in the DOM.
 */
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';

await suite('g2-surface-bar', async ({ page, base, check, log }) => {
  await page.addInitScript(() => {
    window.sequence = { openRepo: async () => null, shell: async () => ({ maximized: false }) };
  });
  /* 1024 is the narrowest width that still has the bar (below it the app folds to one view at a time). */
  await resize(page, 1024, 700);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  for (const id of ['architecture', 'files']) {
    await page.locator(sel(`s2-tab-${id}`)).click();
    await settle(page);
  }
  await page.waitForTimeout(600);

  const bar = () => page.evaluate(() => {
    const n = document.querySelector('[data-testid="s2-surfaces"]');
    const r = n.getBoundingClientRect();
    return { sw: n.scrollWidth, cw: n.clientWidth, left: n.scrollLeft, x: r.left, right: r.right, y: r.top + r.height / 2 };
  });
  const tabBox = (id) => page.evaluate((id) => {
    const t = document.querySelector(`[data-testid="s2-tab-${id}"]`).getBoundingClientRect();
    const b = document.querySelector('[data-testid="s2-surfaces"]').getBoundingClientRect();
    return { l: t.left - b.left, r: t.right - b.right };
  }, id);
  const frames = (n) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  const start = await bar();
  log('bar', JSON.stringify(start));
  await check('precondition: the names overflow the bar at 1024 (positive control)', async () => {
    atLeast(start.sw - start.cw, 30, 'overflow (px)');
  });

  await check('every tab can be brought fully into the bar by the wheel', async () => {
    for (const id of ['architecture', 'files', 'whiteboard', 'terminal', 'agents']) {
      /* scroll to whichever end brings it in */
      const b = await bar();
      const before = await tabBox(id);
      if (before.r > 0.5) await page.mouse.move(b.x + b.cw / 2, b.y), await page.mouse.wheel(0, 400);
      if (before.l < -0.5) await page.mouse.move(b.x + b.cw / 2, b.y), await page.mouse.wheel(0, -400);
      await page.waitForTimeout(700);
      const after = await tabBox(id);
      if (after.l < -1.5 || after.r > 1.5) throw new Error(`${id} still cut off: ${JSON.stringify(after)}`);
    }
  });

  await check('a burst of pointer events in one task makes at most 2 scrollLeft writes', async () => {
    await page.evaluate(() => { document.querySelector('[data-testid="s2-surfaces"]').scrollLeft = 0; });
    await settle(page);
    const writes = await page.evaluate(() => {
      const n = document.querySelector('[data-testid="s2-surfaces"]');
      const proto = Object.getPrototypeOf(Object.getPrototypeOf(n));
      const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
      let count = 0;
      Object.defineProperty(n, 'scrollLeft', { configurable: true, get() { return desc.get.call(this); }, set(v) { count++; desc.set.call(this, v); } });
      const r = n.getBoundingClientRect();
      const x0 = r.left + 200;
      const y = r.top + r.height / 2;
      const ev = (type, x, t) => new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y });
      n.dispatchEvent(ev('pointerdown', x0));
      for (let i = 1; i <= 24; i++) n.dispatchEvent(ev('pointermove', x0 - i * 1));
      n.dispatchEvent(ev('pointerup', x0 - 24));
      void proto;
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => { delete n.scrollLeft; res(count); })));
    });
    log('scrollLeft writes for 24 pointer moves', writes);
    if (writes > 2) throw new Error(`${writes} writes for one burst`);
    await settle(page);
  });

  await check('a drag follows the pointer 1:1, a fast release keeps gliding, and it settles', async () => {
    await page.evaluate(() => { const n = document.querySelector('[data-testid="s2-surfaces"]'); n.scrollLeft = 0; });
    await page.waitForTimeout(100);
    const b = await bar();
    const x0 = b.x + b.cw - 40;
    await page.mouse.move(x0, b.y);
    await page.mouse.down();
    let t = 0;
    for (let i = 1; i <= 4; i++) { await page.mouse.move(x0 - i * 5, b.y); await page.waitForTimeout(16); t += 5; }
    await frames(2);
    const during = (await bar()).left;
    log('after a 20 px drag, scrollLeft', during);
    if (Math.abs(during - 20) > 3) throw new Error(`drag moved ${during}, wanted 20 +/- 3`);
    await page.mouse.up();
    const atUp = (await bar()).left;
    await page.waitForTimeout(220);
    const later = (await bar()).left;
    const max = b.sw - b.cw;
    log('release: at up', atUp, 'later', later, 'max', max);
    if (!(later > atUp + 1 || later >= max - 1)) throw new Error(`no glide after release: ${atUp} -> ${later} (max ${max})`);
    await page.waitForTimeout(800);
    const a = (await bar()).left;
    await page.waitForTimeout(250);
    is((await bar()).left, a, 'scrollLeft once settled');
  });

  await check('one wheel notch eases over several frames, not a jump', async () => {
    await page.evaluate(() => { document.querySelector('[data-testid="s2-surfaces"]').scrollLeft = 0; });
    await page.waitForTimeout(150);
    const seen = await page.evaluate(() => new Promise((res) => {
      const n = document.querySelector('[data-testid="s2-surfaces"]');
      const r = n.getBoundingClientRect();
      n.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, deltaMode: 0, bubbles: true, cancelable: true, clientX: r.left + 50, clientY: r.top + 10 }));
      const vals = [];
      let i = 0;
      const f = () => { vals.push(Math.round(n.scrollLeft * 10) / 10); if (++i < 30) requestAnimationFrame(f); else res(vals); };
      requestAnimationFrame(f);
    }));
    const distinct = new Set(seen.filter((v) => v > 0 && v < 30)).size;
    log('wheel values per frame', JSON.stringify(seen.slice(0, 12)), 'distinct in between', distinct);
    atLeast(distinct, 3, 'intermediate scroll positions for one notch');
    atLeast(seen.at(-1), 28, 'where the notch ends (px)');
  });

  await check('activating a cut-off tab glides it fully into view', async () => {
    await page.evaluate(() => { document.querySelector('[data-testid="s2-surfaces"]').scrollLeft = 0; });
    await page.waitForTimeout(200);
    const before = await tabBox('agents');
    if (before.r <= 0.5) throw new Error('precondition: Agents should start cut off');
    /* A real pointer click on the part of Agents that shows (a locator click would scroll it into view itself). */
    const b0 = await bar();
    await page.evaluate(() => {
      window.__seen = [];
      const n = document.querySelector('[data-testid="s2-surfaces"]');
      const f = () => { window.__seen.push(Math.round(n.scrollLeft * 10) / 10); window.__sraf = requestAnimationFrame(f); };
      window.__sraf = requestAnimationFrame(f);
    });
    await page.mouse.click(b0.right - 14, b0.y);
    await page.waitForTimeout(700);
    const seen = await page.evaluate(() => { cancelAnimationFrame(window.__sraf); return window.__seen; });
    const after = await tabBox('agents');
    const end = (await bar()).left;
    const between = new Set(seen.filter((v) => v > 1 && v < end - 1)).size;
    log('into view: scrollLeft per frame', JSON.stringify(seen.slice(0, 14)), 'settled', end, 'agents', JSON.stringify(after));
    if (after.r > 1.5) throw new Error(`Agents still cut off: ${JSON.stringify(after)}`);
    atLeast(between, 3, 'intermediate positions on the way in (a glide, not a snap)');
  });

  await check('the click that ends a drag does not open or close a surface', async () => {
    const pills = () => page.evaluate(() => [...document.querySelectorAll('[data-pill]')].map((p) => `${p.dataset.pill}:${p.dataset.state}`).join(','));
    await page.evaluate(() => { document.querySelector('[data-testid="s2-surfaces"]').scrollLeft = 0; });
    await page.waitForTimeout(200);
    const before = await pills();
    const b = await bar();
    const f = await page.locator(sel('s2-tab-files')).boundingBox();
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(f.x + f.width / 2 - i * 5, f.y + f.height / 2); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    is(await pills(), before, 'pill states after a drag that ended on a name');
    void b;
  });

  await check('scrolling across a fade edge changes only the cues, not the shell', async () => {
    await page.evaluate(() => { document.querySelector('[data-testid="s2-surfaces"]').scrollLeft = 0; });
    await page.waitForTimeout(200);
    const changed = await page.evaluate(() => new Promise((res) => {
      const n = document.querySelector('[data-testid="s2-surfaces"]');
      const shell = document.querySelector('[data-testid="shell"]');
      const seen = new Set();
      const mo = new MutationObserver((rs) => rs.forEach((r) => seen.add(`${r.type}:${r.attributeName ?? ''}:${r.target === n ? 'bar' : r.target === n.parentElement ? 'wrap' : r.target.className?.toString().slice(0, 24) ?? ''}`)));
      mo.observe(shell, { subtree: true, childList: true, attributes: true });
      n.scrollLeft = 20;
      requestAnimationFrame(() => requestAnimationFrame(() => { n.scrollLeft = n.scrollWidth; requestAnimationFrame(() => requestAnimationFrame(() => { mo.disconnect(); res([...seen]); })); }));
    }));
    log('mutations', JSON.stringify(changed));
    const stray = changed.filter((c) => !/^attributes:(data-fade|data-more|data-scrollable|style):/.test(c));
    is(JSON.stringify(stray), '[]', 'mutations other than the scroll cues');
  });

  await check('the glide ends: no frame loop keeps running after a wheel notch (DPR 1 rounds scrollLeft)', async () => {
    await page.evaluate(() => {
      window.__raf = 0;
      const o = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__raf++; return o(cb); };
      document.querySelector('[data-testid="s2-surfaces"]').scrollLeft = 0;
    });
    await page.waitForTimeout(300);
    const b = await bar();
    await page.mouse.move(b.x + b.cw / 2, b.y);
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(1200);
    const a = await page.evaluate(() => window.__raf);
    await page.waitForTimeout(1000);
    const c = await page.evaluate(() => window.__raf);
    log('rAF calls in 1 s after settling', c - a);
    if (c - a > 5) throw new Error(`${c - a} frame callbacks in a second once the bar had settled`);
    atLeast((await bar()).left, 28, 'where the notch ended');
  });
});
