/* ═══════════════════════════════════════════════════════════════════════════
   THE REASONING SLIDER (packages/web2/src/shell2/ReasoningTrack.tsx)

   Owner, 2026-10-09, pointing at Cursor's effort slider: "this is good ui for
   reasoning sliders, incorporate this format". So: "Faster" and "Smarter" at
   the two ends, one rounded track with a dot per level, a light pill that
   slides to the chosen dot, and "Recommended" under the level the model
   recommends. The words of the chosen level live in the header (the caller).

   Owner, 2026-10-09: the track fills with the accent from the left end up to
   the chosen dot, the way a settings switch turns on; Off is an empty track.

   Off and Auto, when offered, are the leftmost dots: the track runs from the
   least thinking to the most, and nothing is crammed into words on the track.

   One role=slider is the tab stop (the pill). Arrows, Home and End move it;
   a click or drag on the track picks the nearest dot.

   PURE VIEW. The caller owns which stop is on and what picking one does.
   Motion lives in modelMenu.css and is off under prefers-reduced-motion.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

import { stopFromKey, type EffortStop } from './EffortSlider';

/** Off sorts first, then Auto, then the levels in the order given. */
const rank = (s: EffortStop) => (s.key === 'none' || s.key === 'minimal' ? 0 : s.key === 'default' || s.key === 'auto' ? 1 : 2);

/** The rail sits this far in from each end of the track (modelMenu.css `.s2-rt-rail`). */
const RAIL_INSET = 14;
/** A press that moves less than this is a click. */
const DRAG_SLOP = 3;

/** Where stop i of n sits along the track, as a fraction (one stop sits in the middle). */
export const stopAt = (i: number, n: number) => (n <= 1 ? 0.5 : i / (n - 1));

export function ReasoningTrack({
  stops: given,
  testidFor,
  recommended,
  name = 'Reasoning effort',
}: {
  stops: readonly EffortStop[];
  testidFor: (stop: EffortStop) => string;
  /** The key of the level the model recommends; captioned "Recommended" under its dot. */
  recommended?: string;
  name?: string;
}) {
  const stops = given.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
  const hitRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const pressX = useRef<number | null>(null);
  const release = () => {
    pressX.current = null;
    setDragging(false);
    setDragX(null);
  };
  /* 0.1.8 F1: while a hand is on the track the thumb and the blue follow the pointer (0..1 along the rail); on release this
     clears and the pair settles on the nearest stop with the CSS transition. */
  const [dragX, setDragX] = useState<number | null>(null);
  const count = stops.length;
  const on = stops.findIndex((s) => s.on);
  const current = Math.max(0, on);
  /* The fill is empty only for Off (or nothing chosen): Low on a Low..Max model is a chosen level and fills. */
  const empty = on < 0 || rank(stops[on]!) === 0;
  /* No transition on the first paint: the menu opens with the fill and thumb already in place. */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const rec = recommended ? stops.findIndex((s) => s.key === recommended) : -1;

  const move = (i: number) => {
    if (i !== on && stops[i]) stops[i]!.pick();
  };
  /* The pointer picks the nearest dot. */
  const fromPointer = (ev: PointerEvent, follow: boolean) => {
    const r = hitRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || count < 1) return;
    const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    if (follow && count > 1) setDragX(Math.min(1, Math.max(0, (ev.clientX - r.left - RAIL_INSET) / Math.max(1, r.width - 2 * RAIL_INSET))));
    move(count <= 1 ? 0 : Math.round(t * (count - 1)));
  };
  const x = dragX ?? stopAt(current, count);

  if (count === 0) return null;
  return (
    <div className="s2-rt" data-testid="s2-effort-slider" data-dragging={dragging ? 'true' : 'false'} data-ready={ready ? 'true' : 'false'}>
      <div className="s2-rt-ends" aria-hidden="true">
        <span>Faster</span>
        <span>Smarter</span>
      </div>
      <div
        className="s2-rt-track"
        ref={hitRef}
        onPointerDown={(ev) => {
          /* A press is not yet a drag: the thumb glides to the nearest stop (a click is a pick, and it animates). It becomes a
             drag, following the pointer with no transition, once the pointer has travelled DRAG_SLOP px. */
          pressX.current = ev.clientX;
          try {
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
          } catch {
            /* capture is a nicety; dragging still works inside the track */
          }
          fromPointer(ev, false);
        }}
        onPointerMove={(ev) => {
          if (pressX.current === null) return;
          if (!dragging && Math.abs(ev.clientX - pressX.current) < DRAG_SLOP) return;
          if (!dragging) setDragging(true);
          fromPointer(ev, true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <span className="s2-rt-rail">
          <span
            className="s2-rt-fill"
            aria-hidden="true"
            style={{ '--rt-x': x } as CSSProperties}
            data-empty={empty ? 'true' : 'false'}
            data-testid="s2-effort-fill"
          />
          {stops.map((s, i) => (
            <button
              key={s.key}
              type="button"
              tabIndex={-1}
              title={i === rec ? `${s.title}, recommended` : s.title}
              aria-label={i === rec
 ? `${s.label}, recommended` : s.label}
              className={`s2-rt-dot${s.on ? ' is-on' : ''}${!empty && i < current ? ' is-reached' : ''}`}
              style={{ '--rt-x': stopAt(i, count) } as CSSProperties}
              data-testid={testidFor(s)}
              data-effort={s.key}
              data-on={s.on ? 'true' : 'false'}
              onClick={() => move(i)}
            />
          ))}
          <span
            className={`s2-rt-thumb${on < 0 ? ' is-unset' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label={name}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={count - 1}
            aria-valuenow={current}
            aria-valuetext={on < 0 ? 'Not set' : (stops[current]?.label ?? '')}
            style={{ '--rt-x': x } as CSSProperties}
            data-testid="s2-effort-thumb"
            onKeyDown={(ev: KeyboardEvent) => {
              /* Unset sits before the first stop, so the first press up lands on stop 0 and not on stop 1. */
              const next = stopFromKey(ev.key, on < 0 ? -1 : current, count);
              if (next === null) return;
              ev.preventDefault();
              ev.stopPropagation();
              move(next);
            }}
          />
        </span>
      </div>
      {rec >= 0 ? (
        <div className="s2-rt-under">
          <span className="s2-rt-rec" data-testid="s2-effort-recommended" style={{ '--rt-x': stopAt(rec, count) } as CSSProperties}>
            Recommended
          </span>
        </div>
      ) : null}
    </div>
  );
}
