import { describe, expect, it } from 'vitest';

import css from './settings.css?raw';

/* Owner, 0.1.8.4: "pop-ups should not scroll (except Skills); bottom-up scrolling is OK, left-to-right is NEVER OK."
   jsdom has no layout, so these read the stylesheet; e2e/settings-popup-overflow.mjs measures the real thing at 1440,
   1024 and 420. Each rule here failed before the fix. */

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const body = (sel: string) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');

describe('settings never scrolls sideways', () => {
  it('no rule makes any box a horizontal scroller', () => {
    const bad = rules.filter((r) => /overflow(-x)?:\s*(auto|scroll)/.test(r.body) && !/overflow-y/.test(r.body) || /overflow-x:\s*(auto|scroll)/.test(r.body));
    expect(bad.map((r) => r.sel)).toEqual([]);
  });
  it('the scrolling body clips x, because overflow-y:auto alone makes x auto too', () => {
    expect(body('.settings-scope .sb-body')).toMatch(/overflow-x:\s*hidden/);
  });
  it('a long unbroken error sentence wraps inside its box', () => {
    expect(body('.settings-scope .sb-fail')).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('the narrow nav wraps its pills instead of scrolling them', () => {
    expect(bare).toMatch(/\.settings-scope \.sb-nav \{[^}]*flex-wrap:\s*wrap/);
  });
  it('the autonomy table stacks at narrow widths, each cell labelled', () => {
    expect(bare).toMatch(/\.sb-matrix thead \{ display: none; \}/);
    expect(bare).toMatch(/\.sb-matrix td::before \{ content: attr\(data-label\)/);
  });
});
