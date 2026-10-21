import { describe, expect, it } from 'vitest';

import raw from './shell2.css?raw';

/*
 * ROUND 7, B7 (Jaden: "Make sure all the buttons spacing is unique and
 * uniform throughout. Transparent. Nice soft edges."): the shell's sheet
 * spaces with ONE scale and sizes its controls from the control rungs.
 *
 * WHAT THIS READS: the sheet's text (jsdom has no layout). The rendered half,
 * every icon centred in its button to 0.5 px, is e2e/icons-centred.mjs in a
 * real Chromium. The subject sets are derived from the sheet itself: every
 * spacing declaration, and every rule that draws a pressable thing (it says
 * `cursor: pointer`), so a rule added later is held to the same law.
 */

const css = raw.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  body: string;
}

function rules(sheet: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(sheet); m; m = re.exec(sheet)) out.push({ selector: m[1]!.trim(), body: m[2]! });
  return out;
}

const SPACING = /(?:^|;|\n)\s*((?:row-|column-)?gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;]+);/g;

/** Every raw length in a spacing value that is not on the scale. */
export function offScale(value: string): string[] {
  const bare = value.replace(/var\(--sp-\d+\)/g, '').replace(/calc\([^)]*\)/g, (c) => (/var\(--sp-\d+\)/.test(c) ? '' : c));
  return [...bare.matchAll(/-?\d*\.?\d+(px|rem|em)/g)].map((m) => m[0]).filter((v) => !/^-?0(px|rem|em)$/.test(v));
}

describe('one spacing scale (B7)', () => {
  it('the scan finds an off-scale value when there is one (control)', () => {
    expect(offScale('0 9px')).toEqual(['9px']);
    expect(offScale('var(--sp-8) 13px')).toEqual(['13px']);
    expect(offScale('0 var(--sp-12) 0 var(--sp-16)')).toEqual([]);
    expect(offScale('calc(-1 * var(--sp-4))')).toEqual([]);
  });

  it('every gap, padding and margin in the shell sheet is on the --sp scale', () => {
    /* 14px is not a --sp rung (2, 4, 6, 8, 10, 12, 16…). The transcript / chat-only
       reading column keeps that exact padding so the gutter subtraction stays 1:1
       with the overlay scrollbar; lock those selectors, invent no new scale. */
    const reading = /\.v3-transcript|\.v3-vrow/;
    const bad: string[] = [];
    const reading14: string[] = [];
    let seen = 0;
    for (const r of rules(css)) {
      for (const m of r.body.matchAll(SPACING)) {
        seen++;
        const off = offScale(m[2]!);
        if (!off.length) continue;
        const locked = reading.test(r.selector) && off.every((v) => v === '14px');
        const line = `${r.selector} { ${m[1]}: ${m[2]} }`;
        if (locked) reading14.push(line);
        else bad.push(line);
      }
    }
    expect(seen).toBeGreaterThan(60);
    expect(reading14).toHaveLength(8);
    expect(bad).toEqual([]);
  });
});

describe('controls are sized from the control rungs (B7)', () => {
  it('no pressable rule sets a raw pixel height or width', () => {
    const pressable = rules(css).filter((r) => /cursor:\s*pointer/.test(r.body));
    expect(pressable.length).toBeGreaterThan(10);
    const bad = pressable
      .flatMap((r) => [...r.body.matchAll(/(?:^|\n)\s*((?:min-|max-)?(?:height|width))\s*:\s*([^;]+);/g)].map((m) => ({ r, prop: m[1]!, v: m[2]!.trim() })))
      .filter(({ v }) => /\d+px/.test(v) && !/^100%$/.test(v))
      .map(({ r, prop, v }) => `${r.selector} { ${prop}: ${v} }`);
    expect(bad).toEqual([]);
  });

  it('the surface pills sit on a segmented track; an open pill is not tinted (round 12), edges are full', () => {
    const on = rules(css).find((r) => r.selector === '.s2-sp.is-on')!;
    expect(on.body).toMatch(/background:\s*transparent;/);
    expect(on.body).not.toMatch(/--b-acc/);
    const pill = rules(css).find((r) => r.selector === '.s2-sp')!;
    expect(pill.body).toMatch(/border-radius:\s*var\(--r-full\);/);
    expect(pill.body).toMatch(/height:\s*var\(--control-h-lg\);/);
  });
});
