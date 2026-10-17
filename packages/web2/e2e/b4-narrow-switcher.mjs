#!/usr/bin/env node
/**
 * THE NARROW SURFACE BAR NEVER FOLDS TO ICONS, AND THE CHAT / WORKSPACE SWITCHER IS CENTRED (0.1.6 B4, reworked C6).
 *
 * Owner: "I don't like how at 420 a focus icon shows. It should always show the names of everything, never compressed
 * to icons. People should be able to scroll with their thumb or mouse from left to right to find the other
 * categories." and "make sure chat/workspace is properly centered. I don't want to see any mistakes with centering."
 *
 * What this locks (the fold and centring checks fail on the base build 88d6bbcd):
 *   1. 960..360: every surface is in the bar and EVERY name is drawn (no icon-only tab, no data-fold);
 *   2. a bar that does not fit scrolls by wheel (vertical wheel -> horizontal) and by drag, and is not a page scroll;
 *   3. scrolled to the end the last tab is whole, and the focused tab is brought in clear of the fade edge;
 *   4. below 1024 the Chat / Workspace switcher's centre is the row's centre within 0.5 px at 960, 800, 640, 520, 420,
 *      360; its two segments are the same width with the label centred in each.
 * B4_BASE=<url> runs the same checks against a served build (the base build for the fails-before proof).
 */
import { is, resize, sel, settle, suite } from './lib/harness.mjs';

const SURFACES = ['architecture', 'files', 'whiteboard', 'terminal', 'agents'];

