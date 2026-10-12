// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* The harness lane's browser lookup, reused rather than re-authored: system
   Chrome first, then the Playwright caches, and --force-device-scale-factor=1
   so a host at 125% display scaling cannot move a measurement. It is plain
   JavaScript with no declarations, and the shapes are named here rather than
   loosening the package's `noImplicitAny`. */
// @ts-expect-error — e2e/lib is .mjs and ships no .d.ts; see the note above.
import * as chromiumLib from '../../e2e/lib/chromium.mjs';

const findChromium: () => string | null = chromiumLib.findChromium;
const launchOptions: (path: string) => Record<string, unknown> = chromiumLib.launchOptions;
const loadPlaywright: () => Promise<any> = chromiumLib.loadPlaywright;

/* ══════════════════════════════════════════════════════════════════════════
   THE RENDERED TIER — the rail in a real browser, driven by real clicks
   packages/web2/src/rail/railRendered.test.ts

   WHY THIS FILE EXISTS BESIDE `IndexRail.test.tsx`, which already passes.

   CANON: "Declared values are not rendered values." The sheet's central claim
   about this surface is a claim about three heights — "Row height is semantic,
   not decorative. A board card is a label, so it is the 24px eyebrow rung. A
   file is structure that opens and closes, so it is the 30px rung. A function
   is the object you act on, so it is the 28px rung" — and a test that reads
   `--row-h` cannot see a row that a `display:flex` parent has stretched, that a
   sibling rule has collapsed, or that a long path has pushed to two lines. Only
   a browser can. The book's own first draft "proved this invariant against
   DECLARED token values and passed while being wrong."

   AND: "An e2e click is the honest form." The flow list here is produced by
   clicking a real file row and then a real function row, in a real browser,
   over the real token sheet, against a real scan of this repository. Nothing is
   handed to a component.

   HOW IT FAILS: it SKIPS, loudly, when there is no Chromium or no scan cache —
   both are facts about the machine rather than about the product, and
   `canvas/boardRendered.test.ts` states the reason: "a suite that reports a
   machine fact as a product failure gets ignored within a week."
   ══════════════════════════════════════════════════════════════════════════ */

const HERE = resolve(__dirname);
const REPO = resolve(HERE, '..', '..', '..', '..');
const GRAPH_CACHE = join(REPO, '.sequence', 'graph.json');
const FUNCTION_CACHE = join(REPO, '.sequence', 'functions.json');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

let server: Server | null = null;
let browser: any = null;
let page: any = null;
let skipReason = '';
const pageErrors: string[] = [];

/** A real component of this repository, chosen from the real scan at runtime. */
let missedComponent = '';
/** A real file with at least one traced function, and that function's name. */
let openableFile = '';
let tracedFunction = '';

