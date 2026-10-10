import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COMMAND, NOT_YET, RAIL, REVIEW, SHELL } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   THE PANES ARE MOUNTED IN THE SHIPPED BUNDLE — the Waves 4+5 closing lock.
   packages/web2/e2e/app-mounted.mjs

   WHAT THIS EXISTS BECAUSE OF, and it is not a hypothetical.

   Wave 2 built a whole three-pane shell that the served app never rendered,
   because `App.tsx` still returned the Wave 0 smoke surface. Seven lane
   reports missed it. The Wave 3 gate found it by counting `board-node` in the
   BUILT BUNDLE and getting zero. Waves 4 and 5 have the identical shape: two
   lanes shipped a rail and a review surface with 81 and 111 green tests
   between them, and neither lane was allowed to edit the one file that decides
   whether a user can reach either. A test that renders `<IndexRail>` directly
   answers "does this component work". Only this file answers "can a person who
   opens the app see it", which is the question the last three waves got wrong.

   SO EVERY CHECK BELOW IS PHRASED AGAINST THE USER'S SEAT:
     · the rail pane the frame draws holds the RAIL, not the not-yet panel
     · its rows carry ids the real scan produced — a fabricated row is a defect
       here even though every row would render
     · a click on a row does something a person can see
     · review can be REACHED — by keyboard, through the shell's own surface,
       with no test hook — and when reached it shows a real diff

   WHAT THE SERVER IS. `serveDist` with a route table in front of it, and every
   byte in that table is produced here, now, by a real program:

     /archgraph.json    a real `sequence scan` of this monorepo
     /api/functions     the engine's own `.sequence/functions.json` — the same
                        file the route serves in production
     /api/git/status    a real `git status --porcelain` of a throwaway repo
     /api/git/diff      that repo's real `git diff --no-color HEAD`

   The throwaway repo is built rather than the monorepo used, for one reason:
   this suite must assert exact line numbers off git's own hunk header, and the
   monorepo's working tree is different on every machine and every minute. A
   fixture diff would prove the parser and not the wiring; a real `git diff` of
   a repo made two lines ago proves both and is deterministic.
   ══════════════════════════════════════════════════════════════════════════ */

/** The repository this runs against: the monorepo itself. */
const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

function harnessFailure(message, remedy) {
  console.error(`[app-mounted] ERROR: ${message}`);
  if (remedy) console.error(`[app-mounted] run: ${remedy}`);
  process.exit(2);
}

/**
 * Scan the real repository. Exit 2 on any failure — "the analyzer is not
 * built" is the harness unable to run, and reporting it as "the rail is
 * broken" is how a green suite and a red suite both stop meaning anything.
 */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    harnessFailure(
      'the analyzer is not built, so there is nothing to scan',
      'pnpm --filter @sequence/analyzer build',
    );
  }

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-app-e2e-')), 'archgraph.json');
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    harnessFailure(`sequence scan failed — ${error.message}`);
  }

  const graph = JSON.parse(fs.readFileSync(out, 'utf8'));

  /* The precondition, checked rather than assumed. The rail's first rung IS
     the board card, so a scan with no drawable node makes an empty rail
     CORRECT and every assertion below a falsehood. */
  const drawable = graph.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic',
  );
  if (drawable.length === 0) {
    harnessFailure(
      `the scan of ${graph.repoName} produced no service, datastore or topic node, so there is ` +
        'nothing this spec could honestly expect in the rail',
    );
  }
  return { graph, drawable };
}

/**
 * A throwaway git repository with exactly ONE modified file.
 *
 * EXACTLY ONE, because `serveDist`'s route table keys on pathname and
 * `/api/git/diff?path=…` is one key: a second dirty file would be handed the
 * first one's diff and the suite would be asserting against a lie it wrote
 * itself. `ReviewPane` fetches the diff per file because the route is per
 * file, so one file is also the only shape this server can serve honestly.
 */
function throwawayRepoDiff() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web2-review-e2e-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  try {
    git('init', '--quiet');
    git('config', 'user.email', 'e2e@sequence.local');
    git('config', 'user.name', 'sequence e2e');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const file = path.join(dir, 'src', 'token.ts');
    fs.writeFileSync(file, 'export const A = 1;\nexport const B = 2;\nexport const C = 3;\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'seed');

    fs.writeFileSync(file, 'export const A = 1;\nexport const B = 22;\nexport const C = 3;\n');

    const diff = git('diff', '--no-color', 'HEAD', '--', 'src/token.ts');
    const porcelain = git('status', '--porcelain');
    if (diff.trim() === '') harnessFailure('git produced an empty diff for a file it just changed');
    if (!porcelain.includes('src/token.ts')) {
      harnessFailure(`git status did not name the changed file — got ${JSON.stringify(porcelain)}`);
    }
    return { dir, diff };
  } catch (error) {
    harnessFailure(`could not build a throwaway git repository — ${error.message}`);
    return null;
  }
}

