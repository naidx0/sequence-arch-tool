import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import chat2Raw from './chat2.css?raw';

/*
 * ROUND 8, item 5 (Jaden: "too much depth and shadows and the buttons on the
 * chat box... appear really large... add the transparency on those buttons
 * and remove a little of that shadowing").
 *
 * WHAT THIS READS: the sheets' text, every rule for a selector in order (the
 * cascade keeps the last at equal specificity), and the token values the rules
 * name. The rendered pass is the checkpoint shots.
 */

const chat2 = chat2Raw.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync(resolve(__dirname, '../tokens/graphite.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule body whose selector list includes `selector`, in sheet order (the cascade's order at equal specificity). */
function last(css: string, selector: string): string {
  let out = '';
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').map((s) => s.trim()).includes(selector)) out += `${m[2]!};`;
  }
  expect(out, `no rule for ${selector}`).not.toBe('');
  return out;
}
/** The value the cascade keeps: the last declaration of `prop`. */
const decl = (body: string, prop: string) => [...body.matchAll(new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;]+);`, 'g'))].pop()?.[1]?.trim() ?? null;
const alpha = (v: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(v)?.[1] ?? NaN);

describe('the composer is lighter (round 8)', () => {
  it('its pills and + are thinner glass than the resting control, with a hairline and no drop shadow', () => {
    const pill = last(chat2, '.s2-comp .s2-cb .s2-pill');
    expect(decl(pill, 'box-shadow')).toBe('none');
    expect(decl(pill, 'background')).toBe('var(--comp-glass)');
    expect(decl(pill, 'border-color')).toBe('var(--comp-glass-edge)');
    expect(last(chat2, '.s2-comp .s2-cb .s2-ibtn.s2-g')).toMatch(/box-shadow:\s*none;/);
    /* Lower alpha than the shared glass control, in both rooms. */
    const darkCtl = alpha(/--glass-ctl:\s*(rgba\([^)]*\))/.exec(tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)')))![1]!);
    const lightCtl = alpha(/--glass-ctl:\s*(rgba\([^)]*\))/.exec(tokens)![1]!);
    const comp = [...chat2.matchAll(/--comp-glass:\s*(rgba\([^)]*\))/g)].map((m) => alpha(m[1]!));
    expect(comp).toHaveLength(2);
    expect(comp[0]!).toBeLessThan(darkCtl);
    expect(comp[1]!).toBeLessThan(lightCtl);
  });

  it('the send is 30 px and a softened ink, not the full one', () => {
    const send = last(chat2, '.s2-comp .s2-send');
    expect(decl(send, 'width')).toBe('var(--row-h)');
    expect(decl(send, 'height')).toBe('var(--row-h)');
    expect(tokens).toMatch(/--row-h:\s*30px/);
    expect(decl(send, 'background')).toMatch(/color-mix\(in srgb, var\(--b-ink1\) \d+%/);
  });

  it('the card keeps only a faint lift (no blur over 4 px); the focus ring stays', () => {
    const card = last(chat2, '.s2-comp');
    expect(decl(card, 'box-shadow')).toBe('var(--comp-lift)');
    for (const m of chat2.matchAll(/--comp-lift:\s*([^;]+);/g)) {
      const blur = Number(/\d+px\s+(\d+)px/.exec(m[1]!)?.[1]);
      expect(blur).toBeLessThanOrEqual(4);
    }
    /* The control: the first .s2-comp rule still names B's full shadow, so `last` is what picks the override. */
    expect(/\n\.s2-comp \{[^}]*box-shadow:\s*var\(--b-shadow\)/.test(chat2)).toBe(true);
    expect(last(chat2, '.s2-comp:has(.s2-ta:focus)')).toMatch(/0 0 0 3px var\(--b-accw\)/);
  });

  it('every composer control keeps a 24 px target', () => {
    for (const sel of ['.s2-comp .s2-cb .s2-pill', '.s2-comp .s2-cb .s2-ibtn.s2-g']) {
      expect(decl(last(chat2, sel), 'height')).toBe('var(--control-h)');
    }
    expect(tokens).toMatch(/--control-h:\s*28px/);
  });
});
