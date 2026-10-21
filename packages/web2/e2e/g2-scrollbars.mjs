#!/usr/bin/env node
/**
 * SCROLLBARS ARE SLIM AND QUIET EVERYWHERE (0.1.6 G2, item b).
 *
 * Owner: the scrollbar is "too big, too mega". Chromium ignores ::-webkit-scrollbar
 * on any element that also sets scrollbar-width / scrollbar-color, and falls back to the
 * native bar (8 to 17 px, a visible track). So the check is the bar a reader actually
 * gets: each scroller selector the app styles is planted, and its EFFECTIVE bar is read:
 * scrollbar-width/color must be auto (else the native bar wins) and the ::-webkit-scrollbar
 * box must be 6 px or less, with a transparent track and a thumb at most 30% opaque.
 * (Headless Chromium draws overlay bars with a zero gutter, so offsetWidth - clientWidth
 * cannot be the instrument; the computed pseudo-element is.) The selector set is DERIVED from the stylesheets: every
 * rule that scrolls or sets scrollbar-width/color is found in document.styleSheets and planted.
 * Controls: a scroller with a 14 px gutter must be reported (negative of the scan).
 */
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';

await suite('g2-scrollbars', async ({ page, base, check, log }) => {
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);

  const scan = await page.evaluate(() => {
    /* Selectors of every rule that scrolls (overflow auto/scroll) or sets scrollbar-width/color, in any sheet. */
    const sels = new Set(['plain']);
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) walk(r.cssRules);
        if (!r.style || !r.selectorText) continue;
        const v = ['overflow', 'overflow-x', 'overflow-y', 'scrollbar-width', 'scrollbar-color']
          .map((k) => r.style.getPropertyValue(k))
          .join(' ');
        if (!/(auto|scroll|thin)/.test(v)) continue;
        for (const part of r.selectorText.split(',').map((x) => x.trim())) {
          if (part && !/[*:\[]/.test(part)) sels.add(part);
        }
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    return [...sels];
  });
  /* Plant one scroller per selector (and a plain one) and measure the real gutter. */
  const measure = (selectorText) =>
    page.evaluate((s) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;opacity:0;pointer-events:none;overflow:hidden';
      /* Build the element so the selector matches: parse "a b.c" into nested nodes by class chain. */
      let el = null;
      if (s === 'plain') {
        el = document.createElement('div');
        host.appendChild(el);
      } else {
        /* Only descendant/compound selectors made of classes, ids and tags are plantable. */
        const parts = s.split(',')[0].trim().split(/\s+/).filter((p) => p !== '>');
        let parent = host;
        for (const part of parts) {
          const node = document.createElement(/^[a-z]/i.test(part) ? part.match(/^[a-z0-9]+/i)[0] : 'div');
          for (const m of part.matchAll(/\.([\w-]+)/g)) node.classList.add(m[1]);
          const id = part.match(/#([\w-]+)/);
          if (id) node.id = id[1];
          parent.appendChild(node);
          parent = node;
        }
        el = parent;
      }
      el.style.width = '300px';
      el.style.height = '200px';
      el.style.overflow = 'scroll';
      el.innerHTML = '<div style="width:900px;height:900px"></div>';
      document.body.appendChild(host);
      const cs = getComputedStyle(el);
      const out = {
        selector: s,
        matched: s === 'plain' || host.querySelector(s.split(',')[0].trim()) === el,
        w: getComputedStyle(el, '::-webkit-scrollbar').width,
        h: getComputedStyle(el, '::-webkit-scrollbar').height,
        sbc: cs.scrollbarColor,
        thumb: getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
        track: getComputedStyle(el, '::-webkit-scrollbar-track').backgroundColor,
        sbw: cs.scrollbarWidth,
      };
      host.remove();
      return out;
    }, selectorText);

  const rows = [];
  for (const s of scan) rows.push(await measure(s));
  log('plantable:', rows.filter((r) => r.matched).length);

  await check('the scan found scrollers to measure (positive control)', async () => {
    atLeast(rows.length, 40, 'scroller selectors measured');
    atLeast(rows.filter((r) => r.matched).length, 30, 'selectors that planted a matching element');
  });

  await check('negative controls: a native-thin bar and a 14 px bar are both reported', async () => {
    const r = await page.evaluate(() => {
      const mk = (css) => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:100px;overflow:scroll;opacity:0;' + css;
        el.innerHTML = '<div style="width:900px;height:900px"></div>';
        document.body.appendChild(el);
        const o = { sbw: getComputedStyle(el).scrollbarWidth, w: getComputedStyle(el, '::-webkit-scrollbar').width };
        el.remove();
        return o;
      };
      const st = document.createElement('style');
      st.textContent = '.g2-big::-webkit-scrollbar{width:14px;height:14px}';
      document.head.appendChild(st);
      const big = document.createElement('div');
      big.className = 'g2-big';
      big.style.cssText = 'position:fixed;width:200px;height:100px;overflow:scroll;opacity:0';
      big.innerHTML = '<div style="width:900px;height:900px"></div>';
      document.body.appendChild(big);
      const bigW = getComputedStyle(big, '::-webkit-scrollbar').width;
      big.remove();
      st.remove();
      return { thin: mk('scrollbar-width:thin'), bigW };
    });
    is(r.thin.sbw, 'thin', 'planted native-thin bar');
    is(r.bigW, '14px', 'planted 14 px bar');
  });

  for (const r of rows) {
    if (!r.matched) continue;
    await check(`scrollbar <= 6px: ${r.selector}`, async () => {
      if (!r.matched) return; /* an unplantable selector (pseudo, attribute) is skipped, counted above */
      if (r.sbw === 'none') return;
      if (r.sbw !== 'auto' || r.sbc !== 'auto') throw new Error(`native bar wins: scrollbar-width ${r.sbw}, scrollbar-color ${r.sbc}`);
      if (!(parseFloat(r.w) <= 6 && parseFloat(r.h) <= 6)) throw new Error(`bar is ${r.w} x ${r.h}`);
      const a = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
      if (a(r.track) !== 0) throw new Error(`track is not transparent: ${r.track}`);
      if (a(r.thumb) > 0.3) throw new Error(`thumb too strong: ${r.thumb}`);
    });
  }
});
