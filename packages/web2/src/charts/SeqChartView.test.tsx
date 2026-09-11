import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CHART_KINDS, type ChartKind, type SeqChart, chartFamily } from '@sequence/schema';

import { FAMILY_RENDERERS, SeqChartView } from './SeqChartView.js';
import { CHART_FIXTURES } from './chartFixtures.js';

/**
 * THE ENTRY POINT'S FOUR PROMISES.
 *
 * 1. Every one of the forty-five names the model may ask for reaches a
 *    renderer. A dispatch gap is invisible in a screenshot — the chart is just
 *    not there — so it has to be a test.
 * 2. A refused spec says WHY, in place. Never a blank box.
 * 3. focusItemId spotlights exactly one item and dims the rest, which is the
 *    mechanism teach mode advances one concept at a time with.
 * 4. The same spec produces the same markup, which is the determinism the
 *    whole JSON-not-React decision rests on.
 */

/** A spec that exercises every optional field at once: groups, values, tones,
 *  axes, and a THREE-NODE CYCLE — the shape that hangs a naive layering. */
function probe(kind: ChartKind): SeqChart {
  return {
    version: 1,
    kind,
    title: `probe: ${kind}`,
    caption: 'a probe spec, carrying every optional field the contract has',
    items: [
      { id: 'a', label: 'Alpha', detail: 'src/alpha.ts', value: 3, group: 'one' },
      { id: 'b', label: 'Beta', detail: 'src/beta.ts', value: 5, group: 'one', tone: 'good' },
      { id: 'c', label: 'Gamma', detail: 'src/gamma.ts', value: 2, group: 'two', tone: 'warn' },
    ],
    links: [
      { from: 'a', to: 'b', label: 'calls' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a', tone: 'bad' },
    ],
    axes: { x: 'effort', y: 'value', columns: ['one', 'two'], lanes: ['one', 'two'] },
  };
}

describe('dispatch — all 45 kinds reach a renderer', () => {
  it('maps every kind to a family that has a renderer', () => {
    const gaps = CHART_KINDS.filter((kind) => !FAMILY_RENDERERS[chartFamily(kind)]);
    expect(gaps, `kinds with no renderer: ${gaps.join(', ')}`).toEqual([]);
    /* Vacuity guard: an empty CHART_KINDS would pass the line above. */
    expect(CHART_KINDS.length).toBe(45);
  });

  it.each(CHART_KINDS.map((kind) => [kind] as const))('draws %s without refusing it', (kind) => {
    render(<SeqChartView chart={probe(kind)} />);
    expect(screen.queryByTestId('seqchart-fail')).toBeNull();
    const svg = screen.getByTestId('seqchart-svg');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    /* Every item the spec listed is present as a drawn thing. A renderer that
       quietly dropped an item would otherwise pass "it rendered". */
    for (const item of probe(kind).items) {
      expect(
        svg.querySelectorAll(`[data-item="${item.id}"]`).length,
        `${kind} drew nothing for item ${item.id}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('the honest failure — never a blank box', () => {
  it('refuses a spec with no items and prints the problem', () => {
    render(<SeqChartView chart={{ version: 1, kind: 'bar', title: 'Empty', items: [] }} />);
    const fail = screen.getByTestId('seqchart-fail');
    expect(fail.textContent).toMatch(/could not be rendered/i);
    expect(fail.textContent).toMatch(/items must be non-empty/i);
    expect(screen.queryByTestId('seqchart')).toBeNull();
    expect(screen.queryByTestId('seqchart-svg')).toBeNull();
  });

  it('refuses a kind outside the forty-five', () => {
    const rogue = { version: 1, kind: 'pie-of-pie', title: 'Nope', items: [{ id: 'a', label: 'A' }] };
    render(<SeqChartView chart={rogue as unknown as SeqChart} />);
    expect(screen.getByTestId('seqchart-fail').textContent).toMatch(/45 known chart kinds/i);
  });

  it('refuses a title-less spec rather than drawing an untitled picture', () => {
    render(<SeqChartView chart={{ version: 1, kind: 'bar', title: '   ', items: [{ id: 'a', label: 'A', value: 1 }] }} />);
    expect(screen.getByTestId('seqchart-fail').textContent).toMatch(/title is required/i);
  });

  it('REFUSES A CHART THAT NAMES A NODE THIS REPOSITORY DOES NOT HAVE', () => {
    /* The whole reason the model emits data instead of code. A chart claiming
       repo structure is checked against the scanned graph before it is drawn. */
    const chart: SeqChart = {
      version: 1,
      kind: 'system-architecture',
      title: 'Invented structure',
      items: [
        { id: 'real', label: 'analyzer', nodeId: 'pkg:analyzer' },
        { id: 'fake', label: 'billing service', nodeId: 'pkg:billing' },
      ],
    };
    render(<SeqChartView chart={chart} knownNodeIds={new Set(['pkg:analyzer'])} />);
    const fail = screen.getByTestId('seqchart-fail');
    expect(fail.textContent).toMatch(/pkg:billing/);
    expect(fail.textContent).toMatch(/may not invent structure/i);
  });

  it('draws the same chart once the node set contains it', () => {
    const chart: SeqChart = {
      version: 1,
      kind: 'system-architecture',
      title: 'Grounded structure',
      items: [{ id: 'real', label: 'analyzer', nodeId: 'pkg:analyzer' }],
    };
    render(<SeqChartView chart={chart} knownNodeIds={new Set(['pkg:analyzer'])} />);
    expect(screen.queryByTestId('seqchart-fail')).toBeNull();
    expect(screen.getByTestId('seqchart-svg').querySelector('[data-node-id="pkg:analyzer"]')).not.toBeNull();
  });
});

describe('focusItemId — the teach-mode spotlight', () => {
  const chart: SeqChart = { ...CHART_FIXTURES['node-link'], focusItemId: 'web2' };

  it('marks exactly one item focused and every other one dimmed', () => {
    render(<SeqChartView chart={chart} />);
    const svg = screen.getByTestId('seqchart-svg');
    const focused = svg.querySelector('[data-item="web2"]');
    expect(focused?.getAttribute('data-focused')).toBe('true');
    expect(focused?.getAttribute('data-dim')).toBe('false');

    const others = chart.items.filter((it) => it.id !== 'web2');
    for (const item of others) {
      const node = svg.querySelector(`[data-item="${item.id}"]`);
      expect(node?.getAttribute('data-dim'), `${item.id} should be dimmed`).toBe('true');
      expect(node?.getAttribute('data-focused')).toBe('false');
    }
  });

  it('turns the dim rule on at the figure, so an unfocused chart dims nothing', () => {
    const { rerender } = render(<SeqChartView chart={chart} />);
    expect(screen.getByTestId('seqchart').getAttribute('data-focus')).toBe('on');
    rerender(<SeqChartView chart={CHART_FIXTURES['node-link']} />);
    expect(screen.getByTestId('seqchart').getAttribute('data-focus')).toBe('off');
    const dimmed = screen
      .getByTestId('seqchart-svg')
      .querySelectorAll('[data-dim="true"]');
    expect(dimmed.length).toBe(0);
  });

  it('keeps a connector touching the focused item at full strength', () => {
    render(<SeqChartView chart={chart} />);
    const edges = screen.getByTestId('seqchart-edges');
    const touching = edges.querySelector('[data-item="analyzer->web2"]');
    expect(touching?.getAttribute('data-dim')).toBe('false');
    const away = edges.querySelector('[data-item="schema->acp"]');
    expect(away?.getAttribute('data-dim')).toBe('true');
  });

  it('refuses a focusItemId that names no item', () => {
    render(<SeqChartView chart={{ ...CHART_FIXTURES.cards, focusItemId: 'nope' }} />);
    /* The offending value, quoted -- validateChart now quotes it and appends the
       admissible set, because a refusal that names the bad value and not the
       good ones made the model guess the same way twice (schema/chart.ts). The
       assertion tracks that change rather than being loosened around it: the
       id must still be named, AND the reader must now be told what WOULD have
       worked. */
    const failText = screen.getByTestId('seqchart-fail').textContent ?? '';
    expect(failText).toMatch(/unknown item "nope"/i);
    expect(failText).toMatch(/known items:/i);
  });
});

describe('accessibility and containment', () => {
  it('names the drawing from the title, the caption and the item count', () => {
    render(<SeqChartView chart={CHART_FIXTURES.quantitative} />);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain(CHART_FIXTURES.quantitative.title);
    expect(label).toContain('Declared edges are config claims');
    expect(label).toContain('4 items');
  });

  it('says which item is focused in the accessible name', () => {
    render(<SeqChartView chart={{ ...CHART_FIXTURES['node-link'], focusItemId: 'web2' }} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/focused on web2/);
  });

  it('keeps the title and caption as real text beside the drawing', () => {
    render(<SeqChartView chart={CHART_FIXTURES.flow} />);
    expect(screen.getByTestId('seqchart-title').textContent).toBe(CHART_FIXTURES.flow.title);
    expect(screen.getByTestId('seqchart-cap').textContent).toBe(CHART_FIXTURES.flow.caption);
  });

  it('owns its own scroller so a wide chart never moves the page', () => {
    render(<SeqChartView chart={CHART_FIXTURES.flow} />);
    const scroll = screen.getByTestId('seqchart-scroll');
    expect(scroll.contains(screen.getByTestId('seqchart-svg'))).toBe(true);
    /* The svg carries an intrinsic width; the overflow belongs to the box
       around it, which is what stops the transcript growing sideways. */
    expect(Number(screen.getByTestId('seqchart-svg').getAttribute('width'))).toBeGreaterThan(0);
  });

  it('says out loud that an annotated interface is standing in as a node-link map', () => {
    render(<SeqChartView chart={CHART_FIXTURES.annotated} />);
    expect(screen.getByTestId('seqchart-note').textContent).toMatch(/pinned coordinates/i);
  });
});

describe('determinism — same spec, same pixels', () => {
  it.each(Object.keys(CHART_FIXTURES).map((family) => [family] as const))(
    'renders %s byte-identically twice',
    (family) => {
      const chart = CHART_FIXTURES[family as keyof typeof CHART_FIXTURES];
      const first = render(<SeqChartView chart={chart} />).container.innerHTML;
      const second = render(<SeqChartView chart={chart} />).container.innerHTML;
      expect(second).toBe(first);
    },
  );
});
