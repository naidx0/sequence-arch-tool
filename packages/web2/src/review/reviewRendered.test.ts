// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* The harness lane's browser lookup, reused rather than re-authored — the same
   import canvas/boardRendered.test.ts makes, for the same reason. */
// @ts-expect-error — e2e/lib is .mjs and ships no .d.ts.
import * as chromiumLib from '../../e2e/lib/chromium.mjs';

import { REVIEW } from './anchors';

const findChromium: () => string | null = chromiumLib.findChromium;
const launchOptions: (path: string) => Record<string, unknown> = chromiumLib.launchOptions;
const loadPlaywright: () => Promise<any> = chromiumLib.loadPlaywright;

/* ══════════════════════════════════════════════════════════════════════════
   THE RENDERED TIER FOR REVIEW — the locks no jsdom test can evaluate
   packages/web2/src/review/reviewRendered.test.ts

   WHY THIS FILE EXISTS, in this project's own words rather than as a
   principle. R15: "no wave ships without a rendered screenshot compared
   against its sheet. The cream-canvas incident is this repo's own proof that
   computed-value assertions do not see a black rectangle." And `8d38fad3`'s
   closing line, which is still live: "nobody has looked at this with human
   eyes."

   `ReviewPane.test.tsx` proves the BEHAVIOUR — one PUT, one path, `path:42` in
   the composer. It cannot prove a single thing about paint, because jsdom has
   no layout and no cascade resolution for var(). Every claim below is about
   paint, and every one of them is a way this surface can be wrong while all
   106 jsdom assertions stay green:

     · a wash that never resolved, so an added line looks like a context line
     · a foreground tint on an added line, which the book explicitly forbids
     · a syntax palette pasted in later, which breaks law 1 on the one surface
       whose real hues are the diff's own arithmetic
     · a gutter that collapsed to zero width, or overlaps the code
     · a code column that scrolls the whole page instead of scrolling itself
     · type or controls that drifted off compact

   THE DIFF IS REAL. A throwaway repository is created, committed to and
   edited, and the bytes `git diff --no-color HEAD` produced are injected into
   the page before it loads. What is measured is the dialect the engine serves.

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
    /* A BROWSER ASKS FOR /favicon.ico ON ITS OWN, unprompted by the document,
       and answering it 404 puts a console error on a page that is otherwise
       clean. That matters here because the Tier-4 gate ASSERTS the console is
       empty — and the usual reaction to one permanent unactionable error is to
       stop asserting on the console at all, which is how the next real error
       goes unseen. 204 is the honest answer: there is no icon, and that is not
       a failure of anything. */
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

/** A real repository, a real `git diff`. */
function realDiff(): { diff: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'seq-review-repo-'));
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t.test', '-c', 'user.name=t', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  git(['init', '-q', '-b', 'main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  const file = join(root, 'src', 'auth.ts');
  writeFileSync(
    file,
    ['export function verify(token: string) {', '  const claims = decode(token);', '  if (!claims) return null;', '  return claims;', '}', ''].join('\n'),
  );
  git(['add', '-A']);
  git(['commit', '-qm', 'first']);
  writeFileSync(
    file,
    [
      'export function verify(token: string) {',
      '  const claims = decode(token);',
      '  if (!claims) throw new AuthError("unreadable token"); // the refusal is explicit',
      '  if (claims.exp < now()) throw new AuthError("expired, and this line is deliberately long enough that the code column must scroll inside the diff rather than scrolling the page");',
      '  return claims;',
      '}',
      '',
    ].join('\n'),
  );
  return { diff: git(['diff', '--no-color', 'HEAD', '--', 'src/auth.ts']), path: 'src/auth.ts' };
}

/**
 * FINISH THE ANIMATIONS BEFORE MEASURING ANYTHING.
 *
 * review.css transitions nothing today, but the comment affordance goes from
 * opacity 0 to 1 and the buttons change background on hover. A transition read
 * mid-flight returns its START value, and this project has already reported a
 * start value as a final one.
 */
