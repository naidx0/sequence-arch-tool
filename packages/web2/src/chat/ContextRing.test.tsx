import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ContextRing,
  contextFraction,
  contextSlices,
  resolveContextRingUsed,
} from './ContextRing';

/**
 * Asked for by name: "I like the Claude context circle. That's the only reason
 * I'm adding it."
 *
 * The same fact the transcript already prints under an answer, drawn where the
 * reader is deciding what to type next. The tests that matter here are the ones
 * about what it REFUSES to draw.
 */

describe('resolveContextRingUsed', () => {
  it('prefers in-flight usage while a turn streams', () => {
    expect(resolveContextRingUsed({ inputTokens: 18_400 }, 9_100)).toBe(18_400);
  });

  it('falls back to the last settled turn when idle', () => {
    expect(resolveContextRingUsed(null, 27_640)).toBe(27_640);
    expect(resolveContextRingUsed(undefined, null)).toBeNull();
  });
});

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
       before the first turn. Zero arc + honest accessible name; totals only
       after click. */
    render(<ContextRing used={null} window={200_000} />);
    const wrap = screen.getByTestId('composer-context');
    expect(wrap.getAttribute('data-fraction')).toBe('0.000');
    expect(wrap.getAttribute('data-metered')).toBe('false');
    expect(screen.queryByTestId('composer-context-label')).toBeNull();
    /* NO NATIVE TOOLTIP AT ALL — Decision 31. The ring opens its own panel
       after 250ms of hover, and an OS tooltip would arrive on top of it three
       quarters of a second later saying the same pair. The accessible name is
       the one place both numbers live now.

       AND STILL NO ZERO IN IT. `0 / 200k` is a measurement claiming a turn
       filled nothing; the absence of one (CANON law 4) is what the empty arc is
       already saying, and the name says it in words. */
    expect(wrap.getAttribute('title')).toBeNull();
    expect(wrap.getAttribute('aria-label')).not.toMatch(/\b0\b/);
    expect(wrap.getAttribute('aria-label')).toMatch(/200,000/);
    expect(wrap.getAttribute('aria-label')).toMatch(/no turn measured yet/i);
  });

  it('refuses a nonsensical window rather than dividing by it', () => {
    render(<ContextRing used={10} window={0} />);
    expect(screen.queryByTestId('composer-context')).toBeNull();
  });

  it('SAYS BOTH NUMBERS FOR A READER WHO CANNOT SEE THE ARC', () => {
    /* A ring with no accessible name is a decoration, and since Decision 31
       took the printed pair off the composer the name is the ONLY place a
       screen reader can get either number: it gets no panel, no bar, and no
       tooltip. So it carries both, in full, not in the panel's rounding. */
    render(<ContextRing used={27_640} window={1_048_576} />);
    const ring = screen.getByTestId('composer-context');
    expect(ring.getAttribute('title')).toBeNull();
    expect(ring.getAttribute('aria-label')).toMatch(/27,640/);
    expect(ring.getAttribute('aria-label')).toMatch(/1,048,576/);
    expect(screen.queryByTestId('composer-context-label')).toBeNull();
  });

  /**
   * Owner, 2026-09-18, on the installed app: "remove the small text elements:
   * 'last provider call, not the sum', 'usage not yet measured for this model'
   * — you say 0 / 131k and show a breakdown depending on how much is done,
   * that's all."
   *
   * A panel that explains itself every time it opens is a panel that has
   * stopped being a gauge. THIS TEST DERIVES THE FORBIDDEN SET rather than
   * listing three strings, so a fourth sentence added later fails it too.
   */
  it('CARRIES NO PROSE — the panel and the tooltip are numbers only', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(
      <ContextRing
        used={3_900}
        window={131_000}
        breakdown={{
          sections: [{ id: 'grounding', label: 'Architecture digest', tokens: 3_000, estimated: true }],
          totalApprox: 3_000,
          totalMeasured: 3_900,
        }}
      />,
    );
    const ring = screen.getByTestId('composer-context');
    expect(ring.getAttribute('title')).toBeNull();
    fireEvent.click(ring);
    const panel = screen.getByTestId('composer-context-breakdown');
    const text = panel.textContent ?? '';
    for (const gone of [
      /last provider call/i,
      /not the sum/i,
      /not the summed turn bill/i,
      /usage not yet measured/i,
      /this call \/ window/i,
      /no section breakdown/i,
    ]) {
      expect(text, `the panel still explains itself: ${gone}`).not.toMatch(gone);
    }
    /*
     * ── WHAT THIS CHECK READS ────────────────────────────────────────────────
     * The panel's own rendered text, split on whitespace. A sentence is a run of
     * words; a measurement is not. Six words is above anything the panel legally
     * prints (`+3 smaller` is two; `no breakdown on this turn` is five) and
     * below any of the sentences that were removed.
     */
    for (const line of [...panel.querySelectorAll('p')]) {
      const words = (line.textContent ?? '').trim().split(/\s+/).filter(Boolean);
      expect(words.length, `prose came back: "${line.textContent}"`).toBeLessThan(6);
    }
  });

  it('opens with ONE header line — used over window', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<ContextRing used={27_640} window={131_100} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-label').textContent).toBe('27.6k / 131.1k');
    /* Exactly one header: a second would be two answers to one question. */
    expect(screen.getAllByTestId('composer-context-label')).toHaveLength(1);
  });

  it('shows the header and ONE quiet line when nothing has been measured', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<ContextRing used={null} window={131_100} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-label').textContent).toBe('— / 131.1k');
    expect(screen.getByTestId('composer-context-breakdown-empty').textContent).toBe(
      'no turn measured yet',
    );
    expect(screen.queryByTestId('composer-context-bar')).toBeNull();
  });

  it('draws a stacked bar whose segments are the measured slices, biggest first', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(
      <ContextRing
        used={20_000}
        window={100_000}
        breakdown={{
          sections: [
            { id: 'tools', label: 'Tool results this turn', tokens: 2_000, estimated: true },
            { id: 'grounding', label: 'Architecture digest', tokens: 6_000, estimated: true },
            { id: 'instructions', label: 'Instructions', tokens: 2_000, estimated: true },
          ],
          totalApprox: 10_000,
          totalMeasured: 20_000,
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('composer-context'));
    const segs = screen.getAllByTestId('composer-context-seg');
    expect(segs.map((s) => s.getAttribute('data-section'))).toEqual([
      'grounding',
      'tools',
      'instructions',
    ]);
    /* SEGMENT WIDTHS ARE THE SHARES, and the shares are of the measured slices
       — 6k of the 10k the server named, not of the 100k window. Percent of the
       window would silently claim the approx sum and the provider count agree. */
    expect(segs[0]!.style.width).toBe('60%');
    expect(segs.reduce((n, s) => n + Number.parseFloat(s.style.width), 0)).toBeCloseTo(100, 6);
    /* Each segment names itself on hover — that is the bar's only legend. */
    expect(segs[0]!.getAttribute('title')).toBe('Architecture digest · 6k (60%)');
    const rows = screen.getAllByTestId('composer-context-section');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toBe('Architecture digest6k (60%)');
    expect(screen.queryByTestId('composer-context-more')).toBeNull();
  });

  it('lists the top eight slices and COUNTS the tail', async () => {
    const { fireEvent } = await import('@testing-library/react');
    /* Ten slices is more than the panel is tall; the ninth and tenth are by
       construction smaller than all eight above them, so naming them costs more
       than it tells. */
    const sections = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}` as 'other',
      label: `Slice ${i}`,
      tokens: 1_000 - i * 50,
      estimated: true,
    }));
    render(
      <ContextRing
        used={9_000}
        window={100_000}
        breakdown={{ sections, totalApprox: 9_000, totalMeasured: 9_000 }}
      />,
    );
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getAllByTestId('composer-context-section')).toHaveLength(8);
    expect(screen.getByTestId('composer-context-more').textContent).toBe('+2 smaller');
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
    expect(screen.getByTestId('composer-context-label').textContent).toMatch(/12k\s*\/\s*100k/i);
    expect(screen.getAllByTestId('composer-context-section')).toHaveLength(2);
  });

  it('INVENTS NO SLICE — a metered turn with no sections says so in four words', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<ContextRing used={4_000} window={100_000} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    /* Distinct from `no turn measured yet`: a turn WAS measured here, the
       server just named no sections for it. One absence is not the other, and a
       shared line would make the panel lie about one of them. */
    expect(screen.getByTestId('composer-context-breakdown-empty').textContent).toBe(
      'no breakdown on this turn',
    );
    expect(screen.queryByTestId('composer-context-bar')).toBeNull();
    expect(screen.queryAllByTestId('composer-context-section')).toHaveLength(0);
  });
});

/**
 * The panel's shape, decided without a DOM. Sorting, the eight-row ceiling and
 * the tail count are arithmetic, and arithmetic tested through a render is
 * arithmetic tested through three other things that can fail first.
 */
describe('contextSlices', () => {
  const slice = (id: string, tokens: number) => ({
    id: id as 'other',
    label: id,
    tokens,
    estimated: true,
  });

  it('sorts by size and shares sum to one', () => {
    const out = contextSlices({
      sections: [slice('a', 1_000), slice('b', 3_000)],
      totalApprox: 4_000,
    });
    expect(out.rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(out.rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1, 10);
    expect(out.hidden).toBe(0);
  });

  it('drops zero-token slices rather than drawing a segment of nothing', () => {
    /* A 0% segment is a 2px sliver (the bar's min-width) claiming a share it
       does not have — the drawing would be the only place that number exists. */
    const out = contextSlices({
      sections: [slice('a', 1_000), slice('empty', 0)],
      totalApprox: 1_000,
    });
    expect(out.rows.map((r) => r.id)).toEqual(['a']);
  });

  it('answers nothing for nothing', () => {
    expect(contextSlices(null).rows).toEqual([]);
    expect(contextSlices(undefined).rows).toEqual([]);
    expect(contextSlices({ sections: [], totalApprox: 0 }).rows).toEqual([]);
    expect(contextSlices({ sections: [slice('a', 0)], totalApprox: 0 }).rows).toEqual([]);
  });

  it('keeps eight and counts the rest', () => {
    const out = contextSlices({
      sections: Array.from({ length: 11 }, (_, i) => slice(`s${i}`, 100 - i)),
      totalApprox: 1_000,
    });
    expect(out.rows).toHaveLength(8);
    expect(out.hidden).toBe(3);
    expect(out.hiddenTokens).toBe(92 + 91 + 90);
  });
});

/**
 * ── JUST A RING, UNTIL YOU ASK — Decision 31 ────────────────────────────────
 *
 * Owner, 2026-09-18, on the built app: "in every single rendering the context
 * ring should just be a ring; there's no 'out of 130K context'. When you hover
 * it or click on it, it will show the details. Otherwise it's just a standing
 * ring with nothing else under it."
 *
 * Three claims, and each is tested by a case that can produce only it: the row
 * holds nothing but the arc at rest; a pause over it opens the details; a click
 * opens them and a pointer leaving does NOT take them away.
 */
describe('the ring stands alone', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('RENDERS THE ARC AND NOTHING BESIDE IT', () => {
    const { container } = render(<ContextRing used={27_640} window={131_100} />);
    const ring = screen.getByTestId('composer-context');

    /* No panel, and no sibling of any kind inside the anchor: the assertion is
       on the anchor's own children rather than on a class name, so a count put
       back under a different name fails here too. */
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
    const anchor = container.querySelector('.ctxring-anchor') as HTMLElement;
    expect(anchor.children).toHaveLength(1);
    expect(anchor.children[0]).toBe(ring);

    /* And the button holds only the arc — no digits anywhere in its text. */
    expect((ring.textContent ?? '').trim()).toBe('');
    expect(ring.querySelectorAll('svg')).toHaveLength(1);
  });

  it('OPENS ON A PAUSE, not on a pointer merely crossing it', () => {
    vi.useFakeTimers();
    const { container } = render(<ContextRing used={27_640} window={131_100} />);
    const anchor = container.querySelector('.ctxring-anchor') as HTMLElement;

    fireEvent.mouseOver(anchor);
    /* 240ms is INSIDE the delay and the case would pass vacuously if the delay
       were zero, so the closed assertion here is the one that proves there is
       a delay at all. */
    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(screen.getByTestId('composer-context-breakdown')).toBeTruthy();
    expect(screen.getByTestId('composer-context-label').textContent).toBe('27.6k / 131.1k');

    /* A GLANCE LEAVES WHEN THE POINTER DOES. The reader never asked for this
       panel, so they must not have to dismiss it. */
    fireEvent.mouseOut(anchor);
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
  });

  it('a pointer that leaves before the delay opens nothing at all', () => {
    vi.useFakeTimers();
    const { container } = render(<ContextRing used={27_640} window={131_100} />);
    const anchor = container.querySelector('.ctxring-anchor') as HTMLElement;
    fireEvent.mouseOver(anchor);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseOut(anchor);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
  });

  it('A CLICK PINS IT — the pointer can leave and the panel stays', () => {
    const { container } = render(<ContextRing used={27_640} window={131_100} />);
    const anchor = container.querySelector('.ctxring-anchor') as HTMLElement;
    const ring = screen.getByTestId('composer-context');

    fireEvent.click(ring);
    expect(screen.getByTestId('composer-context-breakdown')).toBeTruthy();
    expect(ring.getAttribute('aria-expanded')).toBe('true');

    /* THIS IS THE WHOLE DIFFERENCE BETWEEN THE TWO WAYS IN. The same event that
       closes a hovered panel must not close a clicked one — a reader eight rows
       into a breakdown cannot lose it to a stray pointer move. */
    fireEvent.mouseOut(anchor);
    expect(screen.getByTestId('composer-context-breakdown')).toBeTruthy();
  });

  it('Escape and an outside click close a pinned panel; a second click toggles it', () => {
    render(<ContextRing used={27_640} window={131_100} />);
    const ring = screen.getByTestId('composer-context');

    fireEvent.click(ring);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();

    fireEvent.click(ring);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();

    fireEvent.click(ring);
    fireEvent.click(ring);
    expect(screen.queryByTestId('composer-context-breakdown')).toBeNull();
  });
});
