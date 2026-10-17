import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD, RAIL, SHELL } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { isRefusedLine } from './lib/consoleFilter.mjs';
import { readFunctionIndex } from './lib/functionIndex.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   THE FLOW PLAYS ON THE BOARD — item playback
   packages/web2/e2e/flow-plays.mjs

   ── WHY THIS FILE EXISTS, IN THE WORDS OF THE THING IT LOCKS ─────────────

   The rail's flow panel is headed "Plays on board". It said that once, was
   RETREATED to "Traced path", and now says it again. The retreat happened
   because the Waves 4/5 gate clicked a traced function in the shipped bundle
   and watched **no board node change class, selection or camera** — both lanes
   had written the wiring gap into their comments while the user-visible string
   kept asserting the behaviour.

   A HEADING IS A CLAIM. This file is what makes that one true rather than
   asserted, and it has to be here rather than in vitest for two reasons that
   are not stylistic:

     · jsdom implements no layout, so it cannot see a camera move. The camera is
       a viewport translate the board writes into `--board-cam-x/y`; reading it
       needs a browser that resolved a custom property.
     · sheet 06.6 puts a FLOOR under dimming — "Dimmed text must still hold
       4.5:1 against what is behind it" — and that is a question about composited
       colour after an `opacity`, which only a real renderer can answer. jsdom
       does not substitute var() and has no compositor.

   ── WHAT IT RUNS AGAINST ─────────────────────────────────────────────────

   The real repository, twice over: a live `sequence scan` on `/archgraph.json`
   and the engine's own `.sequence/functions.json` on `/api/functions` — the
   same file the route serves in production. `app-mounted.mjs` argues both
   choices at length and this spec follows it rather than restating them.

   ── THE FACT THAT SHAPES EVERY ASSERTION BELOW, AND IT IS MEASURED ───────

   On this monorepo the function graph holds **4,000 call edges and not one of
   them crosses a package**, so `flowForFunction` never produces a
   service→service hop here: every traced flow is file→file, and the board draws
   services. A spec that demanded two different cards light up would fail
   against a correct product, and a wiring that only handled the crossing case
   would light nothing at all while the heading claimed it played.

   So the assertions are phrased against `flowFocus.ts`'s four resolutions.
   Whatever this repository's flows resolve to, the board must (a) light
   something real, (b) move the camera to it, (c) recede what the flow does not
   touch, and (d) SAY, in the resolver's own vocabulary, what it could not show.
   ══════════════════════════════════════════════════════════════════════════ */

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

function harnessFailure(message, remedy) {
  console.error(`[flow-plays] ERROR: ${message}`);
  if (remedy) console.error(`[flow-plays] run: ${remedy}`);
  process.exit(2);
}

/** A real scan of this repository. Exit 2 on failure — see `app-mounted.mjs`:
 *  "the analyzer is not built" is the harness unable to run, and reporting it
 *  as a product defect is how green and red both stop meaning anything. */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    harnessFailure(
      'the analyzer is not built, so there is nothing to scan',
      'pnpm --filter @sequence/analyzer build',
    );
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-flow-e2e-')), 'archgraph.json');
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    harnessFailure(`sequence scan failed — ${error.message}`);
  }
  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));

  const drawable = graph.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic',
  );
  /* TWO is the precondition, not one. Every assertion about DIMMING needs a
     card the flow does not touch; on a one-card board "everything is lit" and
     "nothing is dimmed" are both correct and the spec would be vacuous. */
  if (drawable.length < 2) {
    harnessFailure(
      `the scan of ${graph.repoName} produced ${drawable.length} drawable node(s); this spec ` +
        'needs at least two, because it asserts that what the flow does not touch recedes',
    );
  }
  return { graph, drawable, graphFile: out };
}

/** The engine's own function index, from its own cache. */
function readEngineFunctions(graphFile) {
  const read = readFunctionIndex(REPO, graphFile);
  if (read.failure) harnessFailure(read.failure);
  return read;
}

const { graph, drawable, graphFile } = scanRealRepo();
const functions = readEngineFunctions(graphFile);

