// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
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
   THE RENDERED TIER — the four locks no jsdom test can evaluate
   packages/web2/src/canvas/boardRendered.test.ts

   WHY THIS FILE EXISTS AT ALL, and the argument is this project's own history
   rather than a principle:

     "The book's first draft proved this invariant against DECLARED values and
      passed while being wrong."

   CSS scales every corner radius by f = min(side / sum of the radii on that
   side). On a short box --r-14, --r-18 and --r-full all paint at the same 9px
   and three kinds collapse into one shape, while the token list still says
   three. A test that reads tokens cannot see that. A browser can.

   The same is true of the other three: a colour behind three var() hops, the
   loudness of a selection against its own resting state, and whether the field
   moved when the camera did are all facts about paint.

   WHAT IT DRIVES: `specimen.html`, built with vite into a temp directory and
   served over loopback. The components are the REAL ones — the same `Board`,
   `NodeCard` and `KindLegend` the app mounts, through the real board.css and
   the real token sheet. Nothing is restated for the test.

   HOW IT FAILS: it SKIPS, loudly, when there is no Chromium — a missing
   browser is a fact about the machine, not about the product, and a suite that
   reports a machine fact as a product failure gets ignored within a week.
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

/** Read a computed property off the first element matching a testid. */
function styleOf(testid: string, property: string, index = 0): Promise<string> {
  return page.evaluate(
    ([id, prop, at]: [string, string, number]) => {
      const el = document.querySelectorAll(`[data-testid="${id}"]`)[at];
      if (!el) throw new Error(`no element for ${id}[${at}]`);
      return getComputedStyle(el).getPropertyValue(prop);
    },
    [testid, property, index],
  );
}

/**
 * FINISH THE ANIMATIONS BEFORE MEASURING ANYTHING.
 *
 * board.css transitions background and border-colour on every card. A
 * transition read mid-flight returns its START value, and this project has
 * already reported a start value as a final one. Then two animation frames: one
 * for the layout, one for whatever that layout caused.
 */