async function serve(root: string): Promise<string> {
  const http = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname === '/' ? '/specimen.html' : url.pathname;
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
 * FINISH THE ANIMATIONS BEFORE MEASURING ANYTHING.
 *
 * rail.css transitions nothing today and pulses one dot, but CANON's rule is
 * about the class of defect rather than about today's stylesheet: "A hidden
 * browser pane measures nothing. Front the tab and force
 * `document.getAnimations().forEach(a => a.finish())` before reading a computed
 * value, or you measure transition start-values and report them as final."
 */
async function settle() {
  await page.evaluate(() => {
    document.getAnimations().forEach((animation: Animation) => animation.finish());
  });
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}

beforeAll(async () => {
  if (!existsSync(GRAPH_CACHE) || !existsSync(FUNCTION_CACHE)) {
    skipReason =
      'no .sequence/graph.json + .sequence/functions.json on this machine — ' +
      'run `node packages/analyzer/dist/cli.js serve --repo . --port 4399` and ' +
      'fetch /archgraph.json then /api/functions once';
    return;
  }

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

  /* The real build pipeline, not a second one: the same plugin the app builds
     with, so what is measured is what would ship. */
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const outDir = mkdtempSync(join(tmpdir(), 'seq-rail-'));

  await build({
    root: HERE,
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    base: './',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: join(HERE, 'specimen.html') } },
  });

  /* The engine's own caches, copied beside the bundle and served as JSON. The
     graph cache wraps the graph; `nodeDetail` is derived per request and is not
     in it, so it is served as `{}` rather than invented. */
  const graphFile = JSON.parse(readFileSync(GRAPH_CACHE, 'utf8')) as { graph: any };
  const graph = { ...graphFile.graph, nodeDetail: {} };
  const functions = JSON.parse(readFileSync(FUNCTION_CACHE, 'utf8')) as {
    functionGraph: any;
    warnings?: string[];
  };
  writeFileSync(join(outDir, 'graph.json'), JSON.stringify(graph));
  writeFileSync(
    join(outDir, 'functions.json'),
    JSON.stringify({ functionGraph: functions.functionGraph, warnings: functions.warnings ?? [] }),
  );

  /* Choose the real subjects from the real scan, at runtime, so this file
     cannot pin a filename that a later scan stops producing. */
  const { buildFunctionIndex, flowForFunction, toRepoPath } = await import('./railModel');
  const index = buildFunctionIndex({
    functionGraph: functions.functionGraph,
    warnings: functions.warnings ?? [],
  });
  for (const node of functions.functionGraph.nodes) {
    if (flowForFunction(node.id, index, graph).traced) {
      tracedFunction = node.name;
      openableFile = toRepoPath(node.file).split('/').pop() ?? '';
      break;
    }
  }
  const components = graph.nodes.filter((n: any) => n.kind === 'service');
  missedComponent = toRepoPath(components.at(-1)?.path ?? '');

  if (!tracedFunction || !missedComponent) {
    throw new Error(
      'the scan produced no traced function or no component — there is nothing this spec ' +
        'could honestly measure. That is a harness fact, not a rail defect.',
    );
  }

  const base = await serve(outDir);
  browser = await chromium.launch(launchOptions(executablePath));
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  /* EVERYTHING THE PAGE SAID, captured before the first navigation. A specimen
     that fails to mount otherwise times out on a selector and reports "the
     element is not visible", which says nothing anyone can act on. */
  page.on('console', (message: any) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('pageerror', (error: Error) => pageErrors.push(`uncaught: ${error.message}`));

  await page.goto(`${base}/specimen.html?missed=${encodeURIComponent(missedComponent)}`, {
    waitUntil: 'networkidle',
  });
  try {
    await page.waitForSelector('[data-testid="rail-row"]', { timeout: 15_000 });
  } catch {
    throw new Error(
      `the rail did not mount. Console said: ${pageErrors.join(' | ') || '(nothing)'}`,
    );
  }
  await settle();
}, 240_000);

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
    120_000,
  );

/** Click the first row whose visible text is exactly `label`. */
async function clickRow(label: string): Promise<void> {
  const clicked = await page.evaluate((text: string) => {
    const rows = [...document.querySelectorAll('[data-testid="rail-row"]')];
    const row = rows.find(
      (el) => (el.querySelector('.rail-name')?.textContent ?? '').trim() === text,
    );
    if (!row) return false;
    (row as HTMLElement).click();
    return true;
  }, label);
  if (!clicked) throw new Error(`no rendered row reads "${label}"`);
  await settle();
}

/* ══════════════════════════════════════════════════════════════════════════
   SHEET 11.2 — THREE RUNGS, AND THE HEIGHTS THAT ACTUALLY PAINT
   ══════════════════════════════════════════════════════════════════════════ */

