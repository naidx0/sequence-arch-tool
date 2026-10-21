import { describe, expect, it } from 'vitest';

import chat2 from './chat2.css?raw';
import edits from './edits.css?raw';
import shell2 from './shell2.css?raw';

/*
 * THE UX AUDIT'S LAYOUT FINDINGS, LOCKED AT THE SHEET (Decision 49).
 *
 * WHAT THIS READS: the stylesheets' own text. jsdom has no layout, so a height
 * or overlap measured here would pass whether or not the rule existed. The
 * measured half (the card's height, Review clickable, the tabs unclipped at
 * 1024) is the built app in headless Chromium: scratchpad shot script
 * edits-shots.mjs, numbers in lab/log.md. These lock that the rules that
 * produce those numbers stay in the sheets.
 */

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('the audit findings stay fixed', () => {
  it('nothing in the transcript column shrinks (the changed-files card was 2 px tall)', () => {
    expect(rule(chat2, '.s2 .v3-transcript > *')).toMatch(/flex-shrink:\s*0;/);
    /* The negative control: the card itself still clips its corners, which is
       exactly what took its min-content floor away. */
    expect(rule(edits, '.s2-cf-wrap')).toMatch(/overflow:\s*hidden;/);
  });

  it("an approval's answers take their own row and wrap; they never share the title's row", () => {
    expect(rule(chat2, '.s2-agcard-hd')).toMatch(/flex-wrap:\s*wrap;/);
    expect(rule(chat2, '.s2-agcard-hd .s2-st-row')).toMatch(/flex:\s*1 1 100%;/);
    expect(rule(chat2, '.s2-agcard-acts')).toMatch(/flex:\s*1 1 100%;/);
    expect(rule(chat2, '.s2-agcard-acts .s2-gate')).toMatch(/flex-wrap:\s*wrap;/);
  });

  it('every surface keeps its name in the bar until the 560px main-column icon fold (0.1.8.4 workspace-nav-fit)', () => {
    /* Round 7, B1: names while they fit. 0.1.8.4: horizontal scrolling is forbidden, so labels hide
       only inside @container s2main (max-width: 560px); icons keep the accessible name and tooltip.
       No data-fold attribute, no 720px fold. */
    expect(rule(shell2, '.s2-mainp')).toMatch(/container:\s*s2main \/ inline-size;/);
    const css = shell2.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const hiders = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .filter((m) => /\.s2-seg-l/.test(m[1]!) && /display:\s*none/.test(m[0]))
      .map((m) => m[1]!.trim());
    expect(hiders).toEqual(['.s2-surfaces .s2-seg-l']);
    expect(css).toMatch(/@container s2main \(max-width: 560px\) \{\s*\.s2-surfaces \.s2-seg-l \{\s*display: none;/);
    expect(css).not.toMatch(/data-fold(?!ed)/);
    expect(css).not.toMatch(/@container s2main \(max-width: 720px\) \{\s*\.s2-surfaces/);
    /* The old 560 px fold of CLOSED pills stays the negative control: no query reaches a pill via .s2-topb .s2-sp. */
    expect(css).not.toMatch(/@container s2main \(max-width: 560px\) \{\s*\.s2-topb \.s2-sp/);
    expect(rule(shell2, '.s2-surfaces')).toMatch(/overflow-x:\s*auto;/);
    expect(css).toMatch(/\.s2-surfaces\[data-fade='both'\]\s*\{[^}]*mask-image:/);
  });

  it("the question takeover's cap is against a definite base, not its own box (r6: the box kept the uncapped height)", () => {
    const take = rule(chat2, '.s2-take.s2-take-q');
    expect(take).toMatch(/max-height:\s*55vh;/);
    expect(take).not.toMatch(/max-height:\s*\d+%/);
  });

  it("the board's pane head floats at the top right, clear of its dock at the bottom", () => {
    const head = rule(shell2, '.s2-pane-head.is-float');
    expect(head).toMatch(/top:\s*12px;/);
    expect(head).not.toMatch(/bottom:/);
  });
});
