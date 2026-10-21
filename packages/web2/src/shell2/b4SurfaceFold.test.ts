import { describe, expect, it } from 'vitest';
import * as shell from './Shell2';
import { CRUMB_HIDDEN_AT, FADE_PX } from './Shell2';
import css from './shell2.css?raw';
import src from './Shell2.tsx?raw';

/* 0.1.8.4 workspace-nav-fit: labels hide only inside the 560px main-column container query (icons keep
   the accessible name). No data-fold writer, no 720px fold. Fade and crumb rules still exist. */
describe('surface names fold to icons only at 560px of the main column', () => {
  it('has no fold chooser, no data-fold writer and no fold rule', () => {
    expect(Object.keys(shell)).not.toContain('pickFold');
    expect(src).not.toMatch(/data-fold(?!ed)|setAttribute\('data-fold'/);
    expect(css).not.toMatch(/data-fold(?!ed)/);
  });
  it('hides a pill label only inside the 560px container query; never swaps in an icon tooltip', () => {
    const flat = css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const hiders: string[] = [];
    for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.s2-seg-l/.test(m[1]!) && /display:\s*none/.test(m[2]!)) hiders.push(m[1]!.trim());
    }
    expect(hiders).toEqual(['.s2-surfaces .s2-seg-l']);
    expect(flat).toMatch(/@container s2main \(max-width: 560px\) \{\s*\.s2-surfaces \.s2-seg-l \{\s*display: none;/);
    expect(flat).not.toMatch(/@container s2main \(max-width: 720px\) \{\s*\.s2-surfaces/);
    expect(flat).not.toMatch(/attr\(data-tip\)/);
  });
  it('keeps the scroll clear of the fade edge, and drops scroll-padding in the 560px icon fold', () => {
    expect(FADE_PX).toBe(28);
    expect(css).toMatch(/\.s2-surfaces\[data-fade='end'\] \{\s*mask-image: linear-gradient\(90deg, black calc\(100% - 28px\), transparent\);/);
    expect(css).toMatch(/\.s2-surfaces\[data-fade='start'\] \{\s*mask-image: linear-gradient\(90deg, transparent, black 28px\);/);
    expect(css).toMatch(/\.s2-surfaces \{\s*scroll-padding: 0 var\(--sp-8\);/);
    expect(css).toMatch(/@container s2main \(max-width: 560px\) \{[\s\S]*?\.s2-surfaces \{\s*scroll-padding: 0;/);
  });
  it('reads the width at which the crumb hides from the same number the stylesheet uses', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toContain(`@container s2main (max-width: ${CRUMB_HIDDEN_AT}px) { .s2-topb { --bar-side: 8px; } .s2-crumb { display: none; } }`);
  });
});
