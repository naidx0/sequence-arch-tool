#!/usr/bin/env node
/**
 * THE FIRST REAL E2E — the app boots, the frame arranges, the composer works.
 *
 * FIVE QUESTIONS, and every one of them is a question jsdom answers wrongly or
 * cannot answer at all. That is the entry condition for this tier: if vitest
 * can prove it, it belongs in vitest, and duplicating it here buys a slower
 * copy of a test that already exists.
 *
 *   1. THE APP BOOTS. A real bundle, served over HTTP, painting in a real
 *      engine, with nothing fetched from a font CDN. The local-first
 *      non-negotiable is a claim about the NETWORK, and only a browser has one
 *      to watch.
 *
 *   2. THE NO-REPOSITORY BOOT comes FIRST, because it is the state of the world
 *      before anything has happened: the chat column, the sidebar with its
 *      open-repository door, and the Architecture surface showing an EMPTY
 *      board (no node is drawn that no scan found).
 *
 *   3. THE ATTACH FLOW draws the board from a real scan.
 *
 *   4. THE FRAME IS SPENT AND NOTHING LEAVES IT, at 1280 / 1024 / 760 and back.
 *
 *   5. THE COMPOSER ACCEPTS INPUT AND ENTER SENDS. Real keystrokes into a real
 *      textarea; Shift+Enter keeps its newline, Enter does not.
 *
 * Plus the locks that belong to no other tier: WHAT WEIGHT AND WHAT SIZE THE
 * TEXT PAINTS. See the blocks above those checks.
 *
 * ── WHY THIS FILE WAS RE-POINTED (round 8 integration, 2026-10-07) ────────
 *
 * It addressed the v3 tab layout: `chat-column`, `shell-cb`, `workspace-rail`,
 * `workspace-tab-*` with `data-on`, a `shell-workspace-split` grid written in
 * px, an appbar with "Open a repository", and six pills that refused out loud
 * when the frame could not seat them. The reskin (Decision 49) and rounds 7
 * and 8 replaced all of it with shell2, so the first `waitForSelector` timed
 * out on `chat-column` and the file exited 2 before one assertion. It had done
 * so since the reskin.
 *
 * THE CLAIMS ARE THE SAME CLAIMS, held against what shell2 builds:
 *   - the frame is spent: the panes and the divider total the stage's MEASURED
 *     width (was: the grid tracks total the measured split), and it follows a
 *     resize;
 *   - nothing is painted outside the window, and every seated pane is at least
 *     a seat wide (the 278 floor is unchanged);
 *   - what the bar says is what the stage draws: a pill reads pressed exactly
 *     when its pane is drawn (was: data-on against a pane, with refusals). The
 *     stage holds two surfaces; a third press replaces the older one, so there
 *     is no refusal left to announce;
 *   - narrow: below 1024 the frame does not hide a column, it makes Chat and
 *     Workspace two views of one column behind a named switch, and each view
 *     fits the window (was: a refused pill in a live region);
 *   - and back: the arrangement is derived from the frame, so 1280 seats both
 *     surfaces and the chat again;
 *   - the type ladder is READ from the document's --t-* tokens rather than
 *     hand-listed: Decision 49 named its half steps there (--t-11-5 and
 *     friends), and a size no token declares still fails.
 *
 * EVERY ELEMENT IS ADDRESSED BY data-testid (lib/anchors.mjs, SHELL2), and a
 * pane by its `data-surface-pane` state attribute. Not one class name for an
 * element, not one DOM path, not one nth-child. The two type checks select by
 * class on purpose, as before: they measure what a class paints.
 *
 * ── WHY THE GRAPH IS A REAL SCAN ──────────────────────────────────────────
 *
 * "The board drew" must never mean "a test wrote a graph it wanted". The
 * shopfront fixture is scanned by the built analyzer — the same program, the
 * same output shape the production route serves — and handed over on
 * /archgraph.json exactly once the spec drives the real attach flow.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CHAT, SHELL2 } from './lib/anchors.mjs';
import { atLeast, attr, computed, count, is, resize, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const FIXTURES = path.join(REPO_ROOT, 'packages', 'analyzer', 'test', 'fixtures');
const FIXTURE = path.join(FIXTURES, 'shopfront');

/** Exit 2, never 1: "the analyzer is not built" is the harness unable to run. */
function scanFixture() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[shell-boot] ERROR: the analyzer is not built, nothing to scan');
    console.error('[shell-boot] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-shell-boot-')), 'archgraph.json');
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', FIXTURE, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO_ROOT,
    });
  } catch (error) {
    console.error('[shell-boot] ERROR: sequence scan failed:', error.message);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const graph = scanFixture();

/** The real sub-directories of the fixture root, in GET /api/browse's shape —
 *  read off disk at run time, for the same reason shell-overlay.mjs reads
 *  packages/: a hand-written listing can be made to satisfy any dialog. */
function realBrowseListing() {
  const entries = fs
    .readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const full = path.join(FIXTURES, entry.name);
      return {
        name: entry.name,
        path: full,
        isRepo: fs.existsSync(path.join(full, 'package.json')) ||
          fs.readdirSync(full).some((f) => f.endsWith('.yaml') || f.endsWith('.yml')),
        hasChildren: true,
      };
    });
  return { root: FIXTURES, path: FIXTURES, parent: null, entries };
}

