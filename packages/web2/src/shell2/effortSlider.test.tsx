import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EffortSlider, stopFromKey, stopFromPointer, type EffortStop } from './EffortSlider';
import { effortLabelOf } from './ModelMenu';

/* jsdom has no PointerEvent: a MouseEvent carries the clientX the slider reads. */
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
}

const stops = (on: number, pick: (i: number) => void): EffortStop[] =>
  ['low', 'medium', 'high', 'max'].map((k, i) => ({ key: k, label: effortLabelOf(k), title: k, on: i === on, pick: () => pick(i) }));

describe('sequenceRowProvider', () => {
  it('Claude and OpenAI wear their marks; every local model is the Sequence mark and the Local group', async () => {
    const { sequenceRowProvider, profileGroupOf } = await import('./ModelMenu');
    expect(sequenceRowProvider('anthropic', 'claude-sonnet-5')).toBe('claude');
    expect(sequenceRowProvider('openai', 'gpt-5.6')).toBe('openai');
    expect(sequenceRowProvider('ollama', 'qwen3-coder:30b')).toBe('sequence');
    expect(sequenceRowProvider('custom', 'qwen3:30b')).toBe('sequence');
    /* no evidence of a local runtime: not claimed as Local */
    expect(sequenceRowProvider('custom', 'my-model')).toBe('other');
    /* A hosted model through a gateway keeps its maker; a local gpt-oss stays Local. */
    expect(profileGroupOf('openai-compatible', 'anthropic/claude-sonnet-5-5')).toBe('claude');
    expect(profileGroupOf('openai-compatible', 'openai/gpt-5.1')).toBe('openai');
    expect(profileGroupOf('openai-compatible', 'minicpm5:latest')).toBe('local');
    expect(profileGroupOf('ollama', 'gpt-oss:20b')).toBe('local');
  });
});

describe('effortLabelOf', () => {
  /* LOCKING: xhigh and max both read Max before; the top two rungs must differ. */
  it('keeps X-High and Max apart, names the default Auto, and Off for none or minimal', () => {
    expect(effortLabelOf('default')).toBe('Auto');
    expect(effortLabelOf('auto')).toBe('Auto');
    expect(effortLabelOf('xhigh')).toBe('X-High');
    expect(effortLabelOf('max')).toBe('Max');
    expect(effortLabelOf('none')).toBe('Off');
    expect(effortLabelOf('minimal')).toBe('Off');
    expect(effortLabelOf('low')).toBe('Low');
  });
});

describe('stopFromPointer', () => {
  it('snaps to the nearest discrete stop and clamps outside the track', () => {
    expect(stopFromPointer(0, 100, 300, 4)).toBe(0);
    expect(stopFromPointer(100, 100, 300, 4)).toBe(0);
    expect(stopFromPointer(200, 100, 300, 4)).toBe(1);
    expect(stopFromPointer(260, 100, 300, 4)).toBe(2);
    expect(stopFromPointer(999, 100, 300, 4)).toBe(3);
    expect(stopFromPointer(5, 0, 0, 4)).toBe(0);
  });
});

describe('stopFromKey', () => {
  it('moves one stop by arrows, two by page keys, to the ends by Home/End', () => {
    expect(stopFromKey('ArrowRight', 1, 4)).toBe(2);
    expect(stopFromKey('ArrowLeft', 0, 4)).toBe(0);
    expect(stopFromKey('PageUp', 1, 4)).toBe(3);
    expect(stopFromKey('Home', 2, 4)).toBe(0);
    expect(stopFromKey('End', 0, 4)).toBe(3);
    expect(stopFromKey('a', 0, 4)).toBeNull();
  });
});

describe('EffortSlider', () => {
  it('is a slider with value text, labels Low/Medium/High/Max, and keyboard control', () => {
    const pick = vi.fn();
    render(<EffortSlider stops={stops(1, pick)} testidFor={(s) => `e-${s.key}`} />);
    const thumb = screen.getByRole('slider');
    expect(thumb.getAttribute('aria-valuetext')).toBe('Medium');
    expect(screen.getByTestId('s2-effort-slider').textContent).toBe('LowMediumHighMax');
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(pick).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(pick).toHaveBeenLastCalledWith(0);
  });

  it('dragging the track picks the stop under the pointer, once per change', () => {
    const pick = vi.fn();
    const { container } = render(<EffortSlider stops={stops(0, pick)} testidFor={(s) => `e-${s.key}`} />);
    const hit = container.querySelector('.s2-slider-hit') as HTMLElement;
    hit.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 24, right: 300, bottom: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireEvent.pointerDown(hit, { clientX: 100, pointerId: 1 });
    expect(pick).toHaveBeenLastCalledWith(1);
    fireEvent.pointerMove(hit, { clientX: 300, pointerId: 1 });
    expect(pick).toHaveBeenLastCalledWith(3);
    fireEvent.pointerUp(hit, { pointerId: 1 });
    pick.mockClear();
    fireEvent.pointerMove(hit, { clientX: 0, pointerId: 1 });
    expect(pick).not.toHaveBeenCalled();
  });

  it('a label click is a shortcut to that stop', () => {
    const pick = vi.fn();
    render(<EffortSlider stops={stops(0, pick)} testidFor={(s) => `e-${s.key}`} />);
    fireEvent.click(screen.getByTestId('e-high'));
    expect(pick).toHaveBeenCalledWith(2);
  });
});