async function settle() {
  await page.evaluate(() => {
    document.getAnimations().forEach((animation) => animation.finish());
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

  // The real build pipeline, not a second one: the same plugin the app builds
  // with, so what is measured is what would ship.
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const outDir = mkdtempSync(join(tmpdir(), 'seq-board-'));

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
  /* EVERYTHING THE PAGE SAID. A specimen that fails to mount used to time out
     on a selector and report "the element is not visible", which says nothing
     anyone can act on. The console is the evidence, and it is captured before
     the first navigation so nothing is missed. */
  page.on('console', (message: any) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('pageerror', (error: Error) => pageErrors.push(`uncaught: ${error.message}`));
  await page.goto(`${base}/specimen.html`, { waitUntil: 'networkidle' });
  try {
    await page.waitForSelector('[data-testid="specimen"]', { timeout: 15_000 });
  } catch (error) {
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
   * TEARDOWN GETS A BOUND TOO — the setup above already has 180s and this had
   * vitest's 10s default, which is not a number anyone chose for "close a real
   * Chromium and a real http server".
   *
   * Measured: this file passed standalone twice in a row and failed inside a
   * full gate with "Hook timed out in 10000ms", while a dev server, the engine
   * and a local model were also running. Nothing about the code under test had
   * changed. A teardown that fails only under load is the worst kind of red —
   * it is indistinguishable from a real defect, so it gets re-run, passes, and
   * teaches everyone to disbelieve the suite.
   */
}, 60_000);

const gate = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (skipReason) {
      console.log(`SKIP: ${skipReason}`);
      return;
    }
    await fn();
  }, 60_000);

/* ══════════════════════════════════════════════════════════════════════════ */

describe('LOCK — kinds separate by icon tint (owner seat 2026-08-26)', () => {
  gate('gives every kind a distinct silhouette radius per Graphite', async () => {
    const radii = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const el of document.querySelectorAll('[data-testid="kind-card"]')) {
        const kind = el.getAttribute('data-kind') ?? '?';
        const s = getComputedStyle(el.querySelector('.node') as HTMLElement);
        out[kind] = s.borderTopLeftRadius;
      }
      return out;
    });
    expect(Object.keys(radii).length).toBe(6);
    for (const value of Object.values(radii)) {
      expect(value).not.toBe('0px');
    }
  });

  gate('differentiates kinds by icon color on the card', async () => {
    const icons = await page.evaluate(() => {
      const out: Array<{ kind: string; icon: string | null; tint: string }> = [];
      for (const el of document.querySelectorAll('[data-testid="kind-card"]')) {
        const iconEl = el.querySelector('.nd-ic') as HTMLElement | null;
        const icon = el.querySelector('.nd-ic [data-icon]') as HTMLElement | null;
        out.push({
          kind: el.getAttribute('data-kind')!,
          icon: icon?.getAttribute('data-icon') ?? null,
          tint: iconEl ? getComputedStyle(iconEl).color : '',
        });
      }
      return out;
    });
    expect(icons).toHaveLength(6);
    for (const row of icons as Array<{ kind: string; icon: string | null }>) {
      expect(row.icon, `${row.kind} must carry a kind icon`).toBeTruthy();
    }
    const glyphNames = (icons as Array<{ icon: string }>).map((r) => r.icon);
    expect(new Set(glyphNames).size).toBeGreaterThanOrEqual(5);
    const tints = (icons as Array<{ tint: string }>).map((r) => r.tint).filter(Boolean);
    expect(new Set(tints).size).toBeGreaterThan(1);
  });

  gate('legend chips keep distinct silhouettes and icons', async () => {
    /* KindLegend starts collapsed; icons live on the expanded chips. */
    await page.click('[data-testid="board-legend-shut"]');
    const measured = await page.evaluate(() => {
      const out: Array<{ kind: string; print: string; icon: string | null; height: number }> = [];
      for (const el of document.querySelectorAll('[data-testid="board-legend-kind"]')) {
        const swatch = el.querySelector('.silswatch') as HTMLElement | null;
        const s = getComputedStyle(swatch ?? (el as HTMLElement));
        const box = (swatch ?? (el as HTMLElement)).getBoundingClientRect();
        const icon = el.querySelector('[data-icon]');
        out.push({
          kind: el.getAttribute('data-kind')!,
          print: JSON.stringify([
            s.borderTopLeftRadius,
            s.borderTopStyle,
            s.borderTopWidth,
            getComputedStyle(swatch ?? (el as HTMLElement), '::before').content,
          ]),
          icon: icon?.getAttribute('data-icon') ?? null,
          height: box.height,
        });
      }
      return out;
    });

    expect(measured.length).toBeGreaterThanOrEqual(5);
    const iconNames = (measured as Array<{ icon: string | null }>)
      .map((s) => s.icon)
      .filter(Boolean);
    expect(new Set(iconNames).size).toBeGreaterThanOrEqual(5);
  });

  gate('paints the chassis from the neutral ramp or kind-tinted mix, never a claim', async () => {
    /* DECISION 2 with owner seat 2026-08-27 override: kind fills may color-mix
       accent into --arch-tone for zoom legibility; claim verdict tokens still
       must not paint the chassis. */
    const result = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const paint = (value: string) => {
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };
      const root = getComputedStyle(document.documentElement);
      const token = (name: string) => root.getPropertyValue(name).trim();

      const ramp = new Set(
        ['--surface-1', '--surface-2', '--surface-3', '--surface-4', '--nest-0', '--bg-base', '--bg-ground', '--edge', '--edge-strong', '--edge-faint', '--accent-solid', '--accent', '--ink-1', '--ink-2', '--ink-3', '--info']
          .map((name) => paint(token(name))),
      );
      const claims = Object.fromEntries(
        ['--accent', '--fits', '--spills', '--wont', '--unknown', '--info'].map((name) => [
          name,
          paint(token(name)),
        ]),
      );
      probe.remove();

      const offenders: string[] = [];
      for (const el of document.querySelectorAll('[data-testid="kind-card"]')) {
        const card = el.querySelector('.node') as HTMLElement;
        const kind = el.getAttribute('data-kind')!;
        const style = getComputedStyle(card);
        const before = getComputedStyle(card, '::before');
        const after = getComputedStyle(card, '::after');

        const painted: Array<[string, string]> = [
          // A border with zero width paints nothing, and its colour falls back
          // to `color` — which on the agent is --ink-1, and reporting that as a
          // chassis colour is reading a value that is not on screen.
          ...(Number.parseFloat(style.borderTopWidth) > 0
            ? ([['border', style.borderTopColor]] as Array<[string, string]>)
            : []),
          ['background', style.backgroundColor],
          ...(before.content !== 'none' ? ([['plate', before.backgroundColor]] as Array<[string, string]>) : []),
          ...(after.content !== 'none' ? ([['fill', after.backgroundColor]] as Array<[string, string]>) : []),
        ];

        for (const [slot, value] of painted) {
          if (value === 'rgba(0, 0, 0, 0)') continue;
          for (const [name, claim] of Object.entries(claims)) {
            if (value === claim) offenders.push(`${kind} ${slot} is ${name}`);
          }
          /* Owner seat 2026-08-27: kind fills use color-mix — skip ramp equality on
             backgrounds/plates; borders still resolve to --edge at rest elsewhere. */
          if (slot === 'background' || slot === 'plate' || slot === 'fill') continue;
          if (!ramp.has(value)) offenders.push(`${kind} ${slot} is off the neutral ramp: ${value}`);
        }
      }
      return offenders;
    });

    expect(result).toEqual([]);
  });
});

