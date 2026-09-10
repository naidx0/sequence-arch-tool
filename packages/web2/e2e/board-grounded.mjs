import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD, WORKSPACE } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD DRAWS THE REAL GRAPH — the Wave 3 closing lock.
   packages/web2/e2e/board-grounded.mjs

   WHAT THIS EXISTS BECAUSE OF, stated once and precisely.

   The Wave 3 gate found `[data-testid="board-node"]` at count 0 in the SHIPPED
   BUNDLE. Every board unit test was green at the same moment. The chain was:
   `App.tsx` never mounted a boot surface, so nothing ever asked the origin for
   a graph; and `createStore()` was called with no projector, so even a graph
   that arrived could not become the `SeqDiagramV1` the canvas paints. The store
   therefore never entered `attached` and `ConnectedBoard` always rendered its
   empty state. A user could not reach a single node by any sequence of actions.

   WHY THIS IS AN E2E AND WHY A jsdom TEST HERE WOULD BE A REPEAT OF THE DEFECT.
   Item 3.5's acceptance test passed in jsdom, against a SYNTHETIC document
   handed straight to the component, while the thing it described was
   unreachable in the product. CANON §6: assert the invariant, not the
   expression. The invariant is "a user who opens the built app against a real
   scanned repository sees nodes"; the expression is "a component given a
   document renders cards". Only a real browser over `dist/`, fed by a real
   scan, can be asked the first question.

   THE GRAPH IS SCANNED HERE, NOW, BY THE REAL ANALYZER.
   It is not a fixture and it is not a file checked in beside this one. A
   fixture is a shape somebody found convenient; this repository is the corpus
   the product is actually pointed at, and `sequence scan` is the exact program
   that produces what `/archgraph.json` serves in production. A hand-written
   graph here could be made to satisfy any projector, including a wrong one.

   WHAT THIS SPEC ASSERTS ABOUT EDGES, AND WHY THAT CHANGED ON 2026-08-21.
   It used to assert NOTHING, and said so: every edge this monorepo scanned was
   kind `import`, `projectEdges` skips those outright, so a correct board here
   had eleven nodes and no connectors. It closed with an instruction — "anyone
   tempted to fix the empty edge layer should point this spec at a repository
   whose scan actually produces http/grpc/queue/db edges instead."

   That is now this repository. Inferring a datastore from real table access
   gives the scan `db_read`/`db_write` edges, `projectEdges` lifts them to one
   service-level `db_access` connector, and the board draws it.

   It also uncovered why NO connector had ever been drawn, in the app, ever:
   @xyflow's `isNodeInitialized` requires `internals.handleBounds || handles`,
   and a node handed explicit `width`/`height` never goes through the measuring
   pass that populates the first. `getEdgePosition` returned null and
   `EdgeWrapper` rendered nothing, silently — no error, because the 008 it can
   raise is for a missing handle id, not for this. The board held a correct edge
   and painted no line, and nothing caught it because no test in the tree had
   ever asserted that a connector reaches the DOM. This one does.

   WHAT THE SERVER IS. `serveDist` with two routes in front of it: the scanned
   graph on `/archgraph.json`, and a hard 404 on the four `/api` routes this
   origin does not serve. That is a truthful description of a static graph host
   and it is `runBoot`'s third rung by name — the one that yields `static-graph`
   and, through `bootSettled`, an attached repo. No engine is started and none
   is faked.
   ══════════════════════════════════════════════════════════════════════════ */

