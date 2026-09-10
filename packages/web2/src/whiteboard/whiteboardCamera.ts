import { clampZoom, type Point } from '../canvas/camera';
import { whiteboardBounds, type WhiteboardDoc } from './whiteboardModel';

/* ══════════════════════════════════════════════════════════════════════════
   A CAMERA FOR THE WHITEBOARD
   packages/web2/src/whiteboard/whiteboardCamera.ts

   The owner's bar for this surface is MIRO — "a Miro board where you can
   literally just draw from scratch". It was a FIXED-VIEWPORT SVG: no pan, no
   zoom, one selection. A board you cannot navigate is not infinite; it is a
   sheet of paper the size of the window.

   ── IT REUSES `canvas/camera.ts` RATHER THAN INVENTING A SECOND CAMERA ───

   `clampZoom` and the zoom stops are already written, argued and tested for
   the architecture board. A second camera would be a second set of limits and
   a second answer to what the wheel does, and the two would drift the first
   time either was touched.

   What is deliberately NOT shared is the ACTION vocabulary. The architecture
   board's `canvas/pan` and `canvas/zoom-at` belong to a slice this surface does
   not own — the whiteboard holds its own document, its own undo stack and its
   own view, and reaching into the other reducer would put a sketch and a
   finding into one state machine, which is the distinction this whole surface
   exists to preserve.

   PURE. View in, view out. No React, no DOM, no clock.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where the board is being looked at from. Screen offset plus a scale. */
export interface WbView {
  x: number;
  y: number;
  zoom: number;
}

export const EMPTY_VIEW: WbView = { x: 0, y: 0, zoom: 1 };

export type WbCameraMove =
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; to: number; at: Point }
  | { kind: 'set'; view: WbView }
  | { kind: 'reset' };

/**
 * Apply one camera move.
 *
 * RETURNS THE SAME OBJECT WHEN NOTHING MOVED, the identity discipline
 * `whiteboardEdit` already follows — a wheel event that lands on a clamped
 * zoom, or a pointer that reports the same position twice, must not re-render
 * the whole board.
 */
export function wbCamera(view: WbView, move: WbCameraMove): WbView {
  switch (move.kind) {
    case 'pan':
      if (move.dx === 0 && move.dy === 0) return view;
      return { ...view, x: view.x + move.dx, y: view.y + move.dy };

    case 'zoom': {
      const zoom = clampZoom(move.to);
      if (zoom === view.zoom) return view;
      /*
       * ZOOM ABOUT THE POINTER. The board point under the cursor must still be
       * under it afterwards, or zooming reads as the drawing jumping away. The
       * algebra: screen = board * zoom + offset, so holding `board` fixed while
       * `zoom` changes means the offset absorbs the difference.
       */
      const board = boardPoint(view, move.at);
      return {
        zoom,
        x: move.at.x - board.x * zoom,
        y: move.at.y - board.y * zoom,
      };
    }

    case 'set':
      return { ...move.view, zoom: clampZoom(move.view.zoom) };

    case 'reset':
      return EMPTY_VIEW;

    default:
      return view;
  }
}

/**
 * Screen coordinates → board coordinates.
 *
 * THE FUNCTION A CAMERA MAKES MANDATORY, and the one whose absence is silent:
 * without it a surface keeps treating `event.clientX` as a board coordinate, so
 * every mark made while panned or zoomed is stored somewhere other than where
 * the reader drew it. It looks correct until the view is reset.
 */
export function boardPoint(view: WbView, screen: Point): Point {
  return { x: (screen.x - view.x) / view.zoom, y: (screen.y - view.y) / view.zoom };
}

/** Board coordinates → screen coordinates. The inverse, for hit reporting. */
export function screenPoint(view: WbView, board: Point): Point {
  return { x: board.x * view.zoom + view.x, y: board.y * view.zoom + view.y };
}

/** Breathing room around a fitted drawing, matching the board's `--sp-24`. */
export const WB_FIT_INSET = 24;

/**
 * A view that frames everything drawn, or null when nothing is.
 *
 * NULL IS A REAL ANSWER. An empty board has no bounds — `whiteboardBounds`
 * says so — and framing a rectangle nobody drew would put the reader at an
 * arbitrary place and call it Fit. The architecture board's own Fit takes the
 * same position.
 */
export function fitTo(doc: WhiteboardDoc, frame: { width: number; height: number }): WbView | null {
  const bounds = whiteboardBounds(doc);
  if (bounds === null) return null;
  if (frame.width <= 0 || frame.height <= 0) return null;

  /*
   * A SINGLE DOT HAS WIDTH ZERO, and `frame / 0` is Infinity, which becomes NaN
   * inside a transform and paints nothing at all. One board unit is the floor —
   * enough to divide by, small enough that the clamp decides the zoom.
   */
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const zoom = clampZoom(
    Math.min((frame.width - WB_FIT_INSET * 2) / width, (frame.height - WB_FIT_INSET * 2) / height),
  );

  return {
    zoom,
    x: frame.width / 2 - (bounds.x + width / 2) * zoom,
    y: frame.height / 2 - (bounds.y + height / 2) * zoom,
  };
}