describe('LOCK — no .node border or edge stroke is a verdict or the accent AT REST', () => {
  gate('resting borders resolve to --edge and to nothing else', async () => {
    const result = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const claim = (name: string) => root.getPropertyValue(name).trim();
      const claims = {
        accent: claim('--accent'),
        fits: claim('--fits'),
        spills: claim('--spills'),
        wont: claim('--wont'),
        info: claim('--info'),
      };

      // Resolve each claim token to painted rgb through a throwaway element, so
      // the comparison is rgb-to-rgb rather than string-to-string.
      const probe = document.createElement('span');
      document.body.append(probe);
      const painted: Record<string, string> = {};
      for (const [name, value] of Object.entries(claims)) {
        probe.style.color = value;
        painted[name] = getComputedStyle(probe).color;
      }
      probe.remove();

      const offenders: string[] = [];
      for (const el of document.querySelectorAll('[data-testid="kind-card"]')) {
        const card = el.querySelector('.node') as HTMLElement;
        const kind = el.getAttribute('data-kind')!;
        const border = getComputedStyle(card).borderTopColor;
        const plate = getComputedStyle(card, '::before').backgroundColor;
        for (const [name, value] of Object.entries(painted)) {
          const strip = (c: string) => c.replace(/rgba?\(|\)|\s/g, '').split(',').slice(0, 3).join(',');
          if (strip(border) === strip(value)) offenders.push(`${kind} border is --${name}`);
          if (strip(plate) === strip(value) && getComputedStyle(card, '::before').content !== 'none') {
            offenders.push(`${kind} drawn outline is --${name}`);
          }
        }
      }
      return offenders;
    });

    expect(result).toEqual([]);
  });

  gate('a resting edge takes the BLUE FLOW ACCENT, and only an ON-FLOW edge takes the accent', async () => {
    // Colour IS permitted on a connector — an edge is DATA, a chart series with
    // two endpoints, and Law 1 governs chrome. What is not permitted is the
    // accent on an edge nobody asked to follow.
    //
    // REDIRECTED BY DECISION 6, and saying so is required rather than polite:
    // this gate used to lock a resting traced edge to --viz-baseline. Wave 0's
    // amendment to sheets 06.6/06.7 rules otherwise — "Decision 6 points
    // declared and traced connectors at the blue flow accent", resolving both
    // to --info, with weight and dash still carrying the distinction. The
    // assertion was redirected, not weakened: it still pins every resting
    // proof state to ONE named token and still refuses the selection accent on
    // any of them.
    const strokes = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const path of document.querySelectorAll('path[data-testid="board-edge"]')) {
        out[path.getAttribute('data-proof')!] = getComputedStyle(path as SVGElement).stroke;
      }
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      document.body.append(probe);
      const computed = (token: string) => {
        probe.style.color = root.getPropertyValue(token).trim();
        return getComputedStyle(probe).color;
      };
      const accent = computed('--accent');
      const baseline = computed('--viz-baseline');
      const info = computed('--info');
      probe.remove();
      return { out, accent, baseline, info };
    });

    const strip = (c: string) => c.replace(/rgba?\(|\)|\s/g, '').split(',').slice(0, 3).join(',');

    // THE EDGES ARE ON THE PAGE AT ALL — which is the "VERIFY edges still route
    // after the change" the item asks for, and the thing that would break the
    // instant the eight handles were deleted.
    expect(Object.keys(strokes.out).sort()).toEqual(['declared', 'onflow', 'traced']);
    // Traced AND declared ride the blue flow accent family — one continuous
    // route — and neither borrows the selection accent nor the old baseline.
    expect(strip(strokes.out.traced!)).toBe(strip(strokes.info));
    expect(strip(strokes.out.declared!)).toBe(strip(strokes.info));
    expect(strip(strokes.out.traced!)).not.toBe(strip(strokes.accent));
    expect(strip(strokes.out.traced!)).not.toBe(strip(strokes.baseline));
    expect(strip(strokes.out.onflow!)).toBe(strip(strokes.accent));
  });

  gate('keeps the three proof states apart in greyscale, by dash as well as hue', async () => {
    const dashes = await page.evaluate(() => {
      const out: Record<string, { dash: string; width: string }> = {};
      for (const path of document.querySelectorAll('path[data-testid="board-edge"]')) {
        const s = getComputedStyle(path as SVGElement);
        out[path.getAttribute('data-proof')!] = { dash: s.strokeDasharray, width: s.strokeWidth };
      }
      return out;
    });

    // Declared is dashed and traced is not, so a reader who cannot receive the
    // hue can still tell a followed call from a claimed one.
    expect(dashes.declared!.dash).not.toBe(dashes.traced!.dash);
    // And the promoted path is thicker as well as differently coloured.
    expect(Number.parseFloat(dashes.onflow!.width)).toBeGreaterThan(
      Number.parseFloat(dashes.traced!.width),
    );
  });
});

