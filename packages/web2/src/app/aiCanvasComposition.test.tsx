import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiCanvas } from './AiCanvas';

/**
 * TWO BLOCKS ON ONE CANVAS.
 *
 * Every other canvas test renders exactly ONE block. Overflow, measure and
 * focus were each proved alone, and each was right alone. This file exists
 * because the assumptions that survive individually are not the same set as the
 * assumptions that survive together, and nothing had ever put two blocks on one
 * canvas at once.
 *
 * ── THE VOCABULARY, DELIBERATELY ─────────────────────────────────────────
 *
 * This canvas is a DOCUMENT, not a spatial plane (AI-CANVAS-IS-A-DOCUMENT §2).
 * So the composition questions are NOT "does one block push the other" or "do
 * they come back in the same relative positions" — a document has no positions
 * to come back to. They are the questions a document actually raises:
 *
 *   - do the blocks render in DOCUMENT ORDER,
 *   - does keyboard order follow that same order,
 *   - can a reader tell the two blocks APART by name,
 *   - and does a block's rendering depend on its neighbours at all.
 *
 * ── WHAT THIS FOUND ──────────────────────────────────────────────────────
 *
 * THE THIRD ONE. `blockAccessibleName` is a pure function of ONE BLOCK, and
 * uniqueness is a property of the SET. A per-block function cannot produce a
 * document-unique name — it has never seen the document. Two untitled mermaid
 * blocks both fall back to the kind heading and announce "Mermaid, Mermaid".
 *
 * That is the same defect the function was written to close, one word better.
 * The original was eight articles announcing "article" eight times; this is
 * three diagrams announcing "Mermaid" three times, and the legibility gate
 * names it outright — no two sibling rows may read the same. It is unreachable
 * with one block, which is why a file of single-block tests could pass forever
 * while landmark navigation stayed broken for every block type that cannot name
 * itself. Those are exactly the blocks that most need a name: a diagram, an svg
 * or an html payload has no heading of its own to borrow.
 *
 * The other three held, and are asserted here rather than assumed.
 */
const css = readFileSync(resolve(__dirname, 'aiCanvas.css'), 'utf8');

/**
 * A canvas built from block literals, rendered as the app renders it.
 *
 * `onAskBlock` IS PASSED BECAUSE THE APP PASSES IT. The ask control is gated on
 * that prop (`AiCanvas.tsx`), so a harness omitting it renders no controls and a
 * keyboard-order assertion then reads zero buttons and fails — which is what the
 * first version of this file did. That failure was my instrument, not the
 * surface: `connect.tsx` supplies the callback in the real render.
 */
function canvasWith(blocks: { id: string; type: string; title?: string; payload: string }[]) {
  return render(
    <AiCanvas
      doc={{ blocks: blocks.map((b) => ({ ...b, status: 'landed' })) } as never}
      onAskBlock={() => {}}
    />,
  );
}

function articles(): HTMLElement[] {
  return Array.from(document.querySelectorAll('article.ai-canvas-block'));
}

