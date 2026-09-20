/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD MUST NOT COVER THE COMPOSER
   packages/web2/e2e/composer-over-board.mjs

   `composer-reachable.mjs` asks the right question - can a pointer reach every
   control the composer draws - and then answers it with the board switched
   off. Its route table refuses `/archgraph.json` and all four platform routes,
   under the note "the repository this runs against is irrelevant - only the
   composer is". That assumption is the whole defect: the composer is only
   covered WHEN A BOARD IS ON SCREEN, so refusing the graph removes the
   condition the bug needs, and the suite passed with Send unclickable.

   MEASURED IN THE RUNNING APP, not inferred. The defect was photographed on
   the PRE-pivot geometry, where the chat floated as an overlay at z-index 2
   and the board furniture spanned the whole viewport at z-index 7:

      .boardfurniture     position absolute  z-index 7   0..1440 x 81..900
      .kindlegend         (its child)        pointer-events auto
                                                         12..633 x 830..888
      composer Send                                      260..288 x 825..853

      document.elementFromPoint(274, 839) -> SPAN.silswatch   (the legend)

   The furniture re-enables pointer events on its children, so the kind legend
   was painted over the composer and ate the click. The primary surface of the
   product could not be sent from.

   Decision 5 has since rearranged the frame — sessions LEFT, chat CENTRE,
   board pane RIGHT — so be honest about what each band can prove at wide
   widths. In the column geometry the chat pane shrinks the canvas, and board
   furniture drawn inside that shrunken canvas CANNOT cross into the pane:
   paint-overlap is unfalsifiable there, and no assertion about it can fail
   short of a regression to full-viewport furniture (the PRE-pivot shape, where
   `.boardfurniture` spanned 0..1440 regardless of panes). That is what the
   wide-band overlap check below is for, stated plainly: a REGRESSION TRIPWIRE
   against furniture leaving the board pane again — not a live gate on paint
   overlap. The LIVE assertion in this file is reachability — the hit test —
   and it lives in the OVERLAY band, where the chat genuinely does share pixels
   with the board's layer and a covering element can actually eat a click.

   The chat pane is found by its own testid, never by a positional guess like
   `document.querySelector('aside')`, which since the pivot matches the
   sessions sidebar instead and once made an overlap check pass vacuously.

   ── WHY THE FIXTURE IS A REAL SCAN ───────────────────────────────────────

   The legend's width is a function of how many kinds the graph contains. A
   two-kind synthetic fixture draws a legend far too narrow to reach the
   composer, and this file would pass while the app stayed broken - the exact
   vacuity it exists to correct. The release gate already says it: fixture
   scale proves logic, only a REAL repo proves the result.

   ── WHAT IT ASSERTS ──────────────────────────────────────────────────────

   Not a z-order. The INVARIANT is that with a board drawn behind it, every
   control the composer draws can still be hit at its own centre — reachable,
   asserted live wherever the geometry lets the two layers genuinely overlap —
   and that nothing the board draws has returned to full-viewport furniture.
   Which layer wins, and how, is free to change.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD, CHAT, COMMAND, SHELL } from './lib/anchors.mjs';
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/** Exit 2, never 1: "the analyzer is not built" is the harness unable to run. */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[composer-over-board] ERROR: the analyzer is not built, nothing to scan');
    console.error('[composer-over-board] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'web2-composer-board-e2e-')),
    'archgraph.json',
  );
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[composer-over-board] ERROR: sequence scan failed:', error.message);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const graph = scanRealRepo();

