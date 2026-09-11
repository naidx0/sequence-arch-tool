import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD, WORKSPACE } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   VISUAL MODE, MEASURED ON A REAL REPOSITORY — the MADR's gate 3
   packages/web2/e2e/visual-mode.mjs

   docs/decisions/visual-board-mode-madr.md, "Gates (binding on every wave)"
   item 3: "a new packages/web2/e2e/visual-mode.mjs added to the test:e2e
   chain: open a real scanned repo, flip Visual on, screenshot, and a human
   looks at it."

   WHAT SHIPPED WITHOUT IT, AND WHAT THAT COST. W1 landed with A1 —
   Visual ON by default — so every existing suite in this directory was already
   rendering the Visual board, and not one of them asserted anything about it.
   What went out under that cover was a row that paints OUTSIDE the card: on
   this monorepo `svc:web` drew SERVICE · ENTRY · TRACED · 13 in a strip whose
   content wanted 149px inside a 118px content box, and `.node` computes
   `overflow: visible`, so the count numeral was painted on the dot grid past
   the card's own border. Entry and Topic cards take --sp-20 side padding for
   their silhouettes where every other kind takes --sp-10, and 138px — what the
   others get — is already exactly what the three-item row needs, so EVERY node
   the entry heuristic matches overflowed. That is the legibility gate's first
   rule ("nothing overflows its box") failing on the repository the gate is run
   against, with every other gate green.

   WHY THIS CANNOT BE A jsdom TEST. jsdom does not lay out flex, so it cannot
   tell 149 from 118; the unit tier can only hold the four declarations that
   decide the outcome (`boardInteractCss.test.ts`). The number is a browser's to
   report, which is what this tier is for.

   THE GRAPH IS SCANNED HERE, NOW, BY THE REAL ANALYZER, for the reason
   board-grounded.mjs gives: a hand-written graph can be made to satisfy any
   renderer, and the card that overflowed only exists because this repository
   really has an entry service with a two-digit part count.
   ══════════════════════════════════════════════════════════════════════════ */

/** The repository this runs against: the monorepo itself. */
const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/** `lod.ts` LOD_LADDER rung 1's floor — the only rung that draws the strip.
 *  Restated rather than imported because this file drives the SHIPPED bundle
 *  and must not be able to agree with a source constant that itself drifted. */
const STRIP_ZOOM = 1;

function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[visual-mode] ERROR: the analyzer is not built, so there is nothing to scan');
    console.error('[visual-mode] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-visual-e2e-')), 'archgraph.json');

  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[visual-mode] ERROR: sequence scan failed —', error.message);
    process.exit(2);
  }

  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
  const drawable = graph.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic',
  );
  if (drawable.length === 0) {
    console.error(
      `[visual-mode] ERROR: the scan of ${graph.repoName} produced nothing the board draws`,
    );
    process.exit(2);
  }
  return { graph, drawable };
}

const { graph, drawable } = scanRealRepo();

/** Same static-graph host board-grounded.mjs establishes. */
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

/**
 * Every Visual strip on screen, against the card it is supposed to sit inside.
 *
 * `scrollWidth` vs `clientWidth` is the overflow itself; the per-child edges
 * are what the READER sees, because `.node` is `overflow: visible` — an item
 * whose right edge is past the card's border-box right edge is painted on the
 * board ground, not clipped.
 */
function stripGeometry() {
  const strips = [...document.querySelectorAll('[data-testid="board-node-meta"]')];
  return strips.map((strip) => {
    const card = strip.closest('[data-testid="board-node"]');
    const cardBox = card.getBoundingClientRect();
    const children = [...strip.children].map((child) => {
      const box = child.getBoundingClientRect();
      return {
        text: (child.textContent ?? '').trim(),
        pastRight: box.right - cardBox.right,
        pastLeft: cardBox.left - box.left,
        /* Whether THIS item is the one being ellipsised. Not an assertion —
           a cut word is legible and reachable — but a person judging the row
           needs to know which word gave way and by how much. */
        cut: child.scrollWidth > child.clientWidth ? child.scrollWidth - child.clientWidth : 0,
      };
    });
    return {
      nodeId: card.getAttribute('data-node-id'),
      kind: card.getAttribute('data-kind'),
      text: (strip.textContent ?? '').trim(),
      scrollWidth: strip.scrollWidth,
      clientWidth: strip.clientWidth,
      children,
    };
  });
}

