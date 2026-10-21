import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProseMessage } from './ProseMessage';

/**
 * MATHS IN THE TRANSCRIPT, LIKE OBSIDIAN.
 *
 * Owner, 2026-09-19: "fix also the embed in the chat output — math functions
 * should be output properly as if they were in Obsidian."
 *
 * The AI Canvas has typeset `$…$` and `$$…$$` since the maths wave; the chat
 * printed the dollars. The product was typesetting maths in the document it
 * writes and not in the sentence it says, which is one renderer answering one
 * question two ways.
 *
 * Every rule below is about a case where getting it wrong is WORSE than not
 * doing it at all — a shell snippet eaten by a formula, a price turned into a
 * variable, a malformed formula rendered as silence.
 */
describe('maths in chat prose', () => {
  it('typesets an inline formula rather than printing its dollars', () => {
    render(<ProseMessage text="The curve is $y = ax^2 + bx + c$ over the range." />);
    const math = screen.getByTestId('prose-math');
    expect(math).toBeTruthy();
    /* KaTeX keeps the source in an annotation, which is also what makes the
       formula selectable and searchable as the model wrote it. */
    expect(math.textContent).toMatch(/ax/);
    expect(screen.getByTestId('v3-prose').textContent).not.toMatch(/\$y =/);
  });

  it('draws a display block for $$…$$', () => {
    render(<ProseMessage text="$$\\int_0^1 x^2\\,dx = \\tfrac13$$" />);
    const math = screen.getByTestId('prose-math');
    expect(math.getAttribute('data-display')).toBe('true');
    expect(math.className).toMatch(/prose-math-display/);
  });

  it('LEAVES A PRICE ALONE, because a lone dollar is not a delimiter', () => {
    /* The rule `canvasMath` was written around: prose here is full of costs
       and shell variables, and a renderer that read the first `$` as an open
       would swallow the rest of the sentence into a formula. */
    render(<ProseMessage text="It cost $5 to run and $PATH was unset." />);
    expect(screen.queryByTestId('prose-math')).toBeNull();
    expect(screen.getByTestId('v3-prose').textContent).toMatch(/\$5/);
    expect(screen.getByTestId('v3-prose').textContent).toMatch(/\$PATH/);
  });

  it('NEVER TYPESETS INSIDE A CODE SPAN', () => {
    /* A backtick span is what the model asked to be shown verbatim. `awk
       '{print $1}'` is a shell, and a formula in the middle of it would be
       the transcript rewriting a command somebody might paste. */
    render(<ProseMessage text="Run `awk '{print $1} END {print $2}'` on the log." />);
    expect(screen.queryByTestId('prose-math')).toBeNull();
    expect(screen.getByTestId('chat-tick').textContent).toMatch(/\$1/);
  });

  it('typesets inside emphasis, because Obsidian does', () => {
    render(<ProseMessage text="The identity is **$e^{i\\pi} + 1 = 0$** exactly." />);
    const strong = screen.getByTestId('chat-strong');
    expect(strong.querySelector('[data-testid="prose-math"]')).toBeTruthy();
  });

  it('shows a rejected formula as its own source rather than as nothing', () => {
    /* The honest-errors rule applied to a renderer: KaTeX refuses malformed
       input, and the one outcome a reader cannot act on is silence. */
    render(<ProseMessage text="Broken: $\\frac{1}{$ here." />);
    const raw = screen.queryByTestId('prose-math-raw');
    const prose = screen.getByTestId('v3-prose');
    /* Either it parsed as text (no maths span) or it fell back to source —
       what must never happen is the characters disappearing. */
    if (raw) expect(raw.textContent).toMatch(/frac/);
    expect(prose.textContent).toMatch(/frac/);
  });
});

/**
 * KATEX IS NOT A BOOT COST.
 *
 * A static `import katex from 'katex'` here put the whole typesetter (587 KB
 * before minification, about a quarter of the entry chunk) in the bundle every
 * cold open downloads and parses before the board shows, for formulas that
 * most sessions never contain. It now loads the first time a formula renders.
 */
describe('katex loads on first use', () => {
  it('MathText has no static runtime import of katex', () => {
    const src = readFileSync(resolve(__dirname, 'MathText.tsx'), 'utf8');
    /* `import type` is erased; a value import is a bundle edge. */
    expect(src).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+['"]katex['"]/m);
  });

  it('shows the source while katex loads, then typesets it', async () => {
    vi.resetModules();
    const fresh = await import('./MathText');
    fresh.resetKatexForTest();
    render(<fresh.MathRun tex="y = ax^2" display={false} family="prose" />);
    const pending = screen.getByTestId('prose-math');
    expect(pending.getAttribute('data-pending')).toBe('true');
    expect(pending.textContent).toContain('ax^2');
    await vi.waitFor(() => {
      const math = screen.getByTestId('prose-math');
      expect(math.getAttribute('data-pending')).toBeNull();
      expect(math.innerHTML).toContain('katex');
    });
  });
});
