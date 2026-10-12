import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery, useReducedMotion } from '@/components/lt/hooks';

/**
 * A CHAPTER'S ART, DRAWN BY SCROLL. The art components (lt/art/) are pure
 * renders of one `progress` (0..1). This frame works that number out from
 * where the art sits in the viewport: 0 as its top enters at the bottom of the
 * window, 1 once its middle has risen to 55% of the window's height, so the
 * drawing is finished while it is still in full view.
 *
 * One passive scroll listener, attached only while the frame is near the
 * viewport (IntersectionObserver), reading layout once per animation frame.
 * React re-renders only when progress moves by more than 0.01 (or lands on 0
 * or 1). The first value is computed in a layout effect, before paint, so a
 * frame already on screen never flashes its empty state. Reduced motion:
 * always 1. Under 640 px the art is not rendered at all (its labels would be
 * about 5 px); the chapter's own figures carry the content there.
 */
const clamp = (v: number) => Math.min(1, Math.max(0, v));

function progressOf(el: Element, finish: number): number {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  const startTop = vh;
  const endTop = finish * vh - r.height / 2;
  return clamp((startTop - r.top) / Math.max(1, startTop - endTop));
}

/**
 * `finish`: where the art's middle is, as a share of the window's height, when
 * the drawing is done. Higher finishes sooner, so the end state holds for
 * longer while the art is still in view.
 */
export function ScrollArt({ render, label, finish = 0.55 }: { render: (progress: number) => ReactNode; label: string; finish?: number }) {
  const phone = useMediaQuery('(max-width: 639px)');
  const reduced = useReducedMotion();
  if (phone) return null;
  return reduced ? (
    <div className="lt-art" data-art-frame={label}>
      {render(1)}
    </div>
  ) : (
    <Scrubbed render={render} label={label} finish={finish} />
  );
}

function Scrubbed({ render, label, finish }: { render: (progress: number) => ReactNode; label: string; finish: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const last = useRef(-1);

  const apply = (next: number) => {
    const q = Math.round(next * 1000) / 1000;
    if (Math.abs(q - last.current) > 0.01 || ((q === 0 || q === 1) && q !== last.current)) {
      last.current = q;
      setP(q);
    }
  };

  useLayoutEffect(() => {
    if (ref.current) apply(progressOf(ref.current, finish));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let on = false;
    const frame = () => {
      raf = 0;
      apply(progressOf(el, finish));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const attach = () => {
      if (on) return;
      on = true;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      onScroll();
    };
    const detach = () => {
      if (!on) return;
      on = false;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      /* Leaving the viewport settles the drawing at its end state for the side it left by. */
      apply(progressOf(el, finish));
    };
    const io = new IntersectionObserver((entries) => (entries.some((e) => e.isIntersecting) ? attach() : detach()), { rootMargin: '10% 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      detach();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className="lt-art" data-art-frame={label} data-progress={p.toFixed(2)}>
      {render(p)}
    </div>
  );
}