async function settle() {
  await page.evaluate(() => {
    document.getAnimations().forEach((animation: Animation) => animation.finish());
  });
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
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

  let specimen: { diff: string; path: string };
  try {
    specimen = realDiff();
  } catch (error) {
    /* A MISSING git IS A MACHINE FACT, exactly like a missing browser, and it
       is reported as one rather than as a broken diff view. */
    skipReason = `git is not usable on this machine — ${(error as Error).message}`;
    return;
  }
  if (!specimen.diff.includes('@@')) {
    skipReason = 'git produced no hunk for the specimen edit';
    return;
  }

  // The real build pipeline, not a second one.
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const outDir = mkdtempSync(join(tmpdir(), 'seq-review-'));

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
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (message: any) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('pageerror', (error: Error) => pageErrors.push(`uncaught: ${error.message}`));
  /* THE URL, NOT JUST "A RESOURCE FAILED". Chrome's console message for a 404
     names no path, so a bad asset reference reports as an unactionable line and
     the usual reaction is to stop asserting on the console. Recording the
     response is what makes the assertion worth keeping. */
  page.on('response', (response: any) => {
    if (response.status() >= 400) pageErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.addInitScript((payload: unknown) => {
    (window as unknown as { __REVIEW_SPECIMEN__: unknown }).__REVIEW_SPECIMEN__ = payload;
  }, specimen);

  await page.goto(`${base}/specimen.html`, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector(`[data-testid="${REVIEW.diff}"]`, { timeout: 15_000 });
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

/** Parse a computed `rgb()` / `rgba()` string into channels. */
function channels(colour: string): [number, number, number, number] {
  const found = colour.match(/[\d.]+/g);
  if (!found || found.length < 3) throw new Error(`not a colour: ${JSON.stringify(colour)}`);
  return [Number(found[0]), Number(found[1]), Number(found[2]), found[3] === undefined ? 1 : Number(found[3])];
}

/** How far a colour is from grey. 0 for any shade of grey. */
function chroma(colour: string): number {
  const [r, g, b] = channels(colour);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe('LOCK — the diff channel paints, and it paints only the background', () => {
  gate('resolves an add wash and a remove wash, and they are not the same paint', async () => {
    const paints = await page.evaluate((id: string) => {
      const lines = [...document.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
      const pick = (kind: string) => lines.find((l) => l.dataset.kind === kind);
      const add = pick('add');
      const del = pick('del');
      const ctx = pick('context');
      if (!add || !del || !ctx) throw new Error('the specimen has no add, remove and context line');
      return {
        add: getComputedStyle(add).backgroundColor,
        del: getComputedStyle(del).backgroundColor,
        ctx: getComputedStyle(ctx).backgroundColor,
        addShadow: getComputedStyle(add).boxShadow,
        delShadow: getComputedStyle(del).boxShadow,
      };
    }, REVIEW.line);

    /* A WASH THAT NEVER RESOLVED IS TRANSPARENT, and a transparent add line
       looks exactly like a context line — the whole surface reduced to
       unmarked text. This is the failure the token name existing cannot
       prevent and only the rendered value can catch. */
    expect(channels(paints.add)[3]).toBeGreaterThan(0);
    expect(channels(paints.del)[3]).toBeGreaterThan(0);
    expect(paints.add).not.toBe(paints.del);
    expect(paints.add).not.toBe(paints.ctx);
    expect(paints.del).not.toBe(paints.ctx);

    /* The brighter inset edge — the token file's `--diffx-gutter-w` inset
       shadow. Without it the wash alone is a very low-contrast rectangle. */
    expect(paints.addShadow).not.toBe('none');
    expect(paints.delShadow).not.toBe('none');
    expect(paints.addShadow).not.toBe(paints.delShadow);
  });

  gate('tints no foreground — the code ink is identical on add, remove and context', async () => {
    /* THE BOOK'S OWN RULE, transcribed at tokens/graphite.css:116: the diff
       channel is "background wash only, never foreground". A green line of
       code is a claim that the code is GOOD, which is not what an added line
       means, and it also drags eighty characters of saturation onto a surface
       whose hue budget is two counts in a header. */
    const inks = await page.evaluate((id: string) => {
      const lines = [...document.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
      const inkOf = (kind: string) => {
        const row = lines.find((l) => l.dataset.kind === kind);
        const code = row?.querySelector('.rv-code');
        if (!code) throw new Error(`no code cell on a ${kind} line`);
        return getComputedStyle(code).color;
      };
      return { add: inkOf('add'), del: inkOf('del'), ctx: inkOf('context') };
    }, REVIEW.line);

    expect(inks.add).toBe(inks.ctx);
    expect(inks.del).toBe(inks.ctx);
  });
});

describe('LOCK — the highlighter spends no hue, measured off the rendered colour', () => {
  gate('paints every syntax class in a grey', async () => {
    /* GRAPHITE LAW 1, and this is the ONLY tier that can enforce it. The class
       list is asserted in syntax.test.ts; what a class RESOLVES TO is a
       cascade question, and the way this rule dies is a later stylesheet
       pointing .rv-t-kw at --info. A declared token name cannot see that.
       Every token also has to remain READABLE, so the ink is checked for
       presence as well as for greyness. */
    const measured = await page.evaluate(() => {
      /* THE RAMP AND THE VERDICTS ARE READ OFF THE LIVE DOCUMENT TOO, so the
         bound below is calibrated against the token layer rather than against
         a number typed here. A hardcoded threshold is a second source of truth
         about what "grey" means in this product, and the first draft of this
         test used one: it failed on --ink-4, because the book's ink ramp is
         deliberately COOL rather than neutral, so "chroma <= 6" was a claim
         about the tokens that the tokens do not make. Reading them is the fix;
         loosening the number would have been the weakening.

         (The failing value is deliberately not quoted here. The firewall bans
         a colour literal outside the token file even inside a comment, and it
         caught this paragraph's first draft — correctly.) */
      const read = (name: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const classes = ['rv-t-kw', 'rv-t-str', 'rv-t-num', 'rv-t-com'];
      const out: Record<string, string | null> = {};
      for (const cls of classes) {
        const el = document.querySelector(`.${cls}`) as HTMLElement | null;
        out[cls] = el ? getComputedStyle(el).color : null;
      }
      return {
        classes: out,
        ramp: ['--ink-1', '--ink-2', '--ink-3', '--ink-4'].map(read),
        verdicts: ['--fits', '--wont', '--spills', '--info', '--accent'].map(read),
      };
    });

    const rampCeiling = Math.max(...measured.ramp.map(chroma));
    const verdictFloor = Math.min(...measured.verdicts.map(chroma));
    /* The two populations must not be near each other, or the assertion below
       says nothing. Measured on the frozen book: the ramp tops out around 9 and
       the least chromatic verdict is around 100. */
    expect(verdictFloor).toBeGreaterThan(rampCeiling * 4);

    const seen = Object.entries(measured.classes).filter(([, colour]) => colour !== null);
    /* The specimen's own diff contains a keyword, a string and a comment. If
       it stops containing them this assertion says so, rather than passing
       against a page with nothing to measure. */
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const [cls, colour] of seen) {
      /* NO MORE CHROMATIC THAN THE INK RAMP ITSELF. That is the whole claim:
         a syntax class may be any ink, and may be no hue. Pointing .rv-t-kw at
         --info or --fits fails by an order of magnitude. */
      expect(chroma(colour as string), `${cls} painted ${colour}`).toBeLessThanOrEqual(rampCeiling);
      expect(channels(colour as string)[3]).toBeGreaterThan(0);
    }
  });
});

describe('LOCK — the gutter is legible: two columns, disjoint, non-zero', () => {
  gate('gives both line numbers real width and never overlaps the code', async () => {
    /* THE LEGIBILITY GATE'S OWN QUESTIONS, asked of this surface: "nothing
       overflows its box, no two texts overlap, nothing is clipped silently."
       A grid whose first two columns collapse renders the numbers on top of
       the code, and every jsdom assertion about `data-new` still passes. */
    const boxes = await page.evaluate((id: string) => {
      const line = [...document.querySelectorAll(`[data-testid="${id}"]`)].find(
        (l) => (l as HTMLElement).dataset.kind === 'context',
      ) as HTMLElement;
      const cells = [...line.children] as HTMLElement[];
      return cells.map((c) => {
        const r = c.getBoundingClientRect();
        return { cls: c.className, left: r.left, right: r.right, width: r.width };
      });
    }, REVIEW.line);

    const [oldNum, newNum, , , code] = boxes;
    expect(oldNum.width).toBeGreaterThan(0);
    expect(newNum.width).toBeGreaterThan(0);
    /* Disjoint, in order, left to right. */
    expect(oldNum.right).toBeLessThanOrEqual(newNum.left + 0.5);
    expect(newNum.right).toBeLessThanOrEqual(code.left + 0.5);
  });

  gate('numbers the two gutters with the real file’s numbers', async () => {
    const rows = await page.evaluate((id: string) => {
      return [...document.querySelectorAll(`[data-testid="${id}"]`)].map((l) => {
        const el = l as HTMLElement;
        const cells = [...el.children] as HTMLElement[];
        return {
          kind: el.dataset.kind,
          old: el.dataset.old ?? null,
          new: el.dataset.new ?? null,
          /* WHAT THE GUTTER ACTUALLY PAINTS, not what the attribute says. The
             two disagreeing is precisely how a comment anchors to the wrong
             line while every attribute assertion stays green. */
          oldText: cells[0].textContent,
          newText: cells[1].textContent,
        };
      });
    }, REVIEW.line);

    for (const row of rows) {
      expect(row.oldText).toBe(row.old ?? '');
      expect(row.newText).toBe(row.new ?? '');
    }
    const removed = rows.filter((r: { kind?: string }) => r.kind === 'del');
    expect(removed.length).toBeGreaterThan(0);
    /* A removed line paints an EMPTY new-number cell — it occupies no line in
       the new file, and a number there would be somewhere to send an agent
       that does not exist. */
    for (const row of removed) expect(row.newText).toBe('');
  });
});

describe('LOCK — the page does not scroll sideways; the diff scrolls inside itself', () => {
  gate('keeps a very long code line inside the diff’s own scroller', async () => {
    const measured = await page.evaluate((ids: { root: string; diff: string }) => {
      const root = document.querySelector(`[data-testid="${ids.root}"]`) as HTMLElement;
      const diff = document.querySelector(`[data-testid="${ids.diff}"]`) as HTMLElement;
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rootOverflow: root.scrollWidth - root.clientWidth,
        diffOverflow: diff.scrollWidth - diff.clientWidth,
        diffOverflowX: getComputedStyle(diff).overflowX,
      };
    }, { root: REVIEW.root, diff: REVIEW.diff });

    /* THE SPECIMEN'S LONG LINE IS THERE TO MAKE THIS QUESTION REAL. If the
       diff did not scroll itself, that line would push the document sideways
       and take the chat column and the canvas with it. */
    expect(measured.diffOverflowX).toBe('auto');
    expect(measured.diffOverflow).toBeGreaterThan(0);
    expect(measured.docOverflow).toBeLessThanOrEqual(1);
    expect(measured.rootOverflow).toBeLessThanOrEqual(1);

    /* AND THE REGION ACTUALLY SCROLLS — the legibility gate's own requirement,
       "every scrollable region scrolls", asked by scrolling it.

       AN EARLIER DRAFT OF THIS ASSERTION MEASURED A RESERVED SCROLLBAR TRACK
       INSTEAD, on the reasoning that an overlay scrollbar makes the clip
       silent. It was measuring the BROWSER, not the product: this Chromium
       paints overlay scrollbars regardless of styling, so the assertion could
       only ever have been satisfied by a cosmetic workaround for one engine's
       rendering mode. What matters to a reader is whether the rest of the line
       is REACHABLE, and that is this. */
    const scrolled = await page.evaluate((id: string) => {
      const diff = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      diff.scrollLeft = 400;
      const landed = diff.scrollLeft;
      diff.scrollLeft = 0;
      return landed;
    }, REVIEW.diff);
    expect(scrolled, 'the diff overflows but cannot be scrolled to').toBeGreaterThan(0);
  });

  gate('leaves the diff column wider than the impact panel at 1280', async () => {
    /* A diff has a hard minimum useful width — two gutters, a sign column and
       a line of code. Letting the side panel squeeze it is what turns a review
       surface into a word-wrapped mess, and R9 is this project's own record of
       exactly that arithmetic going unchecked. */
    const widths = await page.evaluate((ids: { files: string; impact: string }) => {
      const files = document.querySelector('.rv-files') as HTMLElement;
      const impact = document.querySelector(`[data-testid="${ids.impact}"]`) as HTMLElement;
      return { files: files.getBoundingClientRect().width, impact: impact.getBoundingClientRect().width };
    }, { files: REVIEW.file, impact: REVIEW.impact });

    expect(widths.files).toBeGreaterThan(widths.impact);
  });
});

describe('LOCK — compact is the only density', () => {
  gate('renders every text in the pane at 10, 11 or 12 pixels', async () => {
    /* CANON law 3: "Compact is the only density. Working type 10/11/12px…
       Airy is a defect." Measured on the RENDERED size, so a rem that
       resolved against a different root, or an inherited browser default on an
       <h3> or an <input>, is caught — none of which a stylesheet grep sees. */
    const sizes = await page.evaluate((id: string) => {
      const root = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const seen = new Map<string, string[]>();
      for (const el of [root, ...root.querySelectorAll('*')] as HTMLElement[]) {
        if (el.tagName === 'SVG' || el.closest('svg')) continue;
        const hasOwnText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
        );
        if (!hasOwnText) continue;
        const size = getComputedStyle(el).fontSize;
        const where = seen.get(size) ?? [];
        if (where.length < 3) where.push(`${el.tagName}.${el.className}`);
        seen.set(size, where);
      }
      return [...seen.entries()];
    }, REVIEW.root);

    expect(sizes.length).toBeGreaterThan(0);
    for (const [size, where] of sizes) {
      const px = Number(size.replace('px', ''));
      expect(px, `${size} on ${where.join(', ')}`).toBeGreaterThanOrEqual(10);
      expect(px, `${size} on ${where.join(', ')}`).toBeLessThanOrEqual(12);
    }
  });

  gate('holds the control ladder: a 28px control and a 26px icon button', async () => {
    const measured = await page.evaluate((ids: { head: string; accept: string }) => {
      const head = document.querySelector(`[data-testid="${ids.head}"]`) as HTMLElement;
      const btn = document.querySelector('.rv-icon-btn') as HTMLElement | null;
      const solid = document.querySelector('.rv-btn') as HTMLElement | null;
      return {
        fileHead: head.getBoundingClientRect().height,
        iconBtn: btn ? btn.getBoundingClientRect().height : null,
        control: solid ? solid.getBoundingClientRect().height : null,
      };
    }, { head: REVIEW.fileHead, accept: REVIEW.accept });

    expect(measured.fileHead).toBeCloseTo(28, 0);
    if (measured.control !== null) expect(measured.control).toBeCloseTo(28, 0);
    if (measured.iconBtn !== null) expect(measured.iconBtn).toBeCloseTo(26, 0);
  });
});

describe('LOCK — the comment affordance exists for a pointer AND for a keyboard', () => {
  gate('is invisible at rest and visible on hover', async () => {
    /* A control that is always visible puts a plus sign on every line of a
       four-hundred-line diff; a control that is absent from the layout makes
       every line jump under the pointer. Reserving the space and revealing the
       ink is the only arrangement that does neither — and whether it actually
       reveals is a rendered fact. */
    const first = `[data-testid="${REVIEW.line}"] [data-testid="${REVIEW.commentAdd}"]`;
    const rest = await page.$eval(first, (el: Element) => getComputedStyle(el).opacity);
    expect(Number(rest)).toBe(0);

    await page.hover(first);
    await settle();
    const hovered = await page.$eval(first, (el: Element) => getComputedStyle(el).opacity);
    expect(Number(hovered)).toBe(1);
  });
});

describe('LOCK — the refusal is a rendered surface, not a blank box', () => {
  gate('paints the unserved scope’s gap with words in it', async () => {
    const gap = await page.evaluate((ids: { gap: string; diff: string }) => {
      const host = document.querySelector('[data-testid="specimen-gap"]') as HTMLElement;
      const el = host.querySelector(`[data-testid="${ids.gap}"]`) as HTMLElement | null;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        text: el.textContent ?? '',
        width: box.width,
        height: box.height,
        diffs: host.querySelectorAll(`[data-testid="${ids.diff}"]`).length,
      };
    }, { gap: REVIEW.gap, diff: REVIEW.diff });

    expect(gap).not.toBeNull();
    expect(gap!.width).toBeGreaterThan(0);
    expect(gap!.height).toBeGreaterThan(0);
    /* IT NAMES THE REASON. An empty state that says "not available" teaches the
       reader nothing.
       All five listed scopes are served now, so the specimen draws this arm
       with a scope the register never heard of — `scopeSupport` is TOTAL and
       its fallback is a refusal rather than a default, and that is what must
       not regress. */
    expect(gap!.text).toMatch(/no route is registered/i);
    /* AND IT SHOWS NO DIFF. Rendering the unstaged diff under the "Commit"
       heading is the exact lie the scope register exists to prevent. */
    expect(gap!.diffs).toBe(0);
  });
});

describe('TIER 4 — the page a human looks at', () => {
  gate('writes a screenshot for the sheet comparison', async () => {
    /* R15's requirement, and it is a requirement rather than a nicety: three
       rounds of this project shipped green while the app was visibly broken,
       and only a screenshot ever showed it. The path is printed so the next
       reader does not have to find it. */
    const shot = join(tmpdir(), 'seq-review-specimen.png');
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`[tier 4] screenshot: ${shot}`);
    expect(pageErrors, `the specimen logged errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});

describe('LOCK — every text on the surface is actually readable where it sits', () => {
  gate('clears the legibility floor against its own COMPOSITED background', async () => {
    /* THE LOCK THIS SURFACE MOST NEEDED, and it caught three real defects the
       106 jsdom assertions could not see, because all three were valid token
       names in valid CSS:

         .rv-sign  painted at 1.19:1 — the + and the − were, in practice, not
                   on the screen. --diffx-add-strong is a 46% mix meant as an
                   intraline BACKGROUND run, and used as a foreground on one
                   glyph it is invisible.
         .rv-num   2.05:1 on the add wash — the gutter a line comment is
                   anchored by. --ink-4 is the ramp's DISABLED step, not its
                   quiet one.
         .rv-t-com 2.05:1 — a comment should be the quietest thing in a line,
                   not an absent one.

       THE BACKGROUND IS COMPOSITED, NOT READ. Every wash on this surface is a
       translucent rgba over a translucent surface over the base, so
       `getComputedStyle(el).backgroundColor` on the text's own element returns
       `rgba(0,0,0,0)` and a naive check divides by the page background and
       reports everything as fine. Walking the ancestors and alpha-compositing
       is the only way to ask what the eye is actually looking at.

       THE FLOOR IS 3.0 AND THE EXEMPTION IS NAMED. WCAG's 4.5 is for body
       text at default size; this product's working type is 10–12px and its
       quiet ramp is deliberate, so 3.0 — the floor for UI components and
       large text — is the honest bar for the ramp's dim end, and everything
       carrying the actual message clears more. `:disabled` is exempt BY
       SELECTOR rather than by threshold: sheet 12.4 rules that disabled is a
       different object, --surface-3 with --ink-4, and a disabled control that
       read as loudly as a live one would be the defect. */
    const worst = await page.evaluate((id: string) => {
      const root = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const ch = (c: string) => (c.match(/[\d.]+/g) ?? ['0', '0', '0', '1']).map(Number);
      const over = (fg: number[], bg: number[]) => {
        const a = fg[3] === undefined ? 1 : fg[3];
        return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
      };
      const lum = (c: number[]) => {
        const f = c.map((v) => {
          const srgb = v / 255;
          return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
      };
      const bgOf = (el: HTMLElement) => {
        const stack: number[][] = [];
        let node: HTMLElement | null = el;
        while (node) {
          const c = ch(getComputedStyle(node).backgroundColor);
          if ((c[3] ?? 1) > 0) stack.push(c);
          node = node.parentElement;
        }
        let base = ch(getComputedStyle(document.body).backgroundColor).slice(0, 3);
        if (base.every((v) => v === 0)) base = [13, 13, 15];
        for (const c of stack.reverse()) base = over(c, base);
        return base;
      };

      const out: { where: string; ratio: number; text: string }[] = [];
      for (const el of [root, ...root.querySelectorAll('*')] as HTMLElement[]) {
        if (el.closest('svg')) continue;
        if (el.matches(':disabled') || el.closest(':disabled')) continue;
        const own = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
        );
        if (!own) continue;
        const style = getComputedStyle(el);
        if (style.opacity === '0' || style.visibility === 'hidden') continue;
        const bg = bgOf(el);
        const fg = over(ch(style.color), bg);
        const a = lum(fg);
        const b = lum(bg);
        out.push({
          where: `${el.tagName}.${el.className}`,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          text: (el.textContent ?? '').trim().slice(0, 32),
        });
      }
      /* EVERY TEXT, NOT THE WORST SIX. A slice is a place a second failure
         hides behind the first, and this lock has already found five. */
      return out.sort((x, y) => x.ratio - y.ratio);
    }, REVIEW.root);

    expect(worst.length).toBeGreaterThan(0);
    for (const row of worst) {
      expect(
        row.ratio,
        `${row.where} reads at ${row.ratio.toFixed(2)}:1 — "${row.text}"`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
