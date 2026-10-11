import { describe, expect, it } from 'vitest';
import * as shell from './Shell2';
import { CRUMB_HIDDEN_AT, FADE_PX } from './Shell2';
import css from './shell2.css?raw';
import src from './Shell2.tsx?raw';

/* 0.1.6 C6 item 1 (owner: "I don't like how at 420 a focus icon shows. It should always show the names of everything,
   never compressed to icons"): the narrow fold of B4 is gone. These locks fail on the fold (88d6bbcd). */
describe('surface names never fold to icons', () => {
  it('has no fold chooser, no data-fold writer and no fold rule', () => {
    expect(Object.keys(shell)).not.toContain('pickFold');
    expect(src).not.toMatch(/data-fold(?!ed)|setAttribute\('data-fold'/);
    expect(css).not.toMatch(/data-fold(?!ed)/);
  });
  it('no rule hides a pill label or swaps in an icon tooltip', () => {
    const flat = css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.s2-seg-l/.test(m[1]!)) expect(m[2]).not.toMatch(/display:\s*none/);
    }
    expect(flat).not.toMatch(/attr\(data-tip\)/);
  });
  it('keeps the scroll clear of the fade edge', () => {
    expect(FADE_PX).toBe(28);
    expect(css).toMatch(/\.s2-surfaces\s*\{\s*scroll-padding:\s*0 28px;/);
  });
  it('reads the width at which the crumb hides from the same number the stylesheet uses', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toContain(`@container s2main (max-width: ${CRUMB_HIDDEN_AT}px) { .s2-topb { --bar-side: 8px; } .s2-crumb { display: none; } }`);
  });
});
