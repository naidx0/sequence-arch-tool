/* ══════════════════════════════════════════════════════════════════════════
   "WHAT I ALREADY KNOW" — ONE CLICK, NEVER A FORM

   The lesson has to start somewhere, and the two ways to find out what someone
   already knows are to ASK THEM or to GUESS. Guessing produces the lesson that
   explains what a queue is to the person who wrote the queue. Asking, done the
   obvious way, produces the failure this product has already shipped once: a
   turn that opens by interrogating the learner instead of teaching them.

   So it is three cards and one click, before the lesson, outside the
   conversation. Nothing to type, nothing to read back, and no turn spent on it.

   THERE IS NO FOURTH CARD, and the one somebody will want to add is "not sure —
   ask me some questions". That is the interrogation bug arriving through the UI:
   a lesson that opens by quizzing the learner about themselves has taught
   nothing, exactly like one that opens by asking which chart kind they want.
   `KNOWN_OPTIONS` is the closed list and a test asserts its length, so a fourth
   cannot be added without meeting the reason it is banned.

   IT IS A CLAIM ABOUT THE LEARNER, NOT THE REPOSITORY. It licenses skipping an
   explanation; it never licenses asserting anything as true of the code. The
   rendered belt says so in the same breath it says the skip, so a model cannot
   read "assume they know X" as "assert X".

   CLICKING THE CHOSEN CARD CLEARS IT. A one-click control you cannot un-click is
   a trap — the learner told us something they cannot take back, and the lesson
   keeps skipping material they now want.
   ══════════════════════════════════════════════════════════════════════════ */

import type { JSX } from 'react';

export type TeachKnown = 'new' | 'used-it' | 'ship-it';

/**
 * The three, in the order a lesson would meet them. Each says what the LEARNER
 * has done, never how expert they are: "used it" is checkable by the person
 * clicking, "intermediate" is a judgement they have to make about themselves.
 */
export const KNOWN_OPTIONS: ReadonlyArray<{
  value: TeachKnown;
  label: string;
  hint: string;
}> = [
  { value: 'new', label: 'New to it', hint: 'Start from the ground up' },
  { value: 'used-it', label: "I've used it", hint: 'Skip the basics, show the mechanism' },
  { value: 'ship-it', label: 'I ship this', hint: 'Only what is specific to this repo' },
];

export interface TeachKnownCardsProps {
  /** The current click, or null for "not stated" — which is not the same as `new`. */
  value: TeachKnown | null;
  onChange: (known: TeachKnown) => void;
}

export function TeachKnownCards({ value, onChange }: TeachKnownCardsProps): JSX.Element {
  return (
    <div
      className="teach-known"
      role="radiogroup"
      aria-label="What you already know about this"
      data-testid="teach-known"
    >
      {KNOWN_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className="teach-known-card"
          data-testid={`teach-known-${opt.value}`}
          data-selected={value === opt.value ? 'true' : 'false'}
          onClick={() => onChange(opt.value)}
        >
          <span className="teach-known-label">{opt.label}</span>
          <span className="teach-known-hint">{opt.hint}</span>
        </button>
      ))}
    </div>
  );
}
