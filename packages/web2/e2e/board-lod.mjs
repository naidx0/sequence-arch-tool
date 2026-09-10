import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD, WORKSPACE } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   THE LOD LADDER, MEASURED WHERE IT IS ARGUED ABOUT — item 3.8's closing lock.
   packages/web2/e2e/board-lod.mjs

   WHAT THIS EXISTS BECAUSE OF.

   `lod.ts` shipped a ladder neither Graphite sheet states: the icon gone at
   0.667, the SILHOUETTE gone at 0.50, and "nothing on the card" from 0.354
   down. `lod.test.ts` asserted those numbers, so the invention was green in
   both directions. What that produced in a real browser is the thing this file
   measures: at 25% zoom — a stop the zoom-out button lands on — every node on
   the board rendered as `.boardmark`, a `--r-full` pill of `--dot` height, and
   `--r-full` is the same shape for all six kinds. The board answered "what kind
   is this" with one shape at the exact zoom the reader most needs six.

   docs/brand/graphite/pages/05-the-canvas.html §05.8's ladder table gives
   the last row — "silhouette, border treatment, tone" — a threshold of NONE
   and a "Holds to" of 0.25, which is §05.9 assertion 5's clamp floor. The
   silhouette outlives the camera. That is the claim, and a claim about what a
   shape looks like at a zoom is only checked by looking.

   WHY THIS IS AN E2E AND NOT A jsdom TEST. CANON: declared values are not
   rendered values, and the greyscale invariant is explicitly "from the radii
   that actually paint". jsdom does not scale a radius by
   `min(side / sum of radii on that side)`, does not resolve `clip-path`, and
   does not lay out React Flow's scaled viewport. A unit test can prove
   `rungFor(0.25) === 5`; only a browser can prove the reader sees six shapes.

   WHAT THE FINGERPRINT IS. Everything a reader can still see with the colour
   removed: the four painted corner radii, the border style and width, the
   clip-path, and the box's own aspect. Kinds that share a fingerprint are the
   same shape to the reader no matter what the token list says.

   THE GRAPH IS SCANNED HERE, NOW, BY THE REAL ANALYZER, for the reason
   board-grounded.mjs states: a hand-written graph can be made to satisfy any
   renderer. The consequence is that the kinds on the board are whatever this
   monorepo actually has — today service and entry — so this file asserts
   "as many distinct fingerprints as there are kinds on screen" rather than a
   literal six. A board that collapses two into one fails; a repository that
   only has two kinds does not.
   ══════════════════════════════════════════════════════════════════════════ */

/** The repository this runs against: the monorepo itself. */
const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/** §05.9 assertion 5's range, and the stops the buttons land on. Restated here
 *  rather than imported because this file drives the SHIPPED bundle and must
 *  not be able to agree with a source constant that itself drifted. */
const ZOOM_FLOOR = 0.25;

/** §05.8's ladder, as the rung each stop is on. The two the invention got
 *  wrong are 0.25 and 0.50: it put them on rungs 7 and 5, the sheet puts both
 *  on rung 5 — "< 0.67 · silhouette only" is one rung all the way down. */
const LADDER_AT_STOP = { 0.25: 5, 0.5: 5, 1: 1, 2: 1, 4: 1 };

function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[board-lod] ERROR: the analyzer is not built, so there is nothing to scan');
    console.error('[board-lod] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-lod-e2e-')), 'archgraph.json');

  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[board-lod] ERROR: sequence scan failed —', error.message);
    process.exit(2);
  }

  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
  const drawable = graph.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic',
  );
  if (drawable.length === 0) {
    console.error(
      `[board-lod] ERROR: the scan of ${graph.repoName} produced nothing the board draws, so ` +
        'there is no silhouette here to have an opinion about',
    );
    process.exit(2);
  }

  return { graph, drawable };
}

const { graph, drawable } = scanRealRepo();