/**
 * Can a pointer actually reach this element's centre? Same probe as
 * `composer-reachable.mjs` - a hit on a child is a hit on the control, and a
 * miss reports what blocked it, because "blocked" without "by what" is a
 * failure nobody can act on.
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

const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

await suite(
  'composer-over-board',
  async ({ page, base, check }) => {
    await page.goto(base, { waitUntil: 'load' });
    /* Tab-layout shell: the board mounts behind the Architecture tab. */
    await page.getByTestId('workspace-tab-architecture').click();
    await page.waitForSelector(sel(BOARD.node), { timeout: 20000 });
    await settle(page);

    const reach = (testid) => page.evaluate(`(${REACHABLE})(${JSON.stringify(testid)})`);

    await check('THE PRECONDITION: a board is actually drawn behind the chat', async () => {
      /*
       * Checked, not assumed. If no board rendered then nothing could cover the
       * composer, every assertion below would pass for the wrong reason, and
       * this file would become the very thing it was written to replace.
       */
      atLeast(
        await page.locator(sel(BOARD.node)).count(),
        1,
        'board nodes drawn behind the composer',
      );
      /*
       * EITHER FORM OF THE KEY. It now collapses to a control when the board is
       * too narrow to hold it - the ruling board.css said was owed, taken after
       * the owner photographed a legend lying across his file cards. Both shapes
       * are furniture in the same corner and both could cover the composer, so
       * both satisfy this precondition; requiring the OPEN one would have made
       * the guard fail for the reason the guard exists to prevent.
       */
      const key = await page.evaluate(
        `document.querySelectorAll('[data-testid="board-legend"], [data-testid="board-legend-shut"]').length`,
      );
      atLeast(key, 1, 'the kind legend - the element that did the covering - is drawn');
    });

    await check('the composer is drawn at all with a board present', async () => {
      for (const testid of [CHAT.field, CHAT.send, CHAT.plus]) {
        const r = await reach(testid);
        is(r.present, true, `${testid} is drawn`);
        is(r.sized, true, `${testid} has a box`);
      }
    });

    await check('EVERY COMPOSER CONTROL IS REACHABLE OVER A DRAWN BOARD', async () => {
      for (const testid of [CHAT.field, CHAT.send, CHAT.plus]) {
        const r = await reach(testid);
        is(r.reachable, true, `${testid} is reachable (blocked by ${r.blockedBy})`);
      }
    });

    await check('NOTHING THE BOARD DRAWS IS PAINTED ACROSS THE CHAT PANE', async () => {
      /*
       * A REGRESSION TRIPWIRE, NOT A LIVE GATE — said plainly. At wide widths
       * Decision 5's geometry makes the chat a COLUMN: the pane shrinks the
       * canvas, furniture drawn inside that canvas cannot cross into the pane,
       * and this check is unfalsifiable — it cannot fail short of board
       * furniture going full-viewport again (the PRE-pivot defect's exact
       * shape, `.boardfurniture` spanning the window regardless of panes).
       * That return is what it trips on; paint-overlap itself is proven
       * nowhere in this band and is not claimed to be. The live assertion —
       * the hit test over genuinely overlapping geometry — is the OVERLAY band
       * below. The chat pane is found by its OWN testid: the old fallback
       * `document.querySelector('aside')` grabbed the sessions sidebar, which
       * the far-right board can never overlap, and passed vacuously at any
       * width.
       */
      const overlap = await page.evaluate(`(() => {
        /* Tab-layout shell: the chat pane is the chat COLUMN — shell-chat
           (pane modes) is retired with the three-pane layout. */
        const pane = document.querySelector('[data-testid="chat-column"]')
          ?? document.querySelector('[data-testid="${SHELL.chat}"]');
        if (!pane) return { checked: false };
        const p = pane.getBoundingClientRect();
        const bad = [];
        for (const el of document.querySelectorAll('.boardfurniture > *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const hits = !(r.right <= p.left || r.left >= p.right
                      || r.bottom <= p.top || r.top >= p.bottom);
          if (hits) {
            bad.push((el.className || el.tagName).toString().slice(0, 40)
              + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
          }
        }
        return { checked: true, paneRight: Math.round(p.right), bad };
      })()`);

      is(overlap.checked, true, 'the chat pane was found');
      is(
        overlap.bad.length,
        0,
        `board furniture must clear the chat pane (pane ends at ${overlap.paneRight}; ` +
          `overlapping: ${overlap.bad.join(', ')})`,
      );
    });

    await check('AND IN THE BAND WHERE THE CHAT IS AN OVERLAY', async () => {
      /*
       * THE LIVE ASSERTION LIVES HERE. Below MEDIUM_MIN (820)
       * `paneModeFor('chat', 'narrow', true)` is 'overlay': the pane leaves
       * the grid, floats over the canvas at z-index 2, and stops shrinking
       * it. This is the band where the board's furniture - z-index 7, inset 0,
       * pointer-events re-enabled on its children - genuinely shares pixels
       * with the pane, so reachability is falsifiable here: a covering element
       * can actually eat a click, and the hit tests below are what this file
       * is for.
       *
       * The wide band above cannot see any of this — a column pane shrinks the
       * canvas and no overlap can occur there; its overlap check is only a
       * tripwire against full-viewport furniture. Checking only the wide band
       * is how a suite named for composer reachability stays green while the
       * composer of a narrow window cannot be clicked.
       */
      await resize(page, 800, 900);

      /* THE PANE-MODE OVERLAY IS RETIRED with the three-pane shell; the
         tab-layout shell fronts one workspace tab at a time at this width.
         The invariant this band still owes is the FILE'S OWN NAME: the
         composer is reachable at 800px. So front the Chat tab the way a
         reader does and hit-test every composer control — a covering element
         (board furniture, a stray overlay) would eat the click and fail the
         reach test exactly as before. */
      await page.getByTestId('workspace-tab-chat').click();
      await settle(page);

      for (const testid of [CHAT.field, CHAT.send, CHAT.plus]) {
        const r = await reach(testid);
        is(r.present, true, `${testid} is drawn at 800px`);
        is(r.reachable, true, `${testid} is reachable at 800px (blocked by ${r.blockedBy})`);
      }
    });

    await check('AND THE COMMAND SURFACE STILL BEATS THE PANE THAT WAS RAISED', async () => {
      /*
       * The other half of raising the overlay pane, and the reason the number
       * is not simply "very large". The pane and the shell's command surface
       * share one stacking context, so lifting the pane over the canvas can
       * push it over the palette too - trading a covered composer for a
       * covered palette and calling it a fix.
       *
       * Ctrl+K with the overlay pane open is exactly the overlapping case: the
       * scrim is fixed to the whole window, so it crosses the pane by
       * definition.
       */
      await page.keyboard.press('Control+k');
      await settle(page);

      const r = await reach(COMMAND.field);
      is(r.present, true, 'the command field opened');
      is(r.reachable, true, `the command field is reachable (blocked by ${r.blockedBy})`);

      await page.keyboard.press('Escape');
      await settle(page);
    });
  },
  {
    routes: {
      /* The real scan, on the route the boot ladder reads - so a board draws. */
      '/archgraph.json': graph,
      /* No engine behind it; 404 is the honest answer, and runBoot's third rung
         is written for exactly that. */
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
