import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SeqChart } from '@sequence/schema';

import { CHART_FIT_WIDTH_DEFAULT, CHART_FIT_WIDTH_KEY, FIT_W, chartFitWidthOn, fitOptions } from './FlowChart.js';
import { SeqChartView } from './SeqChartView.js';
import { GAP_X, NODE_W, PAD } from './chartLayout.js';

/**
 * THE FIT TARGET IS THE ROOM THE CHART IS GIVEN, NOT A CONSTANT.
 *
 * 440 is the AI Canvas's scroll box at 1280x820. In a 900 px frame the same
 * three-layer concept chart was still squeezed to 432 px (gaps 20, boxes 120)
 * because the target was fixed. `fitOptions(layers, available)` takes the width
 * in and hands the gap and box width out; the flag decides which width goes in.
 */
const drawn = (layers: number, o: { gapX?: number; nodeW?: number }) =>
  PAD * 2 + layers * (o.nodeW ?? NODE_W) + Math.max(0, layers - 1) * (o.gapX ?? GAP_X);

describe('fitOptions: width in, gap and box out', () => {
  it('keeps the 440 behaviour exactly at the canvas width', () => {
    expect(FIT_W).toBe(440);
    expect(fitOptions(3)).toEqual({ gapX: 20, nodeW: 120 });
    expect(fitOptions(3, 440)).toEqual({ gapX: 20, nodeW: 120 });
    expect(drawn(3, fitOptions(3, 440))).toBe(432);
  });

  it('gives a three-layer chart its default gaps and boxes in a 900 px frame', () => {
    const o = fitOptions(3, 900);
    expect(o).toEqual({});
    expect(drawn(3, o)).toBe(616);
  });

  it('grows the gap back before it would enlarge a box, and never past the defaults', () => {
    const o = fitOptions(3, 500);
    expect(o.gapX).toBeGreaterThan(20);
    expect(drawn(3, o)).toBeLessThanOrEqual(500);
    for (const w of [440, 480, 520, 560, 600, 616, 700, 900, 1400]) {
      for (const layers of [2, 3, 4, 5, 8]) {
        const fit = fitOptions(layers, w);
        expect(fit.nodeW ?? NODE_W).toBeLessThanOrEqual(NODE_W);
        expect(fit.gapX ?? GAP_X).toBeLessThanOrEqual(GAP_X);
      }
    }
  });

  it('never targets less than 440, however narrow the measured box', () => {
    for (const w of [0, 200, 439]) expect(fitOptions(3, w)).toEqual(fitOptions(3, 440));
  });

  it('leaves a chart that already fits untouched at every width', () => {
    for (const w of [440, 900]) {
      expect(fitOptions(1, w)).toEqual({});
      expect(fitOptions(2, w)).toEqual({});
    }
  });
});

/*
 * THE FLAG, THROUGH THE RENDERER. jsdom has no layout, so the scroll box's
 * clientWidth is stubbed to 900 for these renders only; with the flag off the
 * stub must change nothing.
 */
describe('StraightFlow reads the frame width only with seq.chartFitWidth on', () => {
  const threeLayer = (): SeqChart => ({
    version: 1,
    kind: 'data-flow',
    title: 'brief.ts',
    focusItemId: 'b',
    items: [
      { id: 'a', label: 'cli.ts' },
      { id: 'b', label: 'brief.ts' },
      { id: 'c', label: 'schema/src/index.ts' },
    ],
    links: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  });
  let restore: (() => void) | undefined;
  beforeEach(() => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
    restore = () => {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
    };
  });
  afterEach(() => {
    restore?.();
    localStorage.removeItem(CHART_FIT_WIDTH_KEY);
  });

  const svgWidth = () => {
    const { container } = render(<SeqChartView chart={threeLayer()} />);
    return Number(container.querySelector('svg')!.getAttribute('width'));
  };

  it('is on by default and draws the defaults (616 px) in a 900 px frame', () => {
    expect(CHART_FIT_WIDTH_DEFAULT).toBe(true);
    expect(chartFitWidthOn()).toBe(true);
    expect(svgWidth()).toBe(616);
  });

  it('keeps the 432 px layout when turned off', () => {
    localStorage.setItem(CHART_FIT_WIDTH_KEY, '0');
    expect(chartFitWidthOn()).toBe(false);
    expect(svgWidth()).toBe(432);
  });

  it('draws the defaults (616 px) in a 900 px frame when on', () => {
    localStorage.setItem(CHART_FIT_WIDTH_KEY, '1');
    expect(chartFitWidthOn()).toBe(true);
    expect(svgWidth()).toBe(616);
  });
});
