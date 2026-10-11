/* ══════════════════════════════════════════════════════════════════════════
   NOTHING IN THE COMPOSER COVERS ANYTHING ELSE IN THE COMPOSER
   packages/web2/e2e/composer-reachable.mjs

   A turn that fails puts a strip above the composer carrying the only route
   out of the failure. The toolbelt menu opens UPWARD from the control row.
   Both want the same band of screen, and for a while the menu won.

   MEASURED IN THE RUNNING APP, not inferred: with the toolbelt open,
   `composer-strip-settings` failed `elementFromPoint` with
   `blockedBy: "menu"`. The one control that fixes "the assistant cannot
   answer" was sitting under an optional browse menu. The first attempt at a
   fix raised the strip's z-index instead, and measuring showed that simply
   reversed it — two of the menu's four rows went under the strip.

   ── WHY THIS IS AN e2e AND NOT A UNIT TEST ───────────────────────────────

   jsdom has NO LAYOUT. `getBoundingClientRect` answers zeroes,
   `elementFromPoint` is meaningless, and `z-index` is never resolved. A jsdom
   test asserting "the button is in the document" passes with the button
   completely buried, which is exactly the state a reader hit. The only engine
   that can answer "can a person click this" is a real one.

   This is the same argument `docs/release-gate.md` makes for the legibility
   tier: three rounds shipped green while the app was visibly broken.

   ── WHAT IT ASSERTS ──────────────────────────────────────────────────────

   Not "the strip beats the menu" — that is one arrangement, and locking an
   arrangement locks out better ones. The INVARIANT is that every control the
   composer draws can be hit by a pointer at its own centre, with the popups
   both closed and open. How the layout achieves that is free to change.
   ══════════════════════════════════════════════════════════════════════════ */

import { CHAT } from './lib/anchors.mjs';
import { is, sel, settle, suite } from './lib/harness.mjs';

/**
 * Can a pointer actually reach this element's centre?
 *
 * `elementFromPoint` at the centre, then a containment check — a hit on a
 * child (the label inside a button) is a hit on the control. Answers the
 * blocker's class list when it is not, because "blocked" without "by what" is
 * a failure nobody can act on.
 */
const REACHABLE = `(testid) => {
  const el = document.querySelector('[data-testid="' + testid + '"]');
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { present: true, sized: false };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const ok = el === hit || el.contains(hit);
  return {
    present: true,
    sized: true,
    reachable: ok,
    blockedBy: ok ? null : (hit ? (hit.className || hit.tagName || '?').toString() : 'nothing'),
  };
}`;

/** The repository this runs against is irrelevant — only the composer is. */
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

await suite(
  'composer-reachable',
  async ({ page, base, check }) => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector(sel(CHAT.field), { timeout: 15000 });
    await settle(page);

    const reach = (testid) => page.evaluate(`(${REACHABLE})(${JSON.stringify(testid)})`);

    await check('every composer control is reachable with nothing open', async () => {
      for (const testid of [CHAT.field, CHAT.send, CHAT.plus]) {
        const r = await reach(testid);
        is(r.present, true, `${testid} is drawn`);
        is(r.sized, true, `${testid} has a box`);
        is(r.reachable, true, `${testid} is reachable (blocked by ${r.blockedBy})`);
      }
    });

    await check('the toolbelt opens and every one of its rows is reachable', async () => {
      await page.click(sel(CHAT.plus));
      await settle(page);

      const rows = await page.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.menuitem, [role="menuitem"]'));
        const blocked = [];
        for (const i of items) {
          const r = i.getBoundingClientRect();
          const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!(i === h || i.contains(h))) blocked.push((i.textContent || '').trim().slice(0, 24));
        }
        return { total: items.length, blocked };
      })()`);

      is(rows.total > 0, true, 'the toolbelt drew rows');
      is(rows.blocked.length, 0, `every row is reachable (blocked: ${rows.blocked.join(', ')})`);
    });

    await check('THE OPEN MENU COVERS NOTHING THE COMPOSER STILL NEEDS', async () => {
      /*
       * The regression, stated as an invariant. With the menu open, the
       * controls beneath it must still be hit-testable — a menu is something
       * the reader opened to look through, and it must not bury the surface
       * it was opened from.
       */
      for (const testid of [CHAT.send, CHAT.plus]) {
        const r = await reach(testid);
        is(r.reachable, true, `${testid} is reachable with the menu open (blocked by ${r.blockedBy})`);
      }
    });

    await check('AN OPEN POPUP NEVER CROSSES THE STRIP BAND', async () => {
      /*
       * THE INVARIANT THE REGRESSION BROKE, stated directly.
       *
       * The failure strip is a SIBLING of `.composer` inside `.inner`, and it
       * only exists while a turn has failed - which this origin cannot
       * produce, since it serves no engine. So rather than manufacture a
       * failure, this asserts the geometry that made the strip unclickable:
       * an upward-opening popup must not reach into the band above
       * `.composer`, because that band is where the strip is drawn.
       *
       * Anchored to `.inner` the popup opens above that band and the question
       * cannot arise. Anchored inside `.composer` it opens across it, which is
       * the arrangement that buried `composer-strip-settings`.
       */
      const crossing = await page.evaluate(`(() => {
        const composer = document.querySelector('.composer');
        const menu = document.querySelector('.menu');
        if (!composer || !menu) return { checked: false };
        const c = composer.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        return {
          checked: true,
          /* The popup reaches above the composer - fine, that is how it opens
             - but its bottom must clear the composer's top, or it is sitting
             in the band the strip occupies. */
          crossesIntoStripBand: m.bottom > c.top + 1,
          menuBottom: Math.round(m.bottom),
          composerTop: Math.round(c.top),
        };
      })()`);

      is(crossing.checked, true, 'both the composer and an open menu were found');
      is(
        crossing.crossesIntoStripBand,
        false,
        `the popup must clear the composer's top (menu bottom ${crossing.menuBottom} vs composer top ${crossing.composerTop})`,
      );
    });

    await check('closing the menu leaves everything reachable again', async () => {
      await page.keyboard.press('Escape');
      await settle(page);
      for (const testid of [CHAT.field, CHAT.send, CHAT.plus]) {
        const r = await reach(testid);
        is(r.reachable, true, `${testid} is reachable again (blocked by ${r.blockedBy})`);
      }
    });
  },
  {
    routes: {
      /* No engine. The composer is drawn regardless, which is the point: this
         spec is about geometry, not about what any route answers. */
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
      '/archgraph.json': null,
    },
  },
);
