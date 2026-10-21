import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * ROUND 8, item 8 (Jaden: "way too white instead of a nicer creamy white like
 * Claude does... softer elements instead of hard contrasting... black buttons
 * are too high in contrast"). The floors (4.5:1 text, 3:1 marks) stay in
 * bastionContrast.test.ts; this locks the WARMTH and the softened solid.
 */

const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = strip(readFileSync(resolve(__dirname, 'graphite.css'), 'utf8'));
const shell2 = strip(readFileSync(resolve(__dirname, '../shell2/shell2.css'), 'utf8'));

/** The light room is the first :root block's declarations. */
const light = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens.slice(tokens.indexOf(':root {')))![1]!.trim();
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe('the light room is warm cream (round 8)', () => {
  it('grounds and surfaces lean warm (red over blue), never pure white', () => {
    for (const t of ['--bg-ground', '--bg-base', '--surface-1', '--surface-2', '--surface-3']) {
      const v = light(t);
      expect(v.toUpperCase(), t).not.toBe('#FFFFFF');
      const [r, , b] = rgb(v);
      expect(r - b, `${t} ${v} warmth`).toBeGreaterThanOrEqual(5);
    }
    /* The control: the cool Ramp ground this replaced leans blue. */
    const [r, , b] = rgb('#F3F4F6');
    expect(r - b).toBeLessThan(0);
  });

  it('the ink is a soft warm near-black, the hairlines the warm ink at 13 and 18 percent (017 H6)', () => {
    expect(light('--ink-1')).toBe('#2B2A27');
    expect(light('--ink-3')).toBe('#54514A');
    expect(light('--edge')).toBe('rgba(43,42,39,.13)');
    expect(light('--edge-strong')).toBe('rgba(43,42,39,.18)');
  });

  it('the solid button and the send are a softened ink in light, not the full one', () => {
    /* New chat mixes a FIXED neutral pair (not the accent-moving ink), so it is
       the same under white and blue; the send keeps the ink mix. */
    const rule = /:root\[data-theme='light'\] \.s2-btn\.s2-solid \{([^}]*)\}/.exec(shell2);
    expect(rule).not.toBeNull();
    const pct = Number(/color-mix\(in srgb, var\(--solid-neutral\) (\d+)%, var\(--solid-on-neutral\)\)/.exec(rule![1]!)?.[1]);
    expect(pct).toBeGreaterThan(50);
    expect(pct).toBeLessThan(90);
  });
});

/* 017 H6 (owner review: "light reads creamier; the blue more transparent and less bright, lower contrast against
   cream; some greys a little darker"). Values are read from the sheet and the contrast is computed here. */
const lum = (hex: string) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const blue = (name: string) => new RegExp(`${name}:[ ]*([^;]+);`).exec(tokens.slice(tokens.indexOf(':root:not([data-accent])[data-theme="light"]')))![1]!.trim();
const sat = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
};
const alpha = (v: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(v)![1]);

