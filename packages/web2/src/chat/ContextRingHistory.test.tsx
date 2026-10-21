import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AskContextBreakdown } from '@sequence/api-types';

import { ContextRing, earlyTurnsNote } from './ContextRing';

/**
 * 019-10 slice 6: the server says how many early turns it carried as a summary
 * (`contextBreakdown.history.summarizedTurns`); the ring's panel says so in words.
 * The ring itself stays "just a ring" (owner, 2026-09-18).
 */

const base: AskContextBreakdown = {
  sections: [{ id: 'grounding', label: 'Architecture digest + question', tokens: 1200, estimated: true }],
  totalApprox: 1200,
};

describe('early turns summarized', () => {
  it('names the count in the panel, plural', () => {
    render(<ContextRing used={5000} window={200_000} breakdown={{ ...base, history: { keptTurns: 12, summarizedTurns: 4 } }} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-history').textContent).toBe('2 early turns summarized');
    expect(screen.getByTestId('composer-context').getAttribute('data-summarized')).toBe('true');
    expect(screen.getByTestId('composer-context').getAttribute('aria-label')).toContain('2 early turns summarized');
  });

  it('is singular for one', () => {
    expect(earlyTurnsNote({ ...base, history: { keptTurns: 4, summarizedTurns: 1 } })).toBe('1 early turn summarized');
  });

  it('019-model: counts turns as the person sees them (a question and its answer), not messages', () => {
    /* The wire counts messages: 60 of them are 30 turns, never "60 early turns". */
    expect(earlyTurnsNote({ ...base, history: { keptTurns: 4, summarizedTurns: 60 } })).toBe('30 early turns summarized');
    expect(earlyTurnsNote({ ...base, history: { keptTurns: 4, summarizedTurns: 7 } })).toBe('4 early turns summarized');
  });

  it('019-model: a measured turn with an unknown window is not "Nothing sent yet"', () => {
    render(<ContextRing used={7800} window={null} breakdown={base} showEmpty />);
    const ring = screen.getByTestId('composer-context');
    expect(ring.getAttribute('aria-label')).toContain('7,800');
    fireEvent.click(ring);
    expect(screen.getByTestId('composer-context-label').textContent).toBe('7.8k');
    expect(screen.queryByText('Nothing sent yet')).toBeNull();
    expect(screen.getAllByTestId('composer-context-section').length).toBeGreaterThan(0);
  });

  it('says nothing when nothing was summarized or the server did not say', () => {
    expect(earlyTurnsNote({ ...base, history: { keptTurns: 9, summarizedTurns: 0 } })).toBeNull();
    expect(earlyTurnsNote(base)).toBeNull();
    expect(earlyTurnsNote(null)).toBeNull();
    render(<ContextRing used={5000} window={200_000} breakdown={base} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.queryByTestId('composer-context-history')).toBeNull();
    expect(screen.getByTestId('composer-context').getAttribute('data-summarized')).toBe('false');
  });

  it('shows the count even before anything is metered', () => {
    render(<ContextRing used={null} window={200_000} breakdown={{ sections: [], totalApprox: 0, history: { keptTurns: 6, summarizedTurns: 18 } }} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-history').textContent).toBe('9 early turns summarized');
  });
});
