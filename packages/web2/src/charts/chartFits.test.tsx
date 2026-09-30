import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SeqChart } from '@sequence/schema';

import { SeqChartView } from './SeqChartView.js';

/**
 * EVERY ITEM IN THE CHART GETS A BOX INSIDE THE FRAME.
 *
 * The derived concept chart draws a focus, its inbound neighbours and its
 * outbound one: three layers. At the layout defaults that measures
 * `PAD*2 + 3*NODE_W + 2*GAP_X = 616`, and the AI Canvas gives a chart 440 — so
 * on the journey's screen 4 the outbound node sat past the clip and the picture
 * read as an arrow leaving `brief.ts` and ending in nothing.
 *
 * Every box WAS drawn and reachable by scrolling; the container's
 * `overflow-x: auto` worked exactly as designed. But nobody scrolls a
 * screenshot, and a reader who does not scroll sees a broken diagram — so the
 * rule is not "the box exists", it is "the box is inside the frame".
 *
 * Locked here rather than trusted to a screenshot, because the screenshot is
 * what noticed it and a screenshot is not a gate.
 */
/*
 * THE REAL CHART, not an invented one: this is byte-for-byte what
 * `buildConceptChart` produced for `brief.ts` on 2026-09-06 and what the AI
 * Canvas drew on the journey's screen 4. An invented fixture was the first
 * attempt and the view refused it — correctly, since the kind was wrong — which
 * is a reminder that a fixture nobody generated proves nothing about what the
 * product makes.
 */
const conceptChart = (): SeqChart => ({
  version: 1,
  kind: 'data-flow',
  title: 'brief.ts',
  caption: 'brief.ts and what it connects to, from the scanned graph.',
  focusItemId: 'file:packages/analyzer/src/brief.ts',
  items: [
    { id: 'file:packages/analyzer/src/brief.ts', label: 'brief.ts' },
    { id: 'file:packages/analyzer/src/cli.ts', label: 'cli.ts' },
    { id: 'file:packages/analyzer/src/index.ts', label: 'analyzer/src/index.ts' },
    { id: 'file:packages/analyzer/src/server/repoServer.ts', label: 'repoServer.ts' },
    { id: 'file:packages/schema/src/index.ts', label: 'schema/src/index.ts' },
  ],
  links: [
    { from: 'file:packages/analyzer/src/cli.ts', to: 'file:packages/analyzer/src/brief.ts' },
    { from: 'file:packages/analyzer/src/index.ts', to: 'file:packages/analyzer/src/brief.ts' },
    { from: 'file:packages/analyzer/src/server/repoServer.ts', to: 'file:packages/analyzer/src/brief.ts' },
    { from: 'file:packages/analyzer/src/brief.ts', to: 'file:packages/schema/src/index.ts' },
  ],
});

describe('a three-layer concept chart fits the canvas it is drawn in', () => {
  it('draws one box per item', () => {
    const { container } = render(<SeqChartView chart={conceptChart()} />);
    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBe(5);
  });

  it('is no wider than the AI Canvas gives it', () => {
    /*
     * 440 is the canvas's scroll box at 1280x820, measured on the running app.
     * The chart may use the frame's scroll for genuinely wide shapes — a
     * twelve-layer flow cannot be honestly shrunk — but a chart with THREE
     * layers is not that, and this one has to fit.
     */
    const { container } = render(<SeqChartView chart={conceptChart()} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const width = Number(svg!.getAttribute('width'));
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeLessThanOrEqual(440);
  });

  it('does not narrow a chart that already fits', () => {
    /*
     * The fit rule must not touch the common case. A two-layer chart is well
     * inside the box at the defaults, and shrinking it would make every ordinary
     * chart smaller to fix a case that is not theirs — NODE_W is "half a board
     * card wide" on purpose.
     */
    const twoLayer: SeqChart = {
      ...conceptChart(),
      items: [
        { id: 'file:packages/analyzer/src/cli.ts', label: 'cli.ts' },
        { id: 'file:packages/analyzer/src/brief.ts', label: 'brief.ts' },
      ],
      links: [
        { from: 'file:packages/analyzer/src/cli.ts', to: 'file:packages/analyzer/src/brief.ts' },
      ],
    };
    const { container } = render(<SeqChartView chart={twoLayer} />);
    const width = Number(container.querySelector('svg')!.getAttribute('width'));
    /* PAD*2 + 2*NODE_W + GAP_X = 32 + 304 + 64 = 400, untouched. */
    expect(width).toBe(400);
  });
});
