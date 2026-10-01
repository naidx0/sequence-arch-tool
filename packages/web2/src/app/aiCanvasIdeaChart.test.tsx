import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiCanvas } from './AiCanvas';
import type { SeqChart } from '@sequence/schema';

/**
 * A CHART ABOUT AN IDEA — one that cites NO node id at all.
 *
 * THE PATH THIS PINS IS LOAD-BEARING AND WAS UNPINNED HERE. Teach mode draws
 * general questions — "what is machine learning" — by emitting a `propose_chart`
 * whose items name no repository node, because there is no repository node to
 * name. `chart.ts` already rules that legal ("a chart about an IDEA (no nodeIds)
 * is legal — not everything is repo structure") and `SeqChartView` already
 * renders it. What had no test was THE CANVAS CALLER: every chart case in
 * `AiCanvas.test.tsx` uses the `node-link` fixture, which carries two nodeIds.
 * So the surface a reader actually meets was covered only for the grounded
 * shape, and the ungrounded one — now the whole of the third loop — was covered
 * by nothing.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT ASSERT ────────────────────────────────
 *
 * That the canvas VOIDS a chart citing a node id the graph lacks. `AiCanvas`
 * does not pass `knownNodeIds`, and that is a decision with its reason written
 * at the call site: the server validates every `nodeId` against the real graph
 * before the event is emitted, while this client's `session.graph` may be from a
 * different or staler scan, so "re-checking here would refuse charts the server
 * accepted, which is a worse failure than the one the check guards against."
 *
 * The refusal itself is real and is tested where it belongs —
 * `SeqChartView.test.tsx` renders a chart naming `pkg:billing` against a known
 * set holding only `pkg:analyzer` and asserts `seqchart-fail` says the model
 * "may not invent structure". A test here demanding the same would not be a
 * stronger lock; it would contradict a recorded ruling and, if anyone "fixed"
 * the product to satisfy it, would blank every legitimate chart the moment the
 * client's scan lagged the server's.
 */

/** The shape teach mode emits: real content, zero repository claims. */
const IDEA: SeqChart = {
  version: 1,
  kind: 'concept-map',
  title: 'Machine Learning',
  caption: 'A program that improves at a task from data rather than from rules someone wrote.',
  items: [
    { id: 'data', label: 'Training data', detail: 'examples with known answers' },
    { id: 'model', label: 'Model', detail: 'the function being fitted' },
    { id: 'loss', label: 'Loss', detail: 'how wrong an answer was' },
    { id: 'update', label: 'Update', detail: 'change the model to lower the loss' },
  ],
};

describe('a chart that cites nothing still draws', () => {
  it('THE FIXTURE IS THE REPORTED SHAPE: not one item names a repository node', () => {
    /*
     * The vacuity guard. Every assertion below is about the UNGROUNDED path, so
     * a fixture that quietly grew a `nodeId` would move this whole file back
     * onto the shape `AiCanvas.test.tsx` already covers, and it would still
     * pass.
     */
    const cited = IDEA.items.filter((item) => item.nodeId !== undefined);
    expect(cited.map((i) => i.id).join(', '), 'a fixture item cites a node').toBe('');
  });

  it('renders, through the real renderer, and is not refused', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [IDEA] } as never} />);
    expect(screen.getAllByTestId('ai-canvas-chart').length).toBe(1);
    /* NOT the refusal frame. A chart citing nothing has nothing to invent, so
       the one thing that must never happen here is the invented-structure
       refusal firing on a chart that made no structural claim. */
    expect(screen.queryByTestId('seqchart-fail')).toBeNull();
    expect(screen.getByTestId('seqchart-svg')).toBeTruthy();
  });

  it('the caption is on screen, because the caption is the answer', () => {
    /*
     * For a repository chart the picture carries the claim and the caption is
     * context. For an IDEA chart the caption is the sentence that answers the
     * question — four boxes reading "Training data / Model / Loss / Update"
     * without it is a diagram of nothing in particular.
     */
    render(<AiCanvas doc={{ blocks: [], charts: [IDEA] } as never} />);
    expect(screen.getByTestId('seqchart-cap').textContent).toBe(IDEA.caption);
  });

  it('every item it names is drawn — the picture is the whole answer', () => {
    /* Derived from the fixture rather than listed, so an item added tomorrow is
       covered without anyone remembering this file. */
    render(<AiCanvas doc={{ blocks: [], charts: [IDEA] } as never} />);
    const missing = IDEA.items.filter((item) => screen.queryAllByText(item.label).length === 0);
    expect(missing.map((i) => i.label).join(', '), 'items named but not drawn').toBe('');
  });

  it('the title is printed once, as for any other chart', () => {
    /* The owner's settled dislike — "a row that repeats its own name" — which
       the feedback log notes keeps coming back in new costumes. The frame draws
       the title in its own figcaption, so a block header above it would be the
       second copy. */
    render(<AiCanvas doc={{ blocks: [], charts: [IDEA] } as never} />);
    expect(screen.getAllByText(IDEA.title)).toHaveLength(1);
  });

  it('a doc holding only an idea chart is not the empty state', () => {
    /* The empty check once keyed on `blocks` alone, so a lesson whose whole
       content was charts painted "Ask in chat to populate this surface" over
       them. A teach turn's whole content IS the chart. */
    render(<AiCanvas doc={{ blocks: [], charts: [IDEA] } as never} />);
    expect(screen.queryByText(/Ask in chat to populate/i)).toBeNull();
  });
});