/**
 * Press + until the readout reaches the stop, then wait for the BOARD to agree.
 *
 * THE SECOND HALF IS NOT DEFENSIVE PADDING. The zoom readout and the board's
 * own `data-rung` are written by different renders, and a run that read the
 * readout at 1.00 and the root at rung 5 in the same breath reported "the strip
 * does not draw" while eleven strips were on screen. Two frames of `settle` is
 * the wrong instrument for "has the product finished reacting"; the product's
 * own state attribute is the right one.
 */
async function zoomTo(page, stop) {
  for (let press = 0; press < 12; press += 1) {
    const at = Number(await page.locator(sel('board-zoom')).getAttribute('data-zoom'));
    if (at >= stop) {
      await page
        .locator(`${sel(BOARD.root)}[${BOARD.rungAttr}="1"]`)
        .waitFor({ state: 'attached', timeout: 10_000 });
      return at;
    }
    if (await page.locator(sel('board-zoom-in')).isDisabled()) return at;
    await page.locator(sel('board-zoom-in')).click();
    await settle(page);
  }
  throw new Error(`the zoom-in button never reached ${stop} in 12 presses`);
}

await suite(
  'visual-mode',
  async ({ page, base, check, consoleErrors, log }) => {
    log(`scanned ${graph.repoName}: ${drawable.length} drawable nodes`);

    await page.goto(base, { waitUntil: 'load' });
    await settle(page);
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

    await check('the board drew the real graph, so there is something to look at', async () => {
      atLeast(await page.locator(sel(BOARD.node)).count(), 1, `[data-testid="${BOARD.node}"]`);
    });

    await check('A1 — a reader who has chosen nothing lands on the Visual board', async () => {
      /* Max, 2026-09-02: "they just load it, and it's always going to be doing
         this." This is a fresh browser profile with nothing in localStorage. */
      is(await page.locator(sel(BOARD.root)).getAttribute(BOARD.visualAttr), 'true', 'data-visual');
      is(
        await page.locator(sel(BOARD.visualToggle)).getAttribute('aria-pressed'),
        'true',
        'the toggle’s aria-pressed',
      );
    });

    await check('the strip is absent at the zoom the fit lands on — and says so', async () => {
      /* `NodeCard` gates the strip on `show.footer`, which is rung 1 only, and
         the post-attach fit on this repository lands well below it. Asserted
         rather than worked around, because it is what makes the toggle's
         tooltip a checkable claim: the sentence has to name the zoom. */
      const rung = Number(await page.locator(sel(BOARD.root)).getAttribute(BOARD.rungAttr));
      if (rung > 1) {
        is(await page.locator(sel(BOARD.nodeMeta)).count(), 0, `strips drawn at rung ${rung}`);
      }
      const title = await page.locator(sel(BOARD.visualToggle)).getAttribute('title');
      is(
        title.includes(`${STRIP_ZOOM * 100}%`),
        true,
        `the tooltip does not name the zoom the strip appears at: "${title}"`,
      );
    });

    const landed = await zoomTo(page, STRIP_ZOOM);

    await check('at 100% the strip actually draws, on every card', async () => {
      is(landed, STRIP_ZOOM, 'the zoom the + button landed on');
      is(await page.locator(sel(BOARD.root)).getAttribute(BOARD.rungAttr), '1', 'board data-rung');
      /* Vacuity guard: the overflow check below proves nothing about a board
         with no strips on it. */
      is(
        await page.locator(sel(BOARD.nodeMeta)).count(),
        await page.locator(sel(BOARD.node)).count(),
        'strips drawn, against cards drawn',
      );
    });

    /* ── THE LOCK ───────────────────────────────────────────────────────── */

    await check('no Visual strip is wider than the card it sits in', async () => {
      const strips = await page.evaluate(stripGeometry);
      const over = strips.filter((s) => s.scrollWidth > s.clientWidth);
      is(
        over.length,
        0,
        `strips wider than their card, of ${strips.length}: ${over
          .map((s) => `${s.nodeId} "${s.text}" ${s.scrollWidth} in ${s.clientWidth}`)
          .join(' | ')}`,
      );
    });

    await check('nothing on a Visual strip is painted outside the card border', async () => {
      /* The reader-visible half. `.node` computes `overflow: visible`, so an
         item past the border box is not clipped — it floats on the dot grid.
         Half a pixel of slack for sub-pixel rounding at the card's border. */
      const strips = await page.evaluate(stripGeometry);
      const spilling = strips.flatMap((s) =>
        s.children
          .filter((c) => c.pastRight > 0.5 || c.pastLeft > 0.5)
          .map((c) => `${s.nodeId} "${c.text}" ${Math.max(c.pastRight, c.pastLeft).toFixed(1)}px`),
      );
      is(spilling.length, 0, `items painted outside their card: ${spilling.join(' | ')}`);
    });

    await check('a word the row had to cut is still reachable, not silently gone', async () => {
      /* The gate's other rule. board.css lets the two uppercase words ellipsise
         — they are the only items another channel already carries — so the one
         thing owed is that the whole word is one hover away. */
      const missing = await page.evaluate(() => {
        const out = [];
        /* Reached through the strip's own anchor, per this suite's rule 1. The
           two shrinkable words are the strip children that carry no testid of
           their own; the provenance chip and the count do, and neither may
           shrink, so neither owes a hover. */
        for (const strip of document.querySelectorAll('[data-testid="board-node-meta"]')) {
          for (const child of strip.children) {
            if (child.hasAttribute('data-testid')) continue;
            if (!(child.getAttribute('title') ?? '').trim()) {
              out.push((child.textContent ?? '').trim());
            }
          }
        }
        return out;
      });
      is(missing.length, 0, `strip words with no full text on hover: ${missing.join(', ')}`);
    });

    await check('decision 2 — turning Visual off changes the picture, not the facts', async () => {
      const idsNow = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="board-node"]')]
          .map((el) => el.getAttribute('data-node-id'))
          .sort(),
      );

      await page.locator(sel(BOARD.visualToggle)).click();
      await settle(page);

      is(await page.locator(sel(BOARD.root)).getAttribute(BOARD.visualAttr), 'false', 'data-visual');
      is(await page.locator(sel(BOARD.nodeMeta)).count(), 0, 'strips drawn with Visual off');

      const idsPlain = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="board-node"]')]
          .map((el) => el.getAttribute('data-node-id'))
          .sort(),
      );
      is(
        JSON.stringify(idsPlain),
        JSON.stringify(idsNow),
        'the plain board draws a different node set from the Visual board',
      );

      /* Back on, so the screenshot below is of the mode this file is about. */
      await page.locator(sel(BOARD.visualToggle)).click();
      await settle(page);
    });

    await check('the page reported no errors it did not have coming', async () => {
      const expected = new Set(REFUSED.map((route) => `${base}${route}`));
      const unexpected = consoleErrors.filter(
        (line) => ![...expected].some((url) => line.includes(url)),
      );
      is(unexpected.length, 0, `console errors: ${unexpected.join(' | ')}`);
    });

    /* GATE 3 ENDS WITH A HUMAN LOOKING. The MADR asks for a screenshot into
       tmp-shots/ precisely because "no assertion failed" is not the same
       sentence as "this looks right".

       ZOOMED BACK IN FIRST, and that is not tidying: flipping the toggle
       re-fits the board to about half zoom, where the strip does not draw at
       all — so a shot taken where the last check left the camera would be a
       picture of the plain board filed as the Visual one, which is exactly the
       kind of evidence this repository has been burned by. */
    await zoomTo(page, STRIP_ZOOM);

    /* AND THE HUMAN IS TOLD WHAT EACH ROW SAYS, not only that it fit. An
       ellipsis is a legibility judgement, not a pass/fail one: "SERVICE" cut to
       "SER…" satisfies every assertion above and is still worth a person's eye,
       so the rendered text goes in the log beside the screenshot. */
    for (const strip of await page.evaluate(stripGeometry)) {
      const cut = strip.children.filter((c) => c.cut > 0);
      log(
        `strip ${strip.nodeId}: "${strip.text}" (${strip.scrollWidth}/${strip.clientWidth})` +
          (cut.length ? ` — cut: ${cut.map((c) => `${c.text} by ${c.cut}px`).join(', ')}` : ''),
      );
    }

    const shots = path.join(REPO, 'tmp-shots');
    fs.mkdirSync(shots, { recursive: true });
    const shot = path.join(shots, 'visual-mode.png');
    await page.screenshot({ path: shot, fullPage: false });
    log('screenshot:', shot);
  },
  {
    routes: {
      '/archgraph.json': graph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