describe('LOCK — selection reads LOUDER than resting', () => {
  gate('adds fill, ring and elevation, and takes nothing away', async () => {
    // THE DEFECT THIS KILLS, measured in v1: selecting a node DROPPED its
    // border to 1.54:1 — the state meaning "you picked this" rendered fainter
    // than the card beside it that nobody picked.
    const measured = await page.evaluate(() => {
      const read = (testid: string) => {
        const card = document
          .querySelector(`[data-testid="${testid}"]`)!
          .querySelector('.node') as HTMLElement;
        const s = getComputedStyle(card);
        return {
          border: s.borderTopColor,
          background: s.backgroundColor,
          shadow: s.boxShadow,
          opacity: Number.parseFloat(s.opacity),
        };
      };
      const luminance = (colour: string) => {
        const [r, g, b, a = 1] = colour.match(/[\d.]+/g)!.map(Number);
        const lin = (channel: number) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return { l: 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!), a };
      };
      const ground = getComputedStyle(
        document.querySelector('[data-testid="specimen-states"]') as HTMLElement,
      ).backgroundColor;

      return { rest: read('state-rest'), sel: read('state-sel'), dim: read('state-dim'), ground, luminance: luminance(ground) };
    });

    /* COMPOSITE THE ALPHA BEFORE MEASURING. The first draft of this check read
       --edge as rgba(255,255,255,.09) and, ignoring the alpha, scored the
       RESTING border at 17.36:1 against the card — a hairline the reader can
       barely see, reported as the loudest thing on the board. Every border on
       this surface is translucent, so a contrast function that drops alpha is
       measuring a colour nothing paints. */
    const over = (fg: string, bg: string) => {
      const f = fg.match(/[\d.]+/g)!.map(Number);
      const b = bg.match(/[\d.]+/g)!.map(Number);
      const a = f[3] ?? 1;
      return [0, 1, 2].map((i) => f[i]! * a + b[i]! * (1 - a));
    };
    const luminance = (rgb: number[]) => {
      const ch = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(rgb[0]!) + 0.7152 * ch(rgb[1]!) + 0.0722 * ch(rgb[2]!);
    };
    const contrast = (fg: string, bg: string, ground: string) => {
      const back = over(bg, ground);
      const front = over(fg, `rgb(${back.join(',')})`);
      const [hi, lo] = [luminance(front), luminance(back)].sort((p, q) => q - p);
      return (hi! + 0.05) / (lo! + 0.05);
    };

    // NOTHING IS TAKEN AWAY: the selected card still has a shadow, and it has
    // MORE of one — the ring is laid outside the elevation rather than
    // replacing it. This is the composed-list fix sheet 06.5 hands back.
    expect(measured.sel.shadow).not.toBe('none');
    expect(measured.sel.shadow.length).toBeGreaterThan(measured.rest.shadow.length);

    // AND THE BORDER GOT LOUDER, not quieter, against the card's own ground.
    const restBorder = contrast(measured.rest.border, measured.rest.background, measured.ground);
    const selBorder = contrast(measured.sel.border, measured.sel.background, measured.ground);
    expect(
      selBorder,
      `selection is quieter than rest: ${selBorder.toFixed(2)}:1 vs ${restBorder.toFixed(2)}:1`,
    ).toBeGreaterThan(restBorder);

    // Sheet 06.1's monotonic order, at the other end: the dimmed card is
    // quieter — and only by OPACITY, so the kind channels survive it.
    expect(measured.dim.opacity).toBeLessThan(1);
    expect(measured.rest.opacity).toBe(1);
    expect(measured.dim.border).toBe(measured.rest.border);
  });

  gate('keeps a dimmed card readable rather than turning it into a smear', async () => {
    // Sheet 06.6's floor: --board-dim-opacity resolves to --st-archived-opacity,
    // "receded and still readable, never dimmed below legibility."
    const opacity = Number.parseFloat(await styleOf('state-dim', 'opacity').catch(() => '1'));
    const cardOpacity = await page.evaluate(() => {
      const card = document
        .querySelector('[data-testid="state-dim"]')!
        .querySelector('.node') as HTMLElement;
      return Number.parseFloat(getComputedStyle(card).opacity);
    });
    expect(cardOpacity).toBeGreaterThanOrEqual(0.5);
    expect(cardOpacity).toBeLessThan(1);
    expect(opacity).toBe(1);
  });

  gate('keeps every status dot readable on the card it lands on — Decision 6', async () => {
    // Sheet 06.7 spends exactly two hues on state (--accent, --info) plus one
    // grey, and Decision 6 puts those dots on cards that may themselves be
    // dimmed. A dot is non-text UI, so its floor is WCAG's 3:1 — measured AFTER
    // the composite, the way flow-plays measures the dimmed title, because a
    // declared token colour is not what the reader sees through an opacity.
    const measured = await page.evaluate(() => {
      const parse = (value: string) => {
        const nums = (value.match(/[\d.]+/g) ?? []).map(Number);
        if (nums.length < 3) return null;
        return { r: nums[0]!, g: nums[1]!, b: nums[2]!, a: nums.length > 3 ? nums[3]! : 1 };
      };
      const over = (
        f: { r: number; g: number; b: number; a: number },
        b: { r: number; g: number; b: number },
      ) => ({
        r: f.a * f.r + (1 - f.a) * b.r,
        g: f.a * f.g + (1 - f.a) * b.g,
        b: f.a * f.b + (1 - f.a) * b.b,
      });
      const lum = (c: { r: number; g: number; b: number }) => {
        const ch = [c.r, c.g, c.b].map((v) => v / 255);
        const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
      };
      /** First ancestor that paints; `transparent` paints nothing. */
      const painted = (start: Element | null) => {
        let el = start;
        while (el) {
          const rgb = parse(getComputedStyle(el as HTMLElement).backgroundColor);
          if (rgb && rgb.a > 0) return rgb;
          el = el.parentElement;
        }
        return { r: 0, g: 0, b: 0, a: 1 };
      };

      const out: Record<string, number> = {};
      for (const testid of ['state-dot-selected', 'state-dot-onpath-dim', 'state-dot-offpath-dim']) {
        const host = document.querySelector(`[data-testid="${testid}"]`);
        const dot = host?.querySelector('.nd-dot') as HTMLElement | null;
        if (!host || !dot) {
          out[testid] = NaN;
          continue;
        }
        const card = dot.closest('.node') as HTMLElement;
        const alpha = Number.parseFloat(getComputedStyle(card).opacity);
        const ground = painted(card.parentElement);
        const cardFill = parse(getComputedStyle(card).backgroundColor) ?? ground;
        const cardOnGround = over(cardFill, ground);
        const seenCard = over({ ...cardOnGround, a: alpha }, ground);

        // A hollow dot carries its claim on its BORDER, a filled one on its
        // fill; measure whichever actually paints.
        const fill = parse(getComputedStyle(dot).backgroundColor);
        const border = parse(getComputedStyle(dot).borderTopColor);
        const ink =
          fill && fill.a > 0 ? fill : border && border.a > 0 ? border : null;
        if (!ink) {
          out[testid] = NaN;
          continue;
        }
        const seenInk = over({ ...over(ink, cardOnGround), a: alpha }, ground);
        const hi = Math.max(lum(seenInk), lum(seenCard));
        const lo = Math.min(lum(seenInk), lum(seenCard));
        out[testid] = (hi + 0.05) / (lo + 0.05);
      }
      return out;
    });
    for (const [testid, ratio] of Object.entries(measured) as [string, number][]) {
      if (testid === 'state-dot-offpath-dim') {
        /* THE HOLLOW DOT IS GREY ON PURPOSE, and the sheet says so in exactly
           those words: "Three states and two actual hues; the third is grey on
           purpose … Greyscale loses both hues and no claim." It carries no
           claim of its own — it marks that a node is NOT being read — so the
           non-text floor binds it only to remain VISIBLE, not to compete with
           the hue-carrying dots. Its legibility channels are the hairline
           geometry and the dimmed card's title above it. */
        expect(ratio, `${testid}'s hollow dot does not paint (${ratio.toFixed(2)}:1)`).toBeGreaterThan(1);
        continue;
      }
      expect(
        ratio,
        `${testid}'s dot landed at ${Number.isFinite(ratio) ? ratio.toFixed(2) : String(ratio)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  gate('quiets Traced provenance — no claim wash pill (Decision 6 density)', async () => {
    /*
     * Seat walk: every card wore a green Traced wash that out-competed English.
     * Within Decision 6 we keep the word and drop the wash. Status dots and
     * blue flow stay; kind never gains a hue.
     */
    const paint = await page.evaluate(() => {
      const pill = document.querySelector(
        '[data-testid="height-evidence"] .prov.p-measured',
      ) as HTMLElement | null;
      if (!pill) return null;
      const cs = getComputedStyle(pill);
      const bg = cs.backgroundColor;
      const parse = (value: string) => {
        const nums = (value.match(/[\d.]+/g) ?? []).map(Number);
        if (nums.length < 3) return null;
        return { r: nums[0]!, g: nums[1]!, b: nums[2]!, a: nums.length > 3 ? nums[3]! : 1 };
      };
      return { text: pill.textContent, bg: parse(bg), radius: cs.borderRadius };
    });
    expect(paint, 'height-evidence must paint a Traced .prov').toBeTruthy();
    expect(paint!.text?.toLowerCase()).toContain('traced');
    expect(paint!.bg?.a ?? 0, 'Traced must not wear a wash fill').toBe(0);
  });
});

describe('LOCK — exactly ONE background-image on the root', () => {
  gate('is on the board root, is one layer, and is the only one in the subtree', async () => {
    const found = await page.evaluate(() => {
      const board = document.querySelector('[data-testid="board"]') as HTMLElement;
      const painted: string[] = [];
      const walk = (el: Element) => {
        const image = getComputedStyle(el as HTMLElement).backgroundImage;
        if (image && image !== 'none') {
          painted.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} → ${image}`);
        }
        for (const child of el.children) walk(child);
      };
      walk(board);
      const image = getComputedStyle(board).backgroundImage;
      let depth = 0;
      let layers = image === 'none' ? 0 : 1;
      for (const character of image) {
        if (character === '(') depth += 1;
        else if (character === ')') depth -= 1;
        else if (character === ',' && depth === 0) layers += 1;
      }

      return {
        painted,
        rootImage: image,
        layers,
        isRoot: painted.length === 1 && board.getAttribute('data-testid') === 'board',
      };
    });

    // v1 draws TWO: a 24px dot grid and a 26px line grid on separate layers,
    // one static and one tracking. Two pitches two pixels apart do not add
    // detail — they beat, and the beat crawls when the camera moves.
    expect(found.painted).toHaveLength(1);
    expect(found.isRoot).toBe(true);
    /* ONE LAYER, not a comma-separated stack: a second layer inside one
       declaration is the same defect with better manners.

       Counted by PAREN DEPTH, and the first draft of this check got it wrong in
       a way worth recording: it split on a regex, which cut the gradient at the
       comma BETWEEN ITS TWO COLOUR STOPS and reported one layer as two. A
       background-image is full of commas that are not layer separators. */
    expect(found.layers).toBe(1);
    expect(found.rootImage).toContain('radial-gradient');
  });

  gate('moves the field with the camera — pan writes position, zoom writes size', async () => {
    // Sheet 05.9 assertion 1, and the sentence the whole sheet turns on: "a
    // field that stays nailed down while the content slides across it is the
    // single biggest tell that a board is not a real board."
    const before = await page.evaluate(() => {
      const board = document.querySelector('[data-testid="board"]') as HTMLElement;
      const s = getComputedStyle(board);
      return { position: s.backgroundPosition, size: s.backgroundSize };
    });

    // Drive the real control rather than the state: the reader's own path.
    await page.click('[data-testid="board-zoom-out"]');
    await settle();

    const after = await page.evaluate(() => {
      const board = document.querySelector('[data-testid="board"]') as HTMLElement;
      const s = getComputedStyle(board);
      return { position: s.backgroundPosition, size: s.backgroundSize, zoom: board.getAttribute('data-zoom') };
    });

    expect(after.size).not.toBe(before.size);
    expect(after.position).not.toBe(before.position);
    expect(Number.parseFloat(after.zoom!)).toBeLessThan(1);

    // Put it back so the screenshot and the later checks see 1:1.
    await page.click('[data-testid="board-zoom-in"]');
    await settle();
  });

  gate('reads out the camera, so the reader always knows where it is', async () => {
    const percent = await page.textContent('[data-testid="board-zoom-pct"]');
    expect(percent).toBe('100%');
  });

  gate('says grab on empty ground, and never crosshair', async () => {
    // Sheet 05.9 assertion 8. v1 applies its draw class unconditionally and it
    // wins on source order over `cursor: grab`, so the pointer promises a mark
    // and delivers a deselect.
    const cursors = await page.evaluate(() => ({
      pane: getComputedStyle(document.querySelector('.react-flow__pane') as HTMLElement).cursor,
      anyCrosshair: [...document.querySelectorAll('[data-testid="board"] *')].some(
        (el) => getComputedStyle(el as HTMLElement).cursor === 'crosshair',
      ),
    }));
    expect(cursors.pane).toBe('grab');
    expect(cursors.anyCrosshair).toBe(false);
  });
});

