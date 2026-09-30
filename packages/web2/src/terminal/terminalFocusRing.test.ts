import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 0019 — THE TERMINAL WEARS A FOCUS RING.
 *
 * The accessibility audit (WCAG 2.4.7): the terminal is a tab stop, and
 * `.terminal-pane-surface { outline: none }` in v3.css took away the app's
 * ring, so keyboard focus on it was invisible (0/1 focus-visible in Chromium).
 *
 * jsdom has no layout or focus-visible heuristics, so these READ THE
 * STYLESHEET, as filesHeaderFit and railWorkspaceNewChat do. The measurement in
 * Chromium is the audit probe (a real Tab onto the terminal, then the computed
 * outline).
 */
/* Line endings normalised: a Windows checkout (autocrlf) would otherwise hide the cleared rule below. */
const css = readFileSync(resolve(__dirname, '..', 'v3', 'v3.css'), 'utf8').replace(/\r\n/g, '\n');
const base = readFileSync(resolve(__dirname, '..', 'styles', 'base.css'), 'utf8');

describe('the terminal focus ring', () => {
  it('draws a :focus-visible ring on the terminal surface', () => {
    const m = /\.terminal-pane-surface:focus-visible[^{]*\{([^}]*)\}/.exec(css);
    expect(m, '.terminal-pane-surface:focus-visible has a rule').toBeTruthy();
    expect(m![1]).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('is the same ring as the app-wide one in base.css', () => {
    expect(base).toMatch(/:focus-visible \{ outline: 2px solid var\(--accent\)/);
  });

  it('comes after the rule that clears the outline, so it wins the cascade', () => {
    const cleared = css.indexOf('.terminal-pane-surface,\n.v3-terminal pre {');
    expect(cleared).toBeGreaterThanOrEqual(0);
    expect(css.indexOf('.terminal-pane-surface:focus-visible')).toBeGreaterThan(cleared);
  });
});
