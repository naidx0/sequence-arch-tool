import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD, WORKSPACE } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   FIT, MEASURED WHERE IT IS PRESSED — item canvas-fixes 1 and 2.
   packages/web2/e2e/board-fit.mjs

   WHAT THIS EXISTS BECAUSE OF.

   The Wave 3 gate pressed Fit on this repository and the camera landed at zoom
   0.6312. Under §05.8's ladder that is rung 5 — below the 0.83 rung that
   carries `.nd-t` and below the 0.67 handoff that carries the icon — so the one
   control whose entire job is "show me everything" produced eleven featureless
   boxes: no title, no kind tag, no icon. The board answered "what is in this
   repository" with a column of blank rectangles.

   TWO INDEPENDENT DEFECTS PRODUCE THAT ONE NUMBER, and either alone is enough,
   which is why both are locked here in one press:

     1. `camera.ts` clamped the fit zoom to ZOOM_MIN (0.25) while a comment two
        functions up claimed the floor was a symbol named FIT_MIN_ZOOM that
        existed NOWHERE in the package. Sheet 05.5: "the type floor is one
        number for the whole product, so the fit floor is one number derived
        from it".
     2. `project.ts` laid the graph out itself and said so — "THE LAYOUT IS A
        STAND-IN". With zero drawn edges every node is depth 0, so all eleven
        stacked into ONE COLUMN 160px wide and ~1,180px tall. A column that
        shape cannot be fitted into a 614 x 792 canvas at any zoom that keeps a
        title, so defect 1's floor and defect 2's layout are the same defect
        seen from two ends.

   WHY THIS IS AN E2E AND NOT A jsdom TEST. `fitViewport` is pure and
   `camera.test.ts` can prove its arithmetic; it cannot prove that pressing the
   control marked Fit leaves a title on screen. This package has already shipped
   a jsdom test asserting a dispatch landed while the button opened nothing
   (`shell-overlay.mjs`'s reason for existing), and CANON names the failure
   twice: assert the invariant, not the expression. The invariant is what the
   reader can read after the press.

   THE TWO CHECKS ARE THE SHEET'S OWN WORDS.

     · §05.8's ladder: `.nd-t` is --t-12 and the type floor is --t-10, so the
       title holds to 10/12 = 0.8333… and no lower. "Fit still carries the
       title" is therefore a claim about painted text, and it is counted as
       painted text.
     · §08.1's second prohibition, verbatim: the board never "clips the far side
       of the graph out of the fit". After Fit every card is inside the frame or
       Fit did not fit.

   THE GRAPH IS SCANNED HERE, NOW, BY THE REAL ANALYZER — the reason
   board-grounded.mjs gives: a hand-written graph can be made to satisfy any
   renderer, and the defect being locked was measured on THIS repository.
   ══════════════════════════════════════════════════════════════════════════ */

/** The repository this runs against: the monorepo itself. */
const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/**
 * §05.8's title rung, restated rather than imported.
 *
 * board-lod.mjs states the same rule and the same reason: this file drives the
 * SHIPPED BUNDLE, so it must not be able to agree with a source constant that
 * itself drifted. --t-10 is the type floor and `.nd-t` is authored at --t-12;
 * below their quotient the title is not small text, it is no text.
 */
const TITLE_HOLDS_TO = 10 / 12;

/** Anchors the board emits that `lib/anchors.mjs` does not yet inventory —
 *  the same literals board-lod.mjs addresses the cluster by. */
const FIT = 'board-fit';
const ZOOM = 'board-zoom';
const TITLE = 'board-node-title';
const EDGELESS = 'board-edgeless';
const DERIVED = 'board-derived-toggle';
const EDGE = 'board-edge';
const EDGE_LABEL = 'board-edge-label';

/**
 * PUT THE BOARD ON SCREEN, THE WAY A READER DOES.
 *
 * The shell opens to chat alone (`INITIAL_CHROME_TABS`), so `page.goto` lands
 * on a board that is not mounted and every assertion below would be about an
 * absence. This suite was silently red for exactly that reason: "the board drew
 * the real graph — expected >= 4, got 0".
 *
 * It is a CLICK on the pill, not a host command or a store poke: if the pill
 * ever stops opening the board, this suite must fail rather than route around
 * it.
 */
async function openBoard(page) {
  const pill = page.locator(sel(WORKSPACE.pill('architecture')));
  if ((await pill.count()) === 0) return;
  if ((await pill.getAttribute('data-on')) !== 'true') await pill.click();
  await settle(page);
}

/** STATE on the board root: `CanvasSlice.layout`. ELK runs off-thread, so a
 *  suite that measured after a fixed number of frames would be reading a race
 *  rather than a layout. */
const LAYOUT_ATTR = 'data-layout';

/**
 * Wait until the board is not mid-layout, then settle.
 *
 * The timeout is NOT a silent pass. If the attribute never leaves
 * 'laying-out', the checks below run anyway and fail on what is actually on
 * screen, which is the honest report — a suite that exits 0 because it gave up
 * waiting is the worst outcome available.
 */
async function layoutSettled(page) {
  await page
    .waitForFunction(
      ([root, attr]) => {
        const el = document.querySelector(`[data-testid="${root}"]`);
        return !!el && el.getAttribute(attr) !== 'laying-out';
      },
      [BOARD.root, LAYOUT_ATTR],
      { timeout: 10_000 },
    )
    .catch(() => {});
  await settle(page);
}

function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[board-fit] ERROR: the analyzer is not built, so there is nothing to scan');
    console.error('[board-fit] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-fit-e2e-')), 'archgraph.json');

  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[board-fit] ERROR: sequence scan failed —', error.message);
    process.exit(2);
  }

  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));
  const drawable = graph.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic',
  );
  if (drawable.length < 4) {
    console.error(
      `[board-fit] ERROR: the scan of ${graph.repoName} produced ${drawable.length} drawable ` +
        'nodes. Fit has nothing to argue about on a graph that fits in the frame trivially',
    );
    process.exit(2);
  }

  return { graph, drawable };
}

