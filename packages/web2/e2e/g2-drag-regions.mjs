#!/usr/bin/env node
/**
 * THE WINDOW CAN BE DRAGGED BY ITS HEADER, AND EVERY CONTROL STILL CLICKS (0.1.6 G2, item e).
 *
 * Owner: "there is no part on the screen where I can click and drag to move [the window]".
 * Root cause measured here: Chromium computes `-webkit-app-region: none` as `no-drag`, so the
 * 0.1.5 spacers that were given `app-region: none` to "carry no region of their own" were in
 * fact no-drag holes, and the bar's drag area was cut to slivers. The frameless Windows window
 * moves only by a drag region, so the header had none.
 *
 * Electron builds its drag region from the elements in tree order, a later element winning
 * where they overlap. REGION_AT below does the same off the live page. Checks (desktop bridge
 * present, so the window buttons draw as in the app):
 *   1. no stylesheet declares app-region: none (it means no-drag);
 *   2. at 1440 with two surfaces open the top bar has drag beside the pills and a long run above
 *      the controls; so has the chat title bar;
 *   3. at the narrow width (900) the narrow bar has drag between its controls;
 *   4. DERIVED SET: every visible button, input, tab and link in a header resolves to
 *      never drag at its left, middle or right;
 *   5. controls: a planted drag strip is seen as drag; a planted no-drag box as no-drag.
 */
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';

const REGION_AT = `(x, y) => {
  let res = 'none';
  for (const el of document.body.querySelectorAll('*')) {
    const v = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim();
    if (v !== 'drag' && v !== 'no-drag') continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) res = v;
  }
  return res;
}`;

