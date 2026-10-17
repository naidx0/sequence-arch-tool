import { useEffect, useRef, useState } from 'react';
import { v014Poster, v014Video } from '@/data/content';

/**
 * ONE RECORDED CLIP OF THE REAL APP, IN A WINDOW FRAME.
 *
 * - The box is 16:9 (the 1920x1080 recordings) before anything loads, so the page never jumps.
 * - The poster is a lazy <img> (eager only in the hero).
 * - The <video> is attached when the box comes within 400px of the viewport,
 *   with preload="none" (the hero: "metadata"). It plays only while at least
 *   40% of it is on screen and pauses when it leaves. Muted, looped, inline.
 * - prefers-reduced-motion: the poster, and a Play button that turns the
 *   browser controls on. A clip that fails to load leaves the poster.
 */
export function Clip({
  id,
  title,
  alt,
  eager = false,
}: {
  id: string;
  /** The window title bar text. */
  title: string;
  /** What the clip shows, for assistive tech and for the poster fallback. */
  alt: string;
  eager?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const visible = useRef(false);
  const [reduced, setReduced] = useState(false);
  const [armed, setArmed] = useState(false);
  const [manual, setManual] = useState(false);
  const [failed, setFailed] = useState(false);
  /* No poster-to-video jump: the poster <img> stays underneath, and the video
     fades in over it only once it is playing (it has painted a frame). */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  useEffect(() => {
    if (reduced || failed) return undefined;
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setArmed(true);
      },
      { rootMargin: '400px 0px' },
    );
    const seen = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        visible.current = Boolean(e?.isIntersecting);
        const v = vid.current;
        if (!v) return;
        if (visible.current) void v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: 0.4 },
    );
    near.observe(el);
    seen.observe(el);
    return () => {
      near.disconnect();
      seen.disconnect();
    };
  }, [reduced, failed]);

  /* The video element arrives after the box may already be on screen. */
  useEffect(() => {
    if (armed && visible.current) void vid.current?.play().catch(() => undefined);
  }, [armed]);

  const showVideo = !failed && (manual || (!reduced && armed));

  return (
    <div className="cx-window" data-testid="clip" data-clip={id}>
      <div className="cx-window-bar" aria-hidden="true">
        <span className="cx-window-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="cx-window-title">{title}</span>
      </div>
      <div ref={box} className="cx-window-media">
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
        {showVideo ? (
          <video
            ref={vid}
            src={v014Video(id)}
            aria-label={alt}
            className={ready || manual ? 'is-ready' : undefined}
            onPlaying={() => setReady(true)}
            muted
            loop
            playsInline
            autoPlay={manual}
            controls={manual}
            preload={eager ? 'metadata' : 'none'}
            onError={() => setFailed(true)}
          />
        ) : null}
        {reduced && !manual && !failed ? (
          <button type="button" className="cx-play" onClick={() => setManual(true)}>
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
            </svg>
            Play clip
          </button>
        ) : null}
      </div>
    </div>
  );
}
