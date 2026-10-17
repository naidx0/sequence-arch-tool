import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COMMAND, NOT_YET, REVIEW, SHELL } from './lib/anchors.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';
import { isRefusedLine } from './lib/consoleFilter.mjs';
import { readFunctionIndex } from './lib/functionIndex.mjs';
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
  return { graph, drawable, graphFile: out };
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
function readEngineFunctions(graphFile) {
  const read = readFunctionIndex(REPO, graphFile);
  if (read.failure) harnessFailure(read.failure);
  return read;
}

const { graph, drawable, graphFile } = scanRealRepo();
const review = throwawayRepoDiff();
const functions = readEngineFunctions(graphFile);

/** file path (forward-slashed) -> how many functions the engine names in it. Read by the Files checks below. */
const FUNCTIONS_BY_FILE = new Map();
for (const node of functions.functionGraph.nodes) {
  const file = String(node.file ?? '').split(String.fromCharCode(92)).join('/');
  FUNCTIONS_BY_FILE.set(file, (FUNCTIONS_BY_FILE.get(file) ?? 0) + 1);
}

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
  /* Not served here: a hard 404, not the SPA's text/html that an EventSource logs as a MIME error. */
  '/api/boards': null,
  '/api/boards/architecture': null,
  '/api/boards/events': null,
  '/api/agent-events': null,
};

const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach', '/api/boards', '/api/boards/architecture', '/api/boards/events', '/api/agent-events'];

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
    if ((await page.getByTestId('s2-tab-architecture').getAttribute('aria-pressed')) !== 'true') {
      await page.getByTestId('s2-tab-architecture').click();
    }
    await page.getByTestId('board').waitFor({ state: 'visible', timeout: 15000 });
    await settle(page);
    /* The setup used to press `board-index-toggle` and wait for `board-region-rail`; the rail is retired (below). */

    /* RETIRED, NOT REPOINTED (owner ruling, docs/plans/0.1.9/HANDOFF.md, 2026-10-14): the Index rail is deleted, with
       the twelve checks that lived here (rail-not-the-not-yet-panel, rail pane in the frame, a row per drawable node,
       card-rung ids from the scan, the file rung, the engine's function counts on file rows, a file opening its
       functions, a card row opening its detail panel, the filter, compact row height). They are NOT all covered
       elsewhere, and this note used to say so. What carried over to Files, and where it is locked:
         function list under a file, and its flow on the board   flow-plays.mjs (files-symbols-toggle, files-symbol, strip)
         function COUNT on each file row                         the "Files carries..." checks below (section 4)
         clicking a board card reveals its file in Files         the "Files carries..." checks below
       Not carried over, by the ruling: the card detail panel, and the rail's own filter (Files has its own find). The
       review checks further down never depended on the rail and are kept as they were. */

    /* ── 4. FILES CARRIES WHAT THE RAIL CARRIED ────────────────────────────
       Piece (3) first: it needs the Architecture tab, where we already are. A click on a real board card
       of a service must reveal that service's folder in Files, which is not mounted yet: the request waits
       in the store and is applied when Files opens. */
    const reveal = drawable.find((n) => n.kind === 'service' && typeof n.path === 'string' && n.path !== '');
    const revealDir = reveal ? reveal.path.split(String.fromCharCode(92)).join('/') : null;
    await check('Files carries: a click on a board card reveals its folder in Files', async () => {
      if (!reveal) throw new Error('the scan has no service with a path to click');
      await page.locator(`${sel('board-node')}[data-node-id="${reveal.id}"]`).first().click();
      await settle(page);
      await page.getByTestId('s2-tab-files').click();
      await page.locator(sel('files-row')).first().waitFor({ state: 'visible', timeout: 15000 });
      await settle(page);
      const under = await page.$$eval(
        sel('files-row'),
        (els, dir) =>
          els
            .map((el) => el.getAttribute('data-path') ?? '')
            .filter((p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')),
        revealDir,
      );
      const anyBelow = await page.$$eval(
        sel('files-row'),
        (els, dir) => els.some((el) => (el.getAttribute('data-path') ?? '').startsWith(dir + '/')),
        revealDir,
      );
      is(anyBelow, true, `rows under ${revealDir} are open in Files (direct children seen: ${under.length})`);
    });

    await check("Files carries: a file row shows the engine's own function count", async () => {
      const [target, expected] = [...FUNCTIONS_BY_FILE.entries()].sort((a, b) => b[1] - a[1])[0];
      await page.locator(sel('files-filter')).fill(target);
      await settle(page);
      const row = page.locator(`${sel('files-row')}[data-path="${target}"]`);
      await row.waitFor({ state: 'visible', timeout: 10000 });
      const shown = (await row.locator(sel('files-fncount')).textContent()) ?? '';
      is(shown.trim(), String(expected), `the count on ${target} against the engine's function index`);
    });

    await check("Files carries: the not-read disclosure states the scan's own number", async () => {
      const regions = Array.isArray(graph.unscanned) ? graph.unscanned : [];
      const files = regions.reduce((n, r) => n + r.files, 0);
      if (files === 0) {
        is(await page.locator(sel('files-unscanned')).count(), 0, 'disclosures when the scan left nothing unread');
        return;
      }
      const text = (await page.locator(sel('files-unscanned')).textContent()) ?? '';
      is(text.startsWith(`${files} source file`), true, `the disclosure leads with the scan's ${files} (saw: ${text.slice(0, 60)})`);
    });

    /* ── 5. REVIEW IS REACHABLE, BY KEYBOARD, WITH NO TEST HOOK ─────────── */

    await check('the command surface offers review', async () => {
      const label = await runCommand(page, 'review');
      if (!/review/i.test(label)) throw new Error(`the first review row read ${JSON.stringify(label)}`);
    });

    await check('review renders in the overlay host, not the not-yet panel', async () => {
      await page.locator(sel(REVIEW.root)).waitFor({ state: 'visible', timeout: 10000 });
      is(await page.locator(sel(NOT_YET.overlayReview)).count(), 0, 'not-yet review panels');
      /* REPOINTED: the host is the shell's overlay panel for review (`v3-overlay-review`, `v3-overlay-<kind>`);
         `shell-overlay` was the retired three-pane layout's host. */
      const inside = await page.evaluate((rootId) => {
        const host = document.querySelector('[data-testid="v3-overlay-review"]');
        const root = document.querySelector(`[data-testid="${rootId}"]`);
        return Boolean(host && root && host.contains(root));
      }, REVIEW.root);
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

    await check('Escape closes review', async () => {
      await page.keyboard.press('Escape');
      await settle(page);
      is(await page.locator(sel(REVIEW.root)).count(), 0, 'review panes after Escape');
    });

    /* ── 6. NOTHING BROKE ON THE WAY ────────────────────────────────────── */

    await check('no console error the routes did not ask for', async () => {
      const unexplained = consoleErrors.filter(
        (line) => !isRefusedLine(line, REFUSED),
      );
      is(unexplained.length, 0, `unexplained console errors: ${unexplained.join(' | ')}`);
    });
  },
  { routes: ROUTES },
);
