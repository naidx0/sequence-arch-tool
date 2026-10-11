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

  it('the ink is a soft warm near-black, the hairlines the warm ink at 10 to 14 percent', () => {
    expect(light('--ink-1')).toBe('#2B2A27');
    expect(light('--ink-3')).toBe('#5F5C56');
    expect(light('--edge')).toBe('rgba(43,42,39,.10)');
    expect(light('--edge-strong')).toBe('rgba(43,42,39,.14)');
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
