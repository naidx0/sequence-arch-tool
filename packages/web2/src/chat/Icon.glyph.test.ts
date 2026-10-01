import { describe, expect, it } from 'vitest';

import { GLYPHS, GLYPH_WEIGHT } from './Icon';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE GOAL CROSSHAIR, LOCKED AT THE SIZE IT IS ACTUALLY DRAWN AT
 *
 * Owner, 2026-09-18, on the installed app: "the goal icon still looks horrible
 * — way better, but it renders very small and rough on the gold little
 * toolbar."
 *
 * `target` is never rendered above 14px in this product: the goalbar, the slash
 * row and the New-goal row are its three call sites. Everything that went wrong
 * with it went wrong BECAUSE of that — a ring that filled the 24-grid landed its
 * stroke a fraction of a pixel from the box edge and split across two rows of
 * device pixels; ticks that stopped short of the ring left a gap too small to
 * read as a gap and too big to look attached; a stroked centre circle at r 1.6
 * became grey mush.
 *
 * ── WHAT THESE CHECKS READ ────────────────────────────────────────────────
 *
 * The glyph's own numbers, not a render. jsdom rasterises nothing, so any claim
 * here about how the mark LOOKS would be a claim about a picture nobody drew.
 * What can be checked numerically is exactly what was wrong: where the geometry
 * sits inside the grid, whether the ticks touch the ring, and whether the
 * centre carries mass instead of outline. A screenshot is the other half and it
 * belongs to the browser pass, not to this file.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** Centre of the 24 grid every glyph in this set is drawn on. */
const C = 12;

type Seg = { from: [number, number]; to: [number, number] };

/**
 * The straight segments of a path built only from absolute moves and
 * axis-aligned `h`/`v` runs — which is all the crosshair's ticks are.
 *
 * DELIBERATELY NARROW. A general SVG path parser here would be a second
 * implementation of something no test should own, and it would happily accept a
 * redraw that used curves — at which point the numbers below would stop
 * describing the ticks while still passing. This throws on anything it does not
 * understand, so a redraw that changes the path's KIND fails loudly.
 */
function axisSegments(d: string): Seg[] {
  const out: Seg[] = [];
  let cursor: [number, number] | null = null;
  const tokens = d.match(/[MmHhVv][^MmHhVvZzLlCcSsQqTtAa]*|[A-Za-z]/g) ?? [];
  for (const token of tokens) {
    const op = token[0]!;
    const args = token
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (op === 'M') {
      cursor = [args[0]!, args[1]!];
      continue;
    }
    if (cursor === null) throw new Error(`path starts without a move: ${d}`);
    if (op === 'h' || op === 'H') {
      const x = op === 'h' ? cursor[0] + args[0]! : args[0]!;
      out.push({ from: [cursor[0], cursor[1]], to: [x, cursor[1]] });
      cursor = [x, cursor[1]];
      continue;
    }
    if (op === 'v' || op === 'V') {
      const y = op === 'v' ? cursor[1] + args[0]! : args[0]!;
      out.push({ from: [cursor[0], cursor[1]], to: [cursor[0], y] });
      cursor = [cursor[0], y];
      continue;
    }
    throw new Error(`the crosshair is no longer axis-aligned: "${op}" in ${d}`);
  }
  return out;
}

function distanceFromCentre([x, y]: [number, number]): number {
  return Math.hypot(x - C, y - C);
}

