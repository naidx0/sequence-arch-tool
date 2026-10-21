/* ══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY LOADER (0.1.4 UX round, the radar)
   packages/web2/src/shell2/ActivityLoader.tsx

   Owner: "I don't like this spinning icon, the Claude icon reused everywhere ... I really like the
   radar ASCII that OpenCode has." The star cycle (a Claude-style asterisk) is gone. Two shapes, one
   family, drawn in braille so every dot is a real pixel pair on a mono grid:

     radar  a 4 x 2 cell field (8 x 8 dots). A bright sweep arm turns about the centre of a ringed disc
            and leaves a trail that thins out behind it (a 2 x 2 ordered dither, not an opacity ramp:
            braille has no grey). The big one: the chat card's header and a surface pane's head.
     cell   a 2 x 1 cell ring (4 x 4 dots) with a comet turning round it. The small
            one: tool rows, the status bar, the Agents tree and the rail.

   Frames are DERIVED from the geometry below, never hand-listed. A timer steps them and exists only
   while a loader is mounted (CSS never loops this), it holds still while the window is hidden, and
   under prefers-reduced-motion it holds one settled frame. The box is fixed (integer px font-size
   from the tokens, line-height equal to the box height, flex-centred), so no frame moves anything.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

const BRAILLE = 0x2800;
/** Dot bit by [column][row] in a braille cell (2 columns x 4 rows). */
const BIT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const;

/** The radar's field: cells across and down. 4 x 2 cells is 8 x 8 dots, a square on the mono grid. */
export const RADAR_CELLS_X = 4;
export const RADAR_CELLS_Y = 2;
/** Sweep positions per turn. */
export const RADAR_STEPS = 16;
/** The compact field: 2 x 1 cells is 4 x 4 dots (a ring with its corners cut), one line tall. */
export const CELL_CELLS_X = 2;
export const CELL_CELLS_Y = 1;
export const CELL_STEPS = 12;
/** 2 x 2 ordered-dither thresholds: how much of the trail a dot needs to be lit. */
const DITHER = [
  [0.2, 0.6],
  [0.8, 0.4],
] as const;

/**
 * One frame of a sweeping field: a disc of dots, a bright arm at `step` and a trail behind it thinned by the
 * dither. `ringAlways` keeps the rim lit (the big radar); without it the rim lights only where the sweep has been
 * (the compact one, a comet round a ring).
 */
function sweepFrame(cellsX: number, cellsY: number, steps: number, step: number, trailAngle: number, ringAlways: boolean): string {
  const cols = cellsX * 2;
  const rows = cellsY * 4;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const radius = Math.min(cx, cy) + 0.35;
  const head = (step / steps) * Math.PI * 2 - Math.PI / 2;
  const dots = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const rim = d >= radius - 1;
      const angle = Math.atan2(dy, dx);
      const behind = (((head - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const arm = behind < 0.42 || behind > Math.PI * 2 - 0.2;
      const intensity = behind < trailAngle ? 1 - behind / trailAngle : 0;
      const trail = intensity > DITHER[y % 2]![x % 2]!;
      dots[y]![x] = (rim && ringAlways) || arm || trail;
    }
  }
  const lines: string[] = [];
  for (let r = 0; r < cellsY; r += 1) {
    let line = '';
    for (let c = 0; c < cellsX; c += 1) {
      let bits = 0;
      for (let dx = 0; dx < 2; dx += 1) for (let dy = 0; dy < 4; dy += 1) if (dots[r * 4 + dy]![c * 2 + dx]) bits |= BIT[dx]![dy]!;
      line += String.fromCharCode(BRAILLE + bits);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export const RADAR_FRAMES: readonly string[] = Array.from({ length: RADAR_STEPS }, (_, i) => sweepFrame(RADAR_CELLS_X, RADAR_CELLS_Y, RADAR_STEPS, i, Math.PI * 0.95, true));
export const CELL_FRAMES: readonly string[] = Array.from({ length: CELL_STEPS }, (_, i) => sweepFrame(CELL_CELLS_X, CELL_CELLS_Y, CELL_STEPS, i, Math.PI * 1.3, false));
/** What each shape holds under reduced motion, when stalled, or when settled: one frame, the sweep at its rest. */
export const RADAR_STILL: string = RADAR_FRAMES[RADAR_STEPS / 4]!;
export const CELL_STILL: string = CELL_FRAMES[CELL_STEPS / 4]!;

export const STEP_MS = 90;

/* ── ONE CLOCK FOR EVERY LOADER ──────────────────────────────────────────────────────────────────────────────
   A busy screen mounts dozens (a row each for tools, subagents, the Agents tree, the rail). One module-level
   interval steps them all together: it starts with the first subscriber, stops with the last, and the tick
   counter returns to zero when it stops, so a loader that mounts into a quiet page starts on frame 0. */
const clockListeners = new Set<() => void>();
let clockTimer: number | null = null;
let clockTick = 0;

function subscribeClock(cb: () => void): () => void {
  clockListeners.add(cb);
  if (clockTimer === null) {
    clockTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      clockTick += 1;
      for (const l of [...clockListeners]) l();
    }, STEP_MS);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
      clockTick = 0;
    }
  };
}
const clockTickNow = () => clockTick;

/* The reduced-motion preference is watched once, and only while a loader is mounted: switching it off mid-session
   resumes the sweep, switching it on holds a still frame, with no remount. */
const motionListeners = new Set<() => void>();
let motionQuery: MediaQueryList | null = null;
let motionWatched = false;
const onMotionChange = () => {
  for (const l of [...motionListeners]) l();
};
/* getSnapshot runs on every render: the query object is made once and its live `.matches` answers after that
   (window.matchMedia parses the query string each call: 33 ms per 6 s of streaming, measured on the old spinner). */
function reduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  return !!motionQuery?.matches;
}
function subscribeMotion(cb: () => void): () => void {
  motionListeners.add(cb);
  if (motionListeners.size === 1 && typeof window !== 'undefined' && window.matchMedia) {
    motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    motionWatched = true;
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else motionQuery.addListener?.(onMotionChange);
  }
  return () => {
    motionListeners.delete(cb);
    if (motionListeners.size === 0 && motionQuery) {
      if (motionWatched) {
        if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
        else motionQuery.removeListener?.(onMotionChange);
      }
      motionWatched = false;
      motionQuery = null;
    }
  };
}

const noopSubscribe = () => () => {};

export type ActivityLoaderVariant = 'radar' | 'cell';

/**
 * The one loader. `active={false}` holds a still frame (a stalled or settled state); it also holds still
 * while the window is hidden and under reduced motion.
 */
export function ActivityLoader({
  variant = 'cell',
  className,
  active = true,
  testId,
}: {
  variant?: ActivityLoaderVariant;
  className?: string;
  active?: boolean;
  testId?: string;
}) {
  const frames = variant === 'radar' ? RADAR_FRAMES : CELL_FRAMES;
  const calm = useSyncExternalStore(subscribeMotion, reduced, () => false);
  const still = !active || calm;
  const tick = useSyncExternalStore(still ? noopSubscribe : subscribeClock, clockTickNow, () => 0);
  const text = still ? (variant === 'radar' ? RADAR_STILL : CELL_STILL) : frames[tick % frames.length]!;
  return (
    <span
      className={`act-loader is-${variant}${variant === 'cell' ? ' s2-ascii-spin' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      data-testid={testId ?? (variant === 'radar' ? 'activity-loader' : 's2-ascii-spinner')}
      data-variant={variant}
      data-still={still || undefined}
    >
      <span className="act-ink">{text}</span>
    </span>
  );
}
