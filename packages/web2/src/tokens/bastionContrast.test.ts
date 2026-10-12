import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/* ══════════════════════════════════════════════════════════════════════════
   DECISION 42's FLOORS, CHECKED BY COMPUTED CONTRAST (room: Decision 49)
   Decision 42 set these floors on the Bastion room; Decision 49 put the warm
   grey back and the floors stay. Checked here over the TOKEN VALUES, not by eye:
     text (body and muted)            ≥ 4.5:1 on the ground and every surface
     box borders and board edges      ≥ 3:1 against the ground they cross
     diff badges and ghosts, hotspots heat, the glass control rim
                                      ≥ 3:1 against what they sit on
   Translucent tokens are composited over the surface first: an rgba ink is
   only as legible as the colour it ends up being.
   ══════════════════════════════════════════════════════════════════════════ */

const CSS = readFileSync(resolve(__dirname, 'graphite.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

type Tokens = Map<string, string>;

/** Declarations of every block whose selector is exactly `selector`, merged in order. */
function block(selector: string): Tokens {
  const out: Tokens = new Map();
  let at = 0;
  for (;;) {
    const i = CSS.indexOf(`${selector} {`, at);
    if (i < 0) break;
    const before = CSS.slice(Math.max(0, i - 1), i);
    at = i + 1;
    if (before !== '\n' && before !== '' && before !== ' ') continue;
    const j = CSS.indexOf('\n}', i);
    for (const m of CSS.slice(i, j).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}
const merge = (...maps: Tokens[]): Tokens => new Map(maps.flatMap((m) => [...m]));

const LIGHT = block(':root');
const DARK = merge(LIGHT, block(':root:not([data-accent]):not([data-theme="light"])'));
const LIGHT_BLUE = merge(LIGHT, block(':root:not([data-accent])[data-theme="light"]'));

function value(t: Tokens, name: string, depth = 0): string {
  const v = t.get(name);
  if (v === undefined) throw new Error(`${name} is not declared`);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m && depth < 8) return value(t, m[1]!, depth + 1);
  return v;
}

type RGBA = [number, number, number, number];
function parse(c: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = /^rgba?\(([^)]+)\)$/.exec(c);
  if (rgba) {
    const p = rgba[1]!.split(',').map((x) => Number(x.trim()));
    return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
  }
  const mix = /^color-mix\(in srgb, (#[0-9a-f]{6}|rgba?\([^)]+\)) (\d+)%, transparent\)$/i.exec(c);
  if (mix) {
    const [r, g, b, a] = parse(mix[1]!);
    return [r, g, b, a * (Number(mix[2]) / 100)];
  }
  throw new Error(`cannot read colour ${c}`);
}
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a)).concat(1) as RGBA;
}
function lum([r, g, b]: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(t: Tokens, fgName: string, groundName: string): number {
  const ground = parse(value(t, groundName));
  const fg = over(parse(value(t, fgName)), ground);
  const [a, b] = [lum(fg), lum(ground)].sort((x, y) => y - x);
  return Math.round(((a! + 0.05) / (b! + 0.05)) * 100) / 100;
}
/** A colour that is a token mixed into transparent at the --mix-edge strength (the board's added/changed borders). */
function mixEdge(t: Tokens, colourName: string): string {
  const pct = Number(value(t, '--mix-edge').replace('%', ''));
  const [r, g, b] = parse(value(t, colourName));
  return `rgba(${r},${g},${b},${pct / 100})`;
}

describe('Decision 49: the rooms are Ramp Kit dark and Ramp Kit / Bastion light', () => {
  it('takes the Ramp Kit values for ground, surface, inks and line', () => {
    expect(value(DARK, '--bg-base')).toBe('#20201F');
    expect(value(DARK, '--surface-1')).toBe('#272725');
    expect(value(DARK, '--ink-1')).toBe('#ECEBE8');
    expect(value(DARK, '--ink-2')).toBe('#B8B7B2');
    expect(value(DARK, '--edge')).toBe('rgba(255,255,255,.08)');
    /* Round 8: the light room is warm cream (Jaden: "a nicer creamy white like Claude does"). */
    expect(value(LIGHT_BLUE, '--bg-base')).toBe('#F5EDDA');
    expect(value(LIGHT_BLUE, '--bg-ground')).toBe('#EDE4D0');
    expect(value(LIGHT_BLUE, '--ink-1')).toBe('#2B2A27');
    expect(value(LIGHT_BLUE, '--accent')).toBe('#4B5F9A');
    /* The Bastion room is not kept as a second value: nothing names it. */
    expect(CSS.includes('#0b0d12')).toBe(false);
  });
});

const GROUNDS = ['--bg-base', '--surface-1', '--surface-2', '--surface-3'];
for (const [theme, t] of [['dark (Ramp Kit)', DARK], ['light (Ramp Kit)', LIGHT_BLUE]] as const) {
  describe(`computed contrast — ${theme}`, () => {
    it('body and muted text read at 4.5:1 or more on the ground and every surface', () => {
      for (const g of GROUNDS) {
        for (const ink of ['--ink-1', '--ink-2', '--ink-3', '--ink-body']) {
          expect(contrast(t, ink, g), `${ink} on ${g}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    /* UX audit R11 #9: --ink-4 is text in about a hundred rules, so the quietest ink is held to the text floor too (it was 2.8 to 3.3:1 on cream). */
    if (theme.startsWith('light')) {
      it('the quietest ink (--ink-4) is text too: 4.5:1 or more on every light ground', () => {
        for (const g of [...GROUNDS, '--bg-ground', '--ground-hi']) {
          expect(contrast(t, '--ink-4', g), `--ink-4 on ${g}`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it('the ink steps stay visibly ordered: ink-1 > ink-2 > ink-3 > ink-4 in contrast', () => {
        for (const g of ['--bg-base', '--surface-1']) {
          const c = ['--ink-1', '--ink-2', '--ink-3', '--ink-4'].map((i) => contrast(t, i, g));
          for (let i = 1; i < c.length; i++) expect(c[i - 1]!, `${g} step ${i}`).toBeGreaterThan(c[i]!);
        }
      });
    }

    it('box borders and board edges reach 3:1 against the ground they cross', () => {
      for (const g of ['--bg-base', '--surface-1']) {
        expect(contrast(t, '--box-edge', g), `--box-edge on ${g}`).toBeGreaterThanOrEqual(3);
      }
      /* Connectors cross the board ground. */
      for (const edge of ['--viz-baseline', '--accent', '--unknown']) {
        expect(contrast(t, edge, '--bg-base'), `${edge} on the board ground`).toBeGreaterThanOrEqual(3);
      }
    });

    it('diff badges, ghosts, hotspots heat and the glass rim reach 3:1 on what they sit on', () => {
      /* Badge glyphs (+ ~ −) on the badge's surface, the heat bar on its track. */
      for (const c of ['--fits', '--spills', '--wont']) {
        expect(contrast(t, c, '--surface-1'), `${c} badge`).toBeGreaterThanOrEqual(3);
        expect(contrast(t, c, '--surface-2'), `${c} on the heat track`).toBeGreaterThanOrEqual(3);
      }
      /* Added / changed box borders (the full verdict ink, board.css) and the
         dashed ghost (--box-edge). The board ground is what a card sits on. */
      for (const c of ['--fits', '--spills', '--box-edge']) {
        expect(contrast(t, c, '--bg-base'), `${c} border`).toBeGreaterThanOrEqual(3);
      }
      /* A mixed-down edge would not do: the old --mix-edge border is the control. */
      const local = new Map(t);
      local.set('--x-mixed', mixEdge(t, '--fits'));
      if (t === LIGHT_BLUE) expect(contrast(local, '--x-mixed', '--surface-1')).toBeLessThan(3);
      /* Decision 49: a glass pill's rim is soft (uiarc.dev); what must read is
         on the pill: its label at 4.5:1 and its glyph (the second ink) at 3:1,
         on the fill composited over the ground and the surface it sits on. */
      for (const g of ['--bg-base', '--surface-1', '--surface-2']) {
        const local = new Map(t);
        local.set('--x-pill', rgbaOf(over(parse(value(t, '--glass-ctl-hover')), parse(value(t, g)))));
        expect(contrast(local, '--ink-1', '--x-pill'), `pill label on ${g}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(local, '--ink-2', '--x-pill'), `pill glyph on ${g}`).toBeGreaterThanOrEqual(3);
        expect(contrast(local, '--accent', '--x-pill'), `chosen glyph on ${g}`).toBeGreaterThanOrEqual(3);
      }
    });
  });
}

/* DECISION 45 — A FLOATING SURFACE OVER BOARD TEXT IS NEAR-OPAQUE. The
   palette's rows sit over board labels; what the row text reads against is
   the palette fill composited over the busiest thing under it, approximated
   by the board's lightest label ink (--ink-1: the label most like the row
   text, so the worst case). */
function mixOverTransparent(t: Tokens, name: string): RGBA {
  const v = value(t, name);
  const m = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\)$/.exec(v);
  if (!m) return parse(v);
  const [r, g, b, a] = parse(value(t, m[1]!));
  return [r, g, b, a * (Number(m[2]) / 100)];
}
const rgbaOf = ([r, g, b, a]: RGBA): string => `rgba(${r},${g},${b},${a})`;
describe('Decision 45 — the palette over board labels', () => {
  for (const [theme, t] of [['dark (Ramp Kit)', DARK], ['light (Ramp Kit)', LIGHT_BLUE]] as const) {
    it(`row text reads 4.5:1 or more on its fill over the busiest board content — ${theme}`, () => {
      const under = parse(value(t, '--ink-1'));
      const local = new Map(t);
      local.set('--x-under', rgbaOf(over(mixOverTransparent(t, '--float-fill'), under)));
      for (const ink of ['--ink-1', '--ink-2']) {
        expect(contrast(local, ink, '--x-under'), `${ink} on the palette`).toBeGreaterThanOrEqual(4.5);
      }
      /* Control: the glass-thin fill the palette had lets the label through. */
      local.set('--x-old', rgbaOf(over(parse(value(t, '--glass-fill-2')), under)));
      expect(contrast(local, '--ink-1', '--x-old')).toBeLessThan(4.5);
    });
  }
  it('the palette is filled with it and does not blur', () => {
    const v3 = readFileSync(resolve(__dirname, '../v3/v3.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\n\.shell-cmd \{([^}]*)\}/.exec(v3)?.[1] ?? '';
    expect(rule).toMatch(/background:\s*var\(--float-fill\)/);
    expect(rule).not.toMatch(/backdrop-filter/);
  });
});

describe('the check can fail (control)', () => {
  it('a Bastion-strength 13% line is far below 3:1, so the box border is not that token', () => {
    expect(contrast(DARK, '--edge', '--bg-base')).toBeLessThan(3);
  });
});
