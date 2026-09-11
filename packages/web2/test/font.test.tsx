import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app/App';
import { resolvedStyle, unquoteFontStack } from './support/css';

/**
 * ITEM 0.1 — THE RENDER HALF OF THE LOCK.
 *
 * Graphite specifies Instrument Sans (_core.html:239 sets --font-sans to it).
 * packages/web ships @fontsource-variable/inter instead and LOCKS INTER IN
 * PLACE WITH A PASSING TEST at product/brandTokens.test.ts:601-607 — which is
 * the part worth understanding, because it means v1's test suite would have
 * gone green forever on the wrong typeface. The lock did not fail to catch the
 * defect; the lock WAS the defect.
 *
 * The substitution is not cosmetic. Instrument Sans was chosen over Inter
 * specifically because it holds its shape at the 10-11px working sizes, and
 * different x-height and different advance widths mean different truncation
 * and a different column fit — so every measurement in the twelve sheets is
 * either taken in Instrument Sans or is wrong.
 *
 * These tests assert against the rendered document, never against the source
 * of a stylesheet. §4.6 bans the readFileSync-and-grep tier outright, and it is
 * banned for exactly this case: a grep for "Instrument Sans" in a .css file
 * passes whether or not the rule reaches the body.
 */
describe('item 0.1 — Instrument Sans is bound to the document', () => {
  it('resolves body font-family to Instrument Sans first', () => {
    render(<App />);

    const stack = unquoteFontStack(resolvedStyle(document.body, 'font-family'));

    // The specified assertion: starts with Instrument Sans.
    expect(stack.startsWith('Instrument Sans')).toBe(true);
  });

  it('keeps a real fallback stack behind it', () => {
    render(<App />);

    const stack = unquoteFontStack(resolvedStyle(document.body, 'font-family'));
    const families = stack.split(',').map((f) => f.trim());

    /*
     * A single-family declaration is a bug waiting for the first machine that
     * cannot load the woff2 — it falls all the way back to the browser default
     * serif, and the whole compact type ladder becomes unreadable rather than
     * merely off-brand. Graphite's stack ends in a generic for that reason.
     */
    expect(families.length).toBeGreaterThan(1);
    expect(families.at(-1)).toBe('sans-serif');
  });

  it('does not fall back to Inter anywhere in the stack', () => {
    render(<App />);

    const stack = unquoteFontStack(resolvedStyle(document.body, 'font-family'));

    /*
     * The v1 lock named Inter. If Inter appears anywhere in web2's stack, the
     * old dependency has been carried across — most likely by someone
     * "restoring a fallback" — and the first machine without the woff2 renders
     * v1's typeface while every test still passes.
     */
    expect(stack).not.toMatch(/\bInter\b/i);
  });

  it('sets mono on code, one step down from the sans beside it', () => {
    // The mono binding is a rule in the stylesheet, not a property of whatever
    // the app happens to render first. This used to lean on the Wave 0 smoke
    // surface having a <code> in it; the shell does not, and that is not a
    // regression in the binding. Render the element the rule is ABOUT.
    const { container } = render(
      <>
        <App />
        <code>scanRepo()</code>
      </>,
    );

    const code = container.querySelector('code');
    expect(code).not.toBeNull();

    const stack = unquoteFontStack(resolvedStyle(code as Element, 'font-family'));
    expect(stack.startsWith('JetBrains Mono')).toBe(true);
  });
});
