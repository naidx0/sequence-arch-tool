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

   THEY ARE CHIPS ON THE RAIL, NOT CARDS ABOVE IT. Owner, 2026-09-13: "it
   shouldn't stack multiple different elements, it should all be within one
   element directly … it shouldn't keep lifting the chat box bar." Three cards
   in a grid could only open a second row under the composer, and choosing a
   mode moved the box the person was typing in. So each option is one chip on
   the same line as the mode and the grounding, and its hint moved to the
   tooltip — the hint was a sentence nobody reads twice, and the label is the
   part that has to be legible at a glance.

   ONCE CHOSEN, THE THREE FOLD INTO ONE. Owner, 2026-09-13: "when you choose
   one of the three options … they're cool and important, but it doesn't seem
   to minimise ever and they stay in your face." A control that has been
   answered and keeps asking is the interrogation bug in a quieter costume. So
   after the click the grid folds to a chip that says what was chosen and that
   it can be changed; pressing the chip unfolds the three again. Nothing is
   lost by folding — the choice is still on screen, in one line — and the
   un-click rule above still holds on the unfolded card. The fold is view
   state, held here, never in the store: what the lesson skips is a fact
   about the learner; whether the cards are open is a fact about this screen.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, type JSX } from 'react';

import { Icon } from './Icon';

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
  /* Folded whenever there is a choice to show; a cleared choice unfolds,
     because "not stated" has nothing to fold into. `unfolded` is the
     person's own "change" press and is forgotten the moment a new choice
     lands, so the chip comes back without a second click. */
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => {
    setUnfolded(false);
  }, [value]);

  const chosen = value === null ? null : KNOWN_OPTIONS.find((o) => o.value === value) ?? null;
  if (chosen !== null && !unfolded) {
    return (
      <button
        type="button"
        className="teach-known-summary"
        data-testid="teach-known-summary"
        aria-label={`This lesson assumes: ${chosen.label}. Press to change.`}
        title={chosen.hint}
        onClick={() => setUnfolded(true)}
      >
        <Icon name="spark" size={12} />
        <span>{chosen.label}</span>
        <span className="teach-known-summary-change">change</span>
      </button>
    );
  }

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
          /* The hint is the accessible description AND the tooltip: it is
             still said, just not spending a line of the rail to say it. */
          title={opt.hint}
          aria-label={`${opt.label} — ${opt.hint}`}
          onClick={() => onChange(opt.value)}
        >
          <span className="teach-known-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
