import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContextRing, contextFraction } from './ContextRing';

/**
 * Asked for by name: "I like the Claude context circle. That's the only reason
 * I'm adding it."
 *
 * The same fact the transcript already prints under an answer, drawn where the
 * reader is deciding what to type next. The tests that matter here are the ones
 * about what it REFUSES to draw.
 */

describe('the context ring', () => {
  it('draws the arc in proportion to the window', () => {
    render(<ContextRing used={250_000} window={1_000_000} />);
    expect(screen.getByTestId('composer-context').getAttribute('data-fraction')).toBe('0.250');
  });

  it('NEVER DRAWS WITHOUT A WINDOW', () => {
    /*
     * The whole reason this component can be trusted. Only Ollama reports a
     * context length; every other provider says nothing. A ring is a FRACTION,
     * so drawing one with no denominator means inventing the denominator —
     * exactly what CANON law 4 forbids, on the same surface whose usage line
     * already carries the comment "never invent a number".
     *
     * Nothing is the honest answer. Not an empty ring, which reads as 0% used;
     * not a full one; and not a guess at a common size.
     */
    render(<ContextRing used={40_000} window={null} />);
    expect(screen.queryByTestId('composer-context')).toBeNull();
  });

  it('shows an empty ring when the window is known but usage is not yet metered', () => {
    /* Owner wants the model’s context circle visible in the composer even
       before the first turn. Zero arc + honest label is not inventing usage. */
    render(<ContextRing used={null} window={200_000} />);
    const wrap = screen.getByTestId('composer-context');
    expect(wrap.getAttribute('data-fraction')).toBe('0.000');
    expect(wrap.getAttribute('data-metered')).toBe('false');
    expect(screen.getByTestId('composer-context-label').textContent).toBe('200k');
    expect(wrap.getAttribute('title')).toMatch(/not yet measured/);
  });

  it('refuses a nonsensical window rather than dividing by it', () => {
    render(<ContextRing used={10} window={0} />);
    expect(screen.queryByTestId('composer-context')).toBeNull();
  });

  it('SAYS BOTH NUMBERS FOR A READER WHO CANNOT SEE THE ARC', () => {
    /* A ring with no accessible name is a decoration. The label carries the
       same two numbers the transcript prints. */
    render(<ContextRing used={27_640} window={1_048_576} />);
    expect(screen.getByTestId('composer-context').getAttribute('title')).toBe(
      '27,640 of 1,048,576 tokens in the context window. Click for breakdown.',
    );
    expect(screen.getByTestId('composer-context-label').textContent).toMatch(/27\.6k\/1\.0M/);
  });

  it('fills rather than overflowing when a turn exceeds the window', () => {
    /*
     * A turn CAN exceed the window — the provider truncates and says so
     * elsewhere. An arc drawn at 140% would either lap itself or read as 40%,
     * which is the opposite of the truth. Full is the honest ceiling, and the
     * number beside it carries the overflow.
     */
    expect(contextFraction(1_400_000, 1_000_000)).toBe(1);
    expect(contextFraction(-5, 1_000)).toBe(0);
  });

  it('opens a measured section breakdown on click (B3.4)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(
      <ContextRing
        used={12_000}
        window={100_000}
        breakdown={{
          sections: [
            { id: 'grounding', label: 'Architecture digest + question', tokens: 8_000, estimated: true },
            { id: 'tools', label: 'Tool results this turn', tokens: 2_000, estimated: true },
          ],
          totalApprox: 10_000,
          totalMeasured: 12_000,
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-breakdown')).toBeTruthy();
    expect(screen.getAllByTestId('composer-context-section')).toHaveLength(2);
    expect(screen.getByTestId('composer-context-breakdown-total').textContent).toMatch(/10,000/);
    expect(screen.getByTestId('composer-context-breakdown-total').textContent).toMatch(/12,000/);
  });

  it('says honestly when usage exists but sections do not', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<ContextRing used={4_000} window={100_000} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-breakdown-empty').textContent).toMatch(
      /No section breakdown/i,
    );
  });
});
