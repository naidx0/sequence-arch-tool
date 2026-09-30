import { useEffect, useRef, useState } from 'react';

import type { ChartStep } from '@sequence/schema';

/* ══════════════════════════════════════════════════════════════════════════
   THE FLOW, PLAYED HOP BY HOP
   packages/web2/src/charts/FlowStepper.tsx

   Owner, 2026-09-22: "a detailed maybe even animated diagram on the AI canvas
   which shows the flows coming from engine sending all of the AI token
   requests into the harness". A flow chart already drew the boxes and the
   arrows; `steps` (schema/src/chart.ts) is the order the data moves through
   them, and this is what plays it: the step list, Prev / Next, Play / Pause.

   ── IT PLAYS BY ITSELF, ONCE, AND STOPS ────────────────────────────────────
   TeachWalk has no autoplay, on purpose: a worked example is read line by
   line. A flow is WATCHED — "maybe even animated" — so this one starts
   playing, one hop per three `--seq-dur-hop` (the board's own hop beat), and
   stops at the last hop rather than looping, so the picture comes to rest on
   the end of the story. Touching Prev, Next or a step takes the wheel and
   pauses it: the reader is then driving, and a timer that kept moving would
   be taking the line from under them.

   ── REDUCED MOTION MEANS IT WAITS ─────────────────────────────────────────
   With `prefers-reduced-motion` it does not start by itself (and the
   marching dash in charts.css stands still); Play is still there for a
   reader who asks for it.

   ── THE CURSOR LIVES WITH THE CALLER ──────────────────────────────────────
   The chart draws the lit hop and this lists it, so one index has to drive
   both: the caller holds it and passes `activeStep` to SeqChartView.

   HUE BUDGET: 1, the same one TeachWalk spends — `--accent` marks the current
   hop, in the list and on the chart.
   ══════════════════════════════════════════════════════════════════════════ */

export interface FlowStepperProps {
  steps: readonly ChartStep[];
  /** The hop on screen. Clamped here, so a stale index never renders blank. */
  at: number;
  onStep: (index: number) => void;
}

/** One hop per three board beats: ~1.2s, long enough to read `says`. */
const BEATS_PER_HOP = 3;
/** graphite.css's `--seq-dur-hop`, when the token cannot be read (jsdom). */
const FALLBACK_HOP_MS = 400;

/** The hop beat from the token, so the chart and the board keep one tempo. */
function hopMs(el: Element | null): number {
  try {
    const raw = getComputedStyle(el ?? document.documentElement).getPropertyValue('--seq-dur-hop').trim();
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n;
  } catch {
    /* No computed style (a test, a detached node): the token's own value. */
  }
  return FALLBACK_HOP_MS;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

export function FlowStepper({ steps, at, onStep }: FlowStepperProps) {
  const last = steps.length - 1;
  const cursor = steps.length === 0 ? 0 : Math.max(0, Math.min(at, last));
  const [playing, setPlaying] = useState(() => steps.length > 1 && !prefersReducedMotion());
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= last) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => onStep(cursor + 1), hopMs(root.current) * BEATS_PER_HOP);
    return () => clearTimeout(timer);
  }, [playing, cursor, last, onStep]);

  if (steps.length === 0) return null;

  /* The reader took the wheel: stop the clock, then move. */
  const go = (index: number): void => {
    setPlaying(false);
    onStep(Math.max(0, Math.min(last, index)));
  };
  const toggle = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    /* Play at the end plays it again from the start. */
    if (cursor >= last) onStep(0);
    setPlaying(true);
  };
  const current = steps[cursor];

  return (
    <section
      ref={root}
      className="walk flowstep"
      data-testid="flow-stepper"
      data-playing={playing || undefined}
      aria-label="Flow, hop by hop"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          go(cursor + 1);
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          go(cursor - 1);
        }
      }}
    >
      <ol className="walk-steps">
        {steps.map((step, index) => (
          <li
            key={`${step.from}-${step.to}-${index}`}
            className="walk-step flowstep-step"
            data-current={index === cursor || undefined}
            data-past={index < cursor || undefined}
            data-testid="flow-stepper-step"
          >
            <button
              type="button"
              className="flowstep-jump"
              aria-current={index === cursor ? 'step' : undefined}
              onClick={() => go(index)}
            >
              <span className="walk-n">{index + 1}</span>
              <span className="walk-says">{step.says}</span>
            </button>
          </li>
        ))}
      </ol>

      {current?.detail ? (
        <p className="flowstep-detail" data-testid="flow-stepper-detail">
          {current.detail}
        </p>
      ) : null}

      <footer className="walk-foot">
        <button
          type="button"
          className="walk-btn"
          data-testid="flow-stepper-prev"
          onClick={() => go(cursor - 1)}
          disabled={cursor === 0}
        >
          Prev
        </button>
        <button
          type="button"
          className="walk-btn"
          data-testid="flow-stepper-play"
          aria-pressed={playing}
          onClick={toggle}
          disabled={steps.length < 2}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="walk-count" data-testid="flow-stepper-count">
          {cursor + 1} of {steps.length}
        </span>
        <button
          type="button"
          className="walk-btn"
          data-testid="flow-stepper-next"
          onClick={() => go(cursor + 1)}
          disabled={cursor === last}
        >
          Next
        </button>
      </footer>
    </section>
  );
}