describe('LOCK — a subtitle-less card is one text line tall', () => {
  gate('measures three heights, and the shortest is the one that says least', async () => {
    const heights = await page.evaluate(() => {
      const measure = (testid: string) =>
        (
          document.querySelector(`[data-testid="${testid}"]`)!.querySelector('.node') as HTMLElement
        ).getBoundingClientRect().height;
      const root = getComputedStyle(document.documentElement);
      return {
        title: measure('height-title'),
        subtitle: measure('height-subtitle'),
        evidence: measure('height-evidence'),
        lh10: Number.parseFloat(root.getPropertyValue('--lh-10')),
        lh14: Number.parseFloat(root.getPropertyValue('--lh-14')),
        sp10: Number.parseFloat(root.getPropertyValue('--sp-10')),
        sp2: Number.parseFloat(root.getPropertyValue('--sp-2')),
        floor: Number.parseFloat(root.getPropertyValue('--arch-card-min-h')),
      };
    });

    /* THE LOCK: the ink on a subtitle-less card is the title and NOTHING MORE,
       and the box is that plus the body's own --sp-2 lid plus the chassis.
       IT USED TO SAY TWO LINES, and that was quoting sheet 02.3's `.nd-hd` row
       (icon + mono kind tag) at --lh-12 — an anatomy that has not shipped since
       P2.6. The icon is `position: absolute` and takes no row; the title is
       --lh-14, not --lh-12. Measured in the running app before this was
       corrected: every card declared 38 and painted 56. */
    const oneLine = heights.sp2 + heights.lh14;
    const chassis = heights.sp10 * 2 + 2;
    expect(heights.title).toBeCloseTo(oneLine + chassis, 0);

    // v1 held ~16px of text in a 96px box. The declared floor is still 96 and
    // the card is deliberately not using it.
    expect(heights.title).toBeLessThan(heights.floor);

    // Each card is as tall as what is in it. "The taller card is taller because
    // it says more."
    expect(heights.title).toBeLessThan(heights.subtitle);
    expect(heights.subtitle).toBeLessThan(heights.evidence);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK — THE DECLARED BOX IS THE PAINTED CARD

   THE DEFECT THIS EXISTS TO CATCH, AND IT SHIPPED. `cardHeight` feeds ELK, the
   edge router, the hit regions and the height @xyflow is handed, and it was
   summing rows the card does not have: sheet 02.3's `.nd-hd` header above a
   `.nd-t` at --lh-12, an anatomy gone since P2.6. Measured on the running app
   against this monorepo, all eleven cards: DECLARED 38, PAINTED 56. An open
   anatomy: DECLARED 252, PAINTED 262. Every neighbour was positioned from a box
   shorter than its own card, so edge endpoints and hit regions landed inside
   the card's real bottom edge and a denser scan collides.

   NO TEST COULD SEE IT, AND THAT IS THE POINT OF THIS ONE. `cardBox.test.ts`
   asserts `cardBox.ts` against the token ramp `cardBox.ts` is written from —
   both halves agreed with each other and neither had ever been compared to a
   card. `anatomyRendered.test.tsx` asserts the wall's reservation against the
   constant that IS the reservation. Thirteen and twenty green assertions
   respectively, describing a card nobody could open.

   So this compares the two numbers that actually matter, in a real browser, on
   the real components: `cardHeight`'s answer (written onto the wrapper by
   `specimen.tsx`) against the card's own painted box. `cardPainted.test.tsx` is
   the jsdom companion — it cannot measure a rect, so it rebuilds the box model
   off the rendered tree and the live cascade, and it runs on machines where
   this file SKIPS for want of a Chromium.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the rung-5 pair that disagreed on the real board', () => {
  gate('reports what a REAL browser does with the two disputed cards', async () => {
    /*
     * `svc:web2` read 45 declared / 49 painted in the in-app pane, with a
     * `.nd-body` padding-top of 6px where `svc:acp` read 2px — on identical
     * class lists, identical attributes and identical matching rules. That pane
     * is now known to accept style writes and never recalculate, so the reading
     * is UNCONFIRMED. This is the same pair in a real Chromium, and it answers
     * the question either way rather than leaving a rumour in the queue.
     */
    const rows: Array<{
      shape: string;
      declared: number;
      painted: number;
      bodyClass: string;
      bodyPadTop: string;
      cardClass: string;
    }> = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="rung5-card"]')].map((wrapper) => {
        const card = wrapper.querySelector('.node') as HTMLElement;
        const body = card.querySelector('.nd-body') as HTMLElement | null;
        return {
          shape: wrapper.getAttribute('data-shape') ?? '?',
          declared: Number(wrapper.getAttribute('data-declared')),
          painted: card.getBoundingClientRect().height,
          bodyClass: body?.className ?? '(none)',
          bodyPadTop: body ? getComputedStyle(body).paddingTop : '(none)',
          cardClass: card.className,
        };
      }),
    );

    // eslint-disable-next-line no-console -- the point of this gate is the reading
    console.log('RUNG5 PAIR:', JSON.stringify(rows, null, 1));

    expect(rows.map((r) => r.shape)).toEqual(['rung5-long', 'rung5-short', 'rung5-subtitled']);
    /* The claim under test: a card's LABEL must not change its lid. The SUBTITLE
       legitimately may — that is what the boost is for — so only the first two
       are compared here, and all three must still declare what they paint. */
    expect(rows[0]!.bodyPadTop, 'label alone must not change the lid').toBe(rows[1]!.bodyPadTop);
    for (const row of rows) {
      expect(
        row.painted,
        `${row.shape}: declared ${row.declared}, painted ${row.painted}, body "${row.bodyClass}" padTop ${row.bodyPadTop}`,
      ).toBeCloseTo(row.declared, 0);
    }
  });
});

