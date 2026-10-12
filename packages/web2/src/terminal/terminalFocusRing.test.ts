import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 0019 — THE TERMINAL SHOWS KEYBOARD FOCUS (WCAG 2.4.7), CALMLY.
 *
 * The accessibility audit: the terminal is a tab stop, and
 * `.terminal-pane-surface { outline: none }` in v3.css took away the app's
 * ring, so keyboard focus on it was invisible (0/1 focus-visible in Chromium).
 * Owner, 2026-10-09: the terminal is glass and calm, so the indicator is a 1px
 * accent border and a soft accent glow, not the app-wide 2px box. The intent is
 * kept: there is a visible, accent-coloured indicator on :focus-visible, and it
 * wins the cascade over the rule that clears the outline.
 *
 * jsdom has no layout or focus-visible heuristics, so these READ THE
 * STYLESHEET. The measurement in Chromium is the audit probe (a real Tab onto
 * the terminal, then the computed border and shadow).
 */
/* Line endings normalised: a Windows checkout (autocrlf) would otherwise hide the cleared rule below. */
const css = readFileSync(resolve(__dirname, '..', 'v3', 'v3.css'), 'utf8').replace(/\r\n/g, '\n');

describe('the terminal focus indicator', () => {
  const rule = /\.terminal-pane-surface:focus-visible[^{]*\{([^}]*)\}/.exec(css);

  it('has a :focus-visible rule on the terminal surface', () => {
    expect(rule, '.terminal-pane-surface:focus-visible has a rule').toBeTruthy();
  });

  it('is a visible accent indicator: an accent border and a soft accent glow, not the heavy 2px outline', () => {
    const body = rule![1]!;
    expect(body).toMatch(/border-color:\s*var\(--accent\)/);
    expect(body).toMatch(/box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--accent\) 22%, transparent\)/);
    expect(body).toMatch(/outline:\s*none/);
    expect(body).not.toMatch(/outline:\s*2px/);
  });

  it('the surface has a 1px border for the accent to colour', () => {
    const surface = [...css.matchAll(/\n\.terminal-pane-surface \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(surface).toMatch(/border:\s*var\(--w-hair\) solid/);
  });

  it('comes after the rule that clears the outline, so it wins the cascade', () => {
    const cleared = css.indexOf('.terminal-pane-surface,\n.v3-terminal pre {');
    expect(cleared).toBeGreaterThanOrEqual(0);
    expect(css.indexOf('.terminal-pane-surface:focus-visible')).toBeGreaterThan(cleared);
    /* The glass rule that draws the resting hairline comes before it too. */
    expect(css.indexOf('.terminal-pane-surface:focus-visible')).toBeGreaterThan(css.indexOf('\n.terminal-pane-surface {'));
  });
});
