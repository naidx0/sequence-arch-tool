#!/usr/bin/env node
/**
 * THE RAILS MATCH (round 8, item 4) AND EVERY SURFACE KEEPS ITS NAME (item 1).
 *
 * Jaden: "issues between the rail... file rail and the session rails. These
 * things should realistically be matching." Both rails draw shell2/RailRow;
 * this is the rendered proof, in a real Chromium where var() resolves and the
 * box has a size: a session row and a file row at the same depth have the same
 * computed height, inset, radius, slots, type, and the same hover and selected
 * fills; their icons start at the same offset from the row's left edge.
 *
 * Item 1 (Jaden: "always show full names unless the actual thing is
 * minimized"): with a surface open, at 1440 and at 1024 with the sidebar
 * shown, every pill's name is drawn at full width (or scrolled to, never
 * folded away).
 *
 * CONTROLS: a file row pushed to the old 26 px rung must be reported
 * (positive); every comparison must have found both rows (a scan of nothing
 * passes anything).
 */
import { atLeast, is, sel, suite } from './lib/harness.mjs';

/** The harness's settle, less the loops: an infinite animation (a spinner) cannot be finished, only waited past. */
async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (Number.isFinite(end)) a.finish();
    }
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id, title, h) => ({ id, title, createdAt: at(h), updatedAt: at(h) });
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [chat('h1', 'Rate limiting for the gateway', 5), chat('h2', 'Orders health check', 4)] },
  scope: 'workspace',
  repos: [{ path: 'C:/work/ticketing', name: 'ticketing', index: { version: 1, activeId: 't1', sessions: [chat('t1', 'Seat holds', 3)] } }],
};
const file = (path) => ({ path, name: path.split('/').pop(), type: 'file' });
const TREE = {
  path: '',
  name: 'shopfront',
  type: 'dir',
  children: [
    { path: 'services', name: 'services', type: 'dir', children: [file('services/gateway.ts'), file('services/orders.ts')] },
    file('README.md'),
  ],
};

/** The row's computed geometry and type, and where its icon starts. Runs in the page. */
function measure(rowSelector) {
  const row = document.querySelector(rowSelector);
  if (!row) return null;
  const cs = getComputedStyle(row);
  const r = row.getBoundingClientRect();
  const ic = row.querySelector(':scope > .s2-rail-ic');
  const tw = row.querySelector(':scope > .s2-rail-twist');
  const glyph = ic?.querySelector('svg');
  const icr = ic?.getBoundingClientRect();
  return {
    height: Math.round(r.height * 10) / 10,
    paddingRight: cs.paddingRight,
    borderRadius: cs.borderTopLeftRadius,
    gap: cs.columnGap,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    fontFamily: cs.fontFamily,
    iconSlot: icr ? `${icr.width}x${icr.height}` : null,
    twistSlot: tw ? `${tw.getBoundingClientRect().width}x${tw.getBoundingClientRect().height}` : null,
    glyph: glyph ? `${glyph.getBoundingClientRect().width}x${glyph.getBoundingClientRect().height}` : null,
    iconOffset: icr ? Math.round((icr.left - r.left) * 10) / 10 : null,
  };
}