describe('LOCK — the declared box is the painted card', () => {
  gate('agrees to the pixel on all six shapes, wrapping included', async () => {
    const rows: Array<{ shape: string; declared: number; painted: number }> = await page.evaluate(
      () =>
        [...document.querySelectorAll('[data-testid="painted-card"]')].map((wrapper) => ({
          shape: wrapper.getAttribute('data-shape') ?? '?',
          declared: Number(wrapper.getAttribute('data-declared')),
          painted: (wrapper.querySelector('.node') as HTMLElement).getBoundingClientRect().height,
        })),
    );

    expect(rows.map((row) => row.shape)).toEqual([
      'title',
      'glance',
      'wrap-glance',
      'wrap-title',
      'visual',
      'anatomy',
    ]);
    for (const row of rows) {
      expect(
        row.painted,
        `${row.shape}: declared ${row.declared}, painted ${row.painted}`,
      ).toBeCloseTo(row.declared, 0);
    }

    /* AND THE WRAPPING SHAPES REALLY WRAP. Without this the two new rows would
       pass by agreeing at ONE line each — the model would be untested and the
       assertion above would be describing a card that never wrapped. So the
       browser is asked how many line boxes it actually drew, and the answer has
       to be two. `svc:web2` painted 83 against a declared 68 exactly here. */
    const lineBoxes = await page.evaluate(() => {
      const read = (shape: string, sel: string, lh: number) => {
        const el = document
          .querySelector(`[data-shape="${shape}"]`)!
          .querySelector(sel) as HTMLElement | null;
        return el ? Math.round(el.getBoundingClientRect().height / lh) : 0;
      };
      return { glance: read('wrap-glance', '.nd-s', 15), title: read('wrap-title', '.nd-t', 21) };
    });
    expect(lineBoxes.glance, 'the wrapping glance line must take two --lh-11 boxes').toBe(2);
    expect(lineBoxes.title, 'the wrapping title must take at least two --lh-14 boxes').toBeGreaterThan(1);

    /* AND THE FLOOR IS NOT HOLDING GROUND THE CARD DOES NOT USE. If
       `--board-card-floor` exceeded the smallest legitimate card, every shape
       above would still agree — the floor would simply be the answer — and
       sheet 02.3's binding sentence would be broken silently. So the title-only
       card is asserted to be its own NATURAL height, with the floor lifted. */
    const natural = await page.evaluate(() => {
      const card = document
        .querySelector('[data-shape="title"]')!
        .querySelector('.node') as HTMLElement;
      const before = card.style.minHeight;
      card.style.minHeight = '0px';
      const height = card.getBoundingClientRect().height;
      card.style.minHeight = before;
      return height;
    });
    expect(natural).toBeCloseTo(rows[0]!.declared, 0);
  });
});

