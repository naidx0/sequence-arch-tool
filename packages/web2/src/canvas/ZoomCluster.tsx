/* ══════════════════════════════════════════════════════════════════════════
   THE ONE CONTROL CLUSTER — item 3.6(d)
   packages/web2/src/canvas/ZoomCluster.tsx

   docs/brand/graphite/pages/05-the-canvas.html §05.6.

   FOUR CONTROLS, LEFT TO RIGHT, AND NO FIFTH: zoom out · the readout · zoom in ·
   Fit. Two icon buttons, one readout, one worded control.

   IT ALWAYS CARRIES THE PERCENTAGE. v1 ships two clusters in two corners in two
   languages and NEITHER shows one, so a reader can pan and zoom for a minute
   and have no idea where the camera is.

   FIT IS A WORD, NEVER A GLYPH — sheet 09, ruling 3. `ic-frame` means the
   boundary drawn around a selection, and fitting the board to the viewport
   draws no boundary. The icon vocabulary has no glyph for a camera move and
   does not borrow one.

   ZOOM-TO-SELECTION IS NOT A FIFTH CONTROL. It is a keystroke (`2`) and it is
   meaningless without a selection, and "a permanently half-dead control in a
   four-control cluster is worse than no control".

   THE BUTTONS STEP THE DOUBLING LADDER and never move continuously: 25% · 50% ·
   100% · 200% · 400%. Continuous zoom is the modifier gesture's job; the
   buttons are for landing on a known place. Both ends are disabled AT the end
   rather than silently no-oping, because a control that does nothing and looks
   live is how a reader learns to stop trusting the cluster.
   ══════════════════════════════════════════════════════════════════════════ */

import { BoardIcon } from './BoardIcon.js';
import { ZOOM_MAX, ZOOM_MIN, zoomPercent } from './camera.js';

export interface ZoomClusterProps {
  zoom: number;
  onStep: (direction: 1 | -1) => void;
  onFit: () => void;
}

export function ZoomCluster({ zoom, onStep, onFit }: ZoomClusterProps) {
  const EPSILON = 1e-6;

  return (
    <div className="zoomcluster" data-testid="board-zoom" data-zoom={zoom.toFixed(4)}>
      <button
        type="button"
        className="iconbtn"
        aria-label="Zoom out"
        data-testid="board-zoom-out"
        disabled={zoom <= ZOOM_MIN + EPSILON}
        onClick={() => onStep(-1)}
      >
        <BoardIcon name="minus" size={14} />
      </button>

      {/* --font-mono, --t-10, --num and --sp-40 wide, so the percentage does not
          jitter in width as it counts. It is a RUN-TIME value, so it is read off
          the camera and never written down. */}
      <span className="pct" data-testid="board-zoom-pct">
        {zoomPercent(zoom)}
      </span>

      <button
        type="button"
        className="iconbtn"
        aria-label="Zoom in"
        data-testid="board-zoom-in"
        disabled={zoom >= ZOOM_MAX - EPSILON}
        onClick={() => onStep(1)}
      >
        <BoardIcon name="plus" size={14} />
      </button>

      <button
        type="button"
        className="btn ghost sm"
        data-testid="board-fit"
        onClick={onFit}
      >
        Fit
      </button>
    </div>
  );
}
