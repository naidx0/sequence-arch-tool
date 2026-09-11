import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiCanvas } from './AiCanvas';

/**
 * A READING MEASURE FOR PROSE — docs/AI-CANVAS-IS-A-DOCUMENT.md §5 item 3.
 *
 * A document has a measure; without one a paragraph runs the whole width of a
 * wide pane and the eye loses the line on the return sweep.
 *
 * ── WHAT EACH TEST READS, BEFORE WHAT IT PROVES ──────────────────────────
 *
 * jsdom does not paint imported stylesheets, so the first three READ THE
 * STYLESHEET SOURCE — the pattern `boardInteractCss.test.ts` already uses for
 * contracts jsdom cannot paint. They prove a rule exists, that it is the book's
 * number, and that nothing later re-declares it. They prove nothing about what
 * renders.
 *
 * The last one READS THE RENDERED DOM and proves the elements those rules name
 * are actually on screen. A stylesheet assertion alone passes forever against a
 * class the renderer stopped emitting; a DOM assertion alone passes while the
 * rule is absent. Each fails for its own reason.
 */
const css = readFileSync(resolve(__dirname, 'aiCanvas.css'), 'utf8');

/**
 * The stylesheet's rules, with comments removed first.
 *
 * COMMENTS ARE STRIPPED BECAUSE THEY QUOTE CSS. The comments in this file
 * contain braces — one of them quotes `.prose { … max-width: 68ch }` verbatim —
 * so splitting the raw text on braces terminates inside prose and finds no
 * rules at all. An earlier version of this test did exactly that and reported
 * "no prose rule found", which was true of what it read and false of the file.
 */
function rules(source: string): { selector: string; body: string }[] {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  for (const block of bare.split('}')) {
    const brace = block.indexOf('{');
    if (brace === -1) continue;
    out.push({ selector: block.slice(0, brace).trim(), body: block.slice(brace + 1) });
  }
  return out;
}

/** Selector strings compared with `includes`, not a regex — see the file note. */
const PROSE = ['.ai-canvas-md-p', '.ai-canvas-md-h'];

describe('prose is measured; everything else keeps its width', () => {
  it('READS THE STYLESHEET: prose is capped at the book’s measure, not an invented one', () => {
    /*
     * 68ch comes from `docs/brand/graphite/_core.html:954` — `.prose { …
     * max-width: 68ch }`. CANON: "you extend Graphite, you do not redesign it …
     * the answer is already in the book."
     */
    const measured = rules(css).filter(
      (r) => PROSE.some((p) => r.selector.includes(p)) && r.body.includes('max-width'),
    );
    expect(measured.length, 'no prose rule declares a measure').toBeGreaterThan(0);
    expect(measured[0]!.body).toContain('68ch');
  });

  it('EXCLUDES THE CASCADE: exactly one prose rule declares the measure', () => {
    /*
     * WHAT WOULD MAKE THE TEST ABOVE PASS FOR THE WRONG REASON. It reads text,
     * and text cannot see the cascade: a second rule on `.ai-canvas-md-p`
     * further down the file at the same specificity would win at paint time
     * while the substring `max-width: 68ch` still sat happily in the source.
     * The measure would be gone and the test green.
     *
     * Checked when written: the four later `max-width` declarations belong to
     * `.ai-canvas-svg`, `.ai-canvas-svg svg`, `.ai-canvas-lesson` and
     * `.ai-canvas-math-display` — none of them prose. The risk was real and
     * unrealised, which is the state worth locking rather than trusting.
     *
     * TWO IS A FAILURE EVEN IF THEY AGREE, because two declarations mean the
     * answer depends on order.
     */
    const measured = rules(css).filter(
      (r) => PROSE.some((p) => r.selector.includes(p)) && r.body.includes('max-width'),
    );
    expect(measured.length, `exactly one prose rule may set the measure`).toBe(1);
  });

  it('READS THE STYLESHEET: content that needs its width does not take a measure', () => {
    /*
     * The limit is the design. A diagram, chart, html/react block or code
     * listing needs the width it is given; capping them would cramp the content
     * this canvas exists to show. Code and display maths scroll in their own
     * containers instead, which is the right answer for non-prose.
     */
    for (const cls of ['.ai-canvas-md-codewrap', '.ai-canvas-mermaid-box', '.ai-canvas-math-display']) {
      const wide = rules(css).filter((r) => r.selector.includes(cls));
      for (const r of wide) {
        expect(r.body, `${cls} must not take a reading measure`).not.toContain('68ch');
      }
    }
  });

  it('READS THE RENDERED DOM: the elements those rules name are on screen', () => {
    render(
      <AiCanvas
        doc={
          {
            blocks: [
              { id: 'p1', type: 'markdown', payload: '# Heading\n\nA paragraph of prose.', status: 'landed' },
            ],
          } as never
        }
      />,
    );
    expect(document.querySelector('.ai-canvas-md-p')).toBeTruthy();
    expect(document.querySelector('.ai-canvas-md-h')).toBeTruthy();
    expect(screen.getByText('A paragraph of prose.')).toBeTruthy();
  });
});
