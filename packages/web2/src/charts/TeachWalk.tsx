import { useEffect, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   THE WALK — one real input, moved through the picture, one beat at a time.
   packages/web2/src/charts/TeachWalk.tsx

   THE OWNER'S SHAPE for a lesson: ask what the learner knows → DRAW the thing
   → "have you seen this before?" → walk one real input through the picture,
   side by side, in real time. The first three shipped. This is the fourth, and
   it is the one the other three are for: a box-and-arrow chart shows you the
   PARTS, and only a worked example shows what actually happens.

   ── ONE DIAGRAM WITH A MOVING HIGHLIGHT, NOT A REDRAW PER BEAT ────────────
   `GRAPHITE-DECISIONS.md` left that open. It is settled by what already
   exists: `teachStep.litNodeIds` lights parts of the board today and the
   client already resolves ids against what it actually draws. A redraw per
   beat would also cost a provider round per beat, which is what made the
   seven-minute design draws a defect. So the picture stays still and the
   highlight moves — `onFocusPart` hands the current beat's partId up, and the
   chart lights it.

   ── THE READER DRIVES ──────────────────────────────────────────────────────
   No autoplay. A lesson that advances on a timer is a lesson that has moved on
   before the reader finished the line, and the owner's own phrase for this
   beat is "side by side, in real time" — real time meaning theirs. Arrow keys
   and two buttons; the step list is always visible so nobody has to remember
   what beat four said.

   HUE BUDGET: 1. `--accent` marks the CURRENT beat, which is the same thing it
   marks everywhere else in this product (Decision 12 clause 6: purple marks
   what was chosen). Past and future beats spend nothing — they are positions
   in a list, not claims about the world.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TeachWalkStep {
  partId: string;
  says: string;
}

export interface TeachWalkProps {
  /** The concrete thing being traced. Validated server-side to be specific. */
  input: string;
  steps: readonly TeachWalkStep[];
  /**
   * The current beat's partId, handed up so the picture can light it. Called
   * on mount and on every move, so the highlight is never a frame behind.
   */
  onFocusPart?: (partId: string) => void;
}

export function TeachWalk({ input, steps, onFocusPart }: TeachWalkProps) {
  const [at, setAt] = useState(0);

  /*
   * CLAMPED ON THE WAY IN, not on the way out. A new walk arrives with the
   * next concept and it may be shorter than the one before; a cursor left past
   * its end renders nothing and looks like a broken panel.
   */
  const cursor = steps.length === 0 ? 0 : Math.min(at, steps.length - 1);

  useEffect(() => {
    setAt(0);
  }, [input, steps.length]);

  const current = steps[cursor];
  useEffect(() => {
    if (current) onFocusPart?.(current.partId);
  }, [current, onFocusPart]);

  if (steps.length === 0) return null;

  const move = (delta: number): void => {
    setAt((prev) => Math.max(0, Math.min(steps.length - 1, prev + delta)));
  };

  return (
    <section
      className="walk"
      data-testid="teach-walk"
      aria-label={`Worked example: ${input}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
      tabIndex={0}
    >
      <header className="walk-head">
        {/* THE INPUT IS THE POINT. "Following" names what the reader is
            watching; without it the steps are captions with no subject. */}
        <span className="walk-label">Following</span>
        <span className="walk-input" data-testid="teach-walk-input">
          {input}
        </span>
      </header>

      <ol className="walk-steps">
        {steps.map((step, index) => (
          <li
            key={`${step.partId}-${index}`}
            className="walk-step"
            data-current={index === cursor || undefined}
            data-past={index < cursor || undefined}
            data-testid="teach-walk-step"
          >
            <span className="walk-n">{index + 1}</span>
            <span className="walk-says">{step.says}</span>
          </li>
        ))}
      </ol>

      <footer className="walk-foot">
        <button
          type="button"
          className="walk-btn"
          data-testid="teach-walk-prev"
          onClick={() => move(-1)}
          disabled={cursor === 0}
        >
          Back
        </button>
        <span className="walk-count" data-testid="teach-walk-count">
          {cursor + 1} of {steps.length}
        </span>
        <button
          type="button"
          className="walk-btn"
          data-testid="teach-walk-next"
          onClick={() => move(1)}
          disabled={cursor === steps.length - 1}
        >
          Next
        </button>
      </footer>
    </section>
  );
}