/** The routes board-grounded.mjs establishes: a static graph host with no
 *  engine behind it, which is `runBoot`'s third rung by name. */
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

/**
 * Click zoom-out until the readout stops moving, and report where it stopped.
 *
 * The button is the user's own path to the floor, which is the point: the
 * defect was reachable by pressing a control twice, not by an exotic camera
 * state. The loop is bounded and its bound is a failure, never a silent exit.
 */
async function zoomOutToFloor(page) {
  for (let press = 0; press < 12; press += 1) {
    /*
     * THE BUTTON DISABLES ITSELF AT THE FLOOR, and that is the honest stop
     * condition: waiting for the readout to stop changing would hang on a
     * disabled control for the full click timeout and report the harness as
     * broken rather than the camera as bottomed out.
     */
    if (await page.locator(sel('board-zoom-out')).isDisabled()) {
      return Number(await page.locator(sel('board-zoom')).getAttribute('data-zoom'));
    }
    await page.locator(sel('board-zoom-out')).click();
    await settle(page);
  }
  throw new Error('the zoom-out button never reached a floor in 12 presses');
}

/** Everything a reader can still see with the colour removed. Passed to
 *  `page.evaluate` as a real function so the browser compiles it, not as a
 *  source string the runner has to guess the shape of. */
function fingerprints(testid) {
  const cards = [...document.querySelectorAll(`[data-testid="${testid}"]`)];
  return cards.map((card) => {
    const s = getComputedStyle(card);
    const box = card.getBoundingClientRect();
    return {
      kind: card.getAttribute('data-kind'),
      rung: card.getAttribute('data-rung'),
      className: String(card.className),
      width: box.width,
      height: box.height,
      shape: [
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomRightRadius,
        s.borderBottomLeftRadius,
        s.borderStyle,
        s.borderWidth,
        s.clipPath,
      ].join('|'),
    };
  });
}