/** Every id the scan produced. A node id on screen that is not in here is one
 *  the board invented, which is the first non-negotiable in CANON. */
const REAL_IDS = new Set(graph.nodes.map((n) => n.id));

const ROUTES = {
  '/archgraph.json': graph,
  '/api/functions': functions,
  '/api/status': null,
  '/api/recent': null,
  '/api/browse': null,
  '/api/attach': null,
  '/api/git/status': null,
  '/api/git/diff': null,
  /* Routes this origin does not serve: a hard 404, not the SPA's text/html that an EventSource logs as a MIME error. */
  '/api/boards': null,
  '/api/boards/architecture': null,
  '/api/boards/events': null,
  '/api/agent-events': null,
};

const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach', '/api/git/status', '/api/git/diff', '/api/boards', '/api/boards/architecture', '/api/boards/events', '/api/agent-events'];

/**
 * THE CAMERA, READ THE ONLY WAY THAT IS THIS PRODUCT'S CONTRACT.
 *
 * `--board-cam-x/y/z` are written onto the board root by `Board.tsx` from
 * `canvas.viewport`, and `data-zoom` beside them. That is a promise the board
 * makes. Parsing `.react-flow__viewport`'s transform would be reading @xyflow's
 * internals — Wave 0's re-anchoring rejected exactly that, because it "was never
 * this repo's contract to begin with".
 */
function readCamera(page) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) throw new Error('no board on screen');
    const style = getComputedStyle(el);
    return {
      x: style.getPropertyValue('--board-cam-x').trim(),
      y: style.getPropertyValue('--board-cam-y').trim(),
      zoom: el.getAttribute('data-zoom'),
    };
  }, BOARD.root);
}

/**
 * SHEET 06.6's FLOOR, MEASURED AFTER THE COMPOSITE.
 *
 * "Dimmed text must still hold 4.5:1 against what is behind it, which rules out
 * fading a title toward the ground." The dim is an `opacity` on the whole card,
 * so neither the title's declared colour nor the card's is what lands on the
 * screen: both are composited against whatever the card is lying on. Reading
 * `color` alone would report a ratio the reader never sees — a declared value
 * reported as a rendered one, which CANON §6 names as its own mistake class.
 */
function dimmedTitleContrast(page) {
  return page.evaluate(
    ([nodeId, dimAttr]) => {
      const parse = (value) => {
        const nums = (value.match(/[\d.]+/g) ?? []).map(Number);
        if (nums.length < 3) return null;
        return { r: nums[0], g: nums[1], b: nums[2], a: nums.length > 3 ? nums[3] : 1 };
      };
      /** The first ancestor that actually paints. `transparent` paints nothing. */
      const painted = (start) => {
        let el = start;
        while (el) {
          const rgb = parse(getComputedStyle(el).backgroundColor);
          if (rgb && rgb.a > 0) return rgb;
          el = el.parentElement;
        }
        return { r: 0, g: 0, b: 0, a: 1 };
      };
      const over = (front, back, alpha) => ({
        r: alpha * front.r + (1 - alpha) * back.r,
        g: alpha * front.g + (1 - alpha) * back.g,
        b: alpha * front.b + (1 - alpha) * back.b,
      });
      const lum = (c) => {
        const ch = [c.r, c.g, c.b]
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };

      const card = [...document.querySelectorAll(`[data-testid="${nodeId}"]`)].find(
        (el) => el.getAttribute(dimAttr) === 'true' && el.querySelector('.nd-t'),
      );
      if (!card) return null;

      const title = card.querySelector('.nd-t');
      const alpha = Number(getComputedStyle(card).opacity);
      const ground = painted(card.parentElement);
      const cardFill = parse(getComputedStyle(card).backgroundColor) ?? ground;
      const ink = parse(getComputedStyle(title).color);
      if (!ink) return null;

      // The card's own fill may itself be translucent; land it on the ground
      // first, then apply the dim to the whole card, exactly as the compositor
      // does.
      const cardOnGround = over(cardFill, ground, cardFill.a);
      const inkOnCard = over(ink, cardOnGround, ink.a);

      const seenCard = over(cardOnGround, ground, alpha);
      const seenInk = over(inkOnCard, ground, alpha);

      const a = lum(seenInk);
      const b = lum(seenCard);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { ratio, alpha, title: title.textContent ?? '' };
    },
    [BOARD.node, BOARD.dimmedAttr],
  );
}

