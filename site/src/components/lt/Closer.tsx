import { useEffect, useRef, useState } from 'react';
import { Window } from '@/components/lt/Window';
import { useNear, useReducedMotion } from '@/components/lt/hooks';

/**
 * ONE PINNED CHAPTER, APPLE-STYLE (ported from the dark builder's Zoom.tsx,
 * 970af49f, drawn light): the whole app window, then scroll zooms into the
 * map, then one service on it, then the answer about that service.
 *
 * Three 4K captures of the built app (stills/zoom-map, zoom-node, zoom-answer
 * .webp, 3840x2160, one 1920x1080 window at device scale 2), taken from the
 * same frame so they stack pixel for pixel. The map capture is always the
 * floor; node and answer fade in over it, so a layer is never empty. The zoom
 * is one transform on the layer that holds the captures and the spotlights,
 * written from a requestAnimationFrame after scroll: no render per frame, no
 * layout. At the deepest stop (3x) an 1100px window shows the capture at about
 * 0.86 source pixels per screen pixel, so it stays sharp.
 *
 * Reduced motion: no pinning and no zoom; the answer capture and the four lines.
 */
const W = 1920;
const H = 1080;
const STILL = (name: string) => `/demo/v014/stills/${name}.webp`;
const STILLS = ['zoom-map', 'zoom-node', 'zoom-answer'] as const;

const STOPS = [
  { x: 960, y: 540, s: 1, still: 0, title: 'One window.', line: 'Workspaces, the chat and the map, side by side.', spot: null },
  { x: 1293, y: 557, s: 1.5, still: 0, title: 'The map is read from the code.', line: 'Services, their calls, a database and a topic.', spot: null },
  {
    x: 1290,
    y: 424,
    s: 3,
    still: 1,
    title: 'One service.',
    line: 'Orders, Python and FastAPI. Select it and it becomes a chip in the chat.',
    spot: { x: 1190, y: 370, w: 240, h: 110 },
  },
  {
    x: 460,
    y: 215,
    s: 2.8,
    still: 2,
    title: 'Ask about exactly that.',
    line: 'The question carries the chip. The answer is a sample reply, written from the real scan.',
    spot: { x: 258, y: 80, w: 400, h: 254 },
  },
] as const;

const ALT = [
  'The built app on the sample shop repository: workspaces, the chat and the architecture map.',
  'The Orders card selected on the map, its Ask handle showing, and an orders chip in the composer.',
  'The chat answering what depends on Orders, with the orders chip on the question.',
];

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function transformFor(x: number, y: number, s: number): string {
  const tx = clamp((0.5 - (x / W) * s) * 100, (1 - s) * 100, 0);
  const ty = clamp((0.5 - (y / H) * s) * 100, (1 - s) * 100, 0);
  return `translate3d(${tx.toFixed(3)}%, ${ty.toFixed(3)}%, 0) scale(${s.toFixed(4)})`;
}

export function Closer() {
  const reduced = useReducedMotion();
  return reduced ? <CloserStatic /> : <CloserPinned />;
}

function CloserPinned() {
  const section = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState(0);
  const stopRef = useRef(0);
  /* The captures (170 to 205 kB each) load only when the chapter is close. */
  const near = useNear(section, '600px 0px');

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = section.current;
      const pic = layer.current;
      if (!el || !pic) return;
      const r = el.getBoundingClientRect();
      const run = r.height - window.innerHeight;
      const p = run > 0 ? clamp(-r.top / run, 0, 1) : 0;
      /* Each segment holds at both ends (18% of it) and eases in between. */
      const pos = p * (STOPS.length - 1);
      const i = Math.min(Math.floor(pos), STOPS.length - 2);
      const t = ease(clamp((pos - i - 0.18) / 0.64, 0, 1));
      const a = STOPS[i]!;
      const b = STOPS[i + 1]!;
      pic.style.transform = transformFor(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.s + (b.s - a.s) * t);
      const n = Math.round(i + t);
      if (n !== stopRef.current) {
        stopRef.current = n;
        setStop(n);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const showing = STOPS[stop]!.still;

  return (
    <section ref={section} id="closer" className="lt-zoom" aria-labelledby="zoom-title" data-testid="closer" data-stop={stop}>
      <div className="lt-zoom-pin">
        <div className="lt-zoom-copy" aria-live="polite">
          <h2 id="zoom-title" className="sr-only">
            From the whole window to one answer
          </h2>
          {STOPS.map((s, i) => (
            <div key={s.title} className={`lt-zoom-line ${i === stop ? 'is-on' : ''}`} aria-hidden={i === stop ? undefined : true}>
              <p className="lt-display">{s.title}</p>
              <p className="lt-lede mx-auto mt-3 max-w-[40rem]">{s.line}</p>
            </div>
          ))}
        </div>
        <div className="lt-zoom-frame">
          <Window title="Sequence · shopfront" className="lt-window-big">
            <div ref={layer} className="lt-zoom-layer" style={{ transform: transformFor(960, 540, 1) }}>
              {STILLS.map((name, i) => (
                <img
                  key={name}
                  src={near ? STILL(name) : undefined}
                  alt={i === showing ? ALT[i] : ''}
                  aria-hidden={i === showing ? undefined : true}
                  width={3840}
                  height={2160}
                  decoding="async"
                  data-still={name}
                  className={i === 0 || i <= showing ? 'is-on' : ''}
                />
              ))}
              {STOPS.map((s, i) =>
                s.spot ? (
                  <span
                    key={s.title}
                    aria-hidden="true"
                    className={`lt-zoom-spot ${i === stop ? 'is-on' : ''}`}
                    style={{ left: pct(s.spot.x, W), top: pct(s.spot.y, H), width: pct(s.spot.w, W), height: pct(s.spot.h, H) }}
                  />
                ) : null,
              )}
            </div>
            {/* Frosted over the product: where the camera is, out of four. */}
            <div className="lt-zoom-pill lt-glass" aria-hidden="true">
              {STOPS.map((s, i) => (
                <span key={s.title} className={i === stop ? 'is-on' : ''} />
              ))}
              <em>{String(stop + 1).padStart(2, '0')} / 04</em>
            </div>
          </Window>
          <p className="lt-note mt-3 text-center">Captures of the built app. The answer is a sample reply.</p>
        </div>
      </div>
    </section>
  );
}

function CloserStatic() {
  return (
    <section id="closer" className="lt-chapter" aria-labelledby="zoom-title" data-testid="closer-static">
      <div className="lt-wrap-wide">
        <h2 id="zoom-title" className="lt-display mx-auto max-w-[18ch] text-center">
          From the whole window to one answer.
        </h2>
        <div className="mx-auto mt-10 max-w-[1180px]">
          <Window title="Sequence · shopfront">
            <img src={STILL('zoom-answer')} alt={ALT[2]} width={3840} height={2160} loading="lazy" decoding="async" />
          </Window>
        </div>
        <ol className="mx-auto mt-8 grid max-w-[1180px] list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STOPS.map((s) => (
            <li key={s.title}>
              <p className="text-[18px] font-semibold tracking-tight">{s.title}</p>
              <p className="lt-note mt-1 !text-[14px]">{s.line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