/**
 * The engine's own function index for this repository, from its own cache.
 *
 * `.sequence/functions.json` is what `GET /api/functions` serves — the same
 * file, written by `buildRepoFunctionGraphCached`. It is gitignored, so a
 * machine that has never scanned has none, and that is exit 2 with the command
 * to run: "this machine has not scanned" is the harness unable to run, not the
 * rail being wrong.
 */
function readFunctionIndex() {
  const cache = path.join(REPO, '.sequence', 'functions.json');
  if (!fs.existsSync(cache)) {
    harnessFailure(
      `the engine's function cache is missing at ${cache}, so there is nothing to serve on ` +
        '/api/functions',
      'sequence scan',
    );
  }
  const file = JSON.parse(fs.readFileSync(cache, 'utf8'));
  if (!file.functionGraph) harnessFailure(`${cache} carries no functionGraph`);
  return { functionGraph: file.functionGraph, warnings: file.warnings ?? [] };
}

const { graph, drawable } = scanRealRepo();
const review = throwawayRepoDiff();
const functions = readFunctionIndex();

/** file path (forward-slashed) → how many functions the engine names in it. */
const FUNCTIONS_BY_FILE = new Map();
for (const node of functions.functionGraph.nodes) {
  const file = String(node.file ?? '').split(String.fromCharCode(92)).join('/');
  FUNCTIONS_BY_FILE.set(file, (FUNCTIONS_BY_FILE.get(file) ?? 0) + 1);
}

/** Every id the scan produced. A `data-row-id` on a card rung that is not in
 *  here is a row the rail invented. */
const REAL_IDS = new Set(graph.nodes.map((n) => n.id));

/** The path git itself named. Nothing below hard-codes it twice. */
const CHANGED = 'src/token.ts';

/** The routes this origin answers, and the ones it refuses. Every body is one
 *  a real program produced; nothing here is hand-written. */
const ROUTES = {
  '/archgraph.json': graph,
  '/api/functions': functions,
  '/api/git/status': { branch: 'main', files: [{ path: CHANGED, status: 'modified' }] },
  '/api/git/diff': { path: CHANGED, diff: review.diff },
  '/api/status': null,
  '/api/recent': null,
  '/api/browse': null,
  '/api/attach': null,
};

const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

/** Open the command surface the way a user does, and run the row whose label
 *  contains `needle`. No test hook, no dispatch: the keystroke and the click. */
async function runCommand(page, needle) {
  await page.keyboard.press('Control+k');
  await page.locator(sel(COMMAND.root)).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator(sel(COMMAND.field)).fill(needle);
  await settle(page);
  const row = page.locator(sel(COMMAND.row)).first();
  await row.waitFor({ state: 'visible', timeout: 5000 });
  const label = (await row.textContent()) ?? '';
  await row.click();
  await settle(page);
  return label;
}