await suite(
  'board-lod',
  async ({ page, base, check, consoleErrors, log }) => {
    log(
      `scanned ${graph.repoName}: ${drawable.length} drawable nodes; ` +
        'measuring the ladder in the shipped bundle',
    );

    await page.goto(base, { waitUntil: 'load' });
    await settle(page);
    /* THE SHELL OPENS TO CHAT ALONE, so the board has to be asked for the way a
       reader asks for it — a click on the pill. Without this every assertion
       below is about an absence, which is how this suite came to report
       "expected >= 1, got 0" while nothing was wrong with the board. */
    {
      const pill = page.locator(sel(WORKSPACE.pill('architecture')));
      if ((await pill.count()) > 0 && (await pill.getAttribute('data-on')) !== 'true') {
        await pill.click();
        await settle(page);
      }
    }
    await page
      .locator(sel(BOARD.node))
      .first()
      .waitFor({ state: 'attached', timeout: 20_000 })
      .catch(() => {});
    await settle(page);

    await check('the board drew the real graph, so there is a ladder to measure', async () => {
      atLeast(await page.locator(sel(BOARD.node)).count(), 1, `[data-testid="${BOARD.node}"]`);
    });

    const floor = await zoomOutToFloor(page);

    await check('the zoom-out button reaches §05.9 assertion 5’s clamp floor', async () => {
      is(floor, ZOOM_FLOOR, 'the zoom the buttons bottom out at');
    });

    /* ── THE LOCK ───────────────────────────────────────────────────────── */

    await check('at the camera floor the board is still on a silhouette rung', async () => {
      // §05.8: the silhouette row's threshold column reads "none". There is no
      // rung below it inside the camera's range, so the board's own state says
      // 5 and every card agrees with the board.
      is(await page.locator(sel(BOARD.root)).getAttribute(BOARD.rungAttr), '5', 'board data-rung');

      const cards = await page.evaluate(fingerprints, BOARD.node);
      const wrong = cards.filter((c) => c.rung !== '5');
      is(wrong.length, 0, `cards not on rung 5 at 25% (${wrong.map((c) => c.rung).join(', ')})`);
    });

    await check('at the camera floor every node is a CARD, not a mark', async () => {
      /*
       * The defect in its rendered form. `.boardmark` is the rung-7 element:
       * `--arch-card-w` wide, `--dot` tall, `--r-full` — one pill for all six
       * kinds. Asserted on the painted box as well as the class, because a
       * class name is what the code called it and the box is what the reader
       * got: at 25% a real card is at least the 56px floor scaled, ~14 device
       * pixels, while the mark is --dot scaled, 1.5.
       */
      const cards = await page.evaluate(fingerprints, BOARD.node);
      const marks = cards.filter((c) => c.className.includes('boardmark'));
      is(marks.length, 0, `nodes rendered as a rung-7 mark at 25%, out of ${cards.length}`);

      const flattened = cards.filter((c) => c.height < 6);
      is(
        flattened.length,
        0,
        `nodes painting shorter than 6 device px at 25% (${flattened
          .map((c) => `${c.kind} ${c.height}`)
          .join(', ')})`,
      );
    });

    await check('at the camera floor the kinds on screen still paint DIFFERENT shapes', async () => {
      /*
       * Decision 2's invariant at the size §05.8 claims it holds: "every
       * architecture node kind must remain distinguishable with all colour
       * removed, at every size the silhouette is drawn, from the radii that
       * actually paint." Measured against the kinds this scan really produced
       * — a literal six here would be a number about the repository rather
       * than about the board.
       */
      const cards = await page.evaluate(fingerprints, BOARD.node);
      const kinds = new Set(cards.map((c) => c.kind));
      const shapes = new Set(cards.map((c) => c.shape));

      atLeast(kinds.size, 2, 'distinct kinds on the board (with one, this check proves nothing)');
      is(shapes.size, kinds.size, `distinct painted shapes at 25% for ${kinds.size} kinds`);
    });

    await check('the whole camera range stays on the rung §05.8 puts it on', async () => {
      /*
       * The ladder swept from the floor back up through every stop the buttons
       * land on. This is the assertion that would have caught the invention on
       * the way in: 0.50 and 0.25 are the two stops it disagreed with the sheet
       * about, and both are one press apart from the default view.
       */
      const wrong = [];
      for (const [stop, expected] of Object.entries(LADDER_AT_STOP).sort(
        (a, b) => Number(a[0]) - Number(b[0]),
      )) {
        while (
          Number(await page.locator(sel('board-zoom')).getAttribute('data-zoom')) < Number(stop) &&
          !(await page.locator(sel('board-zoom-in')).isDisabled())
        ) {
          await page.locator(sel('board-zoom-in')).click();
          await settle(page);
        }
        const landed = Number(await page.locator(sel('board-zoom')).getAttribute('data-zoom'));
        if (landed !== Number(stop)) {
          wrong.push(`the + button could not land on ${stop} — it stopped at ${landed}`);
          continue;
        }
        const rung = await page.locator(sel(BOARD.root)).getAttribute(BOARD.rungAttr);
        if (rung !== String(expected)) wrong.push(`${stop} is on rung ${rung}, §05.8 says ${expected}`);
      }
      is(wrong.length, 0, `zoom stops on the wrong rung: ${wrong.join(' | ')}`);
    });

    await check('the page reported no errors it did not have coming', async () => {
      // Same filter board-grounded.mjs uses, and for the same reason: by URL,
      // so a missing stylesheet cannot hide behind a deliberate 404.
      const expected = new Set(REFUSED.map((route) => `${base}${route}`));
      const unexpected = consoleErrors.filter(
        (line) => ![...expected].some((url) => line.includes(url)),
      );
      is(unexpected.length, 0, `console errors: ${unexpected.join(' | ')}`);
    });
  },
  {
    routes: {
      '/archgraph.json': graph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
