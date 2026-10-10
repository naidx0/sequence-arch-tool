import { useEffect, useRef, useState, type ReactNode } from 'react';
import { v014Poster, v014Video } from '@/data/content';
import { useReducedMotion } from '@/components/lt/hooks';

/**
 * THE PRODUCT WINDOW: the app is dark, the page is light, so every recording
 * sits in a dark window (the app's own ground, #20201F, and its title bar
 * surface) with one soft shadow, like a product shot on white.
 */
export function Window({
  title,
  children,
  className = '',
  ratio = '16 / 9',
  over,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  ratio?: string;
  /** Frosted caption or controls over the product (under it on a phone). */
  over?: ReactNode;
}) {
  return (
    <div className={`lt-window ${className}`}>
      <div className="lt-window-bar" aria-hidden="true">
        <span className="lt-window-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="lt-window-title">{title}</span>
      </div>
      <div className="lt-window-media" style={{ aspectRatio: ratio }}>
        {children}
      </div>
      {over}
    </div>
  );
}

/**
 * ONE RECORDED CLIP (1920x1080) INSIDE A WINDOW'S MEDIA BOX.
 *
 * - The box has its 16:9 size before anything loads, so nothing moves.
 * - The poster <img> (the clip's own first frame) stays underneath; the
 *   <video> fades in over it only once it is actually playing, so there is
 *   never a black or empty frame and nothing jumps.
 * - The <video> is created within 400px of the viewport (or when `load`),
 *   preload="none" unless told otherwise, muted, looped, inline. It plays only
 *   while on screen and `play` is true.
 * - Reduced motion: the poster, and a Play button that turns controls on.
 */
export function Clip({
  id,
  alt,
  eager = false,
  load = true,
  play = true,
  preload,
  rewindWhenHidden = false,
  poster = true,
}: {
  id: string;
  alt: string;
  eager?: boolean;
  load?: boolean;
  play?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  rewindWhenHidden?: boolean;
  poster?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [near, setNear] = useState(eager);
  const [inView, setInView] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const nearObs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '400px 0px' },
    );
    const seenObs = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (e) setInView(e.isIntersecting);
      },
      { threshold: eager ? 0.01 : 0.3 },
    );
    nearObs.observe(el);
    seenObs.observe(el);
    return () => {
      nearObs.disconnect();
      seenObs.disconnect();
    };
  }, [eager]);

  const showVideo = !failed && (manual || (!reduced && load && near));
  const shouldPlay = showVideo && !manual && play && inView;

  useEffect(() => {
    const v = vid.current;
    if (!v || manual) return undefined;
    if (shouldPlay) {
      void v.play().catch(() => undefined);
      return undefined;
    }
    v.pause();
    if (!rewindWhenHidden) return undefined;
    /* After the crossfade has hidden it, back to the first frame. */
    const t = window.setTimeout(() => {
      try {
        if (v.paused && v.currentTime > 0) v.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [shouldPlay, showVideo, rewindWhenHidden, manual]);

  return (
    <div ref={box} className="lt-clip" data-testid="clip" data-clip={id} data-playing={shouldPlay ? 'true' : 'false'}>
      {poster || showVideo ? (
        <img
          src={v014Poster(id)}
          alt={showVideo ? '' : alt}
          aria-hidden={showVideo ? true : undefined}
          width={1920}
          height={1080}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
        />
      ) : null}
      {showVideo ? (
        <video
          ref={vid}
          src={v014Video(id)}
          aria-label={alt}
          className={ready || manual ? 'is-ready' : undefined}
          width={1920}
          height={1080}
          onTimeUpdate={(e) => {
            if (!ready && e.currentTarget.currentTime > 0.05) setReady(true);
          }}
          onError={() => setFailed(true)}
          muted
          loop
          playsInline
          autoPlay={manual}
          controls={manual}
          preload={preload ?? (eager ? 'metadata' : 'none')}
        />
      ) : null}
      {reduced && !manual && !failed ? (
        <button type="button" className="lt-play" onClick={() => setManual(true)}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
          </svg>
          Play clip
        </button>
      ) : null}
    </div>
  );
}