const { graph, drawable } = scanRealRepo();

/**
 * The real scan, minus its interaction edges — which is what this spec needs to
 * still have a subject.
 *
 * The edgeless assertions below were written when this monorepo produced NO
 * interaction edges at all: every edge it scanned was an `import`, and the board
 * drops those, so "this repository has no connectors" was simply true. That
 * changed on 2026-08-21 — inferring a datastore from real table access gave the
 * board its first `db_access` connector — and the spec's premise stopped
 * holding, which is exactly the outcome its own comment predicted: "anyone
 * tempted to fix the empty edge layer should point this spec at a repository
 * whose scan actually produces http/grpc/queue/db edges instead."
 *
 * The PROPERTY is still worth locking: a board with nodes and no connectors must
 * say so, in the scan's own numbers, in a note that is not a lid. So the state
 * is produced deliberately rather than relied upon — the same scan of the same
 * repository, with the interaction edges filtered out. Nothing is hand-written:
 * every node, position and count is the real thing, and the imports are kept
 * because the board ignores them anyway, so the graph the app receives is a
 * graph it could really be given.
 *
 * The other direction — a board that HAS a connector must not claim it has none
 * — is asserted against the unfiltered scan in `board-grounded.mjs`.
 */
const edgelessGraph = {
  ...graph,
  edges: graph.edges.filter((e) => e.kind === 'import'),
};

/** The routes board-grounded.mjs establishes: a static graph host with no
 *  engine behind it, which is `runBoot`'s third rung by name. */
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

/** Every card's painted box and the board's own, in one pass, so the two
 *  cannot be read a frame apart. */
