import { useEffect, useRef, useState } from 'react';
import { v014Poster, v014Video } from '@/data/content';

/**
 * A captured clip of the real app, in a box whose size is fixed before
 * anything loads (16:10), so the page never jumps.
 *
 * - Nothing is fetched until the box is near the viewport (poster is a lazy
 *   <img>; the video source is attached on first sight).
 * - Muted, looped, plays while in view and pauses when it leaves.
 * - A click turns the browser controls on.
 * - prefers-reduced-motion, or a clip that fails to load: the poster only.
 */
export function DemoVideo({
  id,
  alt,
  className = '',
  eager = false,
  src,
  poster,
}: {
  id: string;
  alt: string;
  className?: string;
  eager?: boolean;
  /** Override the /demo/v014/<id>.mp4 path. */
  src?: string;
  poster?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);
  const [armed, setArmed] = useState(false);
  const [controls, setControls] = useState(false);
  const [failed, setFailed] = useState(false);
  const videoSrc = src ?? v014Video(id);
  const posterSrc = poster ?? v014Poster(id);

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
      { rootMargin: '300px' },
    );
    const seen = new IntersectionObserver(
      (entries) => {
        const v = vid.current;
        if (!v) return;
        if (entries.some((e) => e.isIntersecting)) void v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: 0.35 },
    );
    near.observe(el);
    seen.observe(el);
    return () => {
      near.disconnect();
      seen.disconnect();
    };
  }, [reduced, failed]);

  return (
    <div
      ref={box}
      className={`relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-tile)] border border-[color:var(--hairline)] bg-[rgb(29,29,28)] ${className}`}
      data-testid="demo-video"
      data-clip={id}
    >
      <img
        src={posterSrc}
        alt={reduced || failed ? alt : ''}
        aria-hidden={reduced || failed ? undefined : true}
        width={1440}
        height={900}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {!reduced && !failed && armed ? (
        <video
          ref={vid}
          className={`absolute inset-0 h-full w-full object-cover ${controls ? '' : 'cursor-pointer'}`}
          src={videoSrc}
          poster={posterSrc}
          aria-label={alt}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          controls={controls}
          onClick={() => setControls(true)}
          onLoadedData={() => {
            const r = box.current?.getBoundingClientRect();
            if (r && (r.bottom < 0 || r.top > window.innerHeight)) vid.current?.pause();
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}
