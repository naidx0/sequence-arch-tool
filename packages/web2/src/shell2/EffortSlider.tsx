/* ══════════════════════════════════════════════════════════════════════════
   THE REASONING SLIDER — a real one (round 9, ask 17)
   packages/web2/src/shell2/EffortSlider.tsx

   Owner: "it's a left-to-right timeline, not a real slider. Use a proper
   slider like ChatGPT and Codex." So: a track, a filled part, a thumb you can
   drag, discrete stops snapped to, a label under every stop. The thumb is the
   one tab stop (role=slider); arrows, Home/End and PageUp/PageDown move it.
   The labels are also clickable, as a shortcut, but are not tab stops.

   PURE VIEW. The caller owns which stop is on and what picking one does.
   ══════════════════════════════════════════════════════════════════════════ */

import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export interface EffortStop {
  key: string;
  label: string;
  title: string;
  on: boolean;
  pick: () => void;
}

/** The stop nearest a pointer at `clientX` along a track of `left`..`left+width`. */
export function stopFromPointer(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const t = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round(t * (count - 1));
}

/** Where a key moves the thumb; null when the key is not the slider's. */
export function stopFromKey(key: string, index: number, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return Math.min(last, index + 1);
    case 'ArrowLeft':
    case 'ArrowDown':
      return Math.max(0, index - 1);
    case 'PageUp':
      return Math.min(last, index + 2);
    case 'PageDown':
      return Math.max(0, index - 2);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

export function EffortSlider({
  stops,
  testidFor,
  name = 'Reasoning effort',
}: {
  stops: readonly EffortStop[];
  testidFor: (stop: EffortStop) => string;
  name?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const count = stops.length;
  const current = Math.max(0, stops.findIndex((s) => s.on));
  const pct = (i: number) => (count > 1 ? (i / (count - 1)) * 100 : 0);

  const move = (i: number) => {
    if (i !== current && stops[i]) stops[i]!.pick();
  };
  const fromPointer = (ev: PointerEvent) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    move(stopFromPointer(ev.clientX, r.left, r.width, count));
  };

  return (
    <div className="s2-slider" data-testid="s2-effort-slider" data-dragging={dragging ? 'true' : 'false'}>
      <div
        className="s2-slider-hit"
        ref={trackRef}
        onPointerDown={(ev) => {
          setDragging(true);
          try {
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
          } catch {
            /* capture is a nicety; dragging still works inside the box */
          }
          fromPointer(ev);
        }}
        onPointerMove={(ev) => {
          if (dragging) fromPointer(ev);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <span className="s2-slider-track" aria-hidden="true">
          <span className="s2-slider-fill" style={{ width: `${pct(current)}%` }} />
          {stops.map((s, i) => (
            <span key={s.key} className={`s2-slider-tick${i <= current ? ' is-past' : ''}`} style={{ left: `${pct(i)}%` }} />
          ))}
        </span>
        <span
          className="s2-slider-thumb"
          role="slider"
          tabIndex={0}
          aria-label={name}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, count - 1)}
          aria-valuenow={current}
          aria-valuetext={stops[current]?.label ?? ''}
          data-testid="s2-effort-thumb"
          style={{ left: `${pct(current)}%` }}
          onKeyDown={(ev: KeyboardEvent) => {
            const next = stopFromKey(ev.key, current, count);
            if (next === null) return;
            ev.preventDefault();
            ev.stopPropagation();
            move(next);
          }}
        />
      </div>
      <div className="s2-slider-labels">
        {stops.map((s, i) => (
          <button
            key={s.key}
            type="button"
            tabIndex={-1}
            title={s.title}
            aria-label={s.title}
            className={`s2-stop${s.on ? ' is-on' : ''}${i <= current ? ' is-past' : ''}`}
            style={{ left: `${pct(i)}%` }}
            data-testid={testidFor(s)}
            data-effort={s.key}
            data-on={s.on ? 'true' : 'false'}
            onClick={s.pick}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