function geometry([nodeTestid, rootTestid]) {
  const board = document.querySelector(`[data-testid="${rootTestid}"]`).getBoundingClientRect();
  const cards = [...document.querySelectorAll(`[data-testid="${nodeTestid}"]`)].map((card) => {
    const box = card.getBoundingClientRect();
    return {
      id: card.getAttribute('data-node-id'),
      rung: card.getAttribute('data-rung'),
      x: box.x,
      y: box.y,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
  });
  return {
    board: {
      x: board.x,
      y: board.y,
      right: board.right,
      bottom: board.bottom,
      width: board.width,
      height: board.height,
    },
    cards,
  };
}

await suite(
  'board-fit',
  async ({ page, base, check, consoleErrors, log }) => {
    log(
      `scanned ${graph.repoName}: ${drawable.length} drawable nodes, ` +
        `${graph.edges.length} scanned edges (${edgelessGraph.edges.length} served — ` +
        'interaction edges filtered so the edgeless state has a subject); ' +
        'pressing Fit in the shipped bundle',
    );

    await page.goto(base, { waitUntil: 'load' });
    await settle(page);
    await openBoard(page);
    await page
      .locator(sel(BOARD.node))
      .first()
      .waitFor({ state: 'attached', timeout: 20_000 })
      .catch(() => {});
    await settle(page);

    await check('the board drew the real graph, so there is something to fit', async () => {
      atLeast(await page.locator(sel(BOARD.node)).count(), 4, `[data-testid="${BOARD.node}"]`);
    });

    await layoutSettled(page);

    /* THE PRESS. Not a dispatch, not a keystroke handler called directly — the
       control the reader sees, clicked. */
    await page.locator(sel(FIT)).click();
    await layoutSettled(page);

    const zoom = Number(await page.locator(sel(ZOOM)).getAttribute('data-zoom'));
    const { board, cards } = await page.evaluate(geometry, [BOARD.node, BOARD.root]);
    log(`after Fit: zoom ${zoom}, ${cards.length} cards, board ${Math.round(board.width)}x${Math.round(board.height)}`);

    /* ── THE LOCK ───────────────────────────────────────────────────────── */

    await check('Fit does not land below the title rung unless holding it would CLIP', async () => {
      /*
       * The measured defect this was written for: 0.6312 against a 0.8333
       * floor, eleven featureless boxes. That half is unchanged and still
       * asserted — on any frame where an arrangement fitting at 0.8333 exists,
       * Fit must not land below it.
       *
       * WHAT WAS ALSO TRUE, AND WHAT THIS NOW SEPARATES. The old assertion was
       * unconditional, and paired with §08.1's "nothing is clipped" it demanded
       * something no camera can deliver at a narrow pane: `CARD_W` is 160 and
       * the fit insets 24 a side, so from 208px of pane down, one card alone is
       * wider than the box it is fitted into. Measured in this bundle at a
       * 158px pane: content packed to 158 x 930, Fit clamped to 0.8333, 784px
       * of graph inside a 719px frame — the floor's only effect was the clip.
       *
       * So the claim is now conditional and the CONDITION is checked, not
       * assumed: below the title rung, Fit has to show that the floor could not
       * have shown the graph whole.
       */
      if (zoom >= TITLE_HOLDS_TO) return;

      const content = cards.reduce(
        (acc, c) => ({
          w: Math.max(acc.w, c.right - Math.min(...cards.map((o) => o.x))),
          h: Math.max(acc.h, c.bottom - Math.min(...cards.map((o) => o.y))),
        }),
        { w: 0, h: 0 },
      );
      // What the same content would measure at the floor, from what it measures now.
      const atFloor = { w: (content.w / zoom) * TITLE_HOLDS_TO, h: (content.h / zoom) * TITLE_HOLDS_TO };
      if (atFloor.w <= board.width && atFloor.h <= board.height) {
        throw new Error(
          `Fit landed at ${zoom}, below --t-10 / --t-12 = ${TITLE_HOLDS_TO.toFixed(4)}, ` +
            `while the graph would have fitted there (${Math.round(atFloor.w)}x${Math.round(atFloor.h)} ` +
            `in ${Math.round(board.width)}x${Math.round(board.height)})`,
        );
      }
    });

    await check('after Fit every card on screen still carries its TITLE', async () => {
      // `data-rung` is what the board believes. This is what the reader got.
      // Conditional for the same reason as the check above, and on the same
      // measured fact: below the title rung the ladder takes `.nd-t` away by
      // design, and it is the ladder's rule that labels are hidden rather than
      // shrunk. At or above it, every card must carry its name.
      if (zoom < TITLE_HOLDS_TO) return;
      const titles = await page.locator(sel(TITLE)).count();
      is(titles, cards.length, 'cards painting a .nd-t after Fit, out of the cards drawn');
    });

    await check('after Fit nothing is clipped out of the frame — §08.1', async () => {
      // "What the board never does": clip the far side of the graph out of the
      // fit. A single 160px column ~1,180px tall cannot satisfy this and the
      // title floor at once, which is why the stand-in layout fails here too.
      const SLACK = 1; // one device pixel of rounding, and no more
      const outside = cards.filter(
        (c) =>
          c.x < board.x - SLACK ||
          c.y < board.y - SLACK ||
          c.right > board.right + SLACK ||
          c.bottom > board.bottom + SLACK,
      );
      is(
        outside.length,
        0,
        `cards clipped out of the frame by Fit (${outside
          .map((c) => `${c.id} @ ${Math.round(c.x)},${Math.round(c.y)}`)
          .join(', ')}), out of ${cards.length}`,
      );
    });

    await check('the layout is shaped by the frame, not stacked in one column', async () => {
      /*
       * Item canvas-fixes 2, in its rendered form. `project.ts`'s stand-in gave
       * every node depth 0 — with no drawn edge there is no other answer — so
       * the board was one 160px column using ~13% of the canvas width and
       * overflowing its height. ELK's own component packing, handed the frame's
       * aspect ratio, is what replaces it.
       *
       * Asserted as COLUMNS rather than as a width fraction, because a fraction
       * is a threshold somebody picked and a second column is the difference
       * between a board and a list.
       */
      const columns = new Set(cards.map((c) => Math.round(c.x))).size;
      atLeast(columns, 2, `distinct columns across ${cards.length} cards after Fit`);
    });

    await check('the ELK layout ran — the board is not still laying out', async () => {
      // `data-layout` is 'failed' when there was no Worker or ELK gave up, and
      // in that state the board is showing `project.ts`'s seed. Distinguishing
      // the three is the point: a board that never laid out and a board that
      // laid out badly are different bugs.
      is(
        await page.locator(sel(BOARD.root)).getAttribute(LAYOUT_ATTR),
        'idle',
        'the board’s CanvasSlice.layout after Fit',
      );
    });

    /* ── ITEM canvas-fixes 3 ───────────────────────────────────────
       Checked in the same run because it is the same board and the same scan:
       booting a second browser to look at the corner of a page already open is
       twenty seconds spent on nothing. */

    /* ── THE DERIVED LAYER ─────────────────────────────────────────────────

       The board still draws no `import` edge AS A CONNECTOR — an import says
       one FILE names another and the board's nodes are services, and that skip
       stays. What it does now is roll those imports up by their files' real
       `parentId` and offer the AGGREGATE as a different kind of claim: dotted,
       hairline, in the weakest ink, counted, and labelled 'N imports'.

       On this scan that is twelve service->service dependencies — 84
       analyzer->schema, 63 web2->api-types, 49 web2->schema, 3 mcp->analyzer
       and so on — every one of them grounded in import edges carrying
       {file, line, snippet}. Before this, all twelve were behind a toggle and
       painted identically when it was pressed. */

    await check('the inference is drawn, and every connector is marked as derived', async () => {
      const drawn = await page.locator(sel(EDGE)).count();
      atLeast(drawn, 4, `connectors on a board whose scan joins nothing up`);

      const proofs = await page.locator(sel(EDGE)).evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-proof')),
      );
      is(
        proofs.filter((p) => p !== 'derived').length,
        0,
        'connectors on this scan that are NOT marked as inferences',
      );
    });

    await check('at 1:1 every connector says how many imports, and they differ', async () => {
      /*
       * THE TAG IS ON THE LADDER'S FIRST ROW and this check has to respect it:
       * §05.8 authors `.edgetag` at --t-10, so its threshold is --t-10 / --t-10
       * = 1.00 and it is the FIRST ink to go. Fit landed this graph at 0.528,
       * which is below that row — the labels are correctly absent there, and a
       * suite that asserted them at any zoom would be asserting against the
       * ladder rather than against the defect.
       *
       * So the zoom is put where the row lives, with the control the reader
       * uses, and the claim is checked there. The DEFECT was that the count did
       * not exist at ANY zoom: twelve inferred connectors, every one of them
       * painted identically, so analyzer->schema (84 imports) and mcp->analyzer
       * (3) read the same.
       */
      while (Number(await page.locator(sel(ZOOM)).getAttribute('data-zoom')) < 1) {
        await page.locator(sel('board-zoom-in')).click();
        await settle(page);
      }

      const drawn = await page.locator(sel(EDGE)).count();
      const labels = await page
        .locator(sel(EDGE_LABEL))
        .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''));
      is(labels.length, drawn, 'connectors carrying a label, out of connectors drawn');
      const wrong = labels.filter((text) => !/^\d+ imports?$/.test(text));
      is(wrong.length, 0, `labels that do not read as a count of imports: ${wrong.join(' | ')}`);
      // Distinct weights read differently, which is the whole point of the count.
      atLeast(new Set(labels).size, 2, 'distinct import counts among the drawn connectors');
      // And not one of them says anything stronger than what was measured.
      const overclaim = labels.filter((text) => /call|http|request/i.test(text));
      is(overclaim.length, 0, `labels claiming behaviour: ${overclaim.join(' | ')}`);
    });

    await check('the toggle says what it draws, and the count matches', async () => {
      const text = (await page.locator(sel(DERIVED)).textContent()) ?? '';
      const claimed = Number(/\((\d+)\)/.exec(text)?.[1]);
      is(claimed, await page.locator(sel(EDGE)).count(), `"${text}" against the connectors drawn`);
      is(await page.locator(sel(DERIVED)).getAttribute('aria-pressed'), 'true', 'the toggle state');
    });

    await check('switching the inference OFF brings back the honest absence', async () => {
      /*
       * THE ORIGINAL LOCK, KEPT — and it is now reachable the only way it
       * should be: with the reader having declined the inference. Sheet 08.5's
       * third state is the sentence for a board with nodes and no connectors
       * ('the connections are the thing missing'), and its WHY must carry the
       * scan's REAL edge count, read from the graph this suite handed the app.
       * A note that said 'no edges' without saying where they went would be the
       * caption 08.3 refuses — a measurement offered and then withheld.
       */
      await page.locator(sel(DERIVED)).click();
      await layoutSettled(page);

      const edges = Number(await page.locator(sel(BOARD.root)).getAttribute('data-edge-count'));
      is(edges, 0, 'edges the board drew on the edgeless variant of this scan');

      const note = await page.locator(sel(EDGELESS)).count();
      is(note, 1, `[data-testid="${EDGELESS}"] on a board with nodes and no edges`);

      const why = await page.locator(`${sel(EDGELESS)} .s`).textContent();
      if (!why || !why.includes(String(edgelessGraph.edges.length))) {
        throw new Error(
          `the note does not carry the scan's own edge count (${edgelessGraph.edges.length}): "${why}"`,
        );
      }
    });

    await check('the note is a NOTE and not a lid over the cards', async () => {
      // 08.5: "at the size of what it is talking about, never a lid over it."
      // Measured as painted area, because a box with `position:absolute` and a
      // wide max-width becomes a lid by arithmetic without anybody deciding to
      // make one.
      const noteBox = await page.locator(sel(EDGELESS)).boundingBox();
      if (!noteBox) throw new Error('the note is not painted at all');
      const share = (noteBox.width * noteBox.height) / (board.width * board.height);
      if (share > 0.25) {
        throw new Error(
          `the note covers ${(share * 100).toFixed(0)}% of the board — that is a lid`,
        );
      }
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
      '/archgraph.json': edgelessGraph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
