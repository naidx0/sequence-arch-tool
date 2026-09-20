import { useEffect, useRef } from 'react';

import type { PaneName } from './shellModel';

/**
 * ONE DRAG HANDLE.
 *
 * UNSHEETED. §5.6 of the v2 plan lists "three-pane geometry + resizers +
 * collapse + breakpoints" among the eleven surfaces Graphite does not cover,
 * and a grep for "resiz" across all twelve sheets returns three prose mentions
 * of the width CLAMPS and no specimen. So this is drawn from the nearest thing
 * that exists rather than invented: the pane border is already the line, and
 * the resizer adds only a hit area straddling it plus the accent while it is
 * being moved — which is law two's "focus", the one job indigo has.
 *
 * IT IS A KEYBOARD CONTROL AS WELL AS A POINTER ONE, and that is not garnish.
 * A drag handle reachable only by mouse makes the pane widths — which sheet 11
 * calls the user's — unreachable for anyone who does not use one, and the
 * arrow-key path costs eleven lines. `role="separator"` with a tabindex is the
 * ARIA window splitter pattern; `aria-valuenow` is what makes the current
 * width announceable, which is the whole point of remembering it.
 *
 * WHY MOUSE EVENTS AND NOT POINTER EVENTS: jsdom 25 does not implement
 * PointerEvent, so a pointer-driven resizer cannot be tested at Tier 2 at all,
 * and this shell's entire reason for existing in a model layer is that its
 * arrangement is testable without a browser. Touch drag on a three-pane
 * desktop shell is not a supported gesture — below 820px both panes are
 * overlays and there is no resizer to grab.
 */

export interface PaneResizerProps {
  pane: PaneName;
  /** The width the pane is actually painted at right now. */
  width: number;
  min: number;
  max: number;
  dragging: boolean;
  label: string;
  onResize: (width: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** One press of an arrow key. --sp-8 off the closed space scale: small enough
 *  to place a border exactly, large enough that crossing a 200px range is not
 *  a hundred keystrokes. */
const KEYBOARD_STEP = 8;

export function PaneResizer({
  pane,
  width,
  min,
  max,
  dragging,
  label,
  onResize,
  onDragStart,
  onDragEnd,
}: PaneResizerProps) {
  /** Where the press landed and how wide the pane was then. Deltas are taken
   *  from the press, never accumulated frame to frame — accumulating drifts,
   *  and a drag that ends 3px from where the cursor is is the classic symptom. */
  const origin = useRef<{ x: number; width: number } | null>(null);

  /** The chat grows rightward and the rail grows leftward, so the rail's delta
   *  is negated. This is the only place that asymmetry exists. */
  const sign = pane === 'chat' ? 1 : -1;

  useEffect(() => {
    if (!dragging) return undefined;

    const move = (event: MouseEvent) => {
      const from = origin.current;
      if (!from) return;
      onResize(from.width + sign * (event.clientX - from.x));
    };
    const up = () => {
      origin.current = null;
      onDragEnd();
    };

    // On the window, not the element: the cursor routinely leaves an 8px strip
    // mid-drag, and a listener on the strip would drop the gesture the moment
    // it did.
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, sign, onResize, onDragEnd]);

  return (
    <button
      type="button"
      className="shell-resizer"
      data-testid={`shell-resizer-${pane}`}
      data-pane={pane}
      data-dragging={dragging ? 'true' : 'false'}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onMouseDown={(event) => {
        event.preventDefault();
        origin.current = { x: event.clientX, width };
        onDragStart();
      }}
      onKeyDown={(event) => {
        // ArrowRight widens the chat and narrows the rail, because the arrow
        // moves the BORDER rather than the pane: the key says which way the
        // line goes and `sign` turns that into which way the pane grows.
        const arrow = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (arrow !== 0) {
          event.preventDefault();
          onResize(width + arrow * KEYBOARD_STEP * sign);
          return;
        }
        if (event.key === 'Home') {
          event.preventDefault();
          onResize(min);
        } else if (event.key === 'End') {
          event.preventDefault();
          onResize(max);
        }
      }}
    />
  );
}
