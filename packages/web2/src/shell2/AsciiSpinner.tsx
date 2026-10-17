/* ══════════════════════════════════════════════════════════════════════════
   THE ASCII SPINNER (the compact loader)
   packages/web2/src/shell2/AsciiSpinner.tsx

   The single-cell shape of the activity loader (shell2/ActivityLoader.tsx): a braille ring with a
   three-dot comet, for tight rows (tool rows, the status bar, the Agents tree and the rail). The
   star cycle that stood here drew a Claude-style asterisk everywhere work ran; it is gone, and so
   is the idea that a busy mark is a brand mark. Every caller keeps its import and its testid.
   ══════════════════════════════════════════════════════════════════════════ */

import { ActivityLoader, CELL_FRAMES, CELL_STILL } from './ActivityLoader';

export const SPINNER_FRAMES = CELL_FRAMES;
/** What holds still under reduced motion or when stalled. */
export const SPINNER_STILL = CELL_STILL;

/** The compact loader. `active={false}` holds a still glyph (a stalled or settled state). */
export function AsciiSpinner({ className, active = true }: { className?: string; active?: boolean }) {
  return <ActivityLoader variant="cell" className={className} active={active} />;
}