/** Every key whose values differ. */
const diff = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} vs ${b[k]}`);

await suite(
  'rails-match',
  async ({ page, base, check, log }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'files', minimized: false }], active: 'files' }));
        /* Round 9: the current project's chats are the Chats section (depth 0); another project's, unfolded, sit at depth 1. */
        localStorage.setItem('s2.projectsOpen', JSON.stringify({ 'c:/work/ticketing': true }));
      } catch {
        /* the defaults */
      }
    });
    await page.goto(base);
    await page.waitForSelector(sel('shell'));
    await page.locator(sel('s2-session')).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.locator(sel('files-row')).first().waitFor({ state: 'visible', timeout: 15000 });
    /* Open the folder, so a file row sits at depth 1 like a project's chat. */
    await page.locator(`${sel('files-row')}[data-kind="dir"]`).first().click();
    await page.locator(`${sel('files-row')}[data-path="services/gateway.ts"]`).waitFor({ state: 'visible', timeout: 5000 });
    await page.mouse.move(2, 890);
    await settle(page);

    const SESSION_1 = sel('s2-session');
    const FILE_1 = `${sel('files-row')}[data-path="services/orders.ts"]`;
    const PROJECT_0 = `${sel('s2-project')}[data-project="ticketing"] .s2-proj-row`;
    const DIR_0 = `${sel('files-row')}[data-kind="dir"]`;

    await check('a chat row and a file row at depth 1 are the same row', async () => {
      const a = await page.evaluate(measure, SESSION_1);
      const b = await page.evaluate(measure, FILE_1);
      is(Boolean(a && b), true, 'both rows found');
      log('depth 1:', JSON.stringify(a));
      is(diff(a, b).join('; '), '', 'session row vs file row');
      atLeast(a.height, 24, 'row height');
    });

    await check('a project row and a folder row at depth 0 are the same row', async () => {
      const a = await page.evaluate(measure, PROJECT_0);
      const b = await page.evaluate(measure, DIR_0);
      is(Boolean(a && b), true, 'both rows found');
      log('depth 0:', JSON.stringify(a));
      /* The current-project weight is the project row's one difference; this one is not current. */
      is(diff(a, b).join('; '), '', 'project row vs folder row');
    });

    await check('one indent per level, the same in both rails', async () => {
      const [s0, s1, f0, f1] = await Promise.all([PROJECT_0, SESSION_1, DIR_0, FILE_1].map((q) => page.evaluate(measure, q)));
      is(s1.iconOffset - s0.iconOffset, f1.iconOffset - f0.iconOffset, 'indent step, sessions vs files');
      atLeast(s1.iconOffset - s0.iconOffset, 8, 'the indent step');
    });

    const fill = (q) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, q);
    await check('the hover fill is the same', async () => {
      /* A row that is NOT the active chat: `.is-on` (the selected tint) rightly wins over :hover. */
      const SESSION_IDLE = `${sel('s2-session')}:not(.is-on)`;
      is(await page.locator(SESSION_IDLE).count() > 0, true, 'an idle chat row to hover');
      await page.hover(SESSION_IDLE);
      await settle(page);
      const a = await fill(SESSION_IDLE);
      await page.hover(FILE_1);
      await settle(page);
      const b = await fill(FILE_1);
      is(a, b, 'hover fill, session vs file');
      is(a === 'rgba(0, 0, 0, 0)', false, 'the hover fill is drawn');
    });

    await check('the selected fill is the same', async () => {
      await page.locator(FILE_1).click();
      await page.mouse.move(2, 890);
      await settle(page);
      const a = await fill(`${sel('s2-session')}.is-on`);
      const b = await fill(`${FILE_1}[data-selected="true"]`);
      is(a, b, 'selected fill, active chat vs selected file');
      is(a === 'rgba(0, 0, 0, 0)', false, 'the selected fill is drawn');
    });

    await check('the comparison reports a row on the old 26 px rung (positive control)', async () => {
      const a = await page.evaluate(measure, SESSION_1);
      const b = await page.evaluate((q) => {
        const el = document.querySelector(q);
        el.style.height = '26px';
        return null;
      }, FILE_1);
      void b;
      const c = await page.evaluate(measure, FILE_1);
      await page.evaluate((q) => {
        document.querySelector(q).style.height = '';
      }, FILE_1);
      atLeast(diff(a, c).length, 1, 'differences reported for the planted row');
    });

    /* ── item 1: every surface keeps its name ─────────────────────────── */
    for (const [w, h] of [
      [1440, 900],
      [1024, 700],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await settle(page);
      await check(`${w}: with a surface open, every pill draws its whole name`, async () => {
        const pills = await page.evaluate(() =>
          [...document.querySelectorAll('nav[aria-label="Workspace"] .s2-sp-main')].map((b) => {
            const l = b.querySelector('.s2-seg-l');
            const cs = l ? getComputedStyle(l) : null;
            return { id: b.getAttribute('data-tab-id'), shown: Boolean(l && cs.display !== 'none' && l.getBoundingClientRect().width > 0), whole: l ? l.scrollWidth <= l.clientWidth + 1 : false };
          }),
        );
        atLeast(pills.length, 4, 'pills in the bar');
        is(JSON.stringify(pills.filter((p) => !p.shown || !p.whole).map((p) => p.id)), '[]', 'pills without their whole name');
      });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/tree': TREE } },
);