describe('two blocks on one canvas', () => {
  it('READS THE DOM: both render, in document order', () => {
    canvasWith([
      { id: 'b1', type: 'markdown', payload: `# Step one\n\nDo the thing.` },
      { id: 'b2', type: 'mermaid', payload: `flowchart TD\n a --> b` },
    ]);
    const kinds = articles().map((el) => el.getAttribute('data-canvas-block'));
    expect(kinds, 'both blocks must render').toEqual(['markdown', 'mermaid']);
  });

  it('READS THE DOM: a reader can tell the two apart — no two blocks announce the same name', () => {
    /*
     * THE COMPOSITION FAULT. Two untitled diagrams is the ordinary shape — an
     * agent asked for a before and an after draws exactly this. Neither can
     * name itself (a diagram is not a title, which is why the fallback exists),
     * so both take the kind heading and the landmark list reads "Mermaid,
     * Mermaid". A name that does not distinguish is not a name.
     *
     * WHY THIS IS ASSERTED ON THE SET AND NOT ON EACH: every individual name
     * here is correct. "Mermaid" is the right word for a mermaid block. The
     * defect exists only in the pair, so only an assertion over the pair can
     * see it.
     */
    canvasWith([
      { id: 'b1', type: 'mermaid', payload: `flowchart TD\n a --> b` },
      { id: 'b2', type: 'mermaid', payload: `flowchart TD\n c --> d` },
    ]);
    const names = articles().map((el) => el.getAttribute('aria-label') ?? '');
    expect(names.length, 'both blocks must render').toBe(2);
    expect(new Set(names).size, `two blocks announced the same name: ${names.join(', ')}`).toBe(
      names.length,
    );
  });

  it('READS THE DOM: three untitled blocks of the same kind are still three distinct names', () => {
    /*
     * The pair could be fixed by a rule that only ever tells two apart. Three
     * is the case that refuses a coin-flip fix.
     */
    canvasWith([
      { id: 'b1', type: 'html', payload: '<p>one</p>' },
      { id: 'b2', type: 'html', payload: '<p>two</p>' },
      { id: 'b3', type: 'html', payload: '<p>three</p>' },
    ]);
    const names = articles().map((el) => el.getAttribute('aria-label') ?? '');
    expect(new Set(names).size, `duplicate names: ${names.join(', ')}`).toBe(3);
  });

  it('READS THE DOM: a block that names itself keeps its own name, and a lone block takes no ordinal', () => {
    /*
     * THE LIMIT OF THE FIX, and the half that keeps it honest. Disambiguating
     * must not rename a block that already had a good name, and must not
     * decorate a block that has no twin — "Mermaid 1" on a canvas holding one
     * diagram is noise invented to satisfy a rule.
     */
    canvasWith([
      { id: 'b1', type: 'markdown', payload: `# Rollout plan\n\nProse.` },
      { id: 'b2', type: 'mermaid', payload: `flowchart TD\n a --> b` },
    ]);
    const names = articles().map((el) => el.getAttribute('aria-label') ?? '');
    expect(names[0], 'a self-naming block keeps the heading it already carries').toBe('Rollout plan');
    expect(names[1], 'the only diagram on the canvas needs no ordinal').toBe('Mermaid');
  });

  it('READS THE DOM: keyboard order follows document order, not insertion or id order', () => {
    /*
     * Held. Asserted because a keyed map that ever sorted, or a portal, would
     * break it silently — the eye would see the document order and the tab key
     * would not. Ids are deliberately in the reverse of document order, so an
     * implementation that sorted by id would be caught rather than agreed with.
     *
     * ASSERTS ON BLOCK IDENTITY, NOT ON THE NAME, and a mutation is why. The
     * first version read each control's `aria-label`, which is derived — so
     * reversing the rendered blocks while the names stayed in their original
     * order left the labels reading "Alpha, Beta" in document order and this test
     * green. It was checking that a label agreed with itself. The `data-testid`
     * carries the block's own id, which no naming rule can restate.
     */
    canvasWith([
      { id: 'zzz-first', type: 'markdown', payload: `# Alpha\n\nOne.` },
      { id: 'aaa-second', type: 'markdown', payload: `# Beta\n\nTwo.` },
    ]);
    const asks = Array.from(document.querySelectorAll('.ai-canvas-ask-block'));
    expect(asks.length, 'each block carries its own ask control').toBe(2);
    expect(
      asks.map((btn) => btn.getAttribute('data-testid')),
      'tab order must walk the document, by block identity',
    ).toEqual(['ai-canvas-ask-zzz-first', 'ai-canvas-ask-aaa-second']);
    const owners = asks.map((btn) => btn.closest('article')?.getAttribute('aria-label'));
    expect(owners, 'and each control sits inside the block it names').toEqual(['Alpha', 'Beta']);
  });

  it('READS THE STYLESHEET: no block’s rendering depends on its neighbours', () => {
    /*
     * THE DOCUMENT INVARIANT, locked where it can actually be broken. §2 rules
     * this surface a document rather than a spatial plane, and the mechanical
     * consequence is that a block must render the same whatever sits beside it.
     * A sibling combinator or an nth-child on a block is how that ruling would
     * be lost — quietly, in a stylesheet, with every single-block test still
     * green.
     *
     * DERIVED, not hand-listed: every selector mentioning a canvas block is
     * checked, so a rule added tomorrow is covered.
     */
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const positional = bare
      .split('}')
      .map((b) => b.slice(0, b.indexOf('{')).trim())
      .filter((sel) => sel.includes('ai-canvas-block'))
      .filter((sel) => /[+~]|:nth-|:first-child|:last-child/.test(sel));
    expect(positional.join(', '), 'a block styled by its position among siblings').toBe('');
  });
});
