#!/usr/bin/env node
/**
 * THE HOME SCREEN (round 9, items 1, 2, 8, 9, 21).
 *
 * Jaden, testing the installed round 8 build with every surface closed and a
 * new chat open:
 *   1 "The surface icons at the top do nothing, so the boards are unreachable
 *     until the app restarts."
 *   2 "The floating background overlaps... it must not block access."
 *   8 "Expanding many section cards pushes Settings and more under the
 *     status bar."
 *   9 "The session rail and main chat overhang the status bar, and it isn't
 *     centered on the screen."
 *  21 "Dragging dividers left and right snaps to lock frames (25%, 33%, 50%)."
 *
 * WHY ITEM 1 NEEDS THE DRAG-REGION WALK. In a headless page every icon took
 * its click; in the frameless desktop window none did. The icons floated
 * (absolutely) over the bar's drag strip, and the window's drag region is
 * built from the page's `app-region` boxes in document order, each `drag` box
 * added and each `no-drag` box cut out, so a strip that comes AFTER the icons
 * covers them again and the window eats the click. `dragRegionHits` replays
 * that walk; a positive control plants a strip over the icons and must be
 * reported.
 *
 * Screenshots (SHOT_DIR, both rooms): the home screen, the sidebar with every
 * project unfolded, and a split dock on a lock frame.
 */
import fs from 'node:fs';
import path from 'node:path';

import { atLeast, is, sel, suite, within } from './lib/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '';
const shot = async (page, name) => {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
};

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (Number.isFinite(end)) a.finish();
    }
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const at = (h) => new Date(Date.UTC(2026, 9, 6, h % 24)).toISOString();
const chat = (id, title, h) => ({ id, title, createdAt: at(h), updatedAt: at(h) });
const REPOS = Array.from({ length: 7 }, (_, r) => ({
  path: `C:/work/project-${r}`,
  name: `project-${r}`,
  index: { version: 1, activeId: `r${r}c0`, sessions: Array.from({ length: 6 }, (_, c) => chat(`r${r}c${c}`, `Chat ${c} of project ${r}`, c)) },
}));
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [chat('h1', 'Rate limiting for the gateway', 5), chat('h2', 'Orders health check', 4)] },
  scope: 'workspace',
  repos: REPOS,
};

/**
 * Which of `points` the window would treat as a title-bar drag (and so never
 * deliver a click to). Runs in the page: every element in document order, a
 * `drag` box added, a `no-drag` box cut out, later boxes winning.
 */
function dragRegionHits(points) {
  const boxes = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const v = (cs.getPropertyValue('app-region') || cs.getPropertyValue('-webkit-app-region')).trim();
    if (v !== 'drag' && v !== 'no-drag') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    boxes.push({ drag: v === 'drag', r });
  }
  return points.map((p) => {
    let drag = false;
    for (const b of boxes) if (p.x >= b.r.left && p.x <= b.r.right && p.y >= b.r.top && p.y <= b.r.bottom) drag = b.drag;
    return drag;
  });
}

const box = (page, q) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, q);

const HOME_TABS = { tabs: [{ id: 'chat', minimized: false }], active: 'chat' };