await suite('b4-narrow-switcher', async ({ page, base, check, log }) => {
  await page.addInitScript(() => {
    /* #noshell: a browser tab (no drawn window buttons). The desktop app's minimum width is 960, so 360 and 280 with
       window buttons beside the switcher is not a window that exists; those widths run as a browser tab. */
    window.sequence = location.hash.includes('noshell') ? { openRepo: async () => null } : { openRepo: async () => null, shell: async () => ({ maximized: false }) };
  });
  const url = process.env.B4_BASE || base;
  await resize(page, 1280, 700);
  await page.goto(url);
  await page.waitForSelector(sel('shell'));
  await settle(page);

  let current = null;
  const open = async (w, noshell = false) => {
    const mode = noshell ? 'tab' : 'desktop';
    /* The page is loaded fresh for each mode (a hash-only goto would not reload, and the init script reads the hash):
       a browser tab (#noshell: no drawn window buttons) or the desktop app (the buttons exist, asserted here). */
    if (mode !== current) {
      await resize(page, w, 700);
      await page.goto('about:blank');
      await page.goto(noshell ? `${url}#noshell` : url);
      await page.reload();
      await page.waitForSelector(sel('shell'));
      await settle(page);
      current = mode;
    }
    await resize(page, w, 700);
    await page.waitForSelector(sel(noshell ? 'shell' : 'shell-window-controls'), { timeout: 5000 });
    is(await page.locator(sel('shell-window-controls')).count(), noshell ? 0 : 1, `window buttons in ${mode} mode`);
    await resize(page, w, 700);
    if (w < 1024) {
      await page.locator(sel('s2-narrow-stage')).click();
      await settle(page);
    }
    for (const id of ['architecture', 'files']) {
      await page.locator(sel(`s2-tab-${id}`)).click();
      await settle(page);
    }
    await page.waitForTimeout(500);
  };
  const read = () =>
    page.evaluate((ids) => {
      const bar = document.querySelector('[data-testid="s2-surfaces"]');
      const b = bar.getBoundingClientRect();
      const tabs = ids.map((id) => {
        const main = document.querySelector(`[data-testid="s2-tab-${id}"]`);
        const t = main.closest('.s2-sp').getBoundingClientRect();
        const lab = main.querySelector('.s2-seg-l');
        return {
          id,
          l: t.left - b.left,
          r: t.right - b.right,
          label: !!lab && getComputedStyle(lab).display !== 'none' && lab.getBoundingClientRect().width > 0,
          focused: main.classList.contains('is-focused'),
        };
      });
      return { fold: bar.dataset.fold ?? null, scrollLeft: bar.scrollLeft, fade: bar.dataset.fade ?? null, sw: bar.scrollWidth, cw: bar.clientWidth, tabs, vw: innerWidth, docW: document.documentElement.scrollWidth };
    }, SURFACES);

  await check('1100: every name shown (positive control for the wide bar)', async () => {
    await open(1100);
    const m = await read();
    is(m.fold, null, 'data-fold at a wide width');
    for (const t of m.tabs) is(t.label, true, `${t.id} label`);
  });

  for (const w of [960, 800, 640, 520, 420, 360]) {
    await check(`${w}: every name is drawn, never an icon alone; no data-fold; the page does not scroll sideways`, async () => {
      await open(w);
      const m = await read();
      log(w, JSON.stringify({ fold: m.fold, sw: m.sw, cw: m.cw, fade: m.fade }));
      is(m.tabs.length, 5, 'surfaces in the bar');
      is(m.fold, null, 'data-fold');
      for (const t of m.tabs) is(t.label, true, `${t.id} label at ${w}`);
      /* A name is whole: its label is not narrower than its text (nothing ellipsised or squeezed). */
      const squeezed = await page.evaluate(() => [...document.querySelectorAll('[data-testid="s2-surfaces"] .s2-seg-l')].filter((l) => l.scrollWidth > l.clientWidth + 1).length);
      is(squeezed, 0, 'squeezed labels');
      if (m.docW > m.vw + 1) throw new Error(`page scrolls sideways: ${m.docW} > ${m.vw}`);
    });
  }

  await check('420: the wheel (vertical) and a drag scroll the bar sideways; the last tab is whole at the end', async () => {
    await open(420);
    const m0 = await read();
    if (m0.sw <= m0.cw + 1) throw new Error(`precondition: the bar should overflow at 420 (${m0.sw}/${m0.cw})`);
    const box = await page.locator(sel('s2-surfaces')).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(700);
    const m1 = await read();
    log(420, 'wheel scrollLeft', m0.scrollLeft, '->', m1.scrollLeft);
    if (!(m1.scrollLeft > m0.scrollLeft + 20)) throw new Error('vertical wheel did not scroll the bar sideways');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy, { steps: 6 });
    await page.mouse.move(cx + 120, cy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const m2 = await read();
    log(420, 'drag scrollLeft', m1.scrollLeft, '->', m2.scrollLeft);
    if (!(m2.scrollLeft < m1.scrollLeft - 20)) throw new Error('drag did not scroll the bar');
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(900);
    const m3 = await read();
    const last = m3.tabs[m3.tabs.length - 1];
    log(420, 'end', JSON.stringify({ sl: m3.scrollLeft, sw: m3.sw, cw: m3.cw, r: last.r, label: last.label }));
    if (m3.scrollLeft < m3.sw - m3.cw - 2) throw new Error('did not reach the end');
    is(last.label, true, 'last tab named at the end');
    if (last.r > 1) throw new Error(`last tab cut at the end (r ${last.r})`);
    const docW = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (docW > 1) throw new Error('the page scrolled sideways');
  });

  await check('280: still overflowing, the focused surface is brought in clear of the fade edge', async () => {
    await open(280, true);
    for (const id of ['whiteboard', 'terminal', 'agents', 'architecture', 'terminal']) {
      await page.locator(sel(`s2-tab-${id}`)).click({ force: true });
      await settle(page);
      await page.waitForTimeout(700);
      const m = await read();
      const t = m.tabs.find((x) => x.id === id);
      log(280, id, JSON.stringify({ l: t.l, r: t.r, fade: m.fade, sw: m.sw, cw: m.cw }));
      if (m.sw <= m.cw + 1) throw new Error('precondition: the bar should overflow at 280');
      if (t.l < -1 || t.r > 1) throw new Error(`${id} cut`);
      if ((m.fade === 'start' || m.fade === 'both') && t.l < 27) throw new Error(`${id} under the start fade (l ${t.l})`);
      if ((m.fade === 'end' || m.fade === 'both') && -t.r < 27) throw new Error(`${id} under the end fade (r ${t.r})`);
    }
  });

  await check('420: Tab and Shift+Tab across the tabs bring each focused tab in, clear of a faded edge', async () => {
    await open(420);
    await page.locator(sel('s2-tab-architecture')).focus();
    const seen = [];
    const measure = async (dir) => {
      await page.waitForTimeout(700);
      const m = await read();
      const f = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
      const t = m.tabs.find((x) => `s2-tab-${x.id}` === f);
      if (!t) return;
      seen.push(`${dir}:${t.id}`);
      if ((m.fade === 'start' || m.fade === 'both') && t.l < 27) throw new Error(`${t.id} under the start fade (l ${t.l}) going ${dir}`);
      if ((m.fade === 'end' || m.fade === 'both') && -t.r < 27) throw new Error(`${t.id} under the end fade (r ${t.r}) going ${dir}`);
      if (t.l < -1 || t.r > 1) throw new Error(`${t.id} cut going ${dir}`);
    };
    /* focus-visible needs the keyboard: Tab moves through the tabs and their close buttons */
    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.press('Tab');
      await measure('fwd');
    }
    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.press('Shift+Tab');
      await measure('back');
    }
    log(420, 'focused tabs seen', seen.join(' '));
    if (new Set(seen.filter((x) => x.startsWith('fwd')).map((x) => x.slice(4))).size < 3) throw new Error(`Tab reached too few tabs: ${seen.join(' ')}`);
  });

  /* C6 item 3: the switcher is centred on its row, in a browser tab (no window buttons: two children in the bar, the
     case a flex row got wrong) and in the desktop app (a 94 px set of window buttons on the right). The app's minimum
     width is 960, so the drawn buttons are only run where a window can be. */
  for (const noshell of [true, false]) {
    for (const w of [960, 800, 640, 520, 420, 360]) {
      if (!noshell && w < 420) continue;
      await check(`${w}${noshell ? ' browser tab' : ' desktop'}: the Chat / Workspace switcher is centred on its row (0.5 px), two equal segments, labels centred`, async () => {
        await open(w, noshell);
        const m = await page.evaluate(() => {
          const bar = document.querySelector('.s2-narrowbar');
          const row = bar.getBoundingClientRect();
          const sw = document.querySelector('[data-testid="s2-narrow-switch"]').getBoundingClientRect();
          const seg = ['chat', 'stage'].map((v) => {
            const b = document.querySelector(`[data-testid="s2-narrow-${v}"]`);
            const br = b.getBoundingClientRect();
            const rg = document.createRange();
            rg.selectNodeContents(b);
            const tr = rg.getBoundingClientRect();
            return { w: br.width, off: tr.left + tr.width / 2 - (br.left + br.width / 2) };
          });
          const sw2 = document.querySelector('[data-testid="s2-narrow-switch"]');
          const others = [...bar.children].filter((c) => c !== sw2).map((c) => c.getBoundingClientRect());
          return { rowC: row.left + row.width / 2, swC: sw.left + sw.width / 2, swL: sw.left, swR: sw.right, seg, others: others.map((k) => [k.left, k.right]) };
        });
        log(w, JSON.stringify(m));
        if (Math.abs(m.rowC - m.swC) > 0.5) throw new Error(`switcher centre ${m.swC} vs row centre ${m.rowC}`);
        if (Math.abs(m.seg[0].w - m.seg[1].w) > 0.5) throw new Error(`segments ${m.seg[0].w} / ${m.seg[1].w}`);
        for (const g of m.seg) if (Math.abs(g.off) > 0.5) throw new Error(`label off centre by ${g.off}`);
        for (const [l, r] of m.others) if (l < m.swR - 0.5 && r > m.swL + 0.5) throw new Error(`a neighbour (${l}..${r}) overlaps the switcher (${m.swL}..${m.swR})`);
      });
    }
  }
});
