import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/* THE GENUI SKIN STAYS THE APP'S SKIN. genui.css may use only what tokens/graphite.css defines (or what
   it defines for itself): no colour literal (hex, rgb(), hsl()) and no var(--x) whose name nobody defines.
   An undefined custom property fails silently (the declaration is dropped), so the check is the only
   thing that notices. */

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

export function definedNames(css: string): Set<string> {
  return new Set([...strip(css).matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

export function colourLiterals(css: string): string[] {
  return [...strip(css).matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)].map((m) => m[0]);
}

export function undefinedVars(css: string, defined: Set<string>): string[] {
  const own = definedNames(css);
  return [...new Set([...strip(css).matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!))].filter((n) => !defined.has(n) && !own.has(n));
}

const tokens = definedNames(readFileSync(join(__dirname, '../tokens/graphite.css'), 'utf8'));

describe('genui.css uses only the app tokens', () => {
  it('the checks find planted violations and pass a clean sheet (positive and negative controls)', () => {
    expect(tokens.has('--surface-1')).toBe(true);
    expect(tokens.size).toBeGreaterThan(300);
    expect(colourLiterals('.a { color: #fff; }')).toEqual(['#fff']);
    expect(colourLiterals('.a { box-shadow: 0 1px 2px rgba(0,0,0,.1); }')).toEqual(['rgba(']);
    expect(colourLiterals('.a { color: hsl(1 2% 3%); }')).toEqual(['hsl(']);
    expect(colourLiterals('/* #fff rgba(0) */ .a { color: var(--ink-1); }')).toEqual([]);
    expect(undefinedVars('.a { color: var(--nope-1); }', tokens)).toEqual(['--nope-1']);
    expect(undefinedVars('.a { --mine: 1px; width: var(--mine); color: var(--ink-1); }', tokens)).toEqual([]);
  });

  const css = readFileSync(join(__dirname, 'genui.css'), 'utf8');

  it('has no colour literal', () => {
    expect(colourLiterals(css)).toEqual([]);
  });

  it('uses no custom property that is not defined in graphite.css or in genui.css', () => {
    expect(undefinedVars(css, tokens)).toEqual([]);
  });

  it('loops nothing (the style ratchet counts infinite animations)', () => {
    expect(strip(css)).not.toMatch(/\binfinite\b/);
  });
});
