/* ══════════════════════════════════════════════════════════════════════════
   NOTHING THE BOARD DRAWS SITS ON TOP OF ANYTHING ELSE IT DRAWS
   packages/web2/e2e/board-furniture.mjs

   Reported from a screenshot of the interior view: "a messed-up design on top
   of the file". The kind legend was the largest offender and is fixed - it now
   collapses rather than wrapping across the cards - but the screenshot showed
   two more collisions in the same corner, and neither had anything measuring
   it:

     - `Back to the system` overlapping the board note;
     - cards running off the right edge with nothing to say there is more.

   THE REASON THERE WAS NO TEST. Every piece of board furniture is absolutely
   positioned in a corner and knows nothing about its neighbours: the note is
   top-left, the interior bar is top-centre, the legend is bottom-left, the zoom
   cluster is bottom-right. Each is correct alone. They collide when the board
   is narrower than the sum of two of them, and NO unit test can see that,
   because jsdom has no layout - `getBoundingClientRect` answers zeroes and
   every overlap check passes vacuously.

   This is the legibility argument the release gate already makes, applied to
   one surface: "three rounds shipped green while the app was visibly broken".

   ── WHAT IT ASSERTS ──────────────────────────────────────────────────────

   Not an arrangement - that would lock today's corners in and forbid a better
   layout. The INVARIANTS are that no two furniture boxes intersect, and that
   none of them hangs outside the board that owns them.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD } from './lib/anchors.mjs';
import { atLeast, is, resize, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/** Exit 2, never 1: "the analyzer is not built" is the harness unable to run. */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[board-furniture] ERROR: the analyzer is not built, nothing to scan');
    console.error('[board-furniture] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'web2-board-furniture-')),
    'archgraph.json',
  );
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[board-furniture] ERROR: sequence scan failed:', error.message);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const graph = scanRealRepo();

/**
 * Every visible piece of furniture, with its box.
 *
 * Read from the DOM rather than from a list written here, so a piece added
 * later is measured without anyone remembering to add it — the failure mode
 * this whole file exists to catch is one nobody thought to check.
 */
const FURNITURE = `() => {
  const board = document.querySelector('[data-testid="board"]');
  if (!board) return { checked: false };
  const b = board.getBoundingClientRect();
  /*
   * QUERIED FROM THE DOCUMENT, not from the board element. The interior bar is
   * a SIBLING of <Board/> rather than a child of it - ConnectedBoard renders it
   * after the board - so scoping to the board measured everything except the
   * one piece the screenshot was about. That structure is also why it can
   * collide unpredictably: it is positioned against a different box from the
   * furniture it shares a corner with.
   *
   * Only one canvas is mounted at a time, so the document is an honest scope
   * here rather than a lazy one.
   */
  const scope = document;
  const sel = '.boardnote, .interiorbar, .kindlegend, .zoomcluster, .proposalbar, .inknote';
  const items = [];
  for (const el of scope.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    items.push({
      what: el.getAttribute('data-testid') || (el.className || el.tagName).toString().split(' ').pop(),
      left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
    });
  }
  return {
    checked: true,
    board: { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom) },
    items,
  };
}`;

/* Compared as JOINED STRINGS, not as arrays. The harness's `is` is Object.is,
   so two arrays are never equal - including two empty ones - and the first
   version of this file reported three collisions that did not exist. A test
   that fails when nothing is wrong is worse than no test: it teaches the reader
   to ignore it. */
const overlaps = (a, z) =>
  !(a.right <= z.left || a.left >= z.right || a.bottom <= z.top || a.top >= z.bottom);

function collisions(items) {
  const bad = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (overlaps(items[i], items[j])) bad.push(`${items[i].what} × ${items[j].what}`);
    }
  }
  return bad;
}

/** Hanging outside the board is the same defect seen from the other side. */
function escaping(items, board) {
  return items
    .filter((i) => i.left < board.left - 1 || i.right > board.right + 1 || i.bottom > board.bottom + 1)
    .map((i) => `${i.what} [${i.left}..${i.right}]`);
}