/** The five counts PostAttachResponse promises, computed from the real scan. */
function realSummary() {
  const kinds = (k) => graph.nodes.filter((n) => n.kind === k).length;
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    services: kinds('service'),
    datastores: kinds('datastore'),
    topics: kinds('topic'),
  };
}

/** The static font cuts shipped (@fontsource/inter 400/500/600, jetbrains-mono
 *  400/500; 700 kept for verdicts). A declared 450 or 550 is not a weight — it
 *  is a request the font files cannot fill, which CSS Fonts 4 resolves UPWARD. */
const SHIPPED_CUTS = new Set(['400', '500', '600', '700']);

/** Every surface the bar names, read off the bar itself at run time. */
function pillIds(page) {
  return page.evaluate(
    (bar) =>
      [...document.querySelectorAll(`[data-testid="${bar}"] [data-tab-id]`)].map((b) => b.getAttribute('data-tab-id')),
    SHELL2.surfaces,
  );
}

/**
 * Routes this origin refuses, BY URL. A hard 404 is the honest answer for an
 * api route a static file host does not serve, and the browser logs one line
 * of console per refusal — so the console check below excuses exactly these
 * URLs and nothing else.
 */
const REFUSED = [
  '/api/status',
  '/api/functions',
  '/api/chat-memory',
  '/api/ai-config',
  '/api/sessions',
];

/**
 * Every drawn pane's box, the stage that holds them, the chat column and the
 * window. One `evaluate`, because the answers have to be read from ONE layout:
 * six round trips across a resize describe six moments.
 */
