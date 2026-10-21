import { describe, expect, it } from 'vitest';

import tokens from '../tokens/graphite.css?raw';
import shell2 from './shell2.css?raw';
import settings from '../settings/settings.css?raw';
import edits from './edits.css?raw';
import base from '../styles/base.css?raw';

/* Decision 52 (native feel): every kit control eases into and out of a press, lifts 1px on a hover device,
   and both go instant under reduced motion. The subject set is the kit's own classes plus the [data-press]
   hook, so a control added to the list cannot drop out of the rule. A stylesheet is read here, not a
   computed style: jsdom has no :active. The browser lock is e2e evidence in the hand-off. */

interface Rule { media: string; selector: string; body: string }

/** A flat list of style rules with the @media prelude each sits in ('' at the top level). */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const walk = (text: string, media: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude);
      else if (!prelude.startsWith('@')) out.push({ media, selector: prelude.replace(/\s+/g, ' '), body });
      i = j;
    }
  };
  walk(src, '');
  return out;
}

const KIT = ['.s2-btn', '.s2-ibtn', '.sb-pill', '.s2-chipbtn', '[data-press]'];
const REDUCED = '(prefers-reduced-motion: reduce)';

describe('press and lift are shared design-system primitives', () => {
  const all = rules(tokens);

  it('the tokens name the press: scale .97 over the first duration', () => {
    expect(tokens).toMatch(/--press-scale:\s*\.97/);
    expect(tokens).toMatch(/--press-dur:\s*var\(--dur-1\)/);
  });

  it.each(KIT)(':active on %s sets the press transform from the token', (k) => {
    const hit = all.filter((r) => r.media === '' && r.selector.includes(k) && /:active/.test(r.selector));
    expect(hit.length).toBeGreaterThan(0);
    for (const r of hit) expect(r.body).toMatch(/transform:\s*scale\(var\(--press-scale\)\)/);
  });

  it.each(KIT)(':hover on %s lifts one hairline, on hover-capable pointers only', (k) => {
    const hit = all.filter((r) => r.selector.includes(k) && /:hover/.test(r.selector) && /translateY\(calc\(-1 \* var\(--w-hair\)\)\)/.test(r.body));
    expect(hit.length).toBeGreaterThan(0);
    for (const r of hit) expect(r.media).toContain('(hover: hover)');
  });

  it.each(KIT)('%s is released to rest under reduced motion (no lift)', (k) => {
    const hit = all.filter((r) => r.media.includes(REDUCED) && r.selector.includes(k) && /:hover/.test(r.selector));
    expect(hit.length).toBeGreaterThan(0);
    for (const r of hit) expect(r.body).toMatch(/transform:\s*none/);
  });

  it('a pressed control is still pressed (not overridden by a later hover lift of equal weight)', () => {
    const lastLift = all.map((r, i) => ({ r, i })).filter(({ r }) => /:hover/.test(r.selector) && r.selector.includes('[data-press]') && r.media.includes('(hover: hover)'));
    const press = all.map((r, i) => ({ r, i })).filter(({ r }) => /:active/.test(r.selector) && r.selector.includes('[data-press]'));
    expect(Math.max(...press.map((p) => p.i))).toBeGreaterThan(Math.max(...lastLift.map((p) => p.i)));
  });

  const sheets: Array<[string, string, string]> = [
    ['.s2-btn', 'shell2.css', shell2],
    ['.s2-ibtn', 'shell2.css', shell2],
    ['.sb-pill', 'settings.css', settings],
    ['.s2-chipbtn', 'edits.css', edits],
  ];
  it.each(sheets)('%s (in %s) transitions transform on the press token', (k, _name, css) => {
    const rest = rules(css).filter((r) => r.media === '' && r.selector.endsWith(k) && /transition/.test(r.body));
    expect(rest.length).toBeGreaterThan(0);
    for (const r of rest) expect(r.body).toMatch(/transition:[^;]*transform var\(--press-dur\) var\(--ease\)/);
  });

  it('the kit sheets carry no raw cubic-bezier and no raw millisecond transition', () => {
    for (const css of [shell2, settings, edits]) {
      const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(live).not.toMatch(/cubic-bezier\(/);
      for (const m of live.matchAll(/(?:transition|animation)\s*:[^;]*/g)) {
        if (/infinite/.test(m[0])) continue;
        expect(m[0], m[0]).not.toMatch(/(?<![\w.-])\d*\.?\d+m?s\b/);
      }
    }
  });
});

describe('native scroll', () => {
  const b = rules(base);
  it('the document never rubber-bands', () => {
    const r = b.find((x) => x.media === '' && x.selector === 'html, body' && /overscroll-behavior:\s*none/.test(x.body));
    expect(r).toBeDefined();
  });
  it('smooth scrolling is opt-in and only without reduced motion', () => {
    const smooth = b.filter((x) => /scroll-behavior:\s*smooth/.test(x.body));
    expect(smooth.length).toBeGreaterThan(0);
    for (const r of smooth) {
      expect(r.media).toContain('(prefers-reduced-motion: no-preference)');
      expect(r.selector).toBe('[data-scroll-smooth]');
    }
  });
});
