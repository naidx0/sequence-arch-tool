import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   ANATOMY, REACHED — the view opened in a real browser, on the real repository
   packages/web2/e2e/anatomy-reached.mjs

   BUILT BUT NOT REACHED IS THIS REPOSITORY'S DOMINANT FAILURE MODE, and until
   this file existed the Anatomy view was an instance of it. `anatomy.ts`,
   `anatomyLocks`, `anatomyRendered`, `cardPainted` and `anatomyBucketDeclared`
   are all jsdom, and JSDOM PAINTS NOTHING: `getBoundingClientRect` answers
   zeroes and no stylesheet is applied. So every claim made about this view —
   including the cell geometry measured in
   `docs/research/repo-on-the-board-2026-09-09.md`, which came out of
   `squarifyAnatomy` rather than off a screen — was arithmetic. NOTHING HAD EVER
   OPENED IT. A grep of this directory for "anatomy" returned no file.

   ── WHAT THIS ASKS THAT NO EXISTING TEST CAN ──────────────────────────────

     1  IS IT REACHABLE. Right-click a real card, click the real menu item, and
        see whether a panel appears. That is the whole of "built but not
        reached" and no unit test can answer it, because a unit test renders the
        component directly and skips the gesture that is supposed to produce it.
     2  DOES THE PAINT AGREE WITH THE MODEL. `anatomyRendered`'s own header says
        its checks assert the DECLARED box. This one measures the PAINTED box,
        which is where a 129px object inside a card that reserved 129px either
        fits or does not.
     3  DOES ANY CELL ESCAPE THE WALL. The treemap's contract is that its
        rectangles tile their frame. Real layout, real rounding, real CSS.
     4  IS THE AGGREGATE DECLARED. The loose-file bucket is the one cell whose
        subject is not in the scan; on this repository its name does not fit, so
        a sentence has to say what it holds. Shipped in `685cca21` against
        jsdom — this is the first time it is read off a browser.

   ── WHY THE REAL REPOSITORY AND NOT A FIXTURE ─────────────────────────────

   CLAUDE.md: "Fixture scale proves logic; only a REAL repo proves the result."
   Every fixture in this package is 3-10 files, where a treemap cannot produce a
   sub-pixel cell and a bucket cannot fail to fit its name. Both of those are
   facts about `analyzer`'s 291 children, so a fixture cannot see either. This
   scans the monorepo it is running inside.

   ── WHAT IT DOES NOT CLAIM ────────────────────────────────────────────────

   It does not claim the view is BEAUTIFUL, or that a stranger learns the
   repository from it. It asserts the view is reachable, grounded, contained and
   honest about its aggregate. The screenshot it writes is for a human to answer
   the rest, which is the third gate's question and not a number.
   ══════════════════════════════════════════════════════════════════════════ */

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
const SHOTS = path.join(WEB2, 'tmp-shots', 'anatomy');

function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[anatomy-reached] ERROR: the analyzer is not built, so there is nothing to scan');
    process.exit(2);
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anatomy-e2e-')), 'graph.json');
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      cwd: REPO,
      stdio: 'pipe',
    });
  } catch (error) {
    console.error('[anatomy-reached] ERROR: sequence scan failed —', error.message);
    process.exit(2);
  }
  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));

  /*
   * THE PRECONDITION, CHECKED RATHER THAN ASSUMED. Anatomy draws a node's
   * CHILDREN. If nothing in this scan has children, then an empty panel is the
   * correct panel and every assertion below would be asserting a falsehood —
   * a harness problem, and it exits 2 saying so rather than reporting a pass.
   */
  const parents = new Set(graph.nodes.map((n) => n.parentId).filter(Boolean));
  /*
   * ORDERED BY CHILD COUNT, DESCENDING, AND THAT ORDER IS THE POINT.
   *
   * The first version took whichever card the DOM offered first and opened
   * `svc:acp` — 7 files, the smallest service in the repository. Eight checks
   * passed and reported nothing about depth. But every fact this file exists to
   * test is a fact about SCALE: a sub-pixel cell, a bucket whose name does not
   * fit, a treemap that has to tile 291 children. A pass on the smallest node in
   * the repository is not evidence about any of them.
   *
   * A count that does not say how deep it looked is not a size, so the target is
   * chosen deliberately — the widest container first — and the suite logs which
   * node it opened and how many children that node has.
   */
  const kidCount = new Map();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    kidCount.set(n.parentId, (kidCount.get(n.parentId) ?? 0) + 1);
  }
  const withKids = graph.nodes
    .filter((n) => n.kind === 'service' && parents.has(n.id))
    .sort((a, b) => (kidCount.get(b.id) ?? 0) - (kidCount.get(a.id) ?? 0));
  if (withKids.length === 0) {
    console.error(
      `[anatomy-reached] ERROR: the scan of ${graph.repoName} produced no service with children, ` +
        'so there is nothing this spec could honestly open an anatomy on',
    );
    process.exit(2);
  }
  return { graph, withKids, kidCount };
}