describe('the rail, rendered at --rail-w against a real scan', () => {
  gate('paints the three rungs at 24, 30 and 28 — measured, not declared', async () => {
    await clickRow(openableFile);
    const heights = await page.evaluate(() => {
      const pick = (rung: string) => {
        const el = document.querySelector(`[data-testid="rail-row"][data-rung="${rung}"]`);
        return el ? Math.round(el.getBoundingClientRect().height) : -1;
      };
      return { card: pick('card'), file: pick('file'), fn: pick('function') };
    });
    /* --sp-24 · --row-h · --row-h-thread, as they PAINT. Compact is the only
       density; airy is a defect. */
    expect(heights).toEqual({ card: 24, file: 30, fn: 28 });
  });

  gate('indents the function rung by exactly one --sp-16 step, applied once', async () => {
    const step = await page.evaluate(() => {
      const left = (rung: string) => {
        const el = document.querySelector(`[data-testid="rail-row"][data-rung="${rung}"]`);
        return el ? el.getBoundingClientRect().left : NaN;
      };
      return { cardToFile: left('file') - left('card'), fileToFn: left('function') - left('file') };
    });
    /* "One indent step, --sp-16, applied once… the indent never compounds."
       A card and a file share a left edge; a function is one step in. */
    expect(step.cardToFile).toBe(0);
    expect(step.fileToFn).toBe(16);
  });

  gate('never overflows the 280px column, at real path lengths', async () => {
    const overflow = await page.evaluate(() => {
      const column = document.querySelector('[data-testid="specimen-column"]') as HTMLElement;
      const box = column.getBoundingClientRect();
      const bad: string[] = [];
      for (const el of document.querySelectorAll('[data-testid="rail-row"], .rail-badge')) {
        const r = el.getBoundingClientRect();
        if (r.right > box.right + 0.5 || r.left < box.left - 0.5) {
          bad.push(`${(el.textContent ?? '').slice(0, 40)} @ ${Math.round(r.width)}`);
        }
      }
      return { width: Math.round(box.width), bad };
    });
    expect(overflow.width).toBe(280);
    expect(overflow.bad).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     LOCK 1, IN A BROWSER — a real click produces a real flow list
     ══════════════════════════════════════════════════════════════════════ */

  gate('produces a flow list from a real click on a real function', async () => {
    await clickRow(tracedFunction);

    const flow = await page.evaluate(() => {
      const hops = [...document.querySelectorAll('[data-testid="rail-hop"]')];
      return {
        count: hops.length,
        refs: hops.map(
          (h) => h.querySelector('[data-testid="rail-hop-ref"]')?.textContent ?? '',
        ),
        acted: document.querySelector('[data-testid="specimen-acted"]')?.textContent ?? '',
        stripRef:
          document.querySelector('[data-testid="rail-strip-ref"]')?.textContent ?? '',
      };
    });

    expect(flow.count).toBeGreaterThan(0);
    /* Every ref is a real `path:line` off the real scan. */
    for (const ref of flow.refs) {
      expect(ref).toMatch(/^[^:]+\.[A-Za-z]+:\d+$/);
    }
    /* The strip is showing the hop the canvas is on, not a blank. */
    expect(flow.stripRef.length).toBeGreaterThan(0);
  });

  gate('lights exactly one row with the accent, and it PAINTS as a full-height bar', async () => {
    /*
     * ASSERT THE MARK, NOT THE DECLARATION THAT MAKES IT. The first version of
     * this gate asserted `boxShadow` contained 'inset', and it went red the
     * moment the implementation moved to a pseudo-element — while the rail got
     * BETTER, not worse. It had been asserting the expression. The invariant is
     * sheet 11.4's: exactly one row is playing, it carries a full-height accent
     * rule, and no other row carries the accent anywhere.
     *
     * (The move itself came out of a screenshot: an `inset box-shadow` is
     * clipped by the row's own --r-10, so a 2px rule on a 28px row painted as a
     * small rounded arc rather than as a bar.)
     */
    const marks = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim();
      const playing = [
        ...document.querySelectorAll('[data-testid="rail-row"][data-playing="true"]'),
      ] as HTMLElement[];

      const bars = playing.map((el) => {
        const before = getComputedStyle(el, '::before');
        /* An ungenerated pseudo-element still resolves width and background off
           the rule, so "did it actually paint" is asked first and separately. */
        if (before.content === 'none' || before.display === 'none') return null;
        return {
          background: before.backgroundColor,
          width: parseFloat(before.width),
          height: parseFloat(before.height),
          rowHeight: Math.round(el.getBoundingClientRect().height),
        };
      });

      const strays: string[] = [];
      for (const el of document.querySelectorAll('[data-testid="rail-row"]')) {
        if ((el as HTMLElement).dataset.playing === 'true') continue;
        const s = getComputedStyle(el);
        const b = getComputedStyle(el, '::before');
        const paintsAccent =
          s.color === accent ||
          s.backgroundColor === accent ||
          s.boxShadow.includes(accent) ||
          (b.content !== 'none' && b.backgroundColor === accent);
        if (paintsAccent) strays.push((el.textContent ?? '').slice(0, 40));
      }
      return { count: playing.length, bars, strays };
    });

    expect(marks.count).toBe(1);
    expect(marks.bars[0]).not.toBeNull();
    /* --w-rule, and the FULL height of the row it marks — not an arc. */
    expect(marks.bars[0].width).toBe(2);
    expect(Math.round(marks.bars[0].height)).toBe(marks.bars[0].rowHeight);
    expect(marks.strays).toEqual([]);
  });

  gate('draws the hover state so it cannot out-weigh the playing mark', async () => {
    /* 11.4: "Hover may never out-weigh playing. The playing mark is the one
       thing a reader hunts for in this rail, and a hover that paints heavier
       than it turns the pointer into a liar." Measured as alpha: the hover wash
       is a low-alpha neutral; the playing mark is a solid 2px accent rule. */
    const weights = await page.evaluate(() => {
      const alphaOf = (value: string) => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) return 1;
        const parts = m[1].split(',').map((p) => Number(p.trim()));
        return parts.length === 4 ? parts[3] : 1;
      };
      const row = document.querySelector('[data-testid="rail-row"][data-rung="file"]') as HTMLElement;
      const style = getComputedStyle(document.documentElement);
      return {
        hover: alphaOf(style.getPropertyValue('--state-hover')),
        playingIsSolid: alphaOf(getComputedStyle(row).getPropertyValue('--accent') || 'rgb(0,0,0)'),
      };
    });
    expect(weights.hover).toBeLessThan(0.2);
    expect(weights.playingIsSolid).toBe(1);
  });

  gate('paints no colour outside the sheet’s two-token hue budget', async () => {
    /*
     * SHEET 11.8, RULE 2, AS AN EXECUTABLE INVARIANT: "No hue for a category.
     * Height, indent, icon and type family tell the rows apart. The only colours
     * this rail may draw are the accent on the playing row and a verdict word on
     * a claim the scan could not confirm."
     *
     * Every `color` actually painted anywhere in the rail is collected and
     * checked against the DECLARED token values, resolved from the live cascade
     * rather than mirrored here. A rule that reaches for --fits, --wont, --info
     * or any literal fails immediately, and so does one that invents a shade the
     * ramp does not contain. This is the check a greyscale screenshot makes by
     * eye, made repeatable.
     */
    const audit = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const token = (name: string) => root.getPropertyValue(name).trim();
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      /* Token values are authored as hex; a computed `color` is rgb(). Resolve
         each token THROUGH the browser so the two are comparable. */
      const asRendered = (value: string) => {
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };
      const allowed = new Set(
        [
          '--ink-1', '--ink-2', '--ink-3', '--ink-4',
          '--accent', '--unknown', '--st-active', '--st-stalled', '--cov-missed',
        ].map((name) => asRendered(token(name))),
      );
      probe.remove();

      const seen = new Map<string, string>();
      const rail = document.querySelector('[data-testid="rail"]') as HTMLElement;
      for (const el of [rail, ...rail.querySelectorAll('*')]) {
        const c = getComputedStyle(el as HTMLElement).color;
        if (!allowed.has(c) && !seen.has(c)) {
          seen.set(
            c,
            `${el.nodeName}.${(el as HTMLElement).className || '-'} "${(el.textContent ?? '').slice(0, 24)}"`,
          );
        }
      }
      return { strays: [...seen.entries()].map(([c, where]) => `${c} on ${where}`) };
    });

    expect(audit.strays).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════
     LOCK 2, IN A BROWSER — the badge is on screen and legible
     ══════════════════════════════════════════════════════════════════════ */

  gate('renders the coverage badge for a real component, on screen and readable', async () => {
    const badge = await page.evaluate((path: string) => {
      const el = document.querySelector(`[data-testid="rail-badge"][data-path="${path}"]`);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        text: el.textContent ?? '',
        width: Math.round(box.width),
        height: Math.round(box.height),
        color: style.color,
        hasGlyph: el.querySelector('svg') !== null,
      };
    }, missedComponent);

    expect(badge).not.toBeNull();
    /* The plan's own line: `packages/web · 1,545 edges · ⚠ not in the last
       answer`. The mark is a drawn glyph beside the words, never typed into
       them, and the words are there for a reader who cannot see the mark. */
    expect(badge.text).toContain(missedComponent);
    expect(badge.text).toContain('not in the last answer');
    expect(badge.text).toMatch(/\d[\d,]* edges?/);
    expect(badge.hasGlyph).toBe(true);
    /* Rendered, not merely present: a badge with no box is a badge nobody sees. */
    expect(badge.height).toBeGreaterThan(8);
    expect(badge.width).toBeGreaterThan(40);
  });

  gate('badges the component the answer missed and no other', async () => {
    const paths = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="rail-badge"]')].map(
        (el) => (el as HTMLElement).dataset.path,
      ),
    );
    expect(paths).toEqual([missedComponent]);
  });
});
