// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReasoningTrack } from './ReasoningTrack';
import cssRaw from './modelMenu.css?raw';

/* jsdom has no PointerEvent: a MouseEvent carries the clientX the slider reads. */
if (!('PointerEvent' in window)) {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
}

const css = cssRaw.replace(/\r\n/g, '\n');
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
};

/*
 * 0.1.8 F1/F2 (owner: "the picker isn't animated ... not snapping to that frame, it's smooth"; "the blue incorporating
 * the white circle picker, spacing around that is a little bit flawed").
 */
describe('the reasoning slider glides and sits evenly in the blue (F1, F2)', () => {
  it('the thumb and the blue transition in 180 ms ease-out, and not under reduced motion', () => {
    expect(rule(".s2-rt[data-ready='true'] .s2-rt-thumb")).toMatch(/transition:\s*left 180ms ease-out/);
    expect(rule(".s2-rt[data-ready='true'] .s2-rt-fill")).toMatch(/transition:\s*width 180ms ease-out/);
    const at = css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .s2-rt[data-ready='true'] .s2-rt-thumb");
    expect(at).toBeGreaterThanOrEqual(0);
    const reduced = css.slice(at, css.indexOf('\n}', at));
    expect(reduced).toMatch(/\.s2-rt\[data-ready='true'\] \.s2-rt-fill,/);
    expect(reduced).toMatch(/transition: none/);
  });

  it('the thumb has the same margin to the blue on every side', () => {
    const pad = 5; /* the fill's right extent below, in px */
    const trackH = 28; /* --control-h (tokens/graphite.css) */
    const thumb = Number(/width:\s*(\d+)px/.exec(rule('.s2-rt-thumb'))![1]);
    /* top and bottom: the thumb is centred in the track. */
    expect((trackH - thumb) / 2).toBe(pad);
    /* right: the blue runs to the dot's centre, then the thumb's radius, then 5 px. */
    expect(rule('.s2-rt-fill')).toContain(`width: calc(var(--rt-x) * 100% + 14px + ${thumb / 2}px + ${pad}px);`);
    /* left: the fill starts at the track edge and the first dot is 14 px in, so the thumb at stop 0 is 14 - 9 = 5 px from it. */
    expect(14 - thumb / 2).toBe(pad);
  });

  it('a click on the track is not a drag: the transition stays on, so the thumb glides to the stop', () => {
    let on = 0;
    const ks = ['low', 'medium', 'high', 'max'];
    const mk = () => ks.map((k, i) => ({ key: k, label: k, title: k, on: i === on, pick: () => { on = i; } }));
    const { container, rerender } = render(<ReasoningTrack stops={mk()} testidFor={(s) => `e-${s.key}`} />);
    const track = container.querySelector<HTMLElement>('.s2-rt-track')!;
    track.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 28, right: 300, bottom: 28, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const rt = () => container.querySelector('.s2-rt')!;
    fireEvent.pointerDown(track, { clientX: 286, pointerId: 1 });
    rerender(<ReasoningTrack stops={mk()} testidFor={(s) => `e-${s.key}`} />);
    expect(on).toBe(3);
    /* data-dragging is what turns the transition off (modelMenu.css); a bare press must leave it off. */
    expect(rt().getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerMove(track, { clientX: 285, pointerId: 1 });
    expect(rt().getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(rt().getAttribute('data-dragging')).toBe('false');
  });

  it('losing pointer capture ends a drag like a cancel', () => {
    const ks = ['low', 'medium', 'high', 'max'];
    const stops = ks.map((k, i) => ({ key: k, label: k, title: k, on: i === 0, pick: () => {} }));
    const { container } = render(<ReasoningTrack stops={stops} testidFor={(s) => `e-${s.key}`} />);
    const track = container.querySelector<HTMLElement>('.s2-rt-track')!;
    track.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 28, right: 300, bottom: 28, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireEvent.pointerDown(track, { clientX: 14, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 });
    expect(container.querySelector('.s2-rt')!.getAttribute('data-dragging')).toBe('true');
    fireEvent.lostPointerCapture(track, { pointerId: 1 });
    expect(container.querySelector('.s2-rt')!.getAttribute('data-dragging')).toBe('false');
  });

  it('dragging follows the pointer, then settles on the nearest stop when released', () => {
    const picks: number[] = [];
    let on = 0;
    const mk = () =>
      ['low', 'medium', 'high', 'max'].map((k, i) => ({
        key: k,
        label: k,
        title: k,
        on: i === on,
        pick: () => {
          picks.push(i);
          on = i;
        },
      }));
    const { container, rerender } = render(<ReasoningTrack stops={mk()} testidFor={(s) => `e-${s.key}`} />);
    const track = container.querySelector<HTMLElement>('.s2-rt-track')!;
    track.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 28, right: 300, bottom: 28, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const x = () => Number(screen.getByTestId('s2-effort-thumb').style.getPropertyValue('--rt-x'));
    fireEvent.pointerDown(track, { clientX: 14, pointerId: 1 });
    /* 150 px of a 300 px track is halfway along the rail (14..286): between the 2nd and 3rd stop, on neither. */
    fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 });
    rerender(<ReasoningTrack stops={mk()} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt')!.getAttribute('data-dragging')).toBe('true');
    expect(x()).toBeCloseTo(0.5, 2);
    fireEvent.pointerUp(track, { pointerId: 1 });
    rerender(<ReasoningTrack stops={mk()} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt')!.getAttribute('data-dragging')).toBe('false');
    /* Released: the thumb is back on a stop (the nearest one was picked); the CSS transition carries it there. */
    expect([0, 1 / 3, 2 / 3, 1].some((s) => Math.abs(s - x()) < 1e-6)).toBe(true);
    expect(picks.at(-1)).toBeGreaterThanOrEqual(1);
  });
});