await suite(
  'app-mounted',
  async ({ page, base, check, consoleErrors, log }) => {
    log(
      `scanned ${graph.repoName}: ${graph.nodes.length} nodes, ${drawable.length} drawable; ` +
        `review repo at ${review.dir}`,
    );

    await page.goto(base, { waitUntil: 'load' });
    /*
     * THE BOARD LIVES BEHIND ITS TAB NOW. The shell boots to Chat with no
     * board mounted (data-board="off") — the tab-layout shell; the reader
     * reaches the board by clicking Architecture, so the spec takes the same
     * door instead of waiting for a three-pane boot that no longer exists.
     */
    await page.getByTestId('workspace-tab-architecture').click();
    await page.getByTestId('board').waitFor({ state: 'visible', timeout: 15000 });
    await settle(page);
    /* Index starts collapsed so the board owns first glance — open it for the
       rail locks below. The RAIL pane only exists once this is pressed, so
       the click comes first and the rail wait follows it. */
    await page.getByTestId('board-index-toggle').click();
    /* The rail pane moved INTO the board region when the shell went
       tab-layout — `board-region-rail`, not the retired `shell-rail`. */
    await page.getByTestId('board-region-rail').waitFor({ state: 'visible', timeout: 15000 });
    await settle(page);

    /* ── 1. THE RAIL IS MOUNTED ─────────────────────────────────────────── */

    await check('the rail pane holds the rail, not the not-yet panel', async () => {
      is(await page.locator(sel(NOT_YET.rail)).count(), 0, 'notyet-index panels on screen');
      is(await page.locator(sel(RAIL.root)).count(), 1, 'index rails on screen');
    });

    await check('the rail is INSIDE the frame’s rail pane', async () => {
      const inside = await page.evaluate(
        ([paneId, railId]) => {
          const pane = document.querySelector(`[data-testid="${paneId}"]`);
          const rail = document.querySelector(`[data-testid="${railId}"]`);
          return Boolean(pane && rail && pane.contains(rail));
        },
        ['board-region-rail', RAIL.root],
      );
      is(inside, true, 'the rail sits inside shell-rail');
    });

    /* ── 2. THE ROWS ARE REAL ───────────────────────────────────────────── */

    await check('the rail draws a row per drawable node, and then some', async () => {
      const cards = await page.locator(`${sel(RAIL.row)}[data-rung="card"]`).count();
      is(cards, drawable.length, 'card rungs drawn');
      atLeast(await page.locator(sel(RAIL.row)).count(), drawable.length + 1, 'rail rows in total');
    });

    await check('every card rung carries an id the scan produced', async () => {
      const ids = await page.$$eval(`${sel(RAIL.row)}[data-rung="card"]`, (els) =>
        els.map((el) => el.getAttribute('data-row-id')),
      );
      /* NON-VACUOUS ON PURPOSE. `[].filter(…).length === 0` is true of a rail
         that drew nothing, and this check passed that way against the not-yet
         panel while the run was red for the right reason elsewhere. A check
         that is green when the surface is absent is not a check. */
      atLeast(ids.length, 1, 'card rungs to check ids on');
      const invented = ids.filter((id) => !REAL_IDS.has(id));
      is(invented.length, 0, `fabricated row ids (${invented.slice(0, 3).join(', ')})`);
    });

    await check('the file rung is drawn, so the index has real depth', async () => {
      atLeast(await page.locator(`${sel(RAIL.row)}[data-rung="file"]`).count(), 1, 'file rungs');
    });

    /* ── THE COUNTS ARE THE ENGINE'S — the defect the screenshot found ─────
     *
     * Mounted with no function index, `buildRailRows` derives every count from
     * the index it was not given and the rail prints `0` beside every file and
     * every card. On this repository the engine names 2,756 functions, so that
     * is five hundred rows each asserting something the scan disproves —
     * Graphite law 4 on every row, and invisible to the rail's own 81 tests
     * because every one of them is handed a real index.
     *
     * These two checks are the browser's half of that: the number a person
     * actually reads off a row is compared against the engine's own count for
     * that file, in the shipped bundle. */

    await check('file rows carry a real function count, not a zero', async () => {
      const rows = await page.$$eval(`${sel(RAIL.row)}[data-rung="file"]`, (els) =>
        els.map((el) => ({
          label: el.querySelector('.rail-name')?.textContent ?? '',
          printed: (el.textContent ?? '').trim().match(/(\d+)$/)?.[1] ?? null,
        })),
      );
      atLeast(rows.length, 1, 'file rows to read a count off');
      const nonZero = rows.filter((r) => r.printed !== null && Number(r.printed) > 0);
      atLeast(nonZero.length, 1, 'file rows printing a count above zero');

      /* Only names borne by exactly ONE path are checked. This repo has 15
         files called `index.ts` (CANON §3) and matching the first would be
         comparing a number against a different file. */
      let checked = 0;
      for (const row of rows) {
        if (row.printed === null || row.label === '') continue;
        const paths = [...FUNCTIONS_BY_FILE.keys()].filter((p) => p.endsWith(`/${row.label}`));
        if (paths.length !== 1) continue;
        is(
          Number(row.printed),
          FUNCTIONS_BY_FILE.get(paths[0]),
          `the count printed on ${row.label}`,
        );
        checked += 1;
        if (checked >= 20) break;
      }
      atLeast(checked, 5, 'unambiguous file names checked against the engine');
    });

    await check('opening a file row reveals its functions', async () => {
      is(await page.locator(`${sel(RAIL.row)}[data-rung="function"]`).count(), 0, 'function rungs before any file is opened');
      /* The FIRST file row that claims functions — opening one that claims none
         would prove nothing and would pass against the zeros. */
      const opened = await page.evaluate((rowId) => {
        const rows = [...document.querySelectorAll(`[data-testid="${rowId}"][data-rung="file"]`)];
        const row = rows.find((el) => Number((el.textContent ?? '').trim().match(/(\d+)$/)?.[1] ?? 0) > 0);
        if (!row) return null;
        row.click();
        return (row.querySelector('.rail-name')?.textContent ?? '').trim();
      }, RAIL.row);
      if (opened === null) throw new Error('no file row claimed a function to open');
      await settle(page);
      atLeast(
        await page.locator(`${sel(RAIL.row)}[data-rung="function"]`).count(),
        1,
        `function rungs after opening ${opened}`,
      );
    });

    /* ── 3. A ROW DOES SOMETHING A PERSON CAN SEE ───────────────────────── */

    await check('clicking a card row opens its detail panel', async () => {
      is(await page.locator(sel(RAIL.detail)).count(), 0, 'detail panels before the click');
      await page.locator(`${sel(RAIL.row)}[data-rung="card"]`).first().click();
      await settle(page);
      is(await page.locator(sel(RAIL.detail)).count(), 1, 'detail panels after the click');
    });

    await check('the filter narrows the rows it is given', async () => {
      const before = await page.locator(sel(RAIL.row)).count();
      await page.locator(sel(RAIL.filter)).fill('zzzzz-no-such-symbol');
      await settle(page);
      const after = await page.locator(sel(RAIL.row)).count();
      if (!(after < before)) throw new Error(`filter did not narrow: ${before} then ${after}`);
      await page.locator(sel(RAIL.filter)).fill('');
      await settle(page);
    });

    /* ── 4. COMPACT IS THE ONLY DENSITY — Graphite law 3 ────────────────── */

    await check('rail rows paint at the compact height', async () => {
      const heights = await page.$$eval(sel(RAIL.row), (els) =>
        els.slice(0, 40).map((el) => el.getBoundingClientRect().height),
      );
      atLeast(heights.length, 1, 'rows to measure');
      const tall = heights.filter((h) => h > 32);
      is(tall.length, 0, `rows taller than 32px (worst ${Math.max(0, ...heights)})`);
    });

    /* ── 5. REVIEW IS REACHABLE, BY KEYBOARD, WITH NO TEST HOOK ─────────── */

    await check('the command surface offers review', async () => {
      const label = await runCommand(page, 'review');
      if (!/review/i.test(label)) throw new Error(`the first review row read ${JSON.stringify(label)}`);
    });

    await check('review renders in the overlay host, not the not-yet panel', async () => {
      await page.locator(sel(REVIEW.root)).waitFor({ state: 'visible', timeout: 10000 });
      is(await page.locator(sel(NOT_YET.overlayReview)).count(), 0, 'not-yet review panels');
      const inside = await page.evaluate(
        ([hostId, rootId]) => {
          const host = document.querySelector(`[data-testid="${hostId}"]`);
          const root = document.querySelector(`[data-testid="${rootId}"]`);
          return Boolean(host && root && host.contains(root));
        },
        [SHELL.overlay, REVIEW.root],
      );
      is(inside, true, 'the review pane sits inside the shell overlay host');
    });

    await check('review shows the real diff of the real changed file', async () => {
      const file = page.locator(`${sel(REVIEW.file)}[data-path="${CHANGED}"]`);
      await file.waitFor({ state: 'visible', timeout: 10000 });
      is(await page.locator(sel(REVIEW.file)).count(), 1, 'files in the review list');
      atLeast(await page.locator(sel(REVIEW.line)).count(), 3, 'diff lines drawn');
      const added = await page.$$eval(`${sel(REVIEW.line)}[data-kind="add"]`, (els) =>
        els.map((el) => el.textContent ?? ''),
      );
      const carries = added.some((text) => text.includes('export const B = 22;'));
      is(carries, true, `the added line git produced is on screen (saw ${added.length} adds)`);
    });

    await check('Escape closes review and the rail is still there', async () => {
      await page.keyboard.press('Escape');
      await settle(page);
      is(await page.locator(sel(REVIEW.root)).count(), 0, 'review panes after Escape');
      /* Index may be collapsed after Escape — the toggle (and pane) remain. */
      atLeast(await page.getByTestId('board-index-toggle').count(), 1, 'index toggle after Escape');
    });

    /* ── 6. NOTHING BROKE ON THE WAY ────────────────────────────────────── */

    await check('no console error the routes did not ask for', async () => {
      const unexplained = consoleErrors.filter(
        (line) => !REFUSED.some((route) => line.includes(route)),
      );
      is(unexplained.length, 0, `unexplained console errors: ${unexplained.join(' | ')}`);
    });
  },
  { routes: ROUTES },
);
