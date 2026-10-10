import { describe, expect, it } from 'vitest';

import { autoExpandStep, rankGroups, READABLE_FIT, startAutoExpand } from './autoExpand';
import { rawFitZoom } from './Board';

/* Expand all opens groups in rank order while the arranged fit stays
   readable, closes the one that takes it below, and parks the rest. */

describe('expand all', () => {
  it('opens one group per finished arrangement while the fit stays readable', () => {
    let s = startAutoExpand(['a', 'b', 'c']);
    let step = autoExpandStep(s, 0.8);
    expect(step.expand).toBe('a');
    s = step.state;
    step = autoExpandStep(s, 0.5);
    expect(step.expand).toBe('b');
    s = step.state;
    step = autoExpandStep(s, READABLE_FIT);
    expect(step.expand).toBe('c');
    step = autoExpandStep(step.state, 0.4);
    expect(step.expand).toBeUndefined();
    expect(step.state).toEqual({ queue: [], tried: null, done: true });
  });

  it('closes the group that takes the fit below 35% and keeps it first in what is left', () => {
    let s = startAutoExpand(['a', 'b', 'c']);
    s = autoExpandStep(s, 0.8).state; // opens a
    const step = autoExpandStep(s, 0.3); // a made it unreadable
    expect(step.collapse).toBe('a');
    expect(step.expand).toBeUndefined();
    expect(step.state).toEqual({ queue: ['a', 'b', 'c'], tried: null, done: true });
    /* Once done, later arrangements (a zoom step) change nothing. */
    expect(autoExpandStep(step.state, 0.9)).toEqual({ state: step.state });
  });

  it('opens nothing when the board is already below readable', () => {
    const step = autoExpandStep(startAutoExpand(['a']), 0.3);
    expect(step.expand).toBeUndefined();
    expect(step.state.done).toBe(true);
    expect(step.state.queue).toEqual(['a']);
  });

  it('stops at the box budget, the group that would pass it first in what is left', () => {
    const step = autoExpandStep(startAutoExpand(['big', 'small']), 0.9, (id) => id !== 'big');
    expect(step.expand).toBeUndefined();
    expect(step.state).toEqual({ queue: ['big', 'small'], tried: null, done: true });
  });

  it('ranks top-level groups with members by lines, then name, leaving open ones out', () => {
    const boxes = [
      { id: 'svc:a', label: 'a' },
      { id: 'svc:b', label: 'b' },
      { id: 'svc:c', label: 'c' },
      { id: 'm', label: 'm', parentId: 'svc:a' },
      { id: 'ds', label: 'db' },
    ];
    const lines = [
      { source: 'svc:c', target: 'svc:b' },
      { source: 'svc:c', target: 'ds' },
    ];
    expect(rankGroups(boxes, new Set(['svc:a', 'svc:b', 'svc:c', 'm']), [], lines)).toEqual(['svc:c', 'svc:b', 'svc:a']);
    expect(rankGroups(boxes, new Set(['svc:a', 'svc:b', 'svc:c']), ['svc:c'], lines)).toEqual(['svc:b', 'svc:a']);
  });
});

describe('the fit an arrangement needs, before the floor', () => {
  it('is the usable frame (inset and bands off) over the bounds, per axis', () => {
    /* 462x620 pane, 24 inset each side, 40 top band, 50 bottom band:
       usable 414 x 482; bounds 1000 x 2000 -> min(0.414, 0.241) = 0.241. */
    expect(rawFitZoom({ width: 1000, height: 2000 }, { width: 462, height: 620 }, { top: 40, bottom: 50 })).toBeCloseTo(0.241, 3);
    expect(rawFitZoom({ width: 0, height: 10 }, { width: 462, height: 620 }, null)).toBe(0);
  });
});
