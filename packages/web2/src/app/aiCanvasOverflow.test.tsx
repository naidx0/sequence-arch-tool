import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiCanvas } from './AiCanvas';

/**
 * NOTHING A BLOCK HOLDS PUSHES THE DOCUMENT SIDEWAYS.
 *
 * The legibility gate exists because "three rounds shipped green while the app
 * was visibly broken", and it asks for two things at once: nothing overflows
 * its box, AND nothing is clipped silently. Those rule out both easy answers —
 * letting content escape, and hiding it — so every container that can hold
 * something wider than itself has to WRAP or SCROLL, deliberately.
 *
 * THE CARD CHROME USED TO HIDE THIS. `.ai-canvas-block` carried
 * `overflow: hidden` until the card was removed (§3 of the design), which
 * clipped anything too wide — a silent failure the gate names outright. Taking
 * it away was right and it removed the accidental cover, so each container now
 * has to say what it does on its own.
 *
 * ── WHAT THESE READ, BEFORE WHAT THEY PROVE ──────────────────────────────
 *
 * jsdom has no layout: `getBoundingClientRect` answers zeroes, so no assertion
 * here can measure an overflow. These READ THE STYLESHEET and prove each
 * container declares a strategy. The last one READS THE DOM and proves the
 * containers exist, because a stylesheet rule for a class nothing renders is a
 * rule about nothing.
 *
 * WHAT WOULD MAKE THEM PASS FOR THE WRONG REASON, and is excluded: checking
 * that the PROPERTY appears rather than its VALUE. `overflow: hidden` contains
 * "overflow" and is the clipping failure the gate forbids, so a test looking
 * for the word alone would bless the defect. Each case below names the values
 * it accepts.
 */
const css = readFileSync(resolve(__dirname, 'aiCanvas.css'), 'utf8');

/** Every rule holding preformatted text, read off the stylesheet rather than listed. */
function preformattedRules(): { selector: string; body: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  for (const block of bare.split('}')) {
    const brace = block.indexOf('{');
    if (brace === -1) continue;
    const body = block.slice(brace + 1);
    if (/white-space:\s*pre/.test(body)) {
      out.push({ selector: block.slice(0, brace).trim(), body });
    }
  }
  return out;
}

function rule(selector: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of bare.split('}')) {
    const brace = block.indexOf('{');
    if (brace === -1) continue;
    if (block.slice(0, brace).includes(selector)) return block.slice(brace + 1);
  }
  return '';
}

describe('every container that can hold wide content says what it does', () => {
  it('READS THE STYLESHEET: a fenced code block wraps, including an unbroken token', () => {
    /*
     * `white-space: pre-wrap` breaks at whitespace only. A URL, a minified
     * line, base64 or a deep import path has no break opportunity and overflows
     * without `overflow-wrap`. Its sibling `.ai-canvas-react-src` — the same
     * shape, a <pre> of foreign text — already carried the guard; this one did
     * not, which is how the gap was found.
     */
    const body = rule('.ai-canvas-md-code');
    expect(body, 'no rule for the code block').not.toBe('');
    expect(body).toContain('pre-wrap');
    expect(body).toContain('overflow-wrap: anywhere');
  });

  it('DERIVES THE SET: every preformatted container carries the guard, named or not', () => {
    /*
     * THE HAND-WRITTEN LIST WAS THE BUG, and it proved so within minutes. The
     * first version of this file named the two <pre> containers I knew about
     * and passed — while a THIRD, `.ai-canvas-mermaid-src`, sat unguarded. A
     * test that enumerates its own subjects cannot fail for a subject nobody
     * added to it, which is the same fault as a spec that does not name its
     * ceiling: whoever writes the list decides what is checked.
     *
     * So the set is DERIVED FROM THE STYLESHEET: every rule declaring
     * `white-space: pre*` holds preformatted text that can be arbitrarily wide,
     * and every one of them must also declare `overflow-wrap`. A container
     * added tomorrow is covered without anyone remembering this file exists.
     *
     * `pre-wrap` breaks at whitespace only, so an unbroken token — a URL, a
     * minified line, base64, a mermaid definition on one line — has no break
     * opportunity and leaves the box.
     */
    const unguarded = preformattedRules()
      .filter((r) => !r.body.includes('overflow-wrap'))
      .map((r) => r.selector);
    expect(unguarded.join(', '), 'preformatted container with no wrap guard').toBe('');
  });

  it('DERIVES THE SET: and there is more than one, so the check is not vacuous', () => {
    /*
     * The guard on the guard. With zero preformatted rules found — a renamed
     * property, a broken parser, a stylesheet that moved — the assertion above
     * passes against an empty list and reports safety it never checked.
     */
    expect(preformattedRules().length).toBeGreaterThanOrEqual(3);
  });

  it('READS THE STYLESHEET: wide non-prose scrolls, and NEVER clips', () => {
    /*
     * The value, not the property. `overflow: hidden` would satisfy a check for
     * the word "overflow" while being the silent clipping the gate forbids.
     */
    for (const sel of ['.ai-canvas-svg', '.ai-canvas-math-display']) {
      const body = rule(sel);
      expect(body, `no rule for ${sel}`).not.toBe('');
      expect(body, `${sel} must scroll`).toMatch(/overflow(-x)?:\s*auto/);
      expect(body, `${sel} must not clip silently`).not.toContain('overflow: hidden');
    }
  });

  it('READS THE DOM: the containers those rules name are rendered', () => {
    render(
      <AiCanvas
        doc={
          {
            blocks: [
              {
                id: 'c1',
                type: 'markdown',
                payload: '```ts\nconst u = "https://example.com/a/very/long/unbroken/token/that/cannot/break";\n```',
                status: 'landed',
              },
            ],
          } as never
        }
      />,
    );
    expect(document.querySelector('.ai-canvas-md-code')).toBeTruthy();
  });
});