/**
 * Open files until one of their functions plays a flow of at least two hops, driving the FILES surface exactly as a
 * person does: filter to the file, open its functions, click one, look.
 *
 * REPOINTED 0.1.9 (item 1). The flow used to start from a function row in the Index rail (\`rail-row\`,
 * \`board-region-rail\`); that rail is no longer mounted. The same act now lives under each file in the Files
 * surface (src/files: \`files-symbols-toggle\` opens a file's functions, \`files-symbol[data-function-id]\` plays
 * one on the board, and the flow strip is the same \`FlowPanel\`: \`rail-flow\`, \`rail-hop\`).
 *
 * TWO HOPS, BECAUSE ONE PROVES NO CLOCK. A single-hop flow cannot advance, so a ticker that never fires would pass a
 * spec that accepted one. \`analyzer/src/cli.ts#main\` produces the longest flow this repository has (14 hops), but a
 * multi-hop flow is searched for rather than hard-coded: a hard-coded function name dies the next time somebody
 * renames a symbol. Candidate files come from the engine's own function index, most functions first.
 */
const SYMBOL = 'files-symbol';
async function playSomeTracedFunction(page, log) {
  const byFile = new Map();
  for (const node of functions.functionGraph.nodes) {
    const file = String(node.file ?? '').split(String.fromCharCode(92)).join('/');
    if (file) byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  const candidates = [...byFile.entries()].sort((x, y) => y[1] - x[1]).map(([file]) => file);

  let opened = 0;
  for (const file of candidates) {
    if (opened >= 25) break;
    /* A name borne by several paths filters to several rows; only the row of THIS path is used. */
    await page.locator(sel('files-filter')).fill(file);
    await settle(page);
    const row = page.locator(`${sel('files-row')}[data-path="${file}"]`);
    if ((await row.count()) === 0) continue;
    const toggle = row.locator(sel('files-symbols-toggle'));
    if ((await toggle.count()) === 0) continue;
    opened += 1;
    await toggle.click();
    await settle(page);

    const ids = await page.$$eval(sel(SYMBOL), (els) => els.map((el) => el.getAttribute('data-function-id')));
    for (const id of ids) {
      /* The tree draws only the rows in view, so these are the first screenful of the file's functions; a minified file can
         repeat an id, so the first row of it is the one played. */
      await page.locator(`${sel(SYMBOL)}[data-function-id="${id}"]`).first().click();
      await settle(page);
      const hops = await page.locator(sel(RAIL.hop)).count();
      if (hops >= 2) {
        log(`playing ${JSON.stringify(id)} in ${file} — ${hops} hops`);
        return { hops, file, id };
      }
    }
    /* The tree draws only the rows in view (perf 019): playing the functions scrolled the file's own row out of the
       window, so a reader goes back up to it, as they would. */
    await page.evaluate(() => { const tree = document.querySelector('[data-testid="files-tree"]'); if (tree) tree.scrollTop = 0; });
    await settle(page);
    await toggle.click();
    await settle(page);
  }
  return null;
}

await suite(
  'flow-plays',
  async ({ page, base, check, consoleErrors, log }) => {
    log(
      `scanned ${graph.repoName}: ${graph.nodes.length} nodes, ${drawable.length} drawable; ` +
        `${functions.functionGraph.nodes.length} functions, ${functions.functionGraph.edges.length} calls`,
    );

    await page.goto(base, { waitUntil: 'load' });
    /* The board and the Files surface share the stage (Shell2): the board is asked for the way a reader asks for
       it, and Files is where a function's flow is started now (the Index rail is not mounted). */
    /* Pressed already when the shell opens on the board: a second press would close it. */
    if ((await page.getByTestId('s2-tab-architecture').getAttribute('aria-pressed')) !== 'true') {
      await page.getByTestId('s2-tab-architecture').click();
    }
    await page.locator(sel(BOARD.root)).waitFor({ state: 'visible', timeout: 15000 });
    /* A plain click SWITCHES the stage (0.1.8.1 C1); a split is opened on purpose, with Ctrl+click (switchOnStage). */
    await page.getByTestId('s2-tab-files').click({ modifiers: ['Control'] });
    await page.locator(sel('files-row')).first().waitFor({ state: 'visible', timeout: 15000 });
    await settle(page);

    /* ── 0. THE BOARD AT REST, so every later claim has a baseline ──────── */

    const restCamera = await readCamera(page);
    const restDimmed = await page.locator(`${sel(BOARD.node)}[${BOARD.dimmedAttr}="true"]`).count();
    const boardNodes = await page.locator(sel(BOARD.node)).count();
    log(`at rest: ${boardNodes} board nodes, ${restDimmed} dimmed, camera ${JSON.stringify(restCamera)}`);

    await check('nothing is dimmed and nothing is selected before a flow', async () => {
      /* Sheet 06.6: dimming is for playback and explicit path-focus and nothing
         else. A board that arrives dimmed would make every assertion below
         about the dim meaningless. */
      is(restDimmed, 0, 'dimmed nodes at rest');
      is(
        await page.locator(`${sel(BOARD.node)}[${BOARD.selectedAttr}="true"]`).count(),
        0,
        'selected nodes at rest',
      );
      is(await page.locator(sel(BOARD.root)).getAttribute(BOARD.viewAttr), 'S0', 'the canvas state at rest');
    });

    /* ── 1. PLAY A REAL FLOW, BY CLICKING ──────────────────────────────── */

    const played = await playSomeTracedFunction(page, log);
    if (played === null) {
      harnessFailure(
        'no function row in the first 25 files with a function count produced a flow of two or ' +
          'more hops, so there is nothing this spec could honestly play',
      );
    }

    /* ── 1a. START THE FLOW FROM A BOARD WITH NOTHING FOCUSED ────────────
     *
     * THIS STEP EXISTS BECAUSE THE SPEC PASSED ONCE WHEN IT SHOULD NOT HAVE.
     * With the wiring deliberately reverted, "a board node takes the focused
     * state, and it is THIS HOP's node" still went green: the search above
     * clicks untraced function rows on its way to a traced one, and an untraced
     * row focuses its ORIGIN card — which, for a function in `packages/analyzer`,
     * is the very service the hop's containment chain runs through. The
     * assertion was true of a selection the flow had not made.
     *
     * So the board is emptied first, with the reader's own gesture — sheet
     * 05.7's Escape, "no keystroke on this sheet changes the graph, so a reader
     * who is lost can always get back without having edited anything" — and the
     * traced row is clicked again. After this point NOTHING but the flow can put
     * a card into the focused state, which is what makes every assertion below
     * about the flow.
     */
    /* The search left a flow playing (Files keeps it until it is cleared): clear it with the flow strip's own Clear,
       the reader's gesture, so the board starts the real run with nothing the flow had selected. */
    if ((await page.locator(sel(RAIL.clear)).count()) > 0) {
      await page.locator(sel(RAIL.clear)).click();
      await settle(page);
    }
    await page.locator(sel(BOARD.root)).focus();
    await page.keyboard.press('Escape');
    await settle(page);
    is(
      await page.locator(`${sel(BOARD.node)}[${BOARD.selectedAttr}="true"]`).count(),
      0,
      'focused nodes after clicking empty ground',
    );
    await page.locator(`${sel('files-filter')}`).fill(played.file);
    await settle(page);
    /* THE CLOCK RUNS WHILE THE CHECKS DO (a hop dwells --seq-dur-hop, and a loaded machine reads the DOM late), so
       any fact about "the hop the flow opens on" has to be recorded when it happens, not read afterwards. This
       observer notes the first hop index the board ever shows and every index after it. */
    await page.evaluate((rootId) => {
      const root = document.querySelector(`[data-testid="${rootId}"]`);
      window.__hops = [];
      const note = () => {
        const v = root.getAttribute('data-flow-hop');
        if (v !== null && window.__hops[window.__hops.length - 1] !== v) window.__hops.push(v);
      };
      note();
      new MutationObserver(note).observe(root, { attributes: true, attributeFilter: ['data-flow-hop'] });
    }, BOARD.root);
    await page.locator(`${sel(SYMBOL)}[data-function-id="${played.id}"]`).click();
    await settle(page);

    await check('the heading claims the flow plays on the board', async () => {
      /* THE CLAIM ITSELF, read as a string. It is asserted FIRST and the
         behaviour is asserted after it, in that order on purpose: this is the
         sentence the product makes to the reader, and everything below is the
         evidence for it. If the heading is ever retreated again, this line is
         what has to be edited, and editing it is what forces the retreat to be
         a decision rather than a quiet loss. */
      const heading = (await page.locator(sel(RAIL.flowTitle)).textContent()) ?? '';
      is(heading.trim(), 'Plays on board', 'the flow panel heading');
    });

    await check('the board entered S3 and knows which hop it is on', async () => {
      const root = page.locator(sel(BOARD.root));
      is(await root.getAttribute(BOARD.viewAttr), 'S3', 'the canvas state while playing');
      is(
        Number(await root.getAttribute(BOARD.flowHopsAttr)),
        played.hops,
        'the hop count the board holds against the hop rows the rail drew',
      );
      const seen = await page.evaluate(() => window.__hops);
      is(seen[0], '0', `the hop the board opens on (hops seen: ${seen.join(', ')})`);
    });

    await check('a board node takes the focused state, and it is THIS HOP’s node', async () => {
      /* THE ASSERTION THE GATE MADE AND FAILED. "click a traced function in the
         shipped bundle → no board node changes class, selection or camera."

         IT IS TIED TO THE HOP AND NOT MERELY TO "something is selected", and
         that is not belt-and-braces: with the wiring reverted, this check
         PASSED in its first form. The rail's own card-click already selects a
         board node, and the search above clicks untraced function rows on the
         way to a traced one — each of which focuses its origin card. So a
         leftover selection satisfied "one node is focused" while the flow moved
         nothing, which is the exact shape of vacuous green this whole item
         exists to remove.

         THE TIE IS THE SCAN'S OWN `parentId`. The board draws services; the
         hop's ends here are files inside them. So the focused card must BE the
         hop's destination or an ANCESTOR of it — walked on the served graph, in
         this harness, against ids the rail printed. A card that is neither is a
         card the flow did not choose. */
      /* ONE READ for the board's hop, its focused cards and the hop rows: the clock may move between two reads. */
      const now = await page.evaluate(
        ([root, node, selAttr, hopSel]) => {
          const el = document.querySelector(`[data-testid="${root}"]`);
          return {
            index: Number(el.getAttribute('data-flow-hop')),
            selected: [...document.querySelectorAll(`[data-testid="${node}"][${selAttr}="true"]`)].map((n) => n.getAttribute('data-node-id')),
            hop: [...document.querySelectorAll(`[data-testid="${hopSel}"]`)].map((n) => ({ from: n.getAttribute('data-from'), to: n.getAttribute('data-to') })),
          };
        },
        [BOARD.root, BOARD.node, BOARD.selectedAttr, RAIL.hop],
      );
      const { selected, hop } = now;
      is(selected.length, 1, `board nodes in the focused state (got ${selected.join(', ')})`);
      is(REAL_IDS.has(selected[0]), true, `${selected[0]} is a node the scan produced`);
      atLeast(hop.length, 1, 'hop rows to read an endpoint off');

      const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parentId ?? null]));
      const chain = (id) => {
        const out = [];
        const seen = new Set();
        let cursor = id;
        while (cursor && !seen.has(cursor)) {
          out.push(cursor);
          seen.add(cursor);
          cursor = parentOf.get(cursor) ?? null;
        }
        return out;
      };
      const here = hop[now.index] ?? hop[0];
      const reachable = new Set([...chain(here.to), ...chain(here.from)]);
      is(
        reachable.has(selected[0]),
        true,
        `${selected[0]} is on the containment chain of hop ${now.index + 1} (${here.from} → ${here.to})`,
      );
    });

    await check('the camera moved to it', async () => {
      const now = await readCamera(page);
      const moved = now.x !== restCamera.x || now.y !== restCamera.y || now.zoom !== restCamera.zoom;
      is(moved, true, `the camera moved (rest ${JSON.stringify(restCamera)}, now ${JSON.stringify(now)})`);
    });

    await check('what the flow does not touch recedes, and what it lights does not', async () => {
      const states = await page.$$eval(`[data-testid="${BOARD.node}"]`, (els) =>
        els.map((el) => ({
          id: el.getAttribute('data-node-id'),
          dimmed: el.getAttribute('data-dimmed'),
          selected: el.getAttribute('data-selected'),
        })),
      );
      atLeast(states.filter((n) => n.dimmed === 'true').length, 1, 'receded nodes');
      const focused = states.find((n) => n.selected === 'true');
      is(focused?.dimmed, 'false', 'the focused node is not also receded');
    });

    await check('a receded title still holds 4.5:1 — sheet 06.6’s floor', async () => {
      const measured = await dimmedTitleContrast(page);
      if (measured === null) throw new Error('no receded card with a title to measure');
      log(`receded title ${JSON.stringify(measured.title)} at opacity ${measured.alpha}: ${measured.ratio.toFixed(2)}:1`);
      /* "Contrast is won by making the answer louder, not by making the rest
         illegible." A dimmed card the reader can see but cannot read is worse
         than one that is hidden — the sheet says so in those words. */
      is(measured.ratio >= 4.5, true, `the receded title's contrast (${measured.ratio.toFixed(2)}:1)`);
    });

    await check('the board says what it cannot show of this hop', async () => {
      /* THE HONEST-ABSENCE HALF. `data-flow-how` is `flowFocus.ts`'s own
         four-member vocabulary; `direct` is the only one that needs no words,
         because both cards are lit and the connector between them is promoted.
         Every other value MUST carry the note, and the note must name the hop
         the reader is on rather than a generic apology. */
      /* One read of the hop, how it resolved, and the note, so they describe the same hop. */
      const got = await page.evaluate(([root, noteId]) => {
        const el = document.querySelector(`[data-testid="${root}"]`);
        const notes = [...document.querySelectorAll(`[data-testid="${noteId}"]`)];
        return {
          index: Number(el.getAttribute('data-flow-hop')),
          how: el.getAttribute('data-flow-how'),
          notes: notes.length,
          text: notes[0]?.textContent ?? '',
        };
      }, [BOARD.root, BOARD.flowNote]);
      if (got.how === 'direct') {
        is(got.notes, 0, 'notes over a hop the board can show outright');
        return;
      }
      is(got.notes, 1, `notes for a hop resolved as ${got.how}`);
      is(
        got.text.includes(`Hop ${got.index + 1} of`),
        true,
        `the note names the hop it is about (the board is on hop ${got.index + 1}) — got ${JSON.stringify(got.text)}`,
      );
    });

    /* ── 2. IT ACTUALLY PLAYS — the clock, with nothing touched ─────────── */

    await check('the playhead advances on its own, without a second click', async () => {
      /* BEFORE THIS ITEM, NOTHING IN THE PACKAGE ADVANCED THE CURSOR. `playing`
         was set to true by the rail and no timer existed anywhere in `rail/`,
         `app/` or `canvas/` — so the pause button's label read "Pause the flow"
         about a flow that was not moving, and a reader who pressed play watched
         one hop forever. A heading that says the flow PLAYS is false without a
         clock, so the clock is part of this lock rather than a follow-up.

         The wait is on the ATTRIBUTE rather than on a fixed sleep: the dwell is
         `--seq-dur-hop`, read off the live cascade, and a spec that hard-coded
         400ms would be a second definition of it. */
      /* "Advanced" means a hop after the first was shown: waiting for the value "1" fails when the clock has already
         passed it, which is the clock working. */
      await page.waitForFunction(() => window.__hops.length >= 2, undefined, { timeout: 8000 });
      const seen = await page.evaluate(() => window.__hops);
      is(Number(seen[1]) > Number(seen[0]), true, `the hops the board showed, in order: ${seen.join(', ')}`);
    });

    await check('the hop the rail marks playing is the hop the board is on', async () => {
      /* ONE ACCENT MARK FOR ONE FACT (sheet 11.6). The rail's row and the
         board's card are two places saying the same thing, and this is the
         assertion that they are in fact the same thing rather than two clocks
         that happen to agree at the moment somebody looked. */
      /* ONE READ: the clock may move between two. */
      const got = await page.evaluate(([root, hopId, nodeId, selAttr]) => {
        const el = document.querySelector(`[data-testid="${root}"]`);
        const rows = [...document.querySelectorAll(`[data-testid="${hopId}"]`)];
        return {
          playing: rows.filter((r) => r.getAttribute('data-playing') === 'true').map((r) => ({ from: r.getAttribute('data-from'), to: r.getAttribute('data-to') })),
          index: rows.findIndex((r) => r.getAttribute('data-playing') === 'true'),
          boardHop: el.getAttribute('data-flow-hop'),
          how: el.getAttribute('data-flow-how'),
          focused: [...document.querySelectorAll(`[data-testid="${nodeId}"][${selAttr}="true"]`)].map((n) => n.getAttribute('data-node-id')),
        };
      }, [BOARD.root, RAIL.hop, BOARD.node, BOARD.selectedAttr]);
      is(got.playing.length, 1, 'hop rows marked playing');
      is(String(got.index), got.boardHop, 'the rail’s playing row against the board’s hop index');

      /* AND THE BOARD'S ANSWER IS ABOUT THAT HOP'S OWN NODES. Where the board
         could place the hop directly, the card it focused IS the hop's
         destination — not a node that merely happens to be lit. */
      if (got.how === 'direct') {
        is(got.focused[0], got.playing[0].to, 'the focused card against the hop’s destination');
      }
    });

    /* ── 3. SCRUBBING IS THE READER'S HAND ON THE SAME STATE ────────────── */

    await check('scrubbing back moves the board back, and stops the clock', async () => {
      await page.locator(sel(RAIL.scrub)).fill('0');
      await settle(page);
      is(
        await page.locator(sel(BOARD.root)).getAttribute(BOARD.flowHopAttr),
        '0',
        'the hop after scrubbing to the start',
      );
      /* "Scrubbing PAUSES, because moving the playhead by hand and then having
         it run away from you is the interaction being fought rather than
         driven." The clock must therefore NOT advance it again. */
      await page.waitForTimeout(1200);
      is(
        await page.locator(sel(BOARD.root)).getAttribute(BOARD.flowHopAttr),
        '0',
        'the hop 1.2s after a scrub, with playback paused',
      );
    });

    /* ── 4. CLEARING GIVES THE BOARD BACK ──────────────────────────────── */

    await check('clearing the flow returns the board to the reader', async () => {
      await page.locator(sel(RAIL.clear)).click();
      await settle(page);

      is(await page.locator(sel(RAIL.flow)).count(), 0, 'flow panels after Clear');
      is(
        await page.locator(`${sel(BOARD.node)}[${BOARD.dimmedAttr}="true"]`).count(),
        0,
        'receded nodes after Clear',
      );
      is(
        await page.locator(`${sel(BOARD.node)}[${BOARD.selectedAttr}="true"]`).count(),
        0,
        'focused nodes after Clear',
      );
      is(await page.locator(sel(BOARD.root)).getAttribute(BOARD.viewAttr), 'S1', 'the canvas state after Clear');
      is(await page.locator(sel(BOARD.flowNote)).count(), 0, 'flow notes after Clear');
    });

    /* ── 5. NOTHING BROKE ON THE WAY ───────────────────────────────────── */

    await check('no console error the routes did not ask for', async () => {
      const unexplained = consoleErrors.filter(
        (line) => !isRefusedLine(line, REFUSED),
      );
      is(unexplained.length, 0, `unexplained console errors: ${unexplained.join(' | ')}`);
    });
  },
  { routes: ROUTES },
);