await suite('g2-drag-regions', async ({ page, base, check, log }) => {
  await page.addInitScript(() => {
    window.sequence = { openRepo: async () => null, shell: async () => ({ maximized: false }) };
  });
  await resize(page, 1440, 900);
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  for (let i = 0; i < 6; i++) {
    const x = page.locator('.s2-sp-x').first();
    if (!(await x.count())) break;
    await x.click();
    await settle(page);
  }
  for (const id of ['architecture', 'files']) {
    await page.locator(sel(`s2-tab-${id}`)).click();
    await settle(page);
  }
  await page.waitForTimeout(500);

  /* Longest horizontal run of drag along a row of one element (its middle, or 4 px under its top edge, in the
     padding above the controls), sampled every 4 px. */
  const longestDrag = (selector, edge = false) =>
    page.evaluate(
      ({ selector, fn, edge }) => {
        const at = eval(fn);
        const el = document.querySelector(selector);
        if (!el) return -1;
        const r = el.getBoundingClientRect();
        const y = edge ? r.top + 4 : r.top + r.height / 2;
        let best = 0;
        let run = 0;
        for (let x = Math.max(0, Math.floor(r.left)); x < r.right; x += 4) {
          if (at(x, y) === 'drag') {
            run += 4;
            best = Math.max(best, run);
          } else run = 0;
        }
        return best;
      },
      { selector, fn: REGION_AT, edge },
    );

  const controls = (rootSel) =>
    page.evaluate(
      ({ rootSel, fn }) => {
        const at = eval(fn);
        const bad = [];
        let n = 0;
        for (const root of document.querySelectorAll(rootSel)) {
          const q = 'button, input, textarea, select, a[href], [role="button"], [role="tab"], [role="menuitem"]';
          for (const el of root.querySelectorAll(q)) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none') continue;
            n++;
            const y = r.top + r.height / 2;
            for (const x of [r.left + r.width * 0.25, r.left + r.width / 2, r.left + r.width * 0.75]) {
              const v = at(x, y);
              if (v === 'drag') bad.push(`${el.dataset.testid || el.className.toString().slice(0, 30)}@${Math.round(x)}=${v}`);
            }
          }
        }
        return { n, bad };
      },
      { rootSel, fn: REGION_AT },
    );

  await check('no stylesheet declares app-region: none (Chromium computes it as no-drag)', async () => {
    const found = await page.evaluate(() => {
      const hits = [];
      const walk = (rules) => {
        for (const r of rules) {
          if (r.cssRules && !r.selectorText) walk(r.cssRules);
          if (!r.style || !r.selectorText) continue;
          for (const k of ['app-region', '-webkit-app-region']) if (r.style.getPropertyValue(k).trim() === 'none') hits.push(r.selectorText);
        }
      };
      for (const s of document.styleSheets) walk(s.cssRules);
      return hits;
    });
    is(JSON.stringify(found), '[]', 'rules declaring app-region: none');
  });

  await check('control: none really computes to no-drag, and the emulator sees drag and no-drag', async () => {
    const r = await page.evaluate((fn) => {
      const at = eval(fn);
      const mk = (css, x) => {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;left:${x}px;top:400px;width:40px;height:40px;${css}`;
        document.body.appendChild(d);
        const out = { computed: getComputedStyle(d).getPropertyValue('-webkit-app-region').trim(), at: at(x + 20, 420) };
        d.remove();
        return out;
      };
      return { none: mk('-webkit-app-region:none', 300), drag: mk('-webkit-app-region:drag', 360), nodrag: mk('-webkit-app-region:no-drag', 420) };
    }, REGION_AT);
    is(r.none.computed, 'no-drag', 'none computes to');
    is(r.drag.at, 'drag', 'planted drag strip');
    is(r.nodrag.at, 'no-drag', 'planted no-drag box');
  });

  await check('the top bar is draggable: a stretch beside the pills and a long one above them (two surfaces, 1440)', async () => {
    const mid = await longestDrag(sel('s2-topbar'));
    const edge = await longestDrag(sel('s2-topbar'), true);
    log('top bar longest drag run: beside the pills', mid, 'above them', edge);
    atLeast(mid, 48, 'top bar drag run beside the pills (px)');
    atLeast(edge, 400, 'top bar drag run above the controls (px)');
  });
  await check('the chat title bar is draggable beside its title and above it', async () => {
    const mid = await longestDrag('.s2-ch');
    const edge = await longestDrag('.s2-ch', true);
    log('chat title bar longest drag run: beside', mid, 'above', edge);
    atLeast(mid, 8, 'chat title bar drag run beside the title (px)');
    atLeast(edge, 300, 'chat title bar drag run above the controls (px)');
  });
  await check('every control in the headers never resolves to drag at its left, middle or right', async () => {
    const r = await controls('.s2-topb, .s2-ch, .s2-ph');
    log('header controls measured', r.n);
    atLeast(r.n, 8, 'controls measured');
    is(JSON.stringify(r.bad), '[]', 'controls that would drag the window instead of clicking');
  });

  await check('a menu opened from the chat title bar is no-drag where it overlaps the bar', async () => {
    await page.locator(sel('s2-chat-more')).click();
    await settle(page);
    const r = await page.evaluate((fn) => {
      const at = eval(fn);
      const m = document.querySelector('.s2-ch .s2-menu');
      if (!m) return { missing: true };
      const b = m.getBoundingClientRect();
      const bar = document.querySelector('.s2-ch').getBoundingClientRect();
      const overlaps = b.top < bar.bottom;
      const y = Math.min(b.top + 4, bar.bottom - 1);
      return { overlaps, region: at(b.left + b.width / 2, y) };
    }, REGION_AT);
    if (r.missing) throw new Error('chat menu did not open');
    if (r.overlaps) if (r.region === 'drag') throw new Error('menu over the bar would drag the window');
    await page.keyboard.press('Escape');
  });

  /* A generous handle (0.1.6): at each width and with 1 to 3 surfaces open there is one contiguous, visible drag area
     of at least 120 x 28 px in the top 120 px (4 px cells; the outer 8 px are the window's resize border and do not
     count), and with the bar scrolled to either end no chat-header control or visible pill resolves to drag. */
  const bigDrag = () =>
    page.evaluate((fn) => {
      const at = eval(fn);
      const W = innerWidth;
      const cols = Math.floor(W / 4);
      const rows = 30;
      const g = [];
      for (let r = 0; r < rows; r++) {
        g.push([]);
        for (let c = 0; c < cols; c++) {
          const x = c * 4 + 2;
          const y = r * 4 + 2;
          g[r].push(x < 8 || x > W - 8 || y < 8 ? 0 : at(x, y) === 'drag' ? 1 : 0);
        }
      }
      /* largest all-drag rectangle with width >= 30 cells and height >= 7 cells, by brute force with a prefix sum */
      const P = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) P[r + 1][c + 1] = P[r][c + 1] + P[r + 1][c] - P[r][c] + g[r][c];
      let best = { w: 0, h: 0 };
      for (let r0 = 0; r0 < rows; r0++) for (let r1 = r0 + 7; r1 <= rows; r1++) {
        let run = 0;
        for (let c = 0; c < cols; c++) {
          const full = P[r1][c + 1] - P[r0][c + 1] - P[r1][c] + P[r0][c] === r1 - r0;
          run = full ? run + 1 : 0;
          if (run * 4 > best.w && (r1 - r0) * 4 >= 28) best = { w: run * 4, h: (r1 - r0) * 4 };
        }
      }
      return best;
    }, REGION_AT);
  const openN = async (n) => {
    for (let i = 0; i < 6; i++) {
      const x = page.locator('.s2-sp-x').first();
      if (!(await x.count())) break;
      await x.click();
      await settle(page);
    }
    for (const id of ['architecture', 'files', 'whiteboard'].slice(0, n)) {
      await page.locator(sel(`s2-tab-${id}`)).click();
      await settle(page);
    }
    await page.waitForTimeout(500);
  };
  for (const [w, h, maxN] of [[1440, 900, 3], [1024, 700, 2]]) {
    await resize(page, w, h);
    await page.goto(base);
    await page.waitForSelector(sel('shell'));
    await settle(page);
    for (let n = 1; n <= maxN; n++) {
      await check(`${w}px, ${n} surface(s): a contiguous drag area >= 120 x 28`, async () => {
        await openN(n);
        const best = await bigDrag();
        log(`${w} px, ${n} open: largest drag area (height >= 28)`, JSON.stringify(best));
        atLeast(best.w, 120, 'drag area width (px)');
      });
    }
    await check(`${w}px: with the bar scrolled to either end, every chat-header control and every visible pill is no-drag`, async () => {
      const bad = [];
      for (const end of ['start', 'end']) {
        await page.evaluate((end) => {
          const n = document.querySelector('[data-testid="s2-surfaces"]');
          n.scrollLeft = end === 'end' ? n.scrollWidth : 0;
        }, end);
        await page.waitForTimeout(300);
        const r = await page.evaluate((fn) => {
          const at = eval(fn);
          const out = [];
          const nb = document.querySelector('[data-testid="s2-surfaces"]').getBoundingClientRect();
          const items = [...document.querySelectorAll('.s2-ch button, .s2-ch input, [data-testid="chat-title"], [data-testid="s2-chat-more"]')];
          for (const el of items) {
            const b = el.getBoundingClientRect();
            if (b.width < 4) continue;
            const y = b.top + b.height / 2;
            for (const x of [b.left + b.width * 0.25, b.left + b.width / 2, b.left + b.width * 0.75]) if (at(x, y) !== 'no-drag') out.push('chat:' + (el.dataset.testid || el.className) + '@' + Math.round(x) + '=' + at(x, y));
          }
          for (const el of document.querySelectorAll('.s2-sp-main, .s2-sp-x')) {
            const b = el.getBoundingClientRect();
            const l = Math.max(b.left, nb.left), rr = Math.min(b.right, nb.right);
            if (rr - l < 6) continue;
            const y = b.top + b.height / 2;
            for (const x of [l + 2, (l + rr) / 2, rr - 2]) if (at(x, y) !== 'no-drag') out.push('pill:' + (el.dataset.testid || el.className) + '@' + Math.round(x) + '=' + at(x, y));
          }
          return out;
        }, REGION_AT);
        bad.push(...r.map((x) => `${end}:${x}`));
      }
      is(JSON.stringify(bad), '[]', 'controls that would drag the window');
    });
    /* Known trade-off, not asserted away: app-region inherits, so a pill scrolled out of sight is no-drag where it
       sits (over the chat column's header, whose own controls are no-drag anyway). Making the pills drag instead put
       them over the chat header's buttons (the later region wins), which the check above forbids. */
  }

  /* The narrow window: one bar, controls between drag. */
  await resize(page, 900, 640);
  await page.goto(base);
  await page.waitForSelector('.s2-narrowbar');
  await settle(page);
  await check('narrow window: drag between the narrow bar controls, and the controls are no-drag', async () => {
    const best = await longestDrag('.s2-narrowbar');
    log('narrow bar longest drag run', best);
    atLeast(best, 40, 'narrow bar drag run (px)');
    const r = await controls('.s2-narrowbar');
    atLeast(r.n, 3, 'narrow controls measured');
    is(JSON.stringify(r.bad), '[]', 'narrow controls that would drag');
  });
});