const { graph, withKids, kidCount } = scanRealRepo();
/* By KIND, never by the literal "repo": the id is the scanner's spelling and a
   spelling is not a contract. */
const repoId = graph.nodes.find((n) => n.kind === 'repo')?.id ?? null;
const kids = (id) => kidCount.get(id) ?? 0;
/**
 * EVERY PLATFORM ROUTE THIS ORIGIN DOES NOT SERVE, DERIVED FROM THE CLIENT.
 *
 * A static graph host has no engine behind it, and the existing rule is written
 * where the routes were first listed: answered 404 "rather than left to the SPA
 * fallback, because 'this origin has no engine' is a fact and index.html-with-a-
 * 200 is a file host pretending otherwise."
 *
 * THE LIST WAS HAND-WRITTEN AND MISSED ONE, WHICH REACHED A SCREENSHOT. It named
 * four routes; `/api/sessions` was not among them, so the sessions rail's request
 * fell through to the SPA fallback and got index.html with a 200. `sessionsClient`
 * then reported exactly what it saw — "the server did not answer with JSON (200)"
 * — and the seat capture went out with a red error on the first screen of the
 * product. THE REAL SERVER IS FINE: probed on the running app, `/api/sessions`
 * answers 200 `application/json` with a valid index. The error was this harness
 * pretending to be an engine, and the picture told a truth about the host that
 * read as a defect in the product.
 *
 * SO THE SET IS DERIVED, not listed. Every `/api/...` literal in the client
 * source is a route this origin may be asked for; a route added tomorrow is
 * refused without anyone remembering this file. A hand-written list cannot fail
 * for a route nobody added to it.
 */
