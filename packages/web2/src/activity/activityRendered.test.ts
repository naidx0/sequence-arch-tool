// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* The harness lane's browser lookup, reused rather than re-authored — the same
   import review/reviewRendered.test.ts and canvas/boardRendered.test.ts make. */
// @ts-expect-error — e2e/lib is .mjs and ships no .d.ts.
import * as chromiumLib from '../../e2e/lib/chromium.mjs';

import { ACTIVITY } from './anchors';

const findChromium: () => string | null = chromiumLib.findChromium;
const launchOptions: (path: string) => Record<string, unknown> = chromiumLib.launchOptions;
const loadPlaywright: () => Promise<any> = chromiumLib.loadPlaywright;

/* ══════════════════════════════════════════════════════════════════════════
   THE RENDERED TIER FOR THE ACTIVITY VIEW — P9
   packages/web2/src/activity/activityRendered.test.ts

   WHY THIS FILE EXISTS, in this project's own words. R15: "no wave ships
   without a rendered screenshot compared against its sheet. The cream-canvas
   incident is this repo's own proof that computed-value assertions do not see a
   black rectangle."

   `ActivityPane.test.tsx` proves the BEHAVIOUR — one row per run, the absence
   drawn rather than counted, a real click opening a real run. It cannot prove
   one thing about paint, because jsdom has no layout and no cascade resolution
   for `var()`. Every claim below is about paint, and every one is a way this
   surface can be wrong while all sixty jsdom assertions stay green:

     · `--ac-tone` never resolves, so six states paint one ink and the hue this
       sheet spends buys nothing
     · a later stylesheet points the blocked tone at the failure token, and a
       run whose driver went away starts reading as a run that failed — §12.6's
       named defect, "teaches the reader to distrust every other red"
     · the pulse never starts, or something else starts pulsing beside it
     · a state word drops below the contrast floor and the surface communicates
       by dot alone, which sheet 12.5 forbids in those words
     · a run id or a long program name pushes the row wider than its box, so the
       whole pane scrolls sideways
     · type or rows drift off compact

   HOW IT FAILS: it SKIPS, loudly, when there is no Chromium. A missing browser
   is a fact about the machine, not about the product, and a suite that reports
   a machine fact as a product failure gets ignored within a week.
   ══════════════════════════════════════════════════════════════════════════ */

const HERE = resolve(__dirname);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

let server: Server | null = null;
let browser: any = null;
let page: any = null;
let skipReason = '';
const pageErrors: string[] = [];

