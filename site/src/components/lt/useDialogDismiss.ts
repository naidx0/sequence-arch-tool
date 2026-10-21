import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * A native <dialog> that leaves the way it came: an exit animation on every
 * close (the close button, Escape, a tap on the backdrop), and on touch a
 * swipe down that follows the finger, closes past 110 px or a quick flick, and
 * springs back otherwise. Reduced motion closes at once.
 *
 * The visuals are classes in native.css (is-closing, is-dragging, is-springing,
 * is-flinging); this only decides which one is on. The drag surface is
 * touch-action: none, so the browser hands us the vertical movement.
 */
const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 0.55; /* px per ms */
const EXIT_MS = 240;
const SPRING_MS = 420;

const reduced = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** px per ms over the last 100 ms of samples. */
function velocity(s: [number, number][], now: number) {
  const a = s[0]!;
  const b = s[s.length - 1]!;
  if (now - b[0] > 100) return 0; /* paused before letting go: not a flick */
  return (b[1] - a[1]) / Math.max(1, b[0] - a[0]);
}

export function useDialogDismiss(dlg: RefObject<HTMLDialogElement | null>) {
  const closing = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const drag = useRef<{ id: number; y0: number; dy: number; s: [number, number][] } | null>(null);

  const finish = useCallback(() => {
    const d = dlg.current;
    window.clearTimeout(timer.current);
    if (!d) return;
    d.classList.remove('is-closing', 'is-flinging', 'is-dragging', 'is-springing');
    d.style.removeProperty('transform');
    d.style.removeProperty('--lt-dim');
    closing.current = false;
    if (d.open) d.close();
  }, [dlg]);

  /* Close with the exit animation. `fling` is a swipe that already has momentum. */
  const dismiss = useCallback(
    (fling = false) => {
      const d = dlg.current;
      if (!d || !d.open || closing.current) return;
      if (reduced()) {
        finish();
        return;
      }
      closing.current = true;
      if (fling) {
        d.classList.remove('is-dragging', 'is-springing');
        d.classList.add('is-flinging');
        d.style.setProperty('--lt-dim', '0');
        d.style.transform = `translateY(${window.innerHeight}px)`;
      } else {
        d.classList.add('is-closing');
      }
      timer.current = window.setTimeout(finish, EXIT_MS + 60);
    },
    [dlg, finish],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    const d = dlg.current;
    if (!d || closing.current || e.pointerType === 'mouse' || !e.isPrimary) return;
    /* Taps on the video, its controls and the close button are theirs. */
    if ((e.target as HTMLElement).closest('video, button, a, input')) return;
    window.clearTimeout(timer.current);
    d.classList.remove('is-springing');
    drag.current = { id: e.pointerId, y0: e.clientY, dy: 0, s: [[e.timeStamp, e.clientY]] };
    d.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDialogElement>) => {
    const d = dlg.current;
    const g = drag.current;
    if (!d || !g || g.id !== e.pointerId) return;
    const raw = e.clientY - g.y0;
    /* Down follows the finger; up resists, like a sheet at its stop. */
    g.dy = raw > 0 ? raw : raw / 6;
    g.s.push([e.timeStamp, e.clientY]);
    while (g.s.length > 2 && e.timeStamp - g.s[0]![0] > 100) g.s.shift();
    d.classList.add('is-dragging');
    d.style.transform = `translateY(${g.dy}px)`;
    d.style.setProperty('--lt-dim', String(Math.max(0, 1 - Math.max(0, g.dy) / (window.innerHeight * 0.6))));
  };
  const end = (e: React.PointerEvent<HTMLDialogElement>, cancelled: boolean) => {
    const d = dlg.current;
    const g = drag.current;
    if (!d || !g || g.id !== e.pointerId) return;
    drag.current = null;
    if (d.hasPointerCapture(e.pointerId)) d.releasePointerCapture(e.pointerId);
    if (!d.classList.contains('is-dragging')) return;
    if (!cancelled && (g.dy > CLOSE_DISTANCE || (g.dy > 24 && velocity(g.s, e.timeStamp) > CLOSE_VELOCITY))) {
      dismiss(true);
      return;
    }
    d.classList.remove('is-dragging');
    if (reduced()) {
      d.style.removeProperty('transform');
      d.style.removeProperty('--lt-dim');
      return;
    }
    d.classList.add('is-springing');
    d.style.removeProperty('transform');
    d.style.removeProperty('--lt-dim');
    timer.current = window.setTimeout(() => d.classList.remove('is-springing'), SPRING_MS);
  };

  return {
    dismiss: () => dismiss(false),
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: React.PointerEvent<HTMLDialogElement>) => end(e, false),
      onPointerCancel: (e: React.PointerEvent<HTMLDialogElement>) => end(e, true),
      onCancel: (e: React.SyntheticEvent<HTMLDialogElement>) => {
        e.preventDefault();
        dismiss(false);
      },
    },
  };
}