describe('017 H6: the light room is creamier, the blue softer, the greys darker', () => {
  it('the grounds are creamier than 0.1.6 (#EEE8DA / #F7F2E6 / #FAF6EB): more red-over-blue, never darker than the old ground by much', () => {
    const warm = (h: string) => rgb(h)[0] - rgb(h)[2];
    expect(warm(light('--bg-ground'))).toBeGreaterThan(warm('#EEE8DA'));
    expect(warm(light('--bg-base'))).toBeGreaterThan(warm('#F7F2E6'));
    expect(warm(light('--surface-1'))).toBeGreaterThan(warm('#FAF6EB'));
    expect(lum(light('--bg-ground'))).toBeGreaterThan(0.75);
  });

  it('the greys are darker than 0.1.6 (ink-2 #46443F, ink-3 #5F5C56, ink-4 #6A665E) and the hairlines stronger', () => {
    expect(lum(light('--ink-2'))).toBeLessThan(lum('#46443F'));
    expect(lum(light('--ink-3'))).toBeLessThan(lum('#5F5C56'));
    expect(lum(light('--ink-4'))).toBeLessThan(lum('#6A665E'));
    expect(alpha(light('--edge'))).toBeGreaterThan(0.1);
    expect(alpha(light('--edge-strong'))).toBeGreaterThan(0.14);
  });

  it('text holds its floor on the darkest ground and every surface: body >= 4.5, muted >= 3 (here: >= 4.5 too)', () => {
    for (const bg of ['--bg-ground', '--bg-base', '--surface-1', '--surface-2']) {
      for (const ink of ['--ink-1', '--ink-2', '--ink-3', '--ink-4', '--ink-body']) {
        expect(ratio(light(ink), light(bg)), `${ink} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the blue is less saturated and every wash is more transparent than 0.1.6 (#2F52B5; .07 .28 .12 .32 .10 .40)', () => {
    expect(sat(blue('--accent'))).toBeLessThan(sat('#2F52B5'));
    expect(alpha(blue('--accent-wash'))).toBeLessThan(0.07);
    expect(alpha(blue('--accent-edge'))).toBeLessThan(0.28);
    expect(alpha(blue('--accent-wash-2'))).toBeLessThan(0.12);
    expect(alpha(blue('--accent-rim'))).toBeLessThan(0.32);
    expect(alpha(blue('--accent-chosen'))).toBeLessThan(0.1);
    expect(alpha(blue('--accent-chosen-edge'))).toBeLessThan(0.4);
    expect(alpha(blue('--state-selected'))).toBeLessThan(0.06);
  });

  it('the softer blue still reads: the mark >= 4.5:1 on the cream card and ground, the ink >= 4.5, white on the solid >= 4.5', () => {
    for (const bg of ['--surface-1', '--bg-ground']) {
      expect(ratio(blue('--accent'), light(bg)), `accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(blue('--accent-ink'), light(bg)), `accent-ink on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio('#FFFFFF', blue('--accent-solid'))).toBeGreaterThanOrEqual(4.5);
    /* and lower contrast against cream than the 0.1.6 blue did */
    expect(ratio(blue('--accent'), light('--surface-1'))).toBeLessThan(ratio('#2F52B5', '#FAF6EB'));
  });

  it('control: the test measures what it says: 0.1.6 blue is more saturated, and a cool grey fails the warmth check', () => {
    expect(sat('#2F52B5')).toBeGreaterThan(sat('#4B5F9A'));
    expect(rgb('#F3F4F6')[0] - rgb('#F3F4F6')[2]).toBeLessThan(0);
  });

  it('each light Settings swatch is the accent that accent paints in light (set derived from the --swatch-* tokens)', () => {
    const names = [...tokens.slice(tokens.indexOf(':root {\n  --swatch-')).matchAll(/--swatch-([a-z]+):\s*(#[0-9A-Fa-f]{6})/g)].slice(0, 7);
    expect(names.length).toBeGreaterThanOrEqual(7);
    const accentOf = (key: string): string => {
      const sel = key === 'gold' ? null : key === 'blue' ? ':root:not([data-accent])[data-theme="light"] {' : `:root[data-accent="${key}"][data-theme="light"] {`;
      const body = sel === null ? tokens.slice(tokens.indexOf(':root {')) : tokens.slice(tokens.indexOf(sel));
      expect(body.length, key).toBeGreaterThan(0);
      return /--accent:\s*(#[0-9A-Fa-f]{6})/.exec(body)![1]!.toUpperCase();
    };
    for (const [, key, value] of names) expect(value!.toUpperCase(), `swatch ${key}`).toBe(accentOf(key!));
    /* control: the 0.1.6 blue is not the swatch */
    expect(names.find(([, k]) => k === 'blue')![2]!.toUpperCase()).not.toBe('#2F52B5');
  });

  it('dark is untouched: its ground and accent are the 0.1.6 values', () => {
    const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"] {'));
    expect(/--bg-ground:\s*#12131A/.test(dark)).toBe(true);
    expect(/--accent:\s*#E8C547/.test(dark)).toBe(true);
    expect(/--ink-3:\s*#9A9CA6/.test(dark)).toBe(true);
  });
});
