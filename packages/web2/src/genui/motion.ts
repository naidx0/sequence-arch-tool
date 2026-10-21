/* ══════════════════════════════════════════════════════════════════════════
   MOTION FOR GENERATED UI
   packages/web2/src/genui/motion.ts

   A surface that changes under the person's eyes must never jump. Four tools,
   all Web Animations (no library), all off under prefers-reduced-motion:

     useEnter      a node arrives: fade + a small rise (the stream "draws in")
     useAutoHeight a container's height animates between measured px values, so
                   a card growing a step is a slide, not a pop (height:auto
                   cannot be transitioned; measuring can)
     useFlip       siblings that moved because something arrived above them
                   glide from where they were (FLIP: first, last, invert, play)
     useSwap       a value changed in place (status, label): a short
                   cross-fade marks it without moving it
     useTween      numbers count to their new value instead of snapping

   Timings and easing are HANDOFF-UX 8.6 (see ENTER below); no spring, no blur.
   ══════════════════════════════════════════════════════════════════════════ */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/* HANDOFF-UX 8.6, the only timings here: enter 180ms on cubic-bezier(0.2,0.8,0.2,1) with opacity and a
   small rise; height changes 200ms; a cross-fade 120ms; a counted number 240ms (--dur-3). Reduced motion
   skips every one of them (animate() and useTween return the end state). */
export const ENTER = { ms: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } as const;
export const HEIGHT_MS = 200;
export const FADE_MS = 120;
export const FLASH_MS = 480;

/** True inside a surface drawn from a saved turn: every hook below skips straight to the end state, as under reduced motion. */
export const StillContext = createContext(false);

function animate(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (!el || reducedMotion() || typeof (el as HTMLElement).animate !== 'function') return null;
  try {
    return (el as HTMLElement).animate(frames, opts);
  } catch {
    return null;
  }
}

/** A node arrives. delay staggers siblings (a row of checks lands left to right). */
export function useEnter(ref: RefObject<HTMLElement>, delay = 0): void {
  const still = useContext(StillContext);
  useLayoutEffect(() => {
    if (still) return;
    animate(ref.current, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: ENTER.ms, easing: ENTER.easing, delay, fill: 'backwards' });
  }, []);
}

/** Animate the outer element's height whenever the inner one's measured height changes. */
export function useAutoHeight(outer: RefObject<HTMLElement>, inner: RefObject<HTMLElement>): void {
  const still = useContext(StillContext);
  const last = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (still || !o || !i || typeof ResizeObserver === 'undefined') return undefined;
    last.current = i.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const next = i.getBoundingClientRect().height;
      const prev = last.current;
      last.current = next;
      if (prev == null || Math.abs(next - prev) < 1) return;
      running.current?.cancel();
      o.style.overflow = 'clip';
      const a = animate(o, [{ height: `${prev}px` }, { height: `${next}px` }], { duration: HEIGHT_MS, easing: ENTER.easing });
      running.current = a;
      const done = (): void => {
        if (running.current === a) o.style.overflow = '';
      };
      if (a) a.onfinish = done;
      else done();
    });
    ro.observe(i);
    return () => ro.disconnect();
  }, [outer, inner, still]);
}

/** FLIP the direct [data-gu-id] children of a container after every render. Positions are
 *  layout offsets, not bounding rects, so a running animation's transform is never mistaken
 *  for a move (measuring rects mid-animation compounds into drift). */
export function useFlip(container: RefObject<HTMLElement>): void {
  const still = useContext(StillContext);
  const pos = useRef(new Map<string, { x: number; y: number }>());
  const running = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    const c = container.current;
    if (still || !c) return;
    const next = new Map<string, { x: number; y: number }>();
    const kids = Array.from(c.children).filter((k): k is HTMLElement => k instanceof HTMLElement && !!k.dataset.guId);
    for (const k of kids) {
      const id = k.dataset.guId!;
      const p = { x: k.offsetLeft, y: k.offsetTop };
      next.set(id, p);
      const was = pos.current.get(id);
      if (!was) continue;
      /* Interrupted mid-glide: start from where it is drawn now, not from where it was laid out. */
      let ox = 0;
      let oy = 0;
      const prev = running.current.get(id);
      if (prev && prev.playState === 'running') {
        const t = getComputedStyle(k).translate.split(' ').map((v) => parseFloat(v) || 0);
        ox = t[0] ?? 0;
        oy = t[1] ?? 0;
        prev.cancel();
      }
      const dx = was.x - p.x + ox;
      const dy = was.y - p.y + oy;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const a = animate(k, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: HEIGHT_MS, easing: ENTER.easing });
      if (a) running.current.set(id, a);
    }
    pos.current = next;
  });
}

/** A value changed in place: a short cross-fade marks it without moving it. */
export function useSwap(ref: RefObject<HTMLElement>, key: unknown): void {
  const still = useContext(StillContext);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (still || first.current) {
      first.current = false;
      return;
    }
    animate(ref.current, [{ opacity: 0.35 }, { opacity: 1 }], { duration: FADE_MS, easing: ENTER.easing });
  }, [key]);
}

/** Count to a number. Returns the displayed value. */
export function useTween(target: number, ms = 240): number {
  const still = useContext(StillContext);
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (still || reducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setShown(target);
      from.current = target;
      return undefined;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    /* The clock is read here, not taken from the frame's timestamp: that one can
       sit on another time base (or before start), and a negative p overshoots. */
    const tick = (): void => {
      const p = Math.max(0, Math.min(1, (performance.now() - start) / ms));
      const e = 1 - Math.pow(1 - p, 3);
      const v = a + (target - a) * e;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, still]);
  return shown;
}

/** Flash an element (a fix landed on it): a ring that fades. The colour is a tone role
 *  (--accent for the lossless fixer, --fits for the agent), passed by the caller. */
export function flash(el: Element | null, color = 'var(--accent)'): void {
  animate(el, [{ boxShadow: `0 0 0 2px ${color}` }, { boxShadow: `0 0 0 6px transparent` }], { duration: FLASH_MS, easing: ENTER.easing });
}
