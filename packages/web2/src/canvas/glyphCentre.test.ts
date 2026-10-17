// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error — e2e/lib is .mjs and ships no .d.ts (same lookup as boardRendered.test.ts).
import * as chromiumLib from '../../e2e/lib/chromium.mjs';
import { GLYPHS } from './BoardIcon';
import { TOOL_GLYPH_PATHS, TOOL_GLYPH_SHAPES } from './boards/archToolGlyphs';

/* ══════════════════════════════════════════════════════════════════════════
   EVERY GLYPH'S INK IS CENTRED ON ITS 24 GRID (owner, 2026-10: "a lot of the
   icons aren't centered in their box").

   A button centres its svg box, so a glyph whose drawn ink sits off the grid's
   centre sits off the button's centre, and no CSS can fix that. This measures
   the ink (SVG getBBox, in a real Chromium) of every board glyph and every
   draw tool and requires its centre within 0.5 grid units of (12, 12), which is
   0.33px at the 16px the board draws them. It skips, loudly, with no Chromium.
   ══════════════════════════════════════════════════════════════════════════ */

const findChromium: () => string | null = chromiumLib.findChromium;
const launchOptions: (path: string) => Record<string, unknown> = chromiumLib.launchOptions;
const loadPlaywright: () => Promise<any> = chromiumLib.loadPlaywright;

type Shape = Record<string, any>;
function markup(id: string, shapes: Shape[]): string {
  const inner = shapes
    .map((s) => {
      if (s.p) return `<path d="${s.p}"/>`;
      if (s.circle) return `<circle cx="${s.circle[0]}" cy="${s.circle[1]}" r="${s.circle[2]}"/>`;
      if (s.ellipse) return `<ellipse cx="${s.ellipse[0]}" cy="${s.ellipse[1]}" rx="${s.ellipse[2]}" ry="${s.ellipse[3]}"/>`;
      return `<rect x="${s.rect[0]}" y="${s.rect[1]}" width="${s.rect[2]}" height="${s.rect[3]}" rx="${s.rect[4]}"/>`;
    })
    .join('');
  return `<svg id="${id}" viewBox="0 0 24 24" width="24" height="24">${inner}</svg>`;
}

let browser: any = null;
let page: any = null;
let skip = '';
const subjects: Record<string, Shape[]> = {};

for (const [name, shapes] of Object.entries(GLYPHS)) subjects[`board:${name}`] = shapes as Shape[];
for (const [tool, paths] of Object.entries(TOOL_GLYPH_PATHS)) {
  const shapes: Shape[] = (paths as readonly string[]).map((p) => ({ p }));
  if (tool === 'rect') {
    const r = TOOL_GLYPH_SHAPES.rect;
    shapes.push({ rect: [r.x, r.y, r.width, r.height, r.rx] });
  }
  if (tool === 'ellipse') {
    const e = TOOL_GLYPH_SHAPES.ellipse;
    shapes.push({ ellipse: [e.cx, e.cy, e.rx, e.ry] });
  }
  subjects[`tool:${tool}`] = shapes;
}
/* The negative control: a planted glyph two units off-centre must be caught. */
subjects['planted:off-centre'] = [{ p: 'M4 4h8v8H4z' }];

let centres: Record<string, { dx: number; dy: number }> = {};

beforeAll(async () => {
  const exe = findChromium();
  if (!exe) return void (skip = 'no Chromium found');
  const chromium = await loadPlaywright();
  if (!chromium) return void (skip = 'playwright-core is not installed');
  browser = await chromium.launch(launchOptions(exe));
  page = await browser.newPage();
  await page.setContent(Object.entries(subjects).map(([k, v]) => markup(k.replace(/[^\w-]/g, '_'), v)).join(''));
  const raw: Array<[string, number, number]> = await page.evaluate(() =>
    [...document.querySelectorAll('svg')].map((s) => {
      const b = (s as SVGGraphicsElement).getBBox();
      return [s.id, b.x + b.width / 2 - 12, b.y + b.height / 2 - 12] as [string, number, number];
    }),
  );
  const byId = new Map(raw.map(([id, dx, dy]) => [id, { dx, dy }]));
  centres = Object.fromEntries(Object.keys(subjects).map((k) => [k, byId.get(k.replace(/[^\w-]/g, '_'))!]));
}, 60_000);

afterAll(async () => {
  /* Under a full parallel run Chromium can be slow to close; never let teardown fail the measurement. */
  await chromiumLib.closeBrowser(browser);
}, 60_000);

describe('glyph ink is centred on the 24 grid', () => {
  it('the negative control is caught (a measurement that finds nothing proves nothing)', () => {
    if (skip) return void console.log(`SKIP: ${skip}`);
    const c = centres['planted:off-centre']!;
    expect(Math.abs(c.dx) > 0.5 && Math.abs(c.dy) > 0.5).toBe(true);
  });

  it('every board glyph and draw tool is within 0.5 units of the centre', () => {
    if (skip) return void console.log(`SKIP: ${skip}`);
    const off = Object.entries(centres)
      .filter(([k]) => !k.startsWith('planted:'))
      .filter(([, c]) => Math.abs(c.dx) > 0.5 || Math.abs(c.dy) > 0.5)
      .map(([k, c]) => `${k} (${c.dx.toFixed(2)}, ${c.dy.toFixed(2)})`);
    expect(off).toEqual([]);
    expect(Object.keys(centres).length).toBeGreaterThan(45);
  });
});