/** The repository this runs against: the monorepo itself. */
const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/**
 * Scan the real repository and return the graph as an object.
 *
 * A failure here is exit 2, never exit 1: "the analyzer is not built" is the
 * harness being unable to run, and reporting it as "the board is broken" is
 * how a green suite and a red suite both stop meaning anything.
 */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[board-grounded] ERROR: the analyzer is not built, so there is nothing to scan');
    console.error('[board-grounded] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }

  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'web2-board-e2e-')),
    'archgraph.json',
  );

  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[board-grounded] ERROR: sequence scan failed —', error.message);
    process.exit(2);
  }

  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));

  /*
   * The precondition, checked rather than assumed. If the scan produced no
   * node the board can draw, then a board with no cards on it is CORRECT and
   * this file would be asserting a falsehood. That is a harness problem, and
   * it exits 2 saying so.
   */
  const drawable = graph.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic',
  );
  if (drawable.length === 0) {
    console.error(
      `[board-grounded] ERROR: the scan of ${graph.repoName} produced no service, datastore or ` +
        'topic node, so there is nothing this spec could honestly expect on the board',
    );
    process.exit(2);
  }

  return { graph, drawable };
}

const { graph, drawable } = scanRealRepo();

/** Every id the scan actually produced. The board may draw a subset of these
 *  and nothing else — an id on screen that is not in here is fabricated. */
const REAL_IDS = new Set(graph.nodes.map((n) => n.id));

/**
 * The platform routes this origin refuses, named once so the route table and
 * the console check cannot drift apart. A static graph host has no engine
 * behind it; 404 is the honest answer and `runBoot`'s third rung is written
 * for exactly it.
 */
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