const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

await suite(
  'board-furniture',
  async ({ page, base, check }) => {
    await page.goto(base, { waitUntil: 'load' });
    /* Tab-layout shell: the board mounts behind the Architecture tab. */
    await page.getByTestId('workspace-tab-architecture').click();
    await page.waitForSelector(sel(BOARD.node), { timeout: 20000 });
    await settle(page);

    const read = () => page.evaluate(`(${FURNITURE})()`);

    await check('THE PRECONDITION: there is furniture to measure', async () => {
      const seen = await read();
      is(seen.checked, true, 'the board was found');
      /*
       * Checked, not assumed. With no furniture on screen every collision test
       * below passes against an empty list, which is the vacuity this
       * repository keeps paying for.
       */
      atLeast(seen.items.length, 2, 'at least two pieces of furniture are drawn');
    });

    await check('NOTHING OVERLAPS ANYTHING, on a wide board', async () => {
      const seen = await read();
      is(collisions(seen.items).join(' | '), '', 'furniture must not intersect');
    });

    await check('and nothing hangs outside the board that owns it', async () => {
      const seen = await read();
      is(escaping(seen.items, seen.board).join(' | '), '', 'furniture must stay inside the board');
    });

    await check('the furniture row sits in the BOTTOM half (sheet 05.6 corner)', async () => {
      /* Locks the corner, not just the geometry: wrap-reverse inverts the flex
         cross axis, and the default align-content once moved the whole row to
         the TOP of the board, drawn over the first card row — caught by the
         P1 screenshot audit while every intersection check stayed green. */
      const mid = await page.evaluate(() => {
        const board = document.querySelector('[data-testid="board"]').getBoundingClientRect();
        const furn = document.querySelector('.boardfurniture');
        const rows = [...furn.children].filter((el) => el.getBoundingClientRect().height > 0);
        const tops = rows.map((el) => el.getBoundingClientRect().top);
        return { boardMid: board.top + board.height / 2, minTop: Math.min(...tops) };
      });
      is(mid.minTop > mid.boardMid, true, `furniture starts at ${Math.round(mid.minTop)}, board midline ${Math.round(mid.boardMid)}`);
    });

    await check('AND INSIDE A SERVICE — the view that was actually photographed', async () => {
      /*
       * THE GAP IN THE FIRST VERSION OF THIS FILE. `.interiorbar` only exists
       * once a service is opened, so measuring the top-level board and calling
       * the reported view covered was exactly the vacuity this suite exists to
       * catch — the precondition passed on note + legend + cluster while the
       * bar the screenshot showed was not on screen at all.
       */
      await page.dblclick(sel(BOARD.node));
      await settle(page);

      const inside = await page.locator('[data-testid="board-interior"]').count();
      if (inside === 0) {
        /* Not every scan has a service with children to open. Say so rather
           than pass: a skip that reads as a check is the thing this repository
           keeps paying for. */
        is(inside, 0, 'no service on this scan had an interior to open — nothing was measured');
        return;
      }

      const seen = await read();
      const names = seen.items.map((i) => i.what).join(', ');
      is(
        names.includes('board-interior'),
        true,
        `the interior bar must be among the measured furniture — saw: ${names}`,
      );
      is(collisions(seen.items).join(' | '), '', 'furniture must not intersect inside a service');
      is(
        escaping(seen.items, seen.board).join(' | '),
        '',
        'furniture must stay inside the board inside a service',
      );
    });

    await check('NOR ON A NARROW BOARD, which is where it was reported', async () => {
      /*
       * The reported screenshot was a window about 640 wide. Each corner is
       * correct alone; they collide when the board is narrower than the sum of
       * two of them, and that is a width nothing was testing.
       */
      await resize(page, 720, 800);
      const seen = await read();
      is(collisions(seen.items).join(' | '), '', 'furniture must not intersect at 720');
      is(escaping(seen.items, seen.board).join(' | '), '', 'furniture must stay inside the board at 720');
    });
  },
  {
    routes: {
      '/archgraph.json': graph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
