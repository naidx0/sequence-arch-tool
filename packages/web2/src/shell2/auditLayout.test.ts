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

  it('every surface keeps its name in the bar; names never fold to icons (round 13 ruling, home bar included)', () => {
    /* Round 7, B1: "I should always just show their surface names". Round 8: no
       width-based fold. Round 12 (Jaden, 1024): "icons only, do not repeat the
       current surface name": below 720 px of main column the names go and the
       icons stay, each with its name as title and accessible name. */
    expect(rule(shell2, '.s2-mainp')).toMatch(/container:\s*s2main \/ inline-size;/);
    const css = shell2.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
    /* Every rule that hides a pill's name, derived from the sheet: the no-surface state and the narrow column. */
    const hiders = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .filter((m) => /\.s2-seg-l/.test(m[1]!) && /display:\s*none/.test(m[0]))
      .map((m) => m[1]!.trim().replace(/^@container[^{]*\{\s*/, ''))
      .sort();
    /* Owner 2026-10-09: the top bar's names are never hidden, by a measure or by a fixed width. */
    expect(hiders).toEqual([]);
    expect(css).not.toMatch(/@container s2main \(max-width: 720px\) \{\s*\.s2-surfaces/);
    /* The old 560 px fold of CLOSED pills stays the negative control: no query reaches a pill below 720. */
    expect(css).not.toMatch(/@container s2main \(max-width: 560px\) \{\s*\.s2-topb \.s2-sp/);
    /* When the names do not fit, the bar scrolls sideways under fade edges. */
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
