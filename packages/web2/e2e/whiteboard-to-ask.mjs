/* ══════════════════════════════════════════════════════════════════════════
   DRAW SOMETHING, HAND IT TO THE ASSISTANT
   packages/web2/e2e/whiteboard-to-ask.mjs

   Moat point 4 is "draw <-> chat sync", and `src/whiteboard/whiteboardAsk.ts`
   is where the whiteboard half of it lives. It had unit tests and NO
   real-browser test at all: nothing proved that a person can pick up a tool,
   draw, and get the drawing into the composer. jsdom cannot answer that - it
   has no layout, so a pointer drag across a canvas is not a thing it can
   perform - and the pure function being green says only that the function is
   green.

   ── THE THREE CLAIMS THIS FEATURE MAKES ──────────────────────────────────

   1. A BOARD OF UNLABELLED MARKS IS NOT A BRIEF. `askableFrom` is false until
      something on the board carries words, and the control is disabled rather
      than offering to send "the reader drew one box". Checked here by drawing
      a shape and asserting the control is STILL disabled - the assertion that
      a naive test would skip, because it looks like nothing happened.

   2. THE UNREADABLE MARKS ARE COUNTED OUT LOUD. A sketch with strokes on it
      produces a request that says how many of them carry no words, so the
      reader cannot believe the assistant is looking at their picture.

   3. IT LANDS IN THE COMPOSER, NEVER ON THE WIRE. The owner's constraint on
      the board's Generate gate, verbatim: "Drawing a box must NOT fire a code
      proposal. Generate is an explicit act with a confirmation step." A canvas
      gesture that started a metered run would be the same violation on another
      surface. Asserted here from the request log, not from the absence of a
      visible answer.

   ── WHY A REAL SCAN IS SERVED ────────────────────────────────────────────

   The canvas tabs only exist once a graph has been read - without one the app
   is on its "No graph yet" screen and there is no Whiteboard to open. So this
   pays for a scan the way `board-grounded.mjs` does.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CHAT } from './lib/anchors.mjs';
import { is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

/** Exit 2, never 1: "the analyzer is not built" is the harness unable to run. */
function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[whiteboard-to-ask] ERROR: the analyzer is not built, nothing to scan');
    console.error('[whiteboard-to-ask] run: pnpm --filter @sequence/analyzer build');
    process.exit(2);
  }
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'web2-whiteboard-e2e-')),
    'archgraph.json',
  );
  try {
    execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO,
    });
  } catch (error) {
    console.error('[whiteboard-to-ask] ERROR: sequence scan failed:', error.message);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const graph = scanRealRepo();

const WB = {
  tab: 'workspace-tab-whiteboard',
  canvas: 'wb-canvas',
  empty: 'wb-empty',
  item: 'wb-item',
  toolRect: 'wb-tool-rect',
  toolText: 'wb-tool-text',
  undo: 'wb-undo',
  clear: 'wb-clear',
  ask: 'wb-ask',
  panel: 'wb-ask-panel',
  note: 'wb-ask-note',
  send: 'wb-ask-send',
};

/** The sentence the request must always carry. Written once, checked verbatim. */
const NOT_EVIDENCE = 'This is from a whiteboard sketch, not from the scan — nothing on it is evidence.';

/** The reader's own words, which must survive into the prompt unchanged. */
const NOTE = 'Add a rate limiter in front of the gateway';

const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

const disabled = (page, testid) =>
  page.evaluate(
    `document.querySelector('[data-testid="${testid}"]')?.disabled ?? 'absent'`,
  );

await suite(
  'whiteboard-to-ask',
  async ({ page, base, check, requests }) => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector(sel(WB.tab), { timeout: 20000 });
    await page.click(sel(WB.tab));
    await settle(page);

    const canvas = await page.locator(sel(WB.canvas)).boundingBox();
    if (!canvas) throw new Error('harness: the whiteboard canvas has no box');
    /* Well inside the canvas, and clear of the tool row along its top. */
    const at = (dx, dy) => [canvas.x + canvas.width / 2 + dx, canvas.y + canvas.height / 2 + dy];

    await check('an empty board offers nothing to send', async () => {
      is(await page.locator(sel(WB.empty)).count(), 1, 'the empty state is drawn');
      is(await disabled(page, WB.ask), true, 'Ask about this is disabled on an empty board');
      is(await disabled(page, WB.undo), true, 'Undo is disabled on an empty board');
      is(await disabled(page, WB.clear), true, 'Clear is disabled on an empty board');
    });

    await check('A DRAWN SHAPE IS STILL NOT A BRIEF', async () => {
      /*
       * The claim a naive test would skip, because on the surface nothing
       * happened. Something did: the board now has a mark, so Undo and Clear
       * turn on - and Ask stays off, because a box with no words on it says
       * nothing the assistant could act on.
       */
      /* Shapes moved behind a dropdown (owner 2026-08-25: expandable features
         rather than an icon dump) — open the menu, then pick the tool. */
      await page.click('[data-testid="wb-shapes-trigger"]');
      await page.click(sel(WB.toolRect));
      const [x1, y1] = at(-160, -80);
      const [x2, y2] = at(-20, 20);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();
      await settle(page);

      is(await page.locator(sel(WB.item)).count(), 1, 'the drag drew exactly one mark');
      is(await page.locator(sel(WB.empty)).count(), 0, 'the empty state is gone');
      is(await disabled(page, WB.undo), false, 'Undo turns on once something is drawn');
      is(await disabled(page, WB.clear), false, 'Clear turns on once something is drawn');
      is(
        await disabled(page, WB.ask),
        true,
        'Ask about this must STAY disabled — an unlabelled mark is not a brief',
      );
    });

    await check('words on the board are what make it askable', async () => {
      /* Text lives in the Annotate dropdown — same shape as Shapes. */
      await page.click('[data-testid="wb-annotate-trigger"]');
      await page.click(sel(WB.toolText));
      const [tx, ty] = at(60, -40);
      await page.mouse.click(tx, ty);
      await settle(page);
      await page.keyboard.press('Escape');
      await settle(page);

      is(await page.locator(sel(WB.item)).count(), 2, 'the board now carries a shape and a note');
      is(await disabled(page, WB.ask), false, 'Ask about this turns on once a note exists');
    });

    await check('THE REQUEST LANDS IN THE COMPOSER, AND SAYS WHAT IT CANNOT READ', async () => {
      await page.click(sel(WB.ask));
      await page.waitForSelector(sel(WB.panel), { timeout: 5000 });
      await page.fill(sel(WB.note), NOTE);
      await page.click(sel(WB.send));
      await settle(page);

      const prompt = await page.evaluate(
        `document.querySelector('[data-testid="${CHAT.field}"]')?.value ?? ''`,
      );

      is(prompt.length > 0, true, 'the composer carries the request');
      is(prompt.includes(NOTE), true, `the reader's own sentence survives verbatim — got: ${prompt.slice(0, 120)}`);
      is(prompt.startsWith(NOTE), true, "the reader's sentence comes first");
      is(prompt.includes(NOT_EVIDENCE), true, 'the request says the sketch is not evidence');
      is(
        /1 mark with no words on (it|them)/.test(prompt) || prompt.includes('with no words'),
        true,
        `the unlabelled mark is counted out loud — got: ${prompt.slice(0, 240)}`,
      );
    });

    await check('AND NOTHING WENT ON THE WIRE', async () => {
      /*
       * The owner's constraint, checked from the request log rather than from
       * the absence of a visible answer - this origin serves no engine, so an
       * answer could not appear even if a run HAD been started, and "no answer
       * on screen" would be evidence of nothing at all.
       */
      const fired = requests.filter((url) => /\/api\/ask/.test(url));
      is(fired.length, 0, `a canvas gesture must not start a run — fired: ${fired.join(', ')}`);
    });
  },
  {
    routes: {
      '/archgraph.json': graph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
