import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TeachWalk } from './TeachWalk';

/*
 * THE FOURTH BEAT, SEEN.
 *
 * The owner's shape ends "walk one real input through the picture, side by
 * side, in real time". The server half (`teachWalk.ts`) refuses a walk that
 * names a part nobody drew; this is the half the learner actually uses.
 */

const STEPS = [
  { partId: 'tok', says: 'split into 3 tokens: the / cat / sat' },
  { partId: 'emb', says: 'each token becomes a 768-number vector' },
  { partId: 'attn', says: '"sat" attends most strongly to "cat"' },
];

function walk(extra: Partial<React.ComponentProps<typeof TeachWalk>> = {}) {
  return render(
    <TeachWalk input={'the sentence "the cat sat"'} steps={STEPS} {...extra} />,
  );
}

describe('the reader walks the example at their own pace', () => {
  it('names the input being followed — the subject of every line', () => {
    walk();
    expect(screen.getByTestId('teach-walk-input').textContent).toBe(
      'the sentence "the cat sat"',
    );
  });

  it('shows every beat at once, with the first one current', () => {
    // The whole list is visible so nobody has to remember what beat four said.
    walk();
    const steps = screen.getAllByTestId('teach-walk-step');
    expect(steps).toHaveLength(3);
    expect(steps[0]!.getAttribute('data-current')).toBe('true');
    expect(steps[1]!.getAttribute('data-current')).toBeNull();
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('1 of 3');
  });

  it('Next and Back move the current beat, and PAST beats stay visible', () => {
    // Past beats recede rather than vanish: the reader needs to see where the
    // input has BEEN to understand where it is.
    walk();
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    const steps = screen.getAllByTestId('teach-walk-step');
    expect(steps[1]!.getAttribute('data-current')).toBe('true');
    expect(steps[0]!.getAttribute('data-past')).toBe('true');
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('2 of 3');

    fireEvent.click(screen.getByTestId('teach-walk-prev'));
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('1 of 3');
  });

  it('cannot walk off either end', () => {
    walk();
    expect((screen.getByTestId('teach-walk-prev') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('3 of 3');
    expect((screen.getByTestId('teach-walk-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('arrow keys drive it too', () => {
    walk();
    fireEvent.keyDown(screen.getByTestId('teach-walk'), { key: 'ArrowRight' });
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('2 of 3');
    fireEvent.keyDown(screen.getByTestId('teach-walk'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('1 of 3');
  });

  it('HANDS THE CURRENT PART UP so the picture can light it', () => {
    // One diagram with a moving highlight, not a redraw per beat — the
    // question GRAPHITE-DECISIONS.md left open, settled by the machinery that
    // already lights board nodes from `teachStep.litNodeIds`.
    const onFocusPart = vi.fn();
    walk({ onFocusPart });
    // On mount, so the highlight is never a frame behind.
    expect(onFocusPart).toHaveBeenLastCalledWith('tok');
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    expect(onFocusPart).toHaveBeenLastCalledWith('emb');
  });

  it('renders NOTHING for an empty walk', () => {
    const { container } = render(<TeachWalk input="x" steps={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('a NEW walk resets to its first beat', () => {
    // The next concept brings a new picture and a new walk, which may be
    // shorter. A cursor left past the end renders nothing and reads as broken.
    const view = walk();
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('3 of 3');

    view.rerender(
      <TeachWalk input="a 404 from /orders" steps={STEPS.slice(0, 2)} />,
    );
    expect(screen.getByTestId('teach-walk-count').textContent).toBe('1 of 2');
  });
});
