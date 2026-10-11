import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiCanvas } from './AiCanvas';
import type { SeqChart } from '@sequence/schema';

/**
 * Owner walk 2026-09-16: "plot a parabola … Use AI Canvas" must land as a
 * real line chart with axes — not ASCII Markdown, not Architecture IR.
 * Pins the last link: product floor chart → canvasDoc.charts → SeqChartView.
 */
const PARABOLA: SeqChart = {
  version: 1,
  kind: 'line',
  title: 'a parabola: x^2',
  caption: 'a parabola, chosen by Sequence to show the shape.',
  axes: { x: 'x', y: 'x^2' },
  items: Array.from({ length: 21 }, (_, i) => {
    const x = -5 + (10 * i) / 20;
    return {
      id: `p${i}`,
      label: String(Math.round(x * 100) / 100),
      value: Math.round(x * x * 1000) / 1000,
      group: 'x^2',
    };
  }),
};

describe('AI Canvas paints a parabola line chart', () => {
  it('THE FIXTURE IS THE REPORTED SHAPE: line kind, x axis, no nodeIds', () => {
    expect(PARABOLA.kind).toBe('line');
    expect(PARABOLA.axes?.x).toBe('x');
    expect(PARABOLA.items.every((it) => it.nodeId === undefined)).toBe(true);
    expect(PARABOLA.items.length).toBeGreaterThanOrEqual(10);
  });

  it('renders through SeqChartView with axes and a polyline curve', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [PARABOLA] } as never} />);
    expect(screen.getAllByTestId('ai-canvas-chart').length).toBe(1);
    expect(screen.queryByTestId('seqchart-fail')).toBeNull();
    const svg = screen.getByTestId('seqchart-svg');
    expect(svg.querySelectorAll('polyline.cseries-line').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('line.caxis').length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelectorAll('line.cgrid').length).toBeGreaterThanOrEqual(4);
  });

  it('does not show the empty board copy over a landed chart', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [PARABOLA] } as never} />);
    expect(screen.queryByText(/Nothing drawn yet/i)).toBeNull();
    expect(screen.queryByText(/Ask in chat to populate/i)).toBeNull();
  });

  it('polyline curve has fill none — no black wedge', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [PARABOLA] } as never} />);
    const line = screen.getByTestId('seqchart-svg').querySelector('polyline.cseries-line');
    expect(line?.getAttribute('fill')).toBe('none');
    expect(line?.getAttribute('points')?.split(' ').length).toBeGreaterThanOrEqual(10);
  });

  it('coalesces singleton groups into one visible curve', () => {
    /* Model habit: one group per point → N length-1 polylines (invisible). */
    const broken: SeqChart = {
      ...PARABOLA,
      items: PARABOLA.items.map((it, i) => ({ ...it, group: `g${i}` })),
    };
    render(<AiCanvas doc={{ blocks: [], charts: [broken] } as never} />);
    const lines = screen.getByTestId('seqchart-svg').querySelectorAll('polyline.cseries-line');
    expect(lines.length).toBe(1);
    expect(lines[0]!.getAttribute('points')?.split(' ').length).toBeGreaterThanOrEqual(10);
  });

  it('does not stack a caption that only repeats the title stem', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [PARABOLA] } as never} />);
    expect(screen.getByTestId('seqchart-title').textContent).toMatch(/parabola/i);
    expect(screen.queryByTestId('seqchart-cap')).toBeNull();
  });
});