function refusedRoutes() {
  const roots = [path.join(WEB2, 'src')];
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/['\`](\/api\/[a-z0-9\-\/]*)['\`]/gi)) {
          found.add(m[1].replace(/\/+$/, ''));
        }
      }
    }
  };
  for (const r of roots) walk(r);
  return [...found].filter((r) => r !== '/api');
}

const REFUSED = refusedRoutes();
if (REFUSED.length < 4) {
  console.error(
    `[anatomy-reached] ERROR: derived only ${REFUSED.length} platform routes from the client ` +
      'source, so the refusal set is almost certainly broken rather than small',
  );
  process.exit(2);
}

await suite(
  'anatomy-reached',
  async ({ page, base, check, consoleErrors, log }) => {
    log(
      `scanned ${graph.repoName}: ${graph.nodes.length} nodes, ` +
        `${withKids.length} services with children`,
    );
    fs.mkdirSync(SHOTS, { recursive: true });

    await page.goto(base, { waitUntil: 'load' });
    await settle(page);

    /* THE SHELL OPENS TO CHAT ALONE. The board is asked for the way a reader
       asks for it, or every assertion below is about an absence. */
    await page.getByTestId('workspace-tab-architecture').click();
    await settle(page);

    await check('the board drew cards from the real scan', async () => {
      atLeast(await page.locator(sel(BOARD.node)).count(), 1, 'board cards on screen');
    });

    /* ── THE GESTURE, WHICH IS THE POINT ────────────────────────────────────
       Right-click sets the menu target (`ConnectedBoard`'s `onMenu`), and the
       menu item is a real button. A unit test that renders `AnatomyPanel`
       directly proves the panel can paint; it cannot prove anyone can GET
       there, and "cannot be found" fails the third gate however well it
       renders. */
    let opened = null;
    await check('right-click then Anatomy actually opens a panel', async () => {
      /* WIDEST FIRST, so a pass is evidence about the case that can fail. */
      for (const target of withKids) {
        const card = page.locator(`${sel(BOARD.node)}[${BOARD.nodeIdAttr}="${target.id}"]`);
        if ((await card.count()) === 0) continue;
        const id = target.id;
        await card.first().click({ button: 'right' });
        await settle(page);
        const item = page.locator(sel('board-menu-anatomy'));
        if ((await item.count()) === 0) {
          await page.keyboard.press('Escape');
          continue;
        }
        await item.click();
        await settle(page);
        if ((await page.locator(sel('board-node-anatomy')).count()) > 0) {
          opened = id;
          break;
        }
      }
      is(opened !== null, true, 'an anatomy panel opened from the menu on a real scanned node');
    });

    /* THE DEPTH, BESIDE THE VERDICT. "8 checks passed" on the smallest service in
       the repository is a different fact from the same words on the widest. */
    if (opened) {
      log(
        `opened the anatomy of ${opened} — ${kids(opened)} direct children ` +
          `(widest in this scan: ${withKids[0].id} with ${kids(withKids[0].id)})`,
      );
    }

    await check('the map is drawn, with cells', async () => {
      atLeast(await page.locator(sel('board-node-anatomy-map')).count(), 1, 'anatomy maps');
      atLeast(await page.locator('[data-cell-id]').count(), 1, 'cells in the map');
    });

    await check('every cell is a node the scan produced, or the one declared aggregate', async () => {
      /* GROUNDED, NOT GUESSED. A cell id that is neither in the scan nor the
         synthetic bucket is a fabricated child, which is the one thing this
         product may never draw. */
      const real = new Set(graph.nodes.map((n) => n.id));
      const ids = await page.locator('[data-cell-id]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-cell-id')),
      );
      const invented = ids.filter((id) => !real.has(id) && !id.startsWith('anatomy:files:'));
      is(invented.join(', '), '', 'cell ids that the scan never produced');
    });

    await check('NO CELL ESCAPES THE WALL — measured on the painted box', async () => {
      /* THE CHECK JSDOM STRUCTURALLY CANNOT MAKE. `getBoundingClientRect`
         answers zeroes there, so the treemap's tiling contract has only ever
         been verified against the numbers the treemap itself returned. Here it
         is read off real layout, with real rounding and real CSS. One pixel of
         slack absorbs subpixel rounding and nothing else. */
      const escaped = await page.evaluate(() => {
        const map = document.querySelector('[data-testid="board-node-anatomy-map"]');
        if (!map) return ['no map'];
        const frame = map.getBoundingClientRect();
        const out = [];
        for (const cell of document.querySelectorAll('[data-cell-id] rect')) {
          const r = cell.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (
            r.left < frame.left - 1 ||
            r.top < frame.top - 1 ||
            r.right > frame.right + 1 ||
            r.bottom > frame.bottom + 1
          ) {
            out.push(cell.parentElement?.getAttribute('data-cell-id') ?? '?');
          }
        }
        return out;
      });
      is(escaped.join(', '), '', 'cells painted outside the anatomy map');
    });

    await check('the panel stays inside the card that opened it', async () => {
      /* THE RESERVATION, PAINTED. `cardBox` reserves the wall's height before
         it renders, and a boolean there once under-reserved by 42 units. Every
         existing check asserts the DECLARED box; this one asserts the painted
         panel is inside the painted card. */
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="board-node-anatomy"]');
        if (!panel) return 'no panel';
        const card = panel.closest('[data-testid="board-node"]');
        if (!card) return 'panel is not inside a card';
        const p = panel.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return p.bottom > c.bottom + 1 || p.right > c.right + 1
          ? `panel ${Math.round(p.right)}x${Math.round(p.bottom)} vs card ${Math.round(c.right)}x${Math.round(c.bottom)}`
          : '';
      });
      is(overflow, '', 'the anatomy panel overflowing its own card');
    });

    await check('an aggregate cell that cannot carry its name says what it holds', async () => {
      /* WHAT THE VIEW DROPS, SAID OUT LOUD — and read off a browser for the
         first time. The bucket stands for N real children and is built with
         `kind: 'file'`, so an unnamed one reads as a single file. Where it has
         no rendered name the panel owes a sentence; where its name renders the
         cell already says it and a sentence would be §3's duplication.
         EITHER OUTCOME IS A PASS — what is forbidden is an unnamed aggregate
         with nothing anywhere saying so. */
      const state = await page.evaluate(() => {
        const bucket = document.querySelector('[data-cell-id^="anatomy:files:"]');
        if (!bucket) return { bucket: false };
        return {
          bucket: true,
          named: bucket.querySelector('text.ana-label') !== null,
          note: document.querySelector('[data-testid="board-node-anatomy-bucket"]') !== null,
          title: (bucket.querySelector('title')?.textContent ?? '').includes('loose files'),
        };
      });
      if (!state.bucket) {
        /* Honest about coverage rather than silently passing: this node had no
           bucket, so this assertion examined nothing. */
        is(true, true, 'no aggregate on this panel, so nothing to declare');
        return;
      }
      is(state.title, true, 'the aggregate names itself in its title');
      is(
        state.named || state.note,
        true,
        'an aggregate must carry its name or be declared in a note',
      );
    });

    await check('the view opened without a console error', async () => {
      const unexpected = consoleErrors.filter(
        (line) => !REFUSED.some((route) => line.includes(route)),
      );
      is(unexpected.join(' | '), '', 'console errors while opening the anatomy');
    });

    await check('THE PAINTED SIZE IS REPORTED, not just the containment', async () => {
      /*
       * CONTAINED IS TRUE AND NOT ENOUGH. The checks above prove the map fits
       * its card and no cell escapes — all true at any scale, including a scale
       * nobody can read. The board opens at its Fit zoom, so the 129px map is
       * multiplied by whatever that zoom is, and the reader meets the product of
       * the two rather than the model's number.
       *
       * REPORTED, NOT ASSERTED AGAINST AN INVENTED FLOOR. Graphite law 4 is
       * never invent a number, and "the smallest readable treemap" is not in the
       * book. What is in the book is --t-10: the smallest type Graphite defines.
       * So this states the painted map size, the effective scale, and what
       * --t-10 becomes at that scale — and the margin against the book's own
       * floor. A verdict without its margin is the fault this lane spent the
       * evening on.
       */
      const m = await page.evaluate(() => {
        const map = document.querySelector('[data-testid="board-node-anatomy-map"]');
        if (!map) return null;
        const r = map.getBoundingClientRect();
        const declared = Number(map.getAttribute('width')) || 0;
        const label = document.querySelector('text.ana-label');
        const labelPx = label ? parseFloat(getComputedStyle(label).fontSize) : null;
        return { painted: r.width, declared, labelPx };
      });
      is(m !== null, true, 'the anatomy map is on screen to measure');
      const scale = m.declared > 0 ? m.painted / m.declared : 0;
      const paintedLabel = m.labelPx === null ? null : m.labelPx * scale;
      log(
        `painted map ${m.painted.toFixed(1)}px for a declared ${m.declared}px ` +
          `(scale ${(scale * 100).toFixed(0)}%)`,
      );
      log(
        paintedLabel === null
          ? '  no cell label is painted at this zoom at all'
          : `  --t-10 lands at ${paintedLabel.toFixed(2)}px on screen — ` +
            `${(10 - paintedLabel).toFixed(2)}px under the book's smallest type`,
      );
      /* The one thing that IS assertable without inventing a number: the map
         must actually occupy space. A zero-size map is drawn and unreachable. */
      is(m.painted > 0, true, 'the anatomy map occupies painted space');
    });

    await check('THE DOOR: the whole repository opens from the board furniture', async () => {
      /*
       * THE REACHABILITY CHECK THIS FILE EXISTS FOR, one level up. The panel
       * for the repo node has always computed correctly — 10 cells partitioning
       * 275,837 lines — and NOTHING COULD OPEN IT: anatomy paints into a card's
       * slot and the board never draws the repository. A door was added to the
       * furniture; this proves a reader can walk through it, which no unit test
       * can, because a unit test renders the view directly and skips the walk.
       */
      await page.keyboard.press('Escape');
      await settle(page);
      const door = page.locator(sel('board-repo-anatomy'));
      is(await door.count(), 1, 'the door is in the board furniture');
      await door.click();
      await settle(page);
      is(await page.locator(sel('board-repo-anatomy-view')).count(), 1, 'the view opened');

      /* GROUNDED: one cell per top-level part the scan produced, and the header
         states the same set the cells draw. */
      const seen = await page.locator(sel('board-repo-anatomy-view')).evaluate((el) => ({
        cells: el.querySelectorAll('[data-cell-id]').length,
        head: el.querySelector('.pb-count')?.textContent ?? '',
        styled: getComputedStyle(el).position,
      }));
      const roots = graph.nodes.filter((n) => n.parentId === repoId).length;
      is(seen.cells, roots, `cells drawn for the ${roots} parts the scan put under the repository`);
      log(`repo anatomy header reads: ${seen.head}`);

      /* STYLED, NOT MERELY PRESENT. Its rules are a compound selector on this
         element and the panel's are `.board-scope .node .ana-*`; either missing
         renders a live, correct, invisible treemap. */
      is(seen.styled, 'absolute', 'the view is positioned by its own stylesheet rule');
      const painted = await page
        .locator(`${sel('board-repo-anatomy-view')} [data-testid="board-node-anatomy-map"]`)
        .evaluate((el) => Math.round(el.getBoundingClientRect().width));
      log(`repo map painted at ${painted}px`);
      atLeast(painted, 200, 'the root view draws the map large enough to read');

      /* EVERY PART NAMED — the question the root view exists to answer.
         Seven of ten cells cannot carry their own name (ink is 0.2% of this
         repository), and neither refused fix is used: no ellipsis, no hue. The
         parts are listed instead. This asserts the LIST names every cell the
         map draws, so "named" is checked rather than assumed. */
      const naming = await page.locator(sel('board-repo-anatomy-view')).evaluate((el) => {
        const cells = [...el.querySelectorAll('[data-cell-id]')].map((c) =>
          c.getAttribute('data-cell-id'),
        );
        const listed = [...el.querySelectorAll('[data-part-id]')].map((c) =>
          c.getAttribute('data-part-id'),
        );
        const inCell = [...el.querySelectorAll('text.ana-label')].map((t) => t.textContent);
        return { cells, listed, drawnLabels: inCell.length };
      });
      const unnamed = naming.cells.filter((id) => !naming.listed.includes(id));
      is(unnamed.join(', '), '', 'root cells with no name anywhere in the view');
      log(
        `root parts: ${naming.cells.length} cells · ${naming.drawnLabels} carry a label in the map · ` +
          `${naming.listed.length} named in the list`,
      );

      /* THE PICTURE MAX ASKED FOR, written from the door rather than from a
         fixture harness: the whole repository, every package at its true share
         of the lines, reached the way a reader reaches it. */
      await page.screenshot({ path: path.join(SHOTS, 'repo-anatomy-through-the-door.png') });
      log(`screenshot: ${path.relative(REPO, path.join(SHOTS, 'repo-anatomy-through-the-door.png'))}`);
    });

    await check('THE WAY BACK, and it is one step', async () => {
      /* A view you can enter and not leave is a trap — the interior bar's own
         words. Both exits are checked because both are offered. */
      await page.locator(sel('board-repo-anatomy-close')).click();
      await settle(page);
      is(await page.locator(sel('board-repo-anatomy-view')).count(), 0, 'Back returned to the board');
      atLeast(await page.locator(sel(BOARD.node)).count(), 1, 'the board is on screen again');

      await page.locator(sel('board-repo-anatomy')).click();
      await settle(page);
      is(await page.locator(sel('board-repo-anatomy-view')).count(), 1, 'it reopens');
      await page.keyboard.press('Escape');
      await settle(page);
      is(await page.locator(sel('board-repo-anatomy-view')).count(), 0, 'Escape closes it too');
    });

    /* THE ARTEFACT A HUMAN JUDGES. The third gate is scored as the user, and no
       assertion above can answer "does an engineer learn this repository's
       shape from this picture". The file is written so that question can be
       asked of something real. */
    const shot = path.join(SHOTS, 'anatomy-real-repo.png');
    await page.screenshot({ path: shot });
    log(`screenshot: ${path.relative(REPO, shot)}`);
  },
  {
    routes: {
      '/archgraph.json': graph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