async function serve(root: string): Promise<string> {
  const http = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname === '/' ? '/specimen.html' : url.pathname;
    /* 204, not 404: a browser asks for /favicon.ico unprompted, and one
       permanent unactionable console error is how a suite comes to stop
       asserting on the console at all. */
    if (path === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    try {
      const body = readFileSync(join(root, decodeURIComponent(path)));
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  server = http;
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

/**
 * FINISH THE ANIMATIONS BEFORE MEASURING ANYTHING — except the one that is
 * SUPPOSED to be running.
 *
 * `Animation.finish()` on an infinite animation throws, and the pulse on the
 * running dot is infinite by design. So this settles two frames rather than
 * forcing every animation to its end: a transition read mid-flight returns its
 * START value, and this project has already reported a start value as a final
 * one — but the pulse is a lock below, not noise to be silenced.
 */
async function settle() {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

beforeAll(async () => {
  const executablePath = findChromium();
  if (!executablePath) {
    skipReason = 'no Chromium found — the rendered tier cannot run on this machine';
    return;
  }
  const chromium = await loadPlaywright();
  if (!chromium) {
    skipReason = 'playwright-core is not installed';
    return;
  }

  // The real build pipeline, not a second one.
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const outDir = mkdtempSync(join(tmpdir(), 'seq-activity-'));

  await build({
    root: HERE,
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    base: './',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: join(HERE, 'specimen.html') } },
  });

  const base = await serve(outDir);
  browser = await chromium.launch(launchOptions(executablePath));
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('console', (message: any) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('pageerror', (error: Error) => pageErrors.push(`uncaught: ${error.message}`));
  page.on('response', (response: any) => {
    if (response.status() >= 400) pageErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  await page.goto(`${base}/specimen.html`, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector(`[data-testid="${ACTIVITY.row}"]`, { timeout: 15_000 });
  } catch {
    throw new Error(
      `the specimen did not mount. Console said: ${pageErrors.join(' | ') || '(nothing)'}`,
    );
  }
  await settle();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  /*
   * TEARDOWN GETS A BOUND, LIKE THE SETUP ABOVE ALREADY HAS.
   *
   * Closing a real Chromium and a real http server ran under vitest's 10s
   * default, which is not a number anyone chose for this work — while the setup
   * beside it is explicitly given minutes.
   *
   * Measured: these files pass standalone and fail inside a full gate with
   * "Hook timed out in 10000ms" when a dev server, the engine and a local model
   * are also running. Nothing about the code under test changes. A teardown that
   * fails only under load is the worst kind of red: indistinguishable from a
   * real defect, so it gets re-run, passes, and teaches everyone to disbelieve
   * the suite.
   */
}, 60_000);

const gate = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async () => {
      if (skipReason) {
        console.log(`SKIP: ${skipReason}`);
        return;
      }
      await fn();
    },
    60_000,
  );

/* ── WCAG 2.1, transcribed rather than depended on ───────────────────────── */

function channels(colour: string): [number, number, number, number] {
  const found = colour.match(/[\d.]+/g);
  if (!found || found.length < 3) throw new Error(`not a colour: ${JSON.stringify(colour)}`);
  return [
    Number(found[0]),
    Number(found[1]),
    Number(found[2]),
    found[3] === undefined ? 1 : Number(found[3]),
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(fg: string, bg: string): number {
  const f = channels(fg);
  const b = channels(bg);
  /* Composite a translucent foreground over its ground before measuring: an
     alpha the eye sees through is an alpha the arithmetic has to see through
     too, or every rgba() token scores as if it were opaque. */
  const over: [number, number, number] = [
    f[0] * f[3] + b[0] * (1 - f[3]),
    f[1] * f[3] + b[1] * (1 - f[3]),
    f[2] * f[3] + b[2] * (1 - f[3]),
  ];
  const l1 = luminance(over);
  const l2 = luminance([b[0], b[1], b[2]]);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Every state cell on the page: its status, its rendered word and its ink. */
function readStates() {
  return page.evaluate((ids: { row: string; state: string }) => {
    const rows = [...document.querySelectorAll(`[data-testid="${ids.row}"]`)] as HTMLElement[];
    return rows.map((row) => {
      const cell = row.querySelector(`[data-testid="${ids.state}"]`) as HTMLElement;
      const dot = cell.querySelector('.ac-dot') as HTMLElement;
      return {
        status: row.dataset.status ?? '',
        tone: row.dataset.tone ?? '',
        word: (cell.textContent ?? '').trim(),
        ink: getComputedStyle(cell).color,
        dotPaint: getComputedStyle(dot).backgroundColor,
        ground: getComputedStyle(document.body).backgroundColor,
        rowHeight: row.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(cell).fontSize),
        scrollW: row.scrollWidth,
        clientW: row.clientWidth,
      };
    });
  }, { row: ACTIVITY.row, state: ACTIVITY.rowState });
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe('LOCK — the state register paints, and every state is a word first', () => {
  gate('resolves a distinct ink for each tone the register uses', async () => {
    /*
     * `--ac-tone` is set by an attribute selector and consumed by `color`. If
     * the mapping block is deleted, mis-scoped, or points at a token that does
     * not exist, `var(--ac-tone, var(--ink-2))` falls through to the fallback
     * and SIX STATES PAINT ONE INK — a surface whose whole visual budget went
     * on nothing, and which no declared-token test can see.
     */
    const states = await readStates();
    expect(states.length).toBeGreaterThan(0);

    const inkByTone = new Map<string, string>();
    for (const s of states) inkByTone.set(s.tone, s.ink);
    // The specimen shows running · paused · interrupted · completed · failed ·
    // stopped, which is five distinct tones (stopped and interrupted share one).
    expect(inkByTone.size).toBeGreaterThanOrEqual(4);
    expect(new Set(inkByTone.values()).size).toBe(inkByTone.size);
  });

  gate('says every state in a word, and the words are all different', async () => {
    /*
     * SHEET 12.5, MEASURED: "Every state is written out as a word as well as
     * drawn as a dot… no state in this product is communicated by colour
     * alone." This is the greyscale invariant for this surface — strip every
     * hue and the rows must still be tellable apart, which is true if and only
     * if the words are distinct and non-empty.
     */
    const states = await readStates();
    const words = states.map((s: { word: string }) => s.word);
    for (const word of words) expect(word.length).toBeGreaterThan(0);
    expect(new Set(words).size).toBe(new Set(states.map((s: { status: string }) => s.status)).size);
  });

  gate('keeps every state word above the contrast floor it is rendered at', async () => {
    /*
     * A state word IS the claim, so it has to be readable — and a verdict hue on
     * a dark ground is exactly where a token drifts below the floor without
     * anybody noticing, because the author knows what it says. 11px is body
     * text under WCAG, so the floor is 4.5.
     */
    const states = await readStates();
    for (const s of states) {
      const ratio = contrast(s.ink, s.ground);
      expect(ratio, `${s.status} ("${s.word}") measured ${ratio}:1 against the pane`).toBeGreaterThanOrEqual(4.5);
    }
  });

  gate('paints a run whose driver went away differently from a run that failed', async () => {
    /*
     * §12.6, MEASURED OFF THE RENDERED COLOUR RATHER THAN OFF A TOKEN NAME.
     * "Red means the check ran and the answer was no. Painting a missing
     * prerequisite red teaches the reader to distrust every other red on the
     * screen, which is the only defence the product has." `interrupted` and
     * `stopped` did not fail at anything. A stylesheet that pointed the blocked
     * tone at the failure token would keep every jsdom assertion green.
     */
    const states = await readStates();
    const ink = (status: string) =>
      states.find((s: { status: string }) => s.status === status)?.ink;
    expect(ink('interrupted')).not.toBe(ink('failed'));
    expect(ink('stopped')).not.toBe(ink('failed'));
    expect(ink('completed')).not.toBe(ink('failed'));
    // And the two that DID reach a verdict are told apart from each other.
    expect(ink('completed')).not.toBe(ink('running'));
  });

  gate('animates the running run and nothing else', async () => {
    /*
     * §12.5: "Running is the only animated object on the surface, and it pulses
     * rather than spins: a spinner says 'wait', a pulse says 'still true'." Two
     * failures are caught here and neither is visible to a declared-value test:
     * a keyframe that never starts, and a second object that starts moving.
     */
    const moving = await page.evaluate((rowId: string) => {
      const animated = document
        .getAnimations()
        .map((a) => (a.effect as KeyframeEffect | null)?.target as Element | null)
        .filter((el): el is Element => el !== null);
      return animated.map((el) => {
        const row = el.closest(`[data-testid="${rowId}"]`) as HTMLElement | null;
        return { tag: el.className?.toString() ?? '', status: row?.dataset.status ?? null };
      });
    }, ACTIVITY.row);

    expect(moving.length, 'nothing is pulsing — the one live signal never started').toBeGreaterThan(0);
    for (const m of moving) {
      expect(m.status, `something outside a running row is animating: ${JSON.stringify(m)}`).toBe(
        'running',
      );
    }
  });
});

describe('LOCK — compact holds and nothing overflows its box', () => {
  gate('keeps the rows on the compact ladder', async () => {
    const states = await readStates();
    for (const s of states) {
      /* 28px is --row-h-thread. "Airy is a defect" — and a row that has grown
         to 40 is a row whose padding was tuned by eye against the wrong sheet. */
      expect(s.rowHeight, `a run row measured ${s.rowHeight}px`).toBeLessThanOrEqual(30);
      expect(s.fontSize).toBeGreaterThanOrEqual(10);
      expect(s.fontSize).toBeLessThanOrEqual(12);
    }
  });

  gate('fits every row inside its own width', async () => {
    /* A run id is 20-odd mono characters and a program name is arbitrary. If
       the program cell does not actually shrink, the row overflows and the
       first thing a reader loses is the elapsed and the state on the right. */
    const states = await readStates();
    for (const s of states) {
      expect(s.scrollW, `a row overflows: ${s.scrollW} > ${s.clientW}`).toBeLessThanOrEqual(
        s.clientW + 1,
      );
    }
  });

  gate('lines the right-hand cluster up down the whole list', async () => {
    /*
     * FOUND BY LOOKING AT THE SCREENSHOT, WHICH IS THE POINT OF WRITING ONE.
     * Every jsdom assertion was green and every rendered lock above passed
     * while the `1/3 nodes` cell started at a different x on each row: the meta
     * cluster was right-aligned as a group, and the run id inside it is a
     * different length on every run (`run-running-…` against
     * `run-interrupted-…`), so the two cells to its left slid with it.
     *
     * That is the legibility gate's own named defect — "no two sibling rows
     * read the same" applies to their geometry as much as to their words. A
     * column that walks left and right down a list cannot be scanned, which is
     * the single thing a triage list has to be good at.
     *
     * Measured as LEFT EDGES rather than as a CSS rule, because the rule that
     * produces the alignment is not the thing that matters — a later change to
     * the id's width, the gap or the font would break the alignment while
     * leaving any rule-shaped assertion green.
     */
    const edges = await page.evaluate((ids: { row: string; progress: string }) => {
      const rows = [...document.querySelectorAll(`[data-testid="${ids.row}"]`)] as HTMLElement[];
      const left = (row: HTMLElement, sel: string) => {
        const el = row.querySelector(sel) as HTMLElement | null;
        return el ? el.getBoundingClientRect().left - row.getBoundingClientRect().left : null;
      };
      return rows.map((row) => ({
        status: row.dataset.status ?? '',
        progress: left(row, `[data-testid="${ids.progress}"]`),
        span: left(row, '.ac-span'),
        program: left(row, '.ac-program'),
      }));
    }, { row: ACTIVITY.row, progress: ACTIVITY.rowProgress });

    for (const key of ['progress', 'span', 'program'] as const) {
      const seen = edges
        .map((e: Record<string, number | null>) => e[key])
        .filter((v: number | null): v is number => v !== null);
      expect(seen.length, `no row drew a ${key} cell`).toBeGreaterThan(1);
      const spread = Math.max(...seen) - Math.min(...seen);
      expect(
        spread,
        `the ${key} column walks ${Math.round(spread)}px across the list: ${JSON.stringify(edges)}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  gate('does not scroll the pane sideways', async () => {
    const pane = await page.evaluate((id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    }, ACTIVITY.root);
    expect(pane.scrollW).toBeLessThanOrEqual(pane.clientW + 1);
  });

  gate('draws the absence at the same weight as the list, and counts nothing there', async () => {
    /*
     * THE SECOND PANE ON THE SPECIMEN. `groundedSweep.test.tsx` polices what
     * this surface may SAY with no run list; this checks that saying it is
     * legible in the space it actually has — an unreadable honest answer is
     * still an answer nobody can act on.
     */
    const absent = await page.evaluate(
      (ids: { host: string; note: string; bar: string }) => {
        const host = document.querySelector(`[data-testid="${ids.host}"]`) as HTMLElement;
        const note = host.querySelector(`[data-testid="${ids.note}"]`) as HTMLElement;
        if (!note) return null;
        const box = note.getBoundingClientRect();
        return {
          text: (note.textContent ?? '').trim(),
          ink: getComputedStyle(note).color,
          ground: getComputedStyle(note).backgroundColor,
          bodyGround: getComputedStyle(document.body).backgroundColor,
          height: box.height,
          clipped: note.scrollHeight > note.clientHeight + 1,
          hasBar: host.querySelector(`[data-testid="${ids.bar}"]`) !== null,
        };
      },
      { host: 'specimen-absent', note: ACTIVITY.unanswered, bar: ACTIVITY.bucketBar },
    );

    expect(absent, 'the absent-list specimen drew no note at all').not.toBeNull();
    expect(absent.hasBar, 'a filter bar was painted over a run list that does not exist').toBe(false);
    expect(absent.text).not.toMatch(/\d/);
    expect(absent.clipped, 'the absence is clipped by its own box').toBe(false);
    // The wash is translucent, so contrast is measured against what is behind it.
    const ratio = contrast(absent.ink, absent.bodyGround);
    expect(ratio, `the absence measured ${ratio}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('TIER 4 — the page a human looks at', () => {
  gate('loads with a clean console', async () => {
    expect(pageErrors).toEqual([]);
  });

  gate('writes a screenshot for the sheet comparison', async () => {
    /* R15. The file is written where the review and board tiers write theirs,
       and its path is printed so a human can open it without hunting. */
    const file = join(tmpdir(), 'seq-activity-specimen.png');
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[tier 4] screenshot: ${file}`);
    expect(readFileSync(file).length).toBeGreaterThan(1000);
  });
});
