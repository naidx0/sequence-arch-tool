import { describe, expect, it } from 'vitest';

import css from './settings.css?raw';

/* Owner: "We need better spacing between buttons and their underlining effects." The nav rows sat 2px apart,
   so the selected row's edge nearly touched the next row; the action pills sat 6px apart, closer than the
   4px (2px offset + 2px ring) a focus ring needs on each side; link underlines hugged the text at 2px. */

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const body = (sel: string) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');
const tokenPx = (v: string) => Number(/--sp-(\d+)\b/.exec(v)?.[1]);

describe('settings spacing', () => {
  it('nav rows are at least 4px apart, as a token', () => {
    const gap = /(?:^|[;\s])gap:\s*([^;]+)/.exec(body('.settings-scope .sb-nav'))?.[1] ?? '';
    expect(tokenPx(gap)).toBeGreaterThanOrEqual(4);
  });
  it('rows of action pills are at least 8px apart', () => {
    const gap = /(?:^|[;\s])gap:\s*([^;]+)/.exec(body('.settings-scope .sb-profile-acts'))?.[1] ?? '';
    expect(tokenPx(gap)).toBeGreaterThanOrEqual(8);
  });
  it('underlines keep 4px clear of the text', () => {
    for (const sel of ['.settings-scope .sb-link', '.settings-scope button.sb-profile-name:hover']) {
      const off = /text-underline-offset:\s*([^;]+)/.exec(body(sel))?.[1] ?? '';
      expect(tokenPx(off), sel).toBeGreaterThanOrEqual(4);
    }
  });
});