await suite(
  'home-screen',
  async ({ page, base, check, log }) => {
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.evaluate(([t, tabs]) => {
        localStorage.clear();
        localStorage.setItem('v3.chromeTabs', JSON.stringify(tabs));
        localStorage.setItem('seq.theme', t);
      }, [theme, HOME_TABS]);
      await page.reload();
      await page.waitForSelector(sel('shell'));
      await page.locator(sel('s2-session')).first().waitFor({ state: 'visible', timeout: 15000 });
      /* V3App opens in the dark room whatever is stored; the light room is the attribute, set as Settings would. */
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.locator(`${sel('s2-ascii-backdrop')}[data-drawn="true"][data-theme-variant="${theme}"]`).waitFor({ state: 'attached', timeout: 15000 });
      await page.mouse.move(720, 450);
      await settle(page);
      is(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme, 'the room');
      await shot(page, `home-surfaces-${theme}`);

      /* ── item 1: the icons take their clicks ──────────────────────────── */
      const pills = await page.$$eval('nav[aria-label="Workspace"] .s2-sp-main', (bs) => bs.map((b) => b.getAttribute('data-tab-id')));
      await check(`${theme}: no surface icon sits under the window's drag region`, async () => {
        atLeast(pills.length, 4, 'icons in the bar');
        const centres = await page.$$eval('nav[aria-label="Workspace"] .s2-sp-main', (bs) =>
          bs.map((b) => {
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }),
        );
        const hits = await page.evaluate(dragRegionHits, centres);
        is(JSON.stringify(pills.filter((_, i) => hits[i])), '[]', 'icons under a drag strip');
      });
      await check(`${theme}: the drag-region walk reports a strip planted over the icons (positive control)`, async () => {
        const hits = await page.evaluate((fn) => {
          const nav = document.querySelector('nav[aria-label="Workspace"]');
          const r = nav.getBoundingClientRect();
          const strip = document.createElement('span');
          strip.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;app-region:drag;-webkit-app-region:drag;pointer-events:none`;
          nav.parentElement.appendChild(strip);
          // eslint-disable-next-line no-new-func
          const out = new Function(`return (${fn})`)()([{ x: r.left + r.width / 2, y: r.top + r.height / 2 }]);
          strip.remove();
          return out;
        }, dragRegionHits.toString());
        is(hits[0], true, 'the planted strip is reported');
      });
      for (const id of pills) {
        await check(`${theme}: the ${id} icon opens its surface from the home screen, and closing it comes home`, async () => {
          const c = await box(page, sel(`s2-tab-${id}`));
          const top = await page.evaluate(([x, y, q]) => Boolean(document.elementFromPoint(x, y)?.closest(q)), [c.left + c.width / 2, c.top + c.height / 2, sel(`s2-tab-${id}`)]);
          is(top, true, 'the icon is the topmost thing under its own centre');
          await page.mouse.click(c.left + c.width / 2, c.top + c.height / 2);
          await page.locator(`[data-surface-pane="${id}"]`).waitFor({ state: 'visible', timeout: 5000 });
          await page.locator(sel(`v3-tab-close-${id}`)).click();
          await page.locator(`${sel('shell')}[data-home="true"]`).waitFor({ timeout: 5000 });
        });
      }

      /* ── asks 35 and 36: a surface selected; the top-left of the bar ───── */
      await check(`${theme}: a selected surface wears the sliding pill; the top-left names the workspace; nothing in the bar is a drag strip`, async () => {
        const [a, b] = pills;
        await page.locator(sel(`s2-tab-${a}`)).click();
        await page.locator(sel(`s2-tab-${b}`)).click();
        await page.locator(`[data-pill="${b}"][data-state="focused"]`).waitFor({ timeout: 5000 });
        await page.waitForTimeout(450);
        const m = await page.evaluate(
          ([fa, fb]) => {
            const r = (q) => document.querySelector(q)?.getBoundingClientRect();
            const ind = r('[data-testid="s2-sp-ind"]');
            const pill = r(`[data-pill="${fb}"]`);
            const crumb = r('[data-testid="s2-crumb"]');
            const nav = r('nav[aria-label="Workspace"]');
            const stage = r('.s2-stage');
            const cs = getComputedStyle(document.querySelector('[data-testid="s2-sp-ind"]'));
            return {
              opacity: cs.opacity,
              indX: ind.left,
              indW: ind.width,
              pillX: pill.left,
              pillW: pill.width,
              crumb: crumb ? [crumb.left, crumb.right, crumb.width] : null,
              navLeft: nav.left,
              stageLeft: stage?.left ?? null,
              behind: document.querySelector(`[data-pill="${fa}"]`).getAttribute('data-state'),
            };
          },
          [a, b],
        );
        log(theme, 'selected', JSON.stringify(m));
        is(m.opacity, '1', 'the indicator is shown');
        is(Math.abs(m.indX - m.pillX) <= 1, true, 'the indicator sits on the focused name (within 1 px)');
        is(Math.abs(m.indW - m.pillW) <= 1, true, 'and is as wide as it');
        is(m.behind, 'open', 'the other open surface reads as open, not focused');
        atLeast(m.crumb ? m.crumb[2] : 0, 40, 'the top-left crumb has content');
        is(m.navLeft >= m.crumb[1] - 1, true, 'the crumb leads the names');
        is(m.crumb[0] >= (m.stageLeft ?? 0) - 1, true, 'the crumb starts at or inside the stage edge');
        const pts = await page.$$eval('.s2-crumb, nav[aria-label="Workspace"] .s2-sp-main, nav[aria-label="Workspace"] .s2-sp-x', (els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }),
        );
        const hits = await page.evaluate(dragRegionHits, pts);
        is(JSON.stringify(hits.filter(Boolean)), '[]', 'bar elements under a drag strip');
        await page.mouse.move(720, 600);
        await shot(page, `surfaces-selected-${theme}`);
        for (const id of [a, b]) await page.locator(sel(`v3-tab-close-${id}`)).click();
        await page.locator(`${sel('shell')}[data-home="true"]`).waitFor({ timeout: 5000 });
      });

      /* ── item 2: the background is behind, and takes nothing ──────────── */
      await settle(page);
      await check(`${theme}: the ASCII ground covers the window, under the cards and the status bar, and takes no click`, async () => {
        const g = await page.evaluate(() => {
          const bd = document.querySelector('[data-testid="s2-ascii-backdrop"]');
          const r = bd.getBoundingClientRect();
          const at = (q) => {
            const e = document.querySelector(q).getBoundingClientRect();
            const hit = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
            return Boolean(hit && !hit.closest('[data-testid="s2-ascii-backdrop"]') && hit.closest(q));
          };
          return {
            rect: [r.left, r.top, r.right, r.bottom],
            pe: getComputedStyle(bd).pointerEvents,
            mode: bd.getAttribute('data-mode'),
            variant: bd.getAttribute('data-theme-variant'),
            composer: at('[data-testid="s2-chat"] textarea'),
            status: at('[data-testid="s2-status"]'),
            settings: at('[data-testid="v3-rail-settings"]'),
            ground: document.elementFromPoint(r.right - 4, 300)?.closest('[data-testid="s2-ascii-backdrop"]') ? 'backdrop' : 'other',
          };
        });
        log(theme, 'backdrop', JSON.stringify(g));
        is(g.rect.join(','), '0,0,1440,900', 'the backdrop fills the window');
        is(g.pe, 'none', 'pointer-events');
        is(g.mode, 'behind-chat', 'mode');
        is(g.variant, theme, 'the photo follows the room');
        is(g.composer, true, 'the composer is on top');
        is(g.status, true, 'the status bar is on top');
        is(g.settings, true, 'Settings is on top');
        is(g.ground, 'other', 'even bare ground hits something else (the backdrop takes no hit)');
      });

      /* ── items 8 and 9: the rail scrolls; nothing overhangs the status bar ── */
      const folds = page.locator(`${sel('s2-project-fold')}[aria-expanded="false"]`);
      for (let n = await folds.count(); n > 0; n = await folds.count()) await folds.first().click();
      await settle(page);
      await check(`${theme}: every project unfolded, the sections scroll inside the sidebar and Settings stays above the status bar`, async () => {
        const m = await page.evaluate(() => {
          const r = (q) => document.querySelector(q)?.getBoundingClientRect();
          const g = document.querySelector('[data-testid="s2-groups"]');
          return {
            settings: r('[data-testid="v3-rail-settings"]').bottom,
            panel: r('[data-testid="s2-panel"]').bottom,
            panelTop: r('[data-testid="s2-panel"]').top,
            chat: r('[data-testid="s2-chat"]').bottom,
            status: r('[data-testid="s2-status"]').top,
            scroll: [g.scrollHeight, g.clientHeight],
            overflowY: getComputedStyle(g).overflowY,
          };
        });
        log(theme, 'rail', JSON.stringify(m));
        atLeast(m.scroll[0], m.scroll[1] + 200, 'the sections overflow (the fixture is big enough)');
        is(m.overflowY, 'auto', 'the sections scroll');
        atLeast(m.status, m.settings, 'status bar top vs Settings bottom');
        atLeast(m.status, m.panel, 'status bar top vs sidebar bottom');
        atLeast(m.status, m.chat, 'status bar top vs chat card bottom');
        atLeast(m.panelTop, 0, 'the sidebar top');
      });
      await shot(page, `home-rail-${theme}`);
      await check(`${theme}: the status bar's content is centred under the chat box, not the window (Jaden 10-08)`, async () => {
        const m = await page.evaluate(() => {
          const s = document.querySelector('[data-testid="s2-status"]');
          const items = [...s.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
          const chat = document.querySelector('[data-testid="s2-chat"]').getBoundingClientRect();
          return { align: s.dataset.align, first: items[0].left, last: items[items.length - 1].right, chatMid: (chat.left + chat.right) / 2 };
        });
        is(m.align, 'chat', 'the bar is aligned to the chat box');
        within((m.first + m.last) / 2, m.chatMid, 2, 'the content centre vs the chat box centre');
      });
    }

    /* ── item 21: the split divider snaps to lock frames ───────────────── */
    await page.evaluate(() => {
      localStorage.setItem('seq.theme', 'dark');
      localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'files', minimized: false }, { id: 'terminal', minimized: false }], active: 'files' }));
      localStorage.setItem('v3.railCollapsed', '1');
    });
    await page.reload();
    await page.waitForSelector(sel('s2-split-divider'));
    await settle(page);
    const stage = await box(page, '.s2-stage');
    const dragTo = async (ratio, shotName) => {
      const d = await box(page, sel('s2-split-divider'));
      const x0 = d.left + d.width / 2;
      const y = d.top + 200;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      await page.mouse.move(stage.left + stage.width * ratio, y, { steps: 6 });
      const frame = await page.locator(sel('s2-split-divider')).getAttribute('data-frame');
      if (shotName) await shot(page, shotName);
      await page.mouse.up();
      await settle(page);
      return { now: Number(await page.locator(sel('s2-split-divider')).getAttribute('aria-valuenow')), frame };
    };
    await check('a drag released within the magnet of 33 percent lands on 33', async () => {
      const r = await dragTo(1 / 3 + 8 / stage.width, 'home-split-snap-dark');
      is(r.now, 33, 'aria-valuenow');
      is(r.frame, '33', 'the frame shown while dragging');
    });
    await check('a drag released within the magnet of 50 percent lands on 50', async () => {
      is((await dragTo(0.5 - 10 / stage.width)).now, 50, 'aria-valuenow');
    });
    await check('a drag released between frames stays where it was let go (control)', async () => {
      const r = await dragTo(0.42);
      within(r.now, 42, 1, 'aria-valuenow');
      is(r.frame, null, 'no frame between frames');
    });
    await check('the arrow keys walk the frames: 42 -> 50 -> 67 -> 75 -> 80, and back to 75', async () => {
      await page.locator(sel('s2-split-divider')).focus();
      const seen = [];
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
        await page.keyboard.press(k);
        seen.push(Number(await page.locator(sel('s2-split-divider')).getAttribute('aria-valuenow')));
      }
      is(seen.join(','), '50,67,75,80,75', 'frames');
    });
  },
  { routes: { '/api/sessions': SESSIONS } },
);
