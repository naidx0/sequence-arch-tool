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
 *   2. THE NO-BOARD BOOT comes FIRST, because it is the state of the world
 *      before anything has happened: one pill on (Chat), the workspace rail
 *      beside it, no board mounted, and the attach door inside the empty chat.
 *
 *   3. THE FRAME IS SPENT AND NOTHING LEAVES IT, at 1280 / 1024 / 760 and back.
 *      This is the section that was worth rewriting rather than deleting, and
 *      the two defects it now locks were both live in the shipped bundle when
 *      it could not run.
 *
 *   4. THE COMPOSER ACCEPTS INPUT AND ENTER SENDS. Real keystrokes into a real
 *      textarea; Shift+Enter keeps its newline, Enter does not.
 *
 * Plus one lock that belongs to no other tier: WHAT WEIGHT THE TEXT PAINTS.
 * See the block above that check.
 *
 * ── WHY THIS FILE WAS REWRITTEN, AND WHAT WAS KEPT ────────────────────────
 *
 * It asserted the three-pane shell: `shell-chat`, `shell-sessions`,
 * `shell-rail`, `data-breakpoint`, two `shell-resizer-*`. Every one of those is
 * rendered under `!tabLayout` (Shell.tsx:734-868) and `App.tsx` passes
 * `tabLayout` unconditionally — so the suite's very first `waitForSelector`
 * timed out at 15s and it exited 2 before making a single assertion, taking
 * `pnpm test:e2e` down with it (the script chains all thirteen with `&&`).
 * Every responsive regression shipped unseen behind that.
 *
 * NOTHING HERE WAS WEAKENED TO GET IT GREEN. The claims are the same claims —
 * the frame is fully spent, nothing is painted outside it, the arrangement
 * survives a round trip through a narrow window — re-pointed at the layout the
 * product builds, and made STRICTER where the old file was vague: the track
 * total is now held against the MEASURED container rather than against a
 * hardcoded fallback, which is exactly the defect
 * `resp-workspace-never-measures-its-container` describes (two panes drew
 * `476px 8px 476px` inside a 1704px container, unchanged by any resize).
 *
 * What is NOT asserted here, deliberately: `data-breakpoint`, `--side-w` and
 * the pane modes. They are still emitted, and they still drive nothing under
 * `tabLayout` — a check on them would report the dead three-pane model as if it
 * were the product. `resp-three-pane-shell-is-dead-code` owns that decision.
 *
 * EVERY ELEMENT IS ADDRESSED BY data-testid. Not one class name, not one DOM
 * path, not one nth-child. See lib/anchors.mjs for why.
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

import { CHAT, SHELL, WORKSPACE } from './lib/anchors.mjs';
import { atLeast, box, computed, count, attr, is, resize, sel, settle, suite } from './lib/harness.mjs';
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

/** The only weights @fontsource/instrument-sans ships. A declared 450 or 550
 *  is not a weight — it is a request the font files cannot fill, which CSS
 *  Fonts 4 resolves UPWARD to 500 and 600. */
const SHIPPED_CUTS = new Set(['400', '500', '600', '700']);

const PILLS = ['chat', 'architecture', 'whiteboard', 'ai-canvas', 'terminal', 'browser'];

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
 * Every visible pane's box, plus what the frame gave them and what the split
 * asked for. One `evaluate` rather than six, because the answers have to be
 * read from ONE layout: six round trips across a resize describe six moments.
 */