await suite(
  'board-grounded',
  async ({ page, base, check, consoleErrors, requests, log }) => {
    log(
      `scanned ${graph.repoName}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
        `${drawable.length} of them drawable`,
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

    /*
     * Boot is a network round trip and a React commit, so the board cannot be
     * on screen at `load`. Waiting for the anchor is the right wait — a fixed
     * sleep is a number nobody can defend and the first thing to become flaky
     * on a slower machine. The timeout is generous and its expiry is a real
     * failure, reported by the check below rather than thrown out of it.
     */
    await page
      .locator(sel(BOARD.node))
      .first()
      .waitFor({ state: 'attached', timeout: 20_000 })
      .catch(() => {});

    await settle(page);

    /* ── THE LOCK ───────────────────────────────────────────────────────── */

    await check('the board draws at least one node from the real scan', async () => {
      const drawn = await page.locator(sel(BOARD.node)).count();
      atLeast(drawn, 1, `[data-testid="${BOARD.node}"] in the shipped bundle`);
    });

    await check('at least one node is actually ON SCREEN, not merely in the DOM', async () => {
      /*
       * "Rendered" and "visible" are different claims and this project has
       * already paid for confusing them. A card parked outside the viewport,
       * collapsed to zero height, or under `visibility: hidden` is in the DOM
       * and is not on screen. This asks the browser the question a user asks:
       * is there a painted box, of non-zero size, inside the window.
       */
      const onScreen = await page.evaluate((testid) => {
        const cards = [...document.querySelectorAll(`[data-testid="${testid}"]`)];
        return cards.filter((card) => {
          const box = card.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          const style = getComputedStyle(card);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (Number(style.opacity) === 0) return false;
          return (
            box.right > 0 &&
            box.bottom > 0 &&
            box.left < window.innerWidth &&
            box.top < window.innerHeight
          );
        }).length;
      }, BOARD.node);

      atLeast(onScreen, 1, 'board nodes inside the viewport with a painted box');
    });

    await check('the empty state is gone — the board is not saying it has nothing', async () => {
      is(await page.locator(sel(BOARD.empty)).count(), 0, `[data-testid="${BOARD.empty}"]`);
    });

    /* ── GROUNDED, NOT GUESSED ──────────────────────────────────────────── */

    await check('every node id on the board came from the scan', async () => {
      /*
       * The projector's first constraint: it must not fabricate topology. No
       * synthesised `part-0 → part-1` chain, no invented participant, no id
       * the scan never produced. Checked as a set difference against the graph
       * this run scanned, so it cannot be satisfied by a projector that
       * happens to produce plausible-looking names.
       */
      const ids = await page.evaluate((testid) => {
        const cards = [...document.querySelectorAll(`[data-testid="${testid}"]`)];
        return cards.map((card) => card.getAttribute('data-node-id'));
      }, BOARD.node);

      const invented = ids.filter((id) => id === null || !REAL_IDS.has(id));
      is(
        invented.length,
        0,
        `board node ids that are not in the scanned graph (${invented.slice(0, 5).join(', ')})`,
      );
    });

    await check('the board draws no more nodes than the scan has drawable ones', async () => {
      /*
       * The other half of the same invariant. The set check above catches an
       * invented id; this catches an invented DUPLICATE — the same real node
       * emitted twice would pass a set check and would still be a board
       * claiming the repository has two of something it has one of.
       */
      const drawn = await page.locator(sel(BOARD.node)).count();
      if (drawn > drawable.length) {
        throw new Error(
          `the board drew ${drawn} nodes from a scan with ${drawable.length} drawable ones`,
        );
      }
    });

    await check('a connector the scan produced actually REACHES THE DOM', async () => {
      /*
       * The regression this exists for is silent by construction, so it is
       * asserted at the last possible point: a painted <path>, not a count in a
       * data attribute and not a model the renderer may still discard.
       *
       * `data-edge-count` is the board's own model; `.react-flow__edge` is what
       * @xyflow committed. For the whole life of the product the first was 1 and
       * the second was 0. Asserting both, and that they agree, is the difference
       * between "we projected an edge" and "the user can see a line".
       */
      const modelled = Number(await page.locator(sel(BOARD.root)).getAttribute('data-edge-count'));
      if (modelled < 1) {
        throw new Error(
          `this spec needs a scan that produces at least one interaction edge; the board modelled ${modelled}. ` +
            'If the datastore inference or projectEdges changed, fix that rather than relaxing this.',
        );
      }

      const painted = await page.locator('.react-flow__edge').count();
      is(painted, modelled, 'connectors painted vs connectors the board modelled');

      const d = await page.locator('.react-flow__edges path').first().getAttribute('d');
      if (!d || !/^M[\s\d.-]+/.test(d)) {
        throw new Error(`the connector has no real path geometry: ${JSON.stringify(d)}`);
      }
    });

    await check('the page reported no errors it did not have coming', async () => {
      /*
       * THE ONLY ERRORS ALLOWED ARE THE ONES THIS SPEC CAUSED ON PURPOSE.
       *
       * The route table answers 404 on the four `/api` paths a static graph
       * host does not serve, and the browser logs each refused request to the
       * console. That is the origin telling the truth, and the boot ladder
       * reading that truth is the whole point of rung 3 — it is not the
       * product being wrong.
       *
       * It is filtered BY URL rather than by the message text, and by the exact
       * URLs this file chose to refuse rather than by a `/api/` prefix. A
       * substring match on "404" would swallow a missing stylesheet, a missing
       * chunk and a missing font, which is a hole big enough to hide the next
       * defect of exactly the kind this suite exists to catch.
       */
      const expected = new Set(REFUSED.map((route) => `${base}${route}`));
      const unexpected = consoleErrors.filter(
        (line) => ![...expected].some((url) => line.includes(url)),
      );
      is(unexpected.length, 0, `console errors: ${unexpected.join(' | ')}`);
    });

    await check('the four refused routes are the only thing that 404d', async () => {
      /*
       * The other side of the filter above, so that "no unexpected errors"
       * cannot be satisfied by a run in which nothing was requested at all.
       */
      const asked = requests.filter((url) => REFUSED.some((route) => url === `${base}${route}`));
      atLeast(asked.length, 1, 'refused /api routes the boot ladder actually asked for');
    });
  },
  {
    routes: {
      /* The real scan, on the route the boot ladder reads. */
      '/archgraph.json': graph,
      /*
       * The four platform routes a static graph host does not serve. Answered
       * 404 rather than left to the SPA fallback, because "this origin has no
       * engine" is a fact and index.html-with-a-200 is a file host pretending
       * otherwise. `runBoot` reads the 404 on /api/status, falls to its third
       * rung and yields `static-graph`.
       */
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
