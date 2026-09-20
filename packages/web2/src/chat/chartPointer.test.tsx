import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Transcript } from './Transcript';
import { assistantTurn, userTurn, workRow } from './fixtures';
import type { WorkRow } from '../state/types';

/**
 * THE PICTURE IS ON ANOTHER TAB AND NOTHING SAID SO.
 *
 * Measured at the seat: a teach turn drew its chart on the AI Canvas and the
 * only trace in the chat was a row reading "Drew a chart", rendered exactly
 * like "Read a file" -- one of a stack a reader scans past. The reader finished
 * the lesson and had no reason to look at another surface, so the derived
 * visual was invisible to the person it was drawn for.
 *
 * The row and its destination are unchanged. What changes is that a chart row
 * reads as a sentence rather than as narration.
 */
/* Built from the fixture factory, so the row carries every field the generic
   renderer reads — a hand-made row missed several and failed for reasons that
   had nothing to do with what is being tested. */
const row = (from: string, opens: string = 'ai-canvas'): WorkRow =>
  workRow(`r-${from}`, { verb: 'Drew a chart', from, opens } as never);

const turnsWith = (r: WorkRow) => [
  userTurn('u1', 'teach me how brief.ts works'),
  assistantTurn('a1', 'u1', { text: 'brief.ts renders the brief.', work: [r] }),
];

describe('the chat points at the chart', () => {
  it('offers one line to open the AI Canvas when a chart landed', () => {
    const onOpen = vi.fn();
    render(<Transcript turns={turnsWith(row('chart:proposal'))} inFlight={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('chat-chart-pointer'));
    /* The surface the row already routed to: this adds a way to NOTICE it, not
       a second destination. */
    expect(onOpen).toHaveBeenCalledWith('ai-canvas', 'a1');
  });

  it('leaves every other affordance row exactly as it was', () => {
    /* If canvas-block and review rows became sentences too, nothing would stand
       out and the change would have bought nothing. */
    render(<Transcript turns={turnsWith(row('file:read', 'rail'))} inFlight={null} />);
    expect(screen.queryByTestId('chat-chart-pointer')).toBeNull();
  });
});