function readFrame(page) {
  return page.evaluate((chatId) => {
    const visible = (el) => el && el.closest('[hidden]') === null && el.getBoundingClientRect().width > 0;
    const all = [...document.querySelectorAll('[data-surface-pane]')];
    const stage = all[0]?.parentElement ?? null;
    const panes = all.filter(visible).map((pane) => {
      const rect = pane.getBoundingClientRect();
      return {
        id: pane.getAttribute('data-surface-pane'),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    });
    /* Everything the stage lays out in a row: the panes and the divider. */
    const spent = stage && visible(stage)
      ? [...stage.children].filter(visible).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
      : 0;
    const chat = document.querySelector(`[data-testid="${chatId}"]`);
    const chatRect = visible(chat) ? chat.getBoundingClientRect() : null;
    return {
      panes,
      spent: Math.round(spent),
      stageWidth: stage && visible(stage) ? Math.round(stage.clientWidth) : 0,
      stageRight: stage && visible(stage) ? Math.round(stage.getBoundingClientRect().right) : 0,
      chat: chatRect ? { left: Math.round(chatRect.left), right: Math.round(chatRect.right) } : null,
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  }, SHELL2.chat);
}

/**
 * Press a pill and wait for the layout it caused. A plain press SWITCHES the stage to that surface (0.1.8.1 C1: tabs
 * switch, they do not add panes); `beside` is the deliberate split, Ctrl/Cmd+click, which opens it next to what is
 * showing. The steps below that are about two panes sharing the stage open the second one on purpose.
 */
async function pressPill(page, id, { beside = false } = {}) {
  const modifiers = beside ? [process.platform === 'darwin' ? 'Meta' : 'Control'] : [];
  await page.locator(sel(SHELL2.pill(id))).click({ modifiers });
  await settle(page);
}

/** What the bar says against what the stage draws: pressed exactly when drawn. */
async function pillsMatchPanes(page, frame, where) {
  for (const id of await pillIds(page)) {
    const on = (await attr(page, SHELL2.pill(id), 'aria-pressed')) === 'true';
    const painted = frame.panes.some((pane) => pane.id === id);
    is(on, painted, `${where}: ${id} pill reads ${on ? 'open' : 'closed'}, pane ${painted ? 'is' : 'is not'} drawn`);
  }
}

await suite(
  'shell-boot',
  async ({ page, base, check, consoleErrors, requests }) => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector(sel(SHELL2.root), { timeout: 15000 });
    // No graph is served yet: the boot ladder finds nothing to attach, which
    // is precisely the state section 2 below asserts. The chat column is the
    // one region that is always there, so it, not a board, is the wait.
    await page.waitForSelector(sel(SHELL2.chat), { timeout: 15000 });
    await settle(page);

    /* ── 1. The app boots ──────────────────────────────────────────────── */

    await check('boots to exactly one shell, one chat column, one composer, one surface bar', async () => {
      is(await count(page, SHELL2.root), 1, 'shell count');
      is(await count(page, SHELL2.chat), 1, 'chat column count');
      is(await count(page, CHAT.field), 1, 'composer field count');
      is(await count(page, CHAT.send), 1, 'composer send count');
      is(await count(page, SHELL2.surfaces), 1, 'surface bar count');
    });

    await check('boots with no console error the refusals do not explain', async () => {
      /*
       * This origin refuses five api routes AND the graph route by design
       * until the attach lands, and each refusal costs one line of browser
       * console — so the check counts everything the REFUSED list does not
       * explain, by URL, never by message substring.
       */
      const unexplained = consoleErrors.filter(
        (line) =>
          !REFUSED.some((route) => line.includes(route)) &&
          !line.includes('/archgraph.json'),
      );
      is(unexplained.length, 0, `console errors: ${unexplained.join(' | ')}`);
    });

    await check('boots with no network font — local-first', async () => {
      const offsite = requests.filter(
        (url) => url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com'),
      );
      is(offsite.length, 0, `font CDN requests: ${offsite.join(' | ')}`);

      const foreign = requests.filter(
        (url) =>
          url.startsWith('http') &&
          !url.startsWith(base) &&
          // Playwright route interception never touches the network; the URL
          // only ever exists inside this page.
          !url.includes('/archgraph.json'),
      );
      is(foreign.length, 0, `off-origin requests: ${foreign.join(' | ')}`);
    });

    /*
     * THE JSX COMPILER IS NOT IN THE BOOT PATH.
     *
     * @babel/standalone was a static import in ReactCanvasMount.tsx and rollup
     * therefore put 2.36 MB of it — 74.8% of a 3,161,162-byte main chunk — in
     * the one file every cold open downloads and parses before anything paints,
     * for a compiler that runs only when the agent has drawn a react block.
     * It is a dynamic import now, so it is its own chunk; this check is what
     * stops a future static import putting it back. The budget is deliberately
     * loose (1.2 MB) — a ratchet against a megabyte-scale regression; the
     * byte-exact one is tools/measure/perf-ratchet.json.
     *
     * The entry chunk is the one script index.html loads (lazy chunks of
     * `index.ts` modules are also named index-*.js, so a filename glob would
     * count them).
     */
    await check('the boot chunk does not carry the JSX compiler', async () => {
      const html = fs.readFileSync(path.join(WEB2, 'dist', 'index.html'), 'utf8');
      const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
      is(entries.length, 1, `one entry script in dist/index.html (found ${entries.join(', ')})`);
      const bytes = fs.statSync(path.join(WEB2, 'dist', 'assets', entries[0])).size;
      atLeast(1_200_000 - bytes, 0, `entry chunk bytes (${bytes}) under the 1.2 MB budget`);
    });

    /* ── 2. The no-repository boot ─────────────────────────────────────── */

    await check('with no repo attached the stage shows an empty Architecture board beside the chat', async () => {
      is(await count(page, SHELL2.panel), 1, 'the sessions sidebar stands');
      is(await count(page, SHELL2.openProject), 1, 'the open-repository door is in the sidebar');
      is(await count(page, SHELL2.settings), 1, 'settings reachable from the sidebar');

      const frame = await readFrame(page);
      is(frame.panes.map((p) => p.id).join(','), 'architecture', 'Architecture is the one surface at boot');
      await pillsMatchPanes(page, frame, 'boot');
      is(await count(page, 'board'), 1, 'the board mounts');
      is(await attr(page, 'board', 'data-node-count'), '0', 'no node is drawn without a scan');
      is(await count(page, 'board-node'), 0, 'no board node without a repository');
      is(await count(page, 'board-empty'), 1, 'the board says it is empty');
    });

    /* ── 3. The attach flow, and a board drawn from a real scan ────────── */

    await check('the attach dialog opens the repository, and the board draws', async () => {
      // Arm the graph route BEFORE the dialog asks for it: POST /api/attach is
      // answered by the static route table; GET /archgraph.json is fulfilled
      // here with the real scan bytes.
      await page.route('**/archgraph.json', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) }),
      );

      await resize(page, 1280, 800);
      await page.locator(sel(SHELL2.openProject)).click();
      await settle(page);
      atLeast(await count(page, 'attach'), 1, 'attach dialog on screen');

      // The real listing of fixtures/, so the row clicked names the directory
      // the scan actually ran on.
      const row = page.locator('[data-testid="attach-entry"]', { hasText: 'shopfront' });
      await row.first().getByRole('button').first().click();

      await page.locator('[data-surface-pane="architecture"]').waitFor({ state: 'visible', timeout: 15000 });
      await page.locator(sel('board-node')).first().waitFor({ state: 'visible', timeout: 15000 });
      await settle(page);

      atLeast(await count(page, 'board-node'), 1, 'board nodes drawn from the real scan');
    });

    /* ── 4. The frame is spent, and nothing leaves it ──────────────────── */

    /**
     * THE 960px DEFECT, HELD AGAINST A MEASURED CONTAINER. A column computed
     * against a literal once drew `476px 8px 476px` inside a 1704px container.
     * The assertion is deliberately an EQUALITY (to a pixel of rounding)
     * against the stage the browser reports, because "roughly the right size"
     * is what 960 looked like.
     */
    await check('1280 — two panes spend the whole stage', async () => {
      await resize(page, 1280, 800);
      await pressPill(page, 'files', { beside: true });

      const frame = await readFrame(page);
      is(frame.panes.length, 2, 'two visible panes');
      atLeast(frame.stageWidth, 1, 'the stage has a measured width');
      atLeast(1, Math.abs(frame.spent - frame.stageWidth), `panes and divider (${frame.spent}) vs the stage (${frame.stageWidth})`);
      atLeast(frame.panes[0].left + 1, frame.chat.right, 'the first pane starts at or after the chat column');
      is(frame.panes[1].right, frame.stageRight, 'the last pane ends at the stage edge');
      atLeast(frame.innerWidth, frame.stageRight, 'and the stage ends inside the window');
      await pillsMatchPanes(page, frame, '1280');
    });

    /** AND IT FOLLOWS THE FRAME. The same two panes, a different window. */
    await check('the stage re-measures when the window changes', async () => {
      const wide = await readFrame(page);
      await resize(page, 1024, 800);
      const narrow = await readFrame(page);

      atLeast(1, Math.abs(narrow.spent - narrow.stageWidth), `panes and divider vs the stage at 1024 (${narrow.spent} vs ${narrow.stageWidth})`);
      is(narrow.stageWidth < wide.stageWidth, true, `the stage narrowed (${wide.stageWidth} → ${narrow.stageWidth})`);
      is(narrow.spent < wide.spent, true, `the panes followed it (${wide.spent} → ${narrow.spent})`);
    });

    /**
     * NOTHING IS PAINTED WHERE NOBODY CAN REACH IT, and every pane is a seat.
     * "Inside the window" was once true of five slivers whose prose wrapped
     * one word per line; a pane the frame seats must also be a pane its
     * surfaces can speak in. 278 = the 280 seat floor minus subpixel rounding.
     */
    await check('1024 — pressing every pill keeps every pane inside the window, and the bar honest', async () => {
      await resize(page, 1024, 800);
      for (const id of await pillIds(page)) {
        if ((await attr(page, SHELL2.pill(id), 'aria-pressed')) === 'true') continue;
        await pressPill(page, id, { beside: true });
      }

      const frame = await readFrame(page);
      atLeast(frame.panes.length, 2, 'more than one pane open at 1024');
      is(frame.documentScrollWidth, frame.innerWidth, 'no horizontal overflow');
      for (const pane of frame.panes) {
        atLeast(frame.innerWidth, pane.right, `${pane.id} right edge inside the window`);
        atLeast(pane.left, 0, `${pane.id} left edge inside the window`);
        atLeast(pane.right - pane.left, 278, `${pane.id} is at least a seat wide`);
      }
      await pillsMatchPanes(page, frame, '1024');
    });

    /**
     * NARROW. Same claim, less room: below 1024 the frame makes Chat and
     * Workspace two views of one column. Neither is lost: the switch names
     * both, one is shown, and the other is one press away and fits.
     */
    await check('760 — chat and workspace become two named views, and each fits', async () => {
      await resize(page, 760, 800);

      const chatView = await readFrame(page);
      is(chatView.documentScrollWidth, chatView.innerWidth, 'no horizontal overflow at 760');
      is(await count(page, SHELL2.narrowSwitch), 1, 'the Chat / Workspace switch is on screen');
      is(await attr(page, SHELL2.narrowView('chat'), 'aria-selected'), 'true', 'the chat view is selected');
      is(chatView.chat !== null, true, 'the chat column is shown');
      atLeast(chatView.innerWidth, chatView.chat.right, 'the chat column ends inside the window');
      is(chatView.panes.length, 0, 'the stage is not painted behind the chat');

      await page.locator(sel(SHELL2.narrowView('stage'))).click();
      await settle(page);
      const stageView = await readFrame(page);
      is(await attr(page, SHELL2.narrowView('stage'), 'aria-selected'), 'true', 'the workspace view is selected');
      is(stageView.chat, null, 'the chat column gives the window to the stage');
      is(stageView.documentScrollWidth, stageView.innerWidth, 'no horizontal overflow in the workspace view');
      atLeast(stageView.panes.length, 1, 'the open surfaces are drawn in the workspace view');
      for (const pane of stageView.panes) {
        atLeast(stageView.innerWidth, pane.right, `${pane.id} right edge inside a 760 window`);
        atLeast(pane.left, 0, `${pane.id} left edge inside a 760 window`);
        atLeast(pane.right - pane.left, 278, `${pane.id} is at least a seat wide at 760`);
      }
      await pillsMatchPanes(page, stageView, '760');
    });

    /**
     * AND BACK. The arrangement is DERIVED from the frame, not consumed by it.
     * A view folded at 760 that did not come back at 1280 would be a reader who
     * loses the chat by making the window small once.
     */
    await check('1280 again — the chat and both surfaces are seated, and the stage is spent', async () => {
      await resize(page, 1280, 800);

      const frame = await readFrame(page);
      is(await count(page, SHELL2.narrowSwitch), 0, 'no narrow switch at 1280');
      is(frame.chat !== null, true, 'the chat column is back');
      is(frame.panes.length, 2, 'both surfaces are back on the stage');
      atLeast(1, Math.abs(frame.spent - frame.stageWidth), 'and the panes still total the stage');
      is(frame.documentScrollWidth, frame.innerWidth, 'with nothing hanging off the edge');
      for (const pane of frame.panes) {
        atLeast(frame.innerWidth, pane.right, `${pane.id} right edge inside the window`);
        atLeast(pane.left + 1, frame.chat.right, `${pane.id} starts after the chat column`);
        atLeast(pane.right - pane.left, 278, `${pane.id} is at least a seat wide`);
      }
      await pillsMatchPanes(page, frame, '1280 again');
    });

    /* ── 5. The composer accepts input ─────────────────────────────────── */

    await check('the composer accepts typing and the send button follows the draft', async () => {
      const field = page.locator(sel(CHAT.field));
      const send = page.locator(sel(CHAT.send));

      is(await send.isDisabled(), true, 'send is disabled on an empty draft');

      await field.click();
      await field.type('what calls the gateway');
      await settle(page);

      is(await field.inputValue(), 'what calls the gateway', 'the field holds what was typed');
      is(await send.isDisabled(), false, 'send is enabled once there is a draft');
      is(await send.getAttribute('aria-label'), 'Send', 'the circle says Send, not Stop');
    });

    /* ── Enter vs Shift+Enter ──────────────────────────────────────────── */

    await check('Shift+Enter puts a newline in the draft', async () => {
      const field = page.locator(sel(CHAT.field));
      await field.click();
      await field.press('End');
      await field.press('Shift+Enter');
      await field.type('and what does it call');
      await settle(page);

      const value = await field.inputValue();
      is(value.includes('\n'), true, `Shift+Enter newline, got ${JSON.stringify(value)}`);
      is(value.split('\n').length, 2, 'exactly one newline');
    });

    await check('Enter does not put a newline in the draft', async () => {
      /*
       * THE ASSERTION IS THE ABSENCE OF A NEWLINE: Enter may SEND (clearing
       * the field) or be refused (leaving the draft alone), but the composer
       * preventDefaults the key either way, so a newline never reaches the
       * draft. That is the browser-side half of the behaviour and the thing
       * that would regress.
       */
      const field = page.locator(sel(CHAT.field));
      const before = await field.inputValue();

      await field.click();
      await field.press('End');
      await field.press('Enter');
      await settle(page);

      const after = await field.inputValue();
      is(after.includes('\n'), false, `Enter put a newline in the draft: ${JSON.stringify(after)}`);
      is(
        after === '' || after === before,
        true,
        `Enter neither sent nor left the draft alone: ${JSON.stringify(after)} vs ${JSON.stringify(before)}`,
      );
    });

    /* ── The weight ramp, measured where weight actually resolves ──────── */

    /**
     * NO ELEMENT PAINTS A WEIGHT THE FONT FILES DO NOT CARRY.
     *
     * Structure-free on purpose: no class name, no testid, no enumeration of
     * surfaces. The invariant is about the whole document, so the check is too,
     * and it keeps holding as later waves add surfaces nobody has written yet.
     */
    await check('every rendered weight is a cut the shipped font files carry', async () => {
      const offenders = await page.evaluate((shippedCuts) => {
        const shipped = new Set(shippedCuts);
        const found = [];
        for (const el of document.querySelectorAll('*')) {
          const weight = getComputedStyle(el).fontWeight;
          if (shipped.has(weight)) continue;
          const id = el.getAttribute('data-testid');
          found.push(`${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} @ ${weight}`);
        }
        return [...new Set(found)];
      }, [...SHIPPED_CUTS]);

      is(offenders.length, 0, `weights no font file carries: ${offenders.join(' | ')}`);
    });

    /**
     * A CONTROL LABEL IS NOT BODY TYPE. The labelled control here is the
     * Architecture pill: it names a surface, and its weight is what tells a
     * reader it is a control (the sidebar's rows are set at body weight by
     * Decision 49, so they are not the specimen any more).
     */
    await check('body and a control label paint two different, shipped cuts', async () => {
      const body = await page.evaluate(() => getComputedStyle(document.body).fontWeight);
      const label = await computed(page, SHELL2.pill('architecture'), 'font-weight');

      is(SHIPPED_CUTS.has(body), true, `body weight ${body} is a shipped cut`);
      is(SHIPPED_CUTS.has(label), true, `control label weight ${label} is a shipped cut`);
      is(body, '400', 'body sits on --fw-body');
      is(label !== body, true, `a control label must not paint the body weight (both ${body})`);
    });

    /**
     * PRIMARY NAVIGATION IS NOT FOOTNOTE TYPE.
     *
     * Audited at 1280x720, the pill labels that name every surface — and the
     * rail rows beside them — once painted at 10px and 11px, the two rungs the
     * ladder keeps for badges and units. A reader has to FIND these. The floor
     * is asserted as a number rather than as a token name because the defect
     * was in what PAINTED, not in what was declared. The sidebar folds while
     * two surfaces share the stage, so one is closed first to bring it back.
     */
    await check('the surface bar and the sidebar rows are readable, not footnote type', async () => {
      const open = [];
      for (const id of await pillIds(page)) {
        if ((await attr(page, SHELL2.pill(id), 'aria-pressed')) === 'true') open.push(id);
      }
      for (const id of open.slice(1)) {
        await page.locator(sel(`v3-tab-close-${id}`)).click();
        await settle(page);
      }
      is(await count(page, SHELL2.settings), 1, 'the sidebar is back with one surface open');
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('.s2-surfaces .s2-seg-l, .s2-panel .s2-it .s2-t')].map((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        ),
      );
      atLeast(sizes.length, 6, 'the pill labels and sidebar rows are on screen');
      for (const size of sizes) atLeast(size, 12, 'primary navigation font-size');
    });

    /**
     * NO ELEMENT COMPUTES A SIZE OFF THE TOKEN LADDER.
     *
     * The same shape as the weight check above, and for the same reason: the
     * invariant is about the whole document, so the check is too.
     *
     * The ladder is READ from the document's `--t-*` custom properties, not
     * hand-listed: Decision 49 named its half steps there, and a hand-listed
     * ladder cannot fail for a rung nobody added. A size no token declares —
     * the UA's `13.3333px` on a control that does not inherit, a sheet that
     * spells 11.75px — still fails.
     *
     * SETTINGS IS OPENED ON PURPOSE: the workspace's own chrome declares a size
     * on nearly every control, so the UA default only surfaces where a sheet
     * leans on inheritance, and Settings is the densest such surface.
     */
    await check('every computed font-size is on the token ladder', async () => {
      await page.locator(sel(SHELL2.settings)).click();
      await page.waitForSelector(sel('overlay-settings'), { timeout: 15000 });
      await settle(page);

      const { ladder, offenders } = await page.evaluate(() => {
        const rungs = new Set();
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (!rule.style) continue;
            for (const prop of rule.style) {
              if (/^--t-\d+(-\d+)?$/.test(prop)) rungs.add(prop);
            }
          }
        }
        const root = getComputedStyle(document.documentElement);
        const sizes = new Set([...rungs].map((p) => Number.parseFloat(root.getPropertyValue(p))).filter(Number.isFinite));
        const found = [];
        for (const el of document.body.querySelectorAll('*')) {
          const size = Number.parseFloat(getComputedStyle(el).fontSize);
          if (sizes.has(size)) continue;
          found.push(`${el.tagName.toLowerCase()}.${el.className} @ ${size}px`);
        }
        return { ladder: [...sizes].sort((a, b) => a - b), offenders: [...new Set(found)] };
      });

      await page.keyboard.press('Escape');
      atLeast(ladder.length, 9, `the ladder was read from the tokens (${ladder.join(', ')})`);
      is(offenders.length, 0, `font sizes off the ladder: ${offenders.join(' | ')}`);
    });
  },
  {
    routes: {
      /* No graph until the attach flow asks: the no-repository boot is the
         first thing this spec asserts, and serving the graph up front would
         make it unreachable. */
      '/archgraph.json': null,
      /* The attach flow's two routes, answered honestly. */
      '/api/recent': { recent: [] },
      '/api/browse': realBrowseListing(),
      '/api/attach': {
        attached: true,
        repoName: 'shopfront',
        root: FIXTURE,
        graphSummary: realSummary(),
      },
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
