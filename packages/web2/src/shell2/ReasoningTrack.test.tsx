// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReasoningTrack, stopAt } from './ReasoningTrack';
import { effortLabelOf } from './ModelMenu';
import type { EffortStop } from './EffortSlider';

function stops(on: number, pick: (i: number) => void) {
  return ['low', 'medium', 'high', 'max'].map((k, i) => ({ key: k, label: k, title: `${k} title`, on: i === on, pick: () => pick(i) }));
}

/* The stops the menu builds for a model that offers every level, Auto first. */
function fullStops(on: string, pick: (key: string) => void): EffortStop[] {
  return ['default', 'low', 'medium', 'high', 'xhigh', 'max'].map((k) => ({
    key: k,
    label: effortLabelOf(k),
    title: effortLabelOf(k),
    on: k === on,
    pick: () => pick(k),
  }));
}

const drawn = () => [...document.querySelectorAll('[data-effort]')].map((el) => el.getAttribute('data-effort'));

describe('the reasoning slider (Faster to Smarter)', () => {
  it('is one slider over a dot per level, with Faster and Smarter at the ends', () => {
    const { container } = render(<ReasoningTrack stops={stops(2, () => {})} testidFor={(s) => `e-${s.key}`} />);
    const thumb = screen.getByRole('slider');
    expect(thumb.getAttribute('aria-valuenow')).toBe('2');
    expect(thumb.getAttribute('aria-valuemax')).toBe('3');
    expect(thumb.getAttribute('aria-valuetext')).toBe('high');
    expect(container.querySelectorAll('.s2-rt-dot')).toHaveLength(4);
    expect(container.querySelector('.s2-rt-ends')!.textContent).toBe('FasterSmarter');
    for (const d of container.querySelectorAll('.s2-rt-dot')) expect(d.textContent).toBe('');
  });
  it('fills only the chosen dot and puts the pill over it', () => {
    render(<ReasoningTrack stops={stops(2, () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(screen.getByTestId('e-high').className).toMatch(/is-on/);
    expect(screen.getByTestId('e-low').className).not.toMatch(/is-on/);
    expect(screen.getByTestId('e-max').className).not.toMatch(/is-on/);
    expect(screen.getByRole('slider').style.getPropertyValue('--rt-x')).toBe(String(2 / 3));
    expect(screen.getByTestId('e-high').style.getPropertyValue('--rt-x')).toBe(String(2 / 3));
  });
  it('fills the track with the accent from the left end up to the chosen dot, and not at Off', () => {
    const { container, rerender } = render(<ReasoningTrack stops={stops(2, () => {})} testidFor={(s) => `e-${s.key}`} />);
    const fill = screen.getByTestId('s2-effort-fill');
    expect(fill.style.getPropertyValue('--rt-x')).toBe(String(2 / 3));
    expect(screen.getByTestId('e-low').className).toMatch(/is-reached/);
    expect(screen.getByTestId('e-medium').className).toMatch(/is-reached/);
    expect(screen.getByTestId('e-high').className).not.toMatch(/is-reached/);
    expect(screen.getByTestId('e-max').className).not.toMatch(/is-reached/);
    expect(fill.getAttribute('data-empty')).toBe('false');
    /* Low on a Low..Max model is a chosen level, not Off: the track fills to it (reviewer: it showed empty). */
    rerender(<ReasoningTrack stops={stops(0, () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt-fill')!.getAttribute('data-empty')).toBe('false');
    expect(container.querySelectorAll('.is-reached')).toHaveLength(0);
  });
  it('is empty only at Off (none or minimal) or when nothing is chosen', () => {
    const offStops = (on: number) => ['none', 'low', 'high'].map((k, i) => ({ key: k, label: k, title: k, on: i === on, pick: () => {} }));
    const { container, rerender } = render(<ReasoningTrack stops={offStops(0)} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt-fill')!.getAttribute('data-empty')).toBe('true');
    rerender(<ReasoningTrack stops={offStops(1)} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt-fill')!.getAttribute('data-empty')).toBe('false');
    rerender(<ReasoningTrack stops={offStops(-1)} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt-fill')!.getAttribute('data-empty')).toBe('true');
  });
  it('the fill encloses the thumb (radius plus padding past the dot) and nothing animates on the first paint', () => {
    const css = readFileSync(resolve(__dirname, 'modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
    const fill = /\.s2-rt-fill \{([^}]*)\}/.exec(css)![1]!;
    expect(fill).toMatch(/width:\s*calc\(var\(--rt-x\) \* 100% \+ 14px \+ 12px\)/);
    expect(fill).not.toMatch(/transition/);
    expect(css).toMatch(/\.s2-rt\[data-ready='true'\] \.s2-rt-fill \{\s*transition: width/);
    expect(css).toMatch(/\.s2-rt\[data-ready='true'\] \.s2-rt-thumb \{\s*transition: left/);
    const { container } = render(<ReasoningTrack stops={stops(1, () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('.s2-rt')!.getAttribute('data-ready')).toBe('false');
  });
  it('moves by arrow key and by clicking a dot', () => {
    const pick = vi.fn();
    render(<ReasoningTrack stops={stops(1, pick)} testidFor={(s) => `e-${s.key}`} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(pick).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' });
    expect(pick).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByTestId('e-max'));
    expect(pick).toHaveBeenLastCalledWith(3);
  });
  it('names each dot by its label and keeps the description as its tooltip', () => {
    render(<ReasoningTrack stops={stops(0, () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(screen.getByRole('button', { name: 'medium' }).getAttribute('title')).toBe('medium title');
  });
  it('captions "Recommended" under the recommended level, at that dot', () => {
    render(<ReasoningTrack stops={stops(0, () => {})} recommended="medium" testidFor={(s) => `e-${s.key}`} />);
    const rec = screen.getByTestId('s2-effort-recommended');
    expect(rec.textContent).toBe('Recommended');
    expect(rec.style.getPropertyValue('--rt-x')).toBe(String(1 / 3));
  });
  it('shows no caption when no level is recommended or the recommended one is not offered', () => {
    const { rerender } = render(<ReasoningTrack stops={stops(0, () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(screen.queryByTestId('s2-effort-recommended')).toBeNull();
    rerender(<ReasoningTrack stops={stops(0, () => {})} recommended="xhigh" testidFor={(s) => `e-${s.key}`} />);
    expect(screen.queryByTestId('s2-effort-recommended')).toBeNull();
  });
});

describe('six levels, as Claude offers them (owner: "Default, Low, Medium, High, Max, Max" crammed)', () => {
  it('draws six distinct, wordless dots; the words are only names', () => {
    const { container } = render(<ReasoningTrack stops={fullStops('medium', () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelectorAll('.s2-rt-dot')).toHaveLength(6);
    const names = [...container.querySelectorAll('.s2-rt-dot')].map((d) => d.getAttribute('aria-label'));
    expect(names).toEqual(['Auto', 'Low', 'Medium', 'High', 'X-High', 'Max']);
    expect(new Set(names).size).toBe(6);
    expect(container.querySelector('.s2-rt-track')!.textContent).toBe('');
  });
  it('labels xhigh and max differently', () => {
    expect(effortLabelOf('xhigh')).toBe('X-High');
    expect(effortLabelOf('max')).toBe('Max');
    expect(effortLabelOf('default')).toBe('Auto');
    expect(effortLabelOf('none')).toBe('Off');
  });
});

describe('order', () => {
  it('runs from least to most thinking: Off, then Auto, then the levels, whatever order the agent listed', () => {
    const picked: string[] = [];
    const given: EffortStop[] = ['low', 'medium', 'default', 'none'].map((k) => ({
      key: k,
      label: effortLabelOf(k),
      title: k,
      on: k === 'medium',
      pick: () => picked.push(k),
    }));
    render(<ReasoningTrack stops={given} testidFor={(s) => `e-${s.key}`} />);
    expect(drawn()).toEqual(['none', 'default', 'low', 'medium']);
    const thumb = screen.getByRole('slider');
    expect(thumb.getAttribute('aria-valuenow')).toBe('3');
    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(picked).toEqual(['low']);
  });
  it('places stops evenly, one stop in the middle', () => {
    expect(stopAt(0, 1)).toBe(0.5);
    expect(stopAt(0, 4)).toBe(0);
    expect(stopAt(3, 4)).toBe(1);
  });
  it('renders nothing for no stops, and an unset pill when none is chosen', () => {
    const { container, rerender } = render(<ReasoningTrack stops={[]} testidFor={(s) => `e-${s.key}`} />);
    expect(container.querySelector('[role="slider"]')).toBeNull();
    rerender(<ReasoningTrack stops={stops(-1, () => {})} testidFor={(s) => `e-${s.key}`} />);
    expect(screen.getByRole('slider').className).toMatch(/is-unset/);
  });
});