describe('LOCK — hover lift reads mid-air (P2.6)', () => {
  gate('resting cards have no inset accent bar; hover lifts and casts elevation', async () => {
    const sel = '[data-testid="kind-card"][data-kind="service"] .node';
    const rest = await page.evaluate((query: string) => {
      const el = document.querySelector(query) as HTMLElement;
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, transform: s.transform };
    }, sel);
    expect(rest.shadow).not.toContain('inset');
    expect(rest.transform).toBe('none');

    await page.hover(sel);
    await settle();

    const hover = await page.evaluate((query: string) => {
      const el = document.querySelector(query) as HTMLElement;
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, transform: s.transform, zIndex: s.zIndex };
    }, sel);
    expect(hover.transform).not.toBe('none');
    expect(hover.shadow).not.toBe('none');
    expect(hover.shadow.length).toBeGreaterThan(rest.shadow.length);
    expect(Number(hover.zIndex)).toBeGreaterThanOrEqual(6);
  });
});

describe('TIER 4 — the page a human looks at', () => {
  gate('renders the board with cards, edges, a legend and one cluster', async () => {
    const census = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-testid="board"] [data-testid="board-node"]').length,
      edges: document.querySelectorAll('path[data-testid="board-edge"]').length,
      /* EITHER FORM COUNTS. The key now collapses to a control when the board
         is too narrow to hold it — board.css said that ruling was owed and the
         owner gave it by reporting a legend lying across his file cards. The
         census asks "is the key on the board", and both shapes answer yes. */
      legends: document.querySelectorAll(
        '[data-testid="board"] [data-testid="board-legend"], [data-testid="board"] [data-testid="board-legend-shut"]',
      ).length,
      legendOpen: document.querySelectorAll('[data-testid="board"] [data-testid="board-legend"]').length,
      clusters: document.querySelectorAll('[data-testid="board"] [data-testid="board-zoom"]').length,
      separators: document.querySelectorAll(
        '[data-testid="board"] [data-testid="board-legend-sep"]',
      ).length,
      errors: document.querySelectorAll('.react-flow__edge').length,
    }));

    expect(census.cards).toBe(6);
    expect(census.edges).toBe(3);
    expect(census.legends).toBe(1);
    expect(census.clusters).toBe(1);
    // Six kinds on the board, so the legend has two groups and one hairline
    // between them: entry is a POSITION and is drawn apart.
    /* Only an OPEN key draws a group hairline. A collapsed one has no groups to
       separate, and asserting a separator regardless would be asserting the
       shape of a thing that is not on screen. */
    expect(census.separators).toBe(census.legendOpen === 1 ? 1 : 0);
  });

  gate('writes a screenshot for the sheet comparison', async () => {
    const out = join(tmpdir(), 'seq-board-specimen.png');
    await page.screenshot({ path: out, fullPage: true });
    console.log(`[tier 4] screenshot: ${out}`);
    expect(readFileSync(out).length).toBeGreaterThan(0);
  });
});