describe('the goal crosshair — `target`', () => {
  const shapes = GLYPHS.target;
  const ring = shapes.find((s) => 'circle' in s) as { circle: [number, number, number] };
  const pip = shapes.find((s) => 'dot' in s) as { dot: [number, number, number] };
  const ticks = shapes.filter((s): s is { p: string; t?: string } => 'p' in s);

  it('is a ring, a filled pip and one tick path — nothing else', () => {
    expect(ring, 'the ring is gone').toBeTruthy();
    expect(pip, 'the centre is stroked again, not filled').toBeTruthy();
    expect(ticks).toHaveLength(1);
    expect(shapes).toHaveLength(3);
  });

  it('KEEPS THE WHOLE MARK INSIDE 2..22 of the 24 grid', () => {
    /*
     * The "rough" the owner is looking at. A 24-grid glyph rendered at 12px is
     * scaled by a half, so geometry at unit 1 sits half a device pixel from the
     * edge of its box and the rasteriser has to split its stroke between two
     * pixel rows — which is not a thin line, it is two grey ones. Two units of
     * margin is one device pixel at 12px and the stroke stays whole.
     *
     * DERIVED, not hand-listed: every shape in the glyph is measured, so a
     * fourth shape added later cannot escape by not being named here.
     */
    const extents: number[] = [];
    for (const shape of shapes) {
      if ('circle' in shape) {
        const [cx, cy, r] = shape.circle;
        extents.push(cx - r, cx + r, cy - r, cy + r);
      } else if ('dot' in shape) {
        const [cx, cy, r] = shape.dot;
        extents.push(cx - r, cx + r, cy - r, cy + r);
      } else {
        for (const seg of axisSegments(shape.p)) {
          extents.push(seg.from[0], seg.to[0], seg.from[1], seg.to[1]);
        }
      }
    }
    expect(extents.length).toBeGreaterThan(0);
    expect(Math.min(...extents), 'the glyph reaches past the 2-unit margin').toBeGreaterThanOrEqual(2);
    expect(Math.max(...extents), 'the glyph reaches past the 22-unit margin').toBeLessThanOrEqual(22);
  });

  it('THE TICKS TOUCH THE RING — no floating hairlines', () => {
    /*
     * The previous cut ran its ticks 3.2 → 5.6 while the ring's edge sat at
     * 4.8: a 0.8-unit gap, which at 12px is four tenths of a device pixel. Too
     * small to read as a deliberate gap, big enough to stop the mark reading as
     * one object. Every tick's inner end now sits ON the ring.
     */
    const [, , r] = ring.circle;
    const segments = ticks.flatMap((t) => axisSegments(t.p));
    expect(segments, 'the crosshair lost its ticks').toHaveLength(4);
    for (const seg of segments) {
      const inner = Math.min(distanceFromCentre(seg.from), distanceFromCentre(seg.to));
      const outer = Math.max(distanceFromCentre(seg.from), distanceFromCentre(seg.to));
      expect(inner, 'a tick floats off the ring').toBeCloseTo(r, 6);
      /* Three units out, so the tick is half the ring's radius again — visible
         at 12px without turning the mark into a star. */
      expect(outer - inner).toBeCloseTo(3, 6);
    }
  });

  it('points at all four axes — one tick each, none doubled', () => {
    /*
     * A PROPERTY OF THE SET, not of any tick. Each tick on its own can be
     * perfectly placed while two of them sit on the same axis and two axes are
     * bare — and a per-tick assertion cannot see that. The direction is read
     * from where the tick MEETS THE RING relative to the centre, not from the
     * order the path happens to draw it in: all four are drawn outward-positive
     * here, and a redraw that reversed one must not fail for that alone.
     */
    const segments = ticks.flatMap((t) => axisSegments(t.p));
    const axes = segments.map((s) => {
      const inner = distanceFromCentre(s.from) <= distanceFromCentre(s.to) ? s.from : s.to;
      const [dx, dy] = [inner[0] - C, inner[1] - C];
      if (dx === 0 && dy === 0) throw new Error('a tick meets the ring at the centre');
      if (dx === 0) return dy < 0 ? 'up' : 'down';
      if (dy === 0) return dx < 0 ? 'left' : 'right';
      return 'diagonal';
    });
    expect([...axes].sort()).toEqual(['down', 'left', 'right', 'up']);
  });

  it('carries MASS at the centre, not an outline', () => {
    /* At 12px the old stroked r-1.6 circle drew a ~0.8px ring in a 0.75px
       stroke. A filled dot is the one primitive that survives any downscale. */
    const [, , r] = pip.dot;
    expect(r).toBeGreaterThanOrEqual(1.8);
    /* …and it must not reach the ring, or the mark closes into a bullseye. */
    expect(r).toBeLessThan(ring.circle[2] - 2);
  });

  it('OVERRIDES THE WEIGHT LADDER so the stroke survives 12px', () => {
    /*
     * The ladder in Icon.tsx is 1.65 at ≥16 and 1.5 below. 1.5 units on a 24
     * grid at 12px is 0.75 of a device pixel — a stroke the display can only
     * render by dimming it. This is the one glyph in the set whose entire
     * reading is thin strokes, so it is the one that gets its own weight.
     */
    expect(GLYPH_WEIGHT.target).toBe(1.9);
    /* One exception, deliberately: a second would be a second voice in the
       vocabulary rather than a fix for a size (GRAPHITE Decision 2). */
    expect(Object.keys(GLYPH_WEIGHT)).toEqual(['target']);
  });
});
