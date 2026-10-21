import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FALLBACK_DARK, FALLBACK_LIGHT, themeStyle } from './visualDoc';

const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string): string => new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';

describe('the drawing card is quiet (v2)', () => {
  it('has a transparent background and the tool-call card frame: the app hairline and 16px radius', () => {
    const card = rule('.dgm');
    expect(card).toMatch(/background:\s*transparent/);
    expect(card).toMatch(/border:\s*1px solid var\(--b-edge\)/);
    expect(card).toMatch(/border-radius:\s*16px/);
  });
  it('the bar label is dimmed, and the card spends less space than before', () => {
    expect(rule('.dgm-bar')).toMatch(/color:\s*var\(--b-ink3\)/);
    /* One line: the bar never wraps, the title is cut with an ellipsis (its tooltip holds it whole). */
    expect(rule('.dgm-bar')).not.toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.dgm-title')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.dgm-title')).toMatch(/text-overflow:\s*ellipsis/);
    /* The actions are icon buttons at the icon-button size, shown on hover or focus and always on touch. */
    expect(readFileSync(join(__dirname, 'VisualActions.tsx'), 'utf8')).toContain('s2-ibtn s2-ibtn-sm dgm-act');
    expect(rule('.dgm-act')).toMatch(/opacity:\s*0/);
    expect(css).toMatch(/\.dgm:focus-within \.dgm-act/);
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.dgm-act \{\s*opacity: 1/);
    expect(css).toMatch(/\.dgm-act:focus-visible::after/);
  });
  it('the drag bar meets the hit-target floor under a finger, and the card uses only real tokens', () => {
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.dgm-grip \{\s*height: var\(--target-min\)/);
    const tokens = readFileSync(join(__dirname, '..', 'tokens', 'graphite.css'), 'utf8');
    const tail = css.slice(css.indexOf('.dgm-body {'));
    const used = new Set([...tail.matchAll(/var\((--[a-z0-9-]+)\s*[,)]/g)].map((m) => m[1]!));
    const missing = [...used].filter((t) => !t.startsWith('--b-') && t !== '--card-h' && t !== '--dgm-side' && !new RegExp(`${t}:`).test(tokens));
    expect(missing).toEqual([]);
    expect(rule('.dgm-bar')).toMatch(/padding:\s*2px 8px/); // the first, base rule; the 0.1.5 grid rule below it tokenises it
    expect(rule('.dgm')).toMatch(/margin:\s*6px 0/);
    expect(rule('.dgm-frame')).toMatch(/background:\s*transparent/);
  });
  it('the dark frame is the app dark grey, never pure black, and has contrast with its text', () => {
    const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (h: string): number => hex(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    expect(FALLBACK_DARK.bg.toLowerCase()).not.toBe('#000000');
    expect(FALLBACK_DARK.bg).toBe('#181a20');
    for (const t of [FALLBACK_DARK, FALLBACK_LIGHT]) {
      expect(ratio(t.bg, t.fg)).toBeGreaterThan(7);
      expect(ratio(t.bg, t.muted)).toBeGreaterThan(4.5);
    }
    expect(themeStyle(FALLBACK_DARK)).toContain('background:transparent');
  });
});

describe('the quiet labels still read (4.5:1 at 11px) in every theme', () => {
  const tokens = readFileSync(join(__dirname, '..', 'tokens', 'graphite.css'), 'utf8');
  const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h: string): number => hex(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  it('the label and the id use the unmixed ink-3, which clears AA on each theme base', () => {
    expect(rule('.dgm-label')).not.toMatch(/opacity/);
    expect(rule('.dgm-title')).toMatch(/color:\s*var\(--(b-ink2|ink-2)/);
    const pairs = [...tokens.matchAll(/--bg-base:\s*(#[0-9A-Fa-f]{6});[\s\S]{0,400}?--ink-3:\s*(#[0-9A-Fa-f]{6})/g)];
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (const [, bg, ink] of pairs) expect(ratio(bg!, ink!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the app page carries the frame policy itself', () => {
  it("index.html has a frame-src 'self' meta tag matching the server header", () => {
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
    expect(html).toMatch(/<meta\s+http-equiv="Content-Security-Policy"\s+content="frame-src 'self'"\s*\/>/);
    const server = readFileSync(join(__dirname, '..', '..', '..', 'analyzer', 'src', 'server', 'static.ts'), 'utf8');
    expect(server).toContain(`APP_FRAME_POLICY = "frame-src 'self'"`);
  });
});
