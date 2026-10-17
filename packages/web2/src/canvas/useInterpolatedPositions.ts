/* ANIMATED TRANSITIONS BETWEEN LAYOUTS (§3.2, S2). When a new arrangement
   lands, every card that was already on the board glides from where it was to
   where it goes, over 240ms, by requestAnimationFrame. Cards new to the board
   appear at their place. Connectors are routed for the final arrangement and
   shown when the glide ends (the board hides them while `animating`).

   Off when the reader prefers reduced motion, and where there is no
   matchMedia (tests): the new arrangement is simply drawn. */

import { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };
type Positions = Readonly<Record<string, Point>>;

export const GLIDE_MS = 240;

/** Ease-out cubic: fast start, gentle landing. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** The positions at fraction `t` of the way from `from` to `to`. */
export function between(from: Positions, to: Positions, t: number): Record<string, Point> {
  const k = easeOut(t);
  const out: Record<string, Point> = {};
  for (const [id, end] of Object.entries(to)) {
    const start = from[id];
    out[id] = start ? { x: start.x + (end.x - start.x) * k, y: start.y + (end.y - start.y) * k } : end;
  }
  return out;
}

function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (typeof window.requestAnimationFrame !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useInterpolatedPositions(target: Positions): { positions: Positions; animating: boolean } {
  const [frame, setFrame] = useState<{ positions: Positions; animating: boolean }>({ positions: target, animating: false });
  const shown = useRef<Positions>(target);

  useEffect(() => {
    const from = shown.current;
    const shared = Object.keys(target).some((id) => from[id] && (from[id]!.x !== target[id]!.x || from[id]!.y !== target[id]!.y));
    if (from === target || !shared || !motionAllowed()) {
      shown.current = target;
      setFrame({ positions: target, animating: false });
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / GLIDE_MS;
      if (t >= 1) {
        shown.current = target;
        setFrame({ positions: target, animating: false });
        return;
      }
      const at = between(from, target, t);
      shown.current = at;
      setFrame({ positions: at, animating: true });
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [target]);

  /* No motion: the target, always. With motion, until the glide's first frame
     the cards stay where they were rather than jumping there and back. */
  if (!motionAllowed()) return { positions: target, animating: false };
  return frame.positions === target || frame.animating ? frame : { positions: shown.current, animating: false };
}
