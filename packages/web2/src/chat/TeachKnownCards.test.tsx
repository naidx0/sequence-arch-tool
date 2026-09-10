import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { KNOWN_OPTIONS, TeachKnownCards } from './TeachKnownCards';
import { reduce, type Action } from '../state/store';
import { EMPTY_COMPOSER } from '../state/initial';
import type { AppState } from '../state/types';

/**
 * "WHAT I ALREADY KNOW" — ONE CLICK, AND THE FOURTH CARD IS BANNED.
 *
 * The two ways to learn what someone already knows are to ask them or to guess.
 * Guessing explains what a queue is to the person who wrote the queue. Asking,
 * done the obvious way, produces the failure this product already shipped once:
 * a turn that opens by interrogating the learner instead of teaching them.
 *
 * Three cards, before the lesson, outside the conversation.
 */
describe('TeachKnownCards', () => {
  it('offers exactly three, and none of them asks the learner a question', () => {
    /*
     * THE BAN, AS A TEST RATHER THAN A COMMENT. The fourth card somebody will
     * want is "not sure — ask me some questions", and that is the interrogation
     * bug arriving through the UI: a lesson that opens by quizzing the learner
     * about themselves has taught nothing, exactly like one that opens by asking
     * which chart kind they want. A comment saying so would not have stopped it.
     */
    expect(KNOWN_OPTIONS).toHaveLength(3);
    expect(KNOWN_OPTIONS.map((o) => o.value)).toEqual(['new', 'used-it', 'ship-it']);
    for (const opt of KNOWN_OPTIONS) {
      expect(`${opt.label} ${opt.hint}`).not.toMatch(/\?|ask me|not sure|quiz|which/i);
    }
  });

  it('says what the learner has DONE, never how expert they are', () => {
    /* "I've used it" is checkable by the person clicking. "Intermediate" is a
       judgement about themselves that they have to invent, and inventing it is
       work the lesson was supposed to save them. */
    for (const opt of KNOWN_OPTIONS) {
      expect(opt.label).not.toMatch(/beginner|intermediate|advanced|expert|level/i);
    }
  });

  it('renders one radio per option and marks the chosen one', () => {
    render(<TeachKnownCards value="used-it" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByTestId('teach-known-used-it').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('teach-known-new').getAttribute('aria-checked')).toBe('false');
  });

  it('reports the click', () => {
    const onChange = vi.fn();
    render(<TeachKnownCards value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('teach-known-ship-it'));
    expect(onChange).toHaveBeenCalledWith('ship-it');
  });

  it('clicking the chosen card CLEARS it — a one-click control must be un-clickable', () => {
    /*
     * A choice you cannot take back is a trap: the learner told us something
     * irreversible and the lesson keeps skipping material they now want. Same
     * value in, null out.
     */
    /* The case reads only the composer slice, so a composer-only state is the
       honest fixture rather than a whole app tree the reducer never looks at. */
    const at = (known: 'new' | 'used-it' | 'ship-it' | null): AppState =>
      ({ composer: { ...EMPTY_COMPOSER, teachKnown: known } }) as unknown as AppState;
    const fire = (state: AppState, known: 'new' | 'used-it' | 'ship-it') =>
      reduce(state, { type: 'composer/teach-known', known } as Action, {} as Parameters<typeof reduce>[2]);

    expect(fire(at(null), 'ship-it').composer.teachKnown).toBe('ship-it');
    expect(fire(at('ship-it'), 'ship-it').composer.teachKnown).toBeNull();
    expect(fire(at('ship-it'), 'new').composer.teachKnown).toBe('new');
  });

  it('starts as NOT STATED, which is not the same as "new"', () => {
    /* Absent adds no skip to the belt. Defaulting to `new` would assert the
       learner is a beginner on their own behalf, which is the guess this control
       exists to replace. */
    expect(EMPTY_COMPOSER.teachKnown).toBeNull();
  });
});