function readFrame(page) {
  return page.evaluate(() => {
    const panes = [...document.querySelectorAll('[data-pane]')].map((pane) => {
      const rect = pane.getBoundingClientRect();
      return {
        id: pane.getAttribute('data-pane'),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    });
    const split = document.querySelector('[data-testid="shell-workspace-split"]');
    const tracks = split
      ? split.style.gridTemplateColumns
          .trim()
          .split(/\s+/)
          .map((track) => Number.parseFloat(track))
      : [];
    const body = document.querySelector('[data-testid="shell-workspace-split"]')?.parentElement;
    return {
      panes,
      trackTotal: tracks.reduce((sum, track) => sum + track, 0),
      bodyWidth: body ? Math.round(body.clientWidth) : 0,
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

/**
 * Press a pill and wait for the layout it caused.
 *
 * `force` is here for ONE reason, and it is not to get past an assertion: a
 * refused pill carries `aria-disabled="true"` (perceivable, not operable) and
 * playwright's actionability gate reads that as "not enabled" and refuses to
 * click it. THE BROWSER HAS NO SUCH RULE — the button is not `disabled`, so a
 * real reader's click lands and the bar answers in its live region, which is
 * exactly the behaviour the 760 check below is asserting. Skipping the
 * harness's gate is what lets the product's own answer be observed.
 */
async function pressPill(page, id) {
  await page.locator(sel(WORKSPACE.pill(id))).click({ force: true });
  await settle(page);
}

await suite(
  'shell-boot',
  async ({ page, base, check, consoleErrors, requests }) => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector(sel(SHELL.root), { timeout: 15000 });
    // No graph is served yet: the boot ladder finds nothing to attach, which
    // is precisely the state section 1 below asserts. The workspace boots to
    // ONE pill — Chat — so that, and not an empty third region, is the wait.
    await page.waitForSelector(sel(CHAT.column), { timeout: 15000 });
    await settle(page);

    /* ── 1. The app boots, chat-only ───────────────────────────────────── */

    await check('boots to exactly one shell, one chat column, one composer', async () => {
      is(await count(page, SHELL.root), 1, 'shell count');
      is(await count(page, CHAT.column), 1, 'chat column count');
      is(await count(page, CHAT.composer), 1, 'composer count');
      is(await count(page, SHELL.appbar), 1, 'appbar count');
    });

    await check('boots with no console error the refusals do not explain', async () => {
      /*
       * RE-POINTED, NOT WEAKENED. This used to demand zero console errors of an
       * origin that served nothing but files, which was trivially true. This
       * origin now refuses four api routes AND the graph route by design until
       * the attach lands, and each refusal costs one line of browser console —
       * so the check counts everything the REFUSED list does not explain, by
       * URL, never by message substring.
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
     * loose (1.2 MB against a measured 800,469) — it is a ratchet against a
     * megabyte-scale regression, not a byte-for-byte snapshot nobody can edit
     * around.
     */
    await check('the boot chunk does not carry the JSX compiler', async () => {
      const assets = path.join(WEB2, 'dist', 'assets');
      const entries = fs.readdirSync(assets).filter((f) => /^index-.*\.js$/.test(f));
      is(entries.length, 1, `one entry chunk in dist/assets (found ${entries.join(', ')})`);
      const bytes = fs.statSync(path.join(assets, entries[0])).size;
      atLeast(1_200_000 - bytes, 0, `entry chunk bytes (${bytes}) under the 1.2 MB budget`);
    });

    /* ── 2. The no-board boot ──────────────────────────────────────────── */

    /**
     * The workspace's own boot state: Chat is the one pill on, the rail stands
     * beside it, no board is mounted, and the attach door is in the empty chat.
     */
    await check('with no repo attached the workspace boots to chat alone', async () => {
      is(await attr(page, SHELL.root, 'data-tab-layout'), 'true', 'the shipped layout is the tab layout');
      is(await count(page, WORKSPACE.root), 1, 'the C+B workspace mounts');
      is(await count(page, WORKSPACE.rail), 1, 'the workspace rail stands');
      is(await count(page, WORKSPACE.pills), 1, 'one pill bar');

      is(await attr(page, WORKSPACE.pill('chat'), 'data-on'), 'true', 'Chat is on at boot');
      for (const id of PILLS.filter((p) => p !== 'chat')) {
        is(await attr(page, WORKSPACE.pill(id), 'data-on'), 'false', `${id} is off at boot`);
      }

      is(await count(page, WORKSPACE.split), 0, 'one pill is not a split');
      is(await count(page, 'board-region'), 0, 'no board without a repository');
      is(await count(page, SHELL.settingsGear), 1, 'settings reachable from the rail');
      atLeast(await count(page, 'chat-empty-attach'), 1, 'attach door lives in the empty chat');
    });

    /* ── 3. The frame is spent, and nothing leaves it ──────────────────── */

    /**
     * THE 960px DEFECT, HELD AGAINST A MEASURED CONTAINER.
     *
     * `useWorkspaceSplitContainerWidth` keyed its effect on a stable ref
     * object, so it fired once — on the boot render, where the split does not
     * exist — and never again. Every column in the app was then computed
     * against a literal 960: two panes drew `476px 8px 476px` inside a 1704px
     * container on a 1920 window, and 1920 → 1280 → 1920 changed nothing. The
     * assertion is deliberately an EQUALITY against the container the browser
     * reports, because "roughly the right size" is what 960 looked like.
     */
    await check('1280 — two panes spend the whole workspace body', async () => {
      await resize(page, 1280, 800);
      await pressPill(page, 'architecture');

      const frame = await readFrame(page);
      is(frame.panes.length, 2, 'two visible panes');
      atLeast(frame.bodyWidth, 1, 'the workspace body has a measured width');
      is(frame.trackTotal, frame.bodyWidth, 'track total vs the container it sits in');

      const rail = await box(page, WORKSPACE.rail);
      const first = frame.panes[0];
      atLeast(first.left + 1, rail.right, 'the first pane starts at or after the rail');
      is(frame.panes[1].right, frame.innerWidth, 'the last pane ends at the frame edge');
    });

    /**
     * AND IT FOLLOWS THE FRAME. The same two panes, a different window: if the
     * observer is attached, the total moves with the container. Under the old
     * hook this check is what fails first — 960 at every viewport.
     */
    await check('the split re-measures when the window changes', async () => {
      const wide = await readFrame(page);
      await resize(page, 1024, 800);
      const narrow = await readFrame(page);

      is(narrow.trackTotal, narrow.bodyWidth, 'track total vs the container at 1024');
      is(narrow.bodyWidth < wide.bodyWidth, true, `the body narrowed (${wide.bodyWidth} → ${narrow.bodyWidth})`);
      is(
        narrow.trackTotal < wide.trackTotal,
        true,
        `the tracks followed it (${wide.trackTotal} → ${narrow.trackTotal})`,
      );
    });

    /**
     * NOTHING IS PAINTED WHERE NOBODY CAN REACH IT.
     *
     * `.shell` is `overflow: hidden`, the track list is written inline in px,
     * and there is no scroll container between them — so a pane the frame
     * cannot seat is not squeezed and is not scrollable, it is drawn outside
     * the window. Measured before the fix: at 1152 the Browser pane spanned
     * 1056..1216 with `documentElement.scrollWidth === innerWidth`, i.e. off
     * screen with no scrollbar, and its pill still read ON.
     */
    await check('1024 — every open pane is inside the window, or its pill says why', async () => {
      await resize(page, 1024, 800);
      for (const id of PILLS) {
        const pill = page.locator(sel(WORKSPACE.pill(id)));
        if ((await pill.getAttribute('aria-disabled')) === 'true') continue;
        if ((await pill.getAttribute('data-on')) === 'true') continue;
        await pressPill(page, id);
      }

      const frame = await readFrame(page);
      atLeast(frame.panes.length, 2, 'more than one pane open at 1024');
      is(frame.documentScrollWidth, frame.innerWidth, 'no horizontal overflow');
      for (const pane of frame.panes) {
        atLeast(frame.innerWidth, pane.right, `${pane.id} right edge inside the window`);
        atLeast(pane.left, 0, `${pane.id} left edge inside the window`);
        /* THE LEGIBILITY FLOOR — the check the 2026-08-29 melt would have
           failed. "Inside the window" was true of five slivers whose prose
           wrapped one word per line; a pane the frame seats must also be a
           pane its surfaces can speak in. 278 = the model's 280 seat floor
           minus subpixel rounding. */
        atLeast(pane.right - pane.left, 278, `${pane.id} is at least a seat wide`);
      }

      /* And a pill that is ON has a pane; a pill the frame refused says so. */
      for (const id of PILLS) {
        const on = (await attr(page, WORKSPACE.pill(id), 'data-on')) === 'true';
        const painted = frame.panes.some((pane) => pane.id === id);
        is(on, painted, `${id}: pill reads ${on ? 'on' : 'off'}, pane ${painted ? 'is' : 'is not'} drawn`);
      }
    });

    /** NARROW. Same claim, less room — and the refusal has to be audible. */
    await check('760 — the frame refuses out loud rather than hiding a pane', async () => {
      await resize(page, 760, 800);

      const frame = await readFrame(page);
      is(frame.documentScrollWidth, frame.innerWidth, 'no horizontal overflow at 760');
      for (const pane of frame.panes) {
        atLeast(frame.innerWidth, pane.right, `${pane.id} right edge inside a 760 window`);
      }

      const refused = [];
      for (const id of PILLS) {
        if ((await attr(page, WORKSPACE.pill(id), 'aria-disabled')) === 'true') refused.push(id);
      }
      atLeast(refused.length, 1, 'a 760px frame cannot seat all six views');

      /* Pressing one is not a no-op: it answers in a live region. */
      await pressPill(page, refused[0]);
      is(await attr(page, WORKSPACE.pill(refused[0]), 'data-on'), 'false', 'the refused pill stayed off');
      is(await count(page, WORKSPACE.refusal), 1, 'the refusal is on screen');
      is(await attr(page, WORKSPACE.refusal, 'role'), 'status', 'and it is announced');
    });

    /**
     * AND BACK. The arrangement is DERIVED from the frame, not consumed by it.
     * A view demoted at 760 that could not be reopened at 1280 would be a
     * reader who loses a pane by making the window small once.
     */
    await check('1280 again — the frame gives back every view its floor can seat', async () => {
      await resize(page, 1280, 800);

      /*
       * THIS CHECK USED TO ASSERT ALL SIX VIEWS SEATED AT 1280 — six columns
       * of ~171px, the exact sliver melt the 2026-08-29 screenshot audit
       * photographed, enshrined green because the bands asserted geometry and
       * never legibility. The honest contract: pressing every pill seats
       * exactly as many views as the SEAT floor allows, every seated pane is
       * at least a seat wide, and the rest are refused OUT LOUD — the same
       * pill refusal the narrow bands already assert, now governing count at
       * every width.
       */
      for (const id of PILLS) {
        if ((await attr(page, WORKSPACE.pill(id), 'aria-disabled')) === 'true') continue;
        if ((await attr(page, WORKSPACE.pill(id), 'data-on')) !== 'true') await pressPill(page, id);
      }

      const frame = await readFrame(page);
      const seatSlot = 280 + 8; /* WORKSPACE_PANE_SEAT_PX + resizer, mirrored */
      const capacity = Math.min(
        PILLS.length,
        Math.max(1, Math.floor((frame.bodyWidth + 8) / seatSlot)),
      );
      is(frame.panes.length, capacity, `the frame seats its capacity (${capacity}) at 1280`);
      atLeast(frame.panes.length, 3, 'a 1280 window seats at least three usable views');
      is(frame.trackTotal, frame.bodyWidth, 'and the tracks still total the container');
      is(frame.documentScrollWidth, frame.innerWidth, 'with nothing hanging off the edge');
      for (const pane of frame.panes) {
        atLeast(frame.innerWidth, pane.right, `${pane.id} right edge inside the window`);
        atLeast(pane.right - pane.left, 278, `${pane.id} is at least a seat wide`);
      }

      /* The refused remainder is spoken for: pill off, press answers aloud. */
      const refused = [];
      for (const id of PILLS) {
        if ((await attr(page, WORKSPACE.pill(id), 'aria-disabled')) === 'true') refused.push(id);
      }
      is(refused.length, PILLS.length - capacity, 'every unseated view is a refused pill');
      if (refused.length > 0) {
        await pressPill(page, refused[0]);
        is(await attr(page, WORKSPACE.pill(refused[0]), 'data-on'), 'false', 'the refused pill stayed off');
        is(await count(page, WORKSPACE.refusal), 1, 'and the refusal is on screen');
      }
    });

    /* ── 4. The attach flow, and a board drawn from a real scan ────────── */

    await check('the attach dialog opens the repository, and the board draws', async () => {
      // Arm the graph route BEFORE the dialog asks for it: POST /api/attach is
      // answered by the static route table; GET /archgraph.json is fulfilled
      // here with the real scan bytes.
      await page.route('**/archgraph.json', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) }),
      );

      await resize(page, 1280, 800);
      await page.locator(sel(SHELL.appbar)).getByRole('button', { name: 'Open a repository' }).click();
      await settle(page);
      atLeast(await count(page, 'attach'), 1, 'attach dialog on screen');

      // The real listing of fixtures/, so the row clicked names the directory
      // the scan actually ran on.
      const row = page.locator('[data-testid="attach-entry"]', { hasText: 'shopfront' });
      await row.first().getByRole('button').first().click();

      await page.locator(sel(WORKSPACE.pane('architecture'))).waitFor({ state: 'visible', timeout: 15000 });
      await page.locator(sel('board-node')).first().waitFor({ state: 'visible', timeout: 15000 });
      await settle(page);

      atLeast(await count(page, 'board-node'), 1, 'board nodes drawn from the real scan');
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
       * THE ASSERTION IS THE ABSENCE OF A NEWLINE, re-pointed when the store
       * wired sends for real: Enter may SEND (clearing the field) or be
       * refused (leaving the draft alone), but Composer.tsx preventDefaults
       * the key either way, so a newline never reaches the draft. That is the
       * browser-side half of the behaviour and the thing that would regress.
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
      const offenders = await page.evaluate(() => {
        const shipped = new Set(['400', '500', '600', '700']);
        const found = [];
        for (const el of document.querySelectorAll('*')) {
          const weight = getComputedStyle(el).fontWeight;
          if (shipped.has(weight)) continue;
          const id = el.getAttribute('data-testid');
          found.push(`${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} @ ${weight}`);
        }
        return [...new Set(found)];
      });

      is(offenders.length, 0, `weights no font file carries: ${offenders.join(' | ')}`);
    });

    await check('body and a control label paint two different, shipped cuts', async () => {
      const body = await page.evaluate(() => getComputedStyle(document.body).fontWeight);
      const label = await computed(page, SHELL.settingsGear, 'font-weight');

      is(SHIPPED_CUTS.has(body), true, `body weight ${body} is a shipped cut`);
      is(SHIPPED_CUTS.has(label), true, `control label weight ${label} is a shipped cut`);
      is(body, '400', 'body sits on --fw-body');
      is(label !== body, true, `a control label must not paint the body weight (both ${body})`);
    });

    /**
     * PRIMARY NAVIGATION IS NOT FOOTNOTE TYPE.
     *
     * Audited at 1280x720, the six pill labels that name every surface in the
     * app — and the rail rows beside them — painted at 10px and 11px, the two
     * rungs the ladder keeps for badges and units. A reader has to FIND these.
     * The floor is asserted as a number rather than as a token name because the
     * defect was in what PAINTED, not in what was declared.
     */
    await check('the pill bar and the rail are readable, not footnote type', async () => {
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('.shell-wpill-label, .shell-rail-act')].map((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        ),
      );
      atLeast(sizes.length, 6, 'the pill labels and rail rows are on screen');
      for (const size of sizes) atLeast(size, 12, 'primary navigation font-size');
    });

    /**
     * NO ELEMENT COMPUTES A SIZE OFF THE NINE-RUNG LADDER.
     *
     * The same shape as the weight check above, and for the same reason: the
     * invariant is about the whole document, so the check is too.
     *
     * WHAT IT ACTUALLY CAUGHT, stated precisely rather than generously. Form
     * controls do not inherit type — they start from the UA sheet, which in
     * Chrome is `13.3333px Arial`, a size on no rung and a family the app does
     * not bind. An audit of the running app counted 83 elements computing it.
     * Read one by one with Settings open they are ICON-ONLY buttons and their
     * SVG children: `.shell-ws-plus`, `.iconbtn`, `.plusbtn`, `.sendbtn`. So
     * the defect was a second, unchosen size in the cascade — NOT text painting
     * at the wrong size, and this check must not be read as claiming it was.
     * base.css makes controls inherit; this is what keeps them there.
     *
     * SETTINGS IS OPENED ON PURPOSE: the workspace's own chrome declares a size
     * on nearly every control, so the UA default only surfaces where a sheet
     * leans on inheritance, and Settings is the densest such surface — 19 of
     * the 83 sit there. A check on the boot screen alone was green with the
     * defect in place, which is how it was measured.
     */
    await check('every computed font-size is on the token ladder', async () => {
      await page.locator(sel(SHELL.settingsGear)).click();
      await page.waitForSelector(sel('overlay-settings'), { timeout: 15000 });
      await settle(page);

      const offenders = await page.evaluate(() => {
        const ladder = new Set([10, 11, 12, 13, 14, 15, 17, 20, 26]);
        const found = [];
        for (const el of document.body.querySelectorAll('*')) {
          const size = Number.parseFloat(getComputedStyle(el).fontSize);
          if (ladder.has(size)) continue;
          found.push(`${el.tagName.toLowerCase()}.${el.className} @ ${size}px`);
        }
        return [...new Set(found)];
      });

      await page.keyboard.press('Escape');
      is(offenders.length, 0, `font sizes off the ladder: ${offenders.join(' | ')}`);
    });
  },
  {
    routes: {
      /* No graph until the attach flow asks: the no-board boot is the first
         thing this spec asserts, and serving the graph up front would make it
         unreachable. */
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
