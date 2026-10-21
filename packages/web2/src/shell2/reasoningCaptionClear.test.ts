/**
 * The "Recommended" caption never touches the thumb, at any stop. The caption sits in its own row below the track, so the
 * clearance is vertical and the same at every stop: the row's gap below the track must exceed what the thumb's focus ring
 * overhangs the track, and the caption's tick must stay in that gap.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');
const css = read('src/shell2/modelMenu.css');
const tokens = read('src/tokens/graphite.css');

const body = (sel: string): string => {
  const at = css.indexOf(`\n${sel} {`);
  if (at < 0) throw new Error(`no rule ${sel}`);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
};
const px = (v: string): number => {
  const t = /var\((--[\w-]+)\)/.exec(v);
  if (t) {
    const d = new RegExp(String.raw`${t[1]}:\s*([\d.]+)px`).exec(tokens);
    if (!d) throw new Error(`no token ${t[1]}`);
    return parseFloat(d[1]!);
  }
  return parseFloat(v);
};
const prop = (sel: string, name: string): string => {
  const m = new RegExp(String.raw`(?:^|;|\s)${name}:\s*([^;]+);`).exec(body(sel));
  if (!m) throw new Error(`no ${name} in ${sel}`);
  return m[1]!.trim();
};

describe('the Recommended caption clears the thumb', () => {
  const thumb = px(prop('.s2-rt-thumb', 'height'));
  const track = px(tokens.match(/--control-h:\s*([\d.]+px)/)![1]!);
  const RING = 4;
  const overhang = Math.max(0, thumb / 2 + RING - track / 2);
  it('the row below the track starts further down than the thumb and its ring reach', () => {
    const gap = px(prop('.s2-rt-under', 'margin').split(/\s+/)[0]!);
    expect(gap).toBeGreaterThanOrEqual(overhang + 8);
  });
  it('the tick stays inside that gap, clear of the track', () => {
    const gap = px(prop('.s2-rt-under', 'margin').split(/\s+/)[0]!);
    const top = px(prop('.s2-rt-rec::before', 'top'));
    const height = px(prop('.s2-rt-rec::before', 'height'));
    expect(top).toBeLessThan(0);
    expect(-top).toBeLessThanOrEqual(gap - 2);
    expect(top + height).toBeLessThan(0);
  });
});
