import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChartFamily, SeqChart } from '@sequence/schema';
import { chartFamily } from '@sequence/schema';

import { SeqChartView } from './SeqChartView.js';
import { ALL_FIXTURES, CHART_FIXTURES, VARIANT_FIXTURES } from './chartFixtures.js';
import { assignLayers, fitText, placeLayered } from './chartLayout.js';

/**
 * ONE FIXTURE PER FAMILY, RENDERED AND MEASURED.
 *
 * "It rendered" is the weakest possible assertion and it is the one that let
 * the cream canvas ship through two rounds. So each family is also asked for
 * the mark it is supposed to draw: a swimlane has lanes, a donut has arcs, a
 * pyramid tapers, a scorecard has tracks. A renderer that produced an empty
 * <svg> would pass a smoke test and fail every check below.
 */

function draw(chart: SeqChart) {
  const view = render(<SeqChartView chart={chart} />);
  const fail = view.container.querySelector('[data-testid="seqchart-fail"]');
  expect(fail, `refused: ${fail?.textContent ?? ''}`).toBeNull();
  const svg = view.container.querySelector('[data-testid="seqchart-svg"]');
  expect(svg).not.toBeNull();
  return svg as SVGSVGElement;
}

describe('every family draws its fixture', () => {
  const families = Object.keys(CHART_FIXTURES) as ChartFamily[];

  it.each(families.map((f) => [f] as const))('%s renders marks for every item', (family) => {
    const chart = CHART_FIXTURES[family];
    const svg = draw(chart);
    expect(svg.querySelectorAll('[data-item]').length).toBeGreaterThanOrEqual(chart.items.length);
    /* Something visible, not just groups: a chart of empty <g> elements is a
       blank box with structure. */
    expect(svg.querySelectorAll('rect, circle, path, polyline, polygon, line').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('text').length).toBeGreaterThan(0);
    expect(chartFamily(chart.kind)).toBe(family);
  });

  it.each(VARIANT_FIXTURES.map((chart) => [chart.kind, chart] as const))(
    'the %s arrangement renders',
    (_kind, chart) => {
      const svg = draw(chart);
      expect(svg.querySelectorAll('[data-item]').length).toBeGreaterThan(0);
    },
  );

  it('has a fixture whose viewBox is real for every one of them', () => {
    for (const chart of ALL_FIXTURES) {
      const svg = draw(chart);
      const [, , w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      expect(w, `${chart.kind} has no width`).toBeGreaterThan(0);
      expect(h, `${chart.kind} has no height`).toBeGreaterThan(0);
    }
  });
});

describe('the arrangement each family actually chose', () => {
  it('draws a lane per swimlane group, in the authored order', () => {
    const svg = draw(CHART_FIXTURES.flow);
    const lanes = [...svg.querySelectorAll('[data-lane]')].map((n) => n.getAttribute('data-lane'));
    expect(lanes).toEqual(['browser', 'gateway', 'worker']);
  });

  it('gives a sankey link its weight as a stroke width THAT ACTUALLY PAINTS', () => {
    /*
     * LOCKING TEST FOR A GREEN-BUT-WRONG DEFECT. The first cut set
     * `strokeWidth={n}` as a presentation attribute; charts.css sets
     * `.cedge { stroke-width: var(--w-edge) }`, and ANY author stylesheet rule
     * outranks a presentation attribute. Every ribbon painted identically
     * while an attribute-reading test passed. So this reads the INLINE STYLE,
     * which is the only form that wins, and fails if anyone moves it back.
     */
    const sankey = VARIANT_FIXTURES.find((c) => c.kind === 'sankey') as SeqChart;
    const svg = draw(sankey);
    const paths = [...svg.querySelectorAll('path.cedge')] as SVGPathElement[];
    expect(paths.length).toBe(4);
    for (const path of paths) {
      expect(path.getAttribute('stroke-width'), 'a presentation attribute cannot beat the class rule').toBeNull();
    }
    const widths = paths.map((p) => Number.parseFloat(p.style.strokeWidth));
    expect(widths.every((w) => w > 0)).toBe(true);
    /* 241 and 55 are different numbers and have to paint as different ribbons. */
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  it('gives every donut slice its own series hue so two greys cannot merge', () => {
    const donut = VARIANT_FIXTURES.find((c) => c.kind === 'donut') as SeqChart;
    const svg = draw(donut);
    const arcs = [...svg.querySelectorAll('path.carc')];
    const series = arcs.map((n) => (n.getAttribute('class') ?? '').match(/\bs-\d\b/)?.[0]);
    expect(series.length).toBe(donut.items.length);
    expect(new Set(series).size).toBe(donut.items.length);
    /* The one toned slice opts out of the series ramp and takes its verdict. */
    const toned = arcs.filter((n) => (n.getAttribute('class') ?? '').includes('toned'));
    expect(toned.length).toBe(donut.items.filter((it) => it.tone).length);
  });

  it('tapers a pyramid by position and never by value', () => {
    const pyramid = VARIANT_FIXTURES.find((c) => c.kind === 'pyramid') as SeqChart;
    const svg = draw(pyramid);
    const widths = [...svg.querySelectorAll('rect.cbox')].map((n) => Number(n.getAttribute('width')));
    expect(widths.length).toBe(3);
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
  });

  it('draws a hierarchy with links as a tree, one box per item', () => {
    const svg = draw(CHART_FIXTURES.hierarchy);
    expect(svg.querySelectorAll('rect.cbox').length).toBe(CHART_FIXTURES.hierarchy.items.length);
    expect(svg.querySelectorAll('path.cedge').length).toBe(CHART_FIXTURES.hierarchy.links?.length);
  });

  it('draws one ring segment per donut item and a key beside it', () => {
    const donut = VARIANT_FIXTURES.find((c) => c.kind === 'donut') as SeqChart;
    const svg = draw(donut);
    expect(svg.querySelectorAll('path.carc').length).toBe(donut.items.length);
    expect(svg.querySelectorAll('text.clabel').length).toBe(donut.items.length);
  });

  it('PAINTS A FULL RING FOR A SINGLE 100% SLICE — not an empty arc', () => {
    /*
     * LOCKING TEST FOR THE MEDIUM-SEVERITY DEFECT. A slice spanning the whole
     * 360° has coincident start and end points, and an SVG arc with coincident
     * endpoints draws nothing — so a one-item donut with total > 0 came out
     * blank. The full case renders a closed annulus instead, which always has
     * a real `d`.
     */
    const one: SeqChart = {
      version: 1,
      kind: 'donut',
      title: 'One thing, all of it',
      items: [{ id: 'only', label: 'everything', value: 42 }],
    };
    const svg = draw(one);
    const arc = svg.querySelector('path.carc');
    expect(arc, 'the sole 100% slice must draw').not.toBeNull();
    const d = arc?.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(0);
    expect(d).toMatch(/A/); // it is an arc-based ring, not a collapsed point
    /* A closed annulus is two subpaths, so it carries two Z commands — the mark
       of a real ring with a punched hole rather than a single wedge. */
    expect((d.match(/Z/g) ?? []).length).toBe(2);

    /* The same defect fires when one item is 100% because the others are zero. */
    const dominant: SeqChart = {
      version: 1,
      kind: 'donut',
      title: 'One real value among zeros',
      items: [
        { id: 'all', label: 'measured', value: 10 },
        { id: 'none', label: 'unmeasured', value: 0 },
      ],
    };
    const svg2 = draw(dominant);
    const full = [...svg2.querySelectorAll('path.carc')].find(
      (p) => (p.getAttribute('d')?.match(/Z/g) ?? []).length === 2,
    );
    expect(full, 'the dominant slice must render as a closed ring').toBeTruthy();
  });

  it('refuses to paint a plausible ring when no value is positive', () => {
    const view = render(
      <SeqChartView
        chart={{
          version: 1,
          kind: 'donut',
          title: 'Nothing measured',
          items: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        }}
      />,
    );
    expect(view.container.querySelector('[data-testid="seqchart-note"]')?.textContent).toMatch(
      /no share can be drawn/i,
    );
    expect(view.container.querySelectorAll('path.carc').length).toBe(0);
  });

  it('draws one line per series on a multi-series line chart', () => {
    const line = VARIANT_FIXTURES.find((c) => c.kind === 'line') as SeqChart;
    const svg = draw(line);
    const series = [...svg.querySelectorAll('polyline')].map((n) => n.getAttribute('data-series'));
    expect(series).toEqual(['unit', 'e2e']);
  });

  it('gives a heat cell an opacity that follows its value', () => {
    const heat = VARIANT_FIXTURES.find((c) => c.kind === 'heat-map') as SeqChart;
    const svg = draw(heat);
    const cells = [...svg.querySelectorAll('rect.cheat')];
    expect(cells.length).toBe(heat.items.length);
    const opacities = cells.map((n) => Number(n.getAttribute('fill-opacity')));
    expect(Math.max(...opacities)).toBeGreaterThan(Math.min(...opacities));
  });

  it('places quadrant items in the cell their group names', () => {
    const quadrant = VARIANT_FIXTURES.find((c) => c.kind === 'quadrant') as SeqChart;
    const svg = draw(quadrant);
    const cells = [...svg.querySelectorAll('[data-quadrant]')];
    expect(cells.map((n) => n.getAttribute('data-quadrant'))).toEqual([
      'do now',
      'ask first',
      'later',
      'drop',
    ]);
    expect(cells[0].querySelectorAll('[data-item]').length).toBe(2);
    expect(cells[3].querySelectorAll('[data-item]').length).toBe(1);
  });

  it('draws one circle per venn set and says the overlap cannot be filled', () => {
    const venn = VARIANT_FIXTURES.find((c) => c.kind === 'venn') as SeqChart;
    const view = render(<SeqChartView chart={venn} />);
    expect(view.container.querySelectorAll('circle.cvenn').length).toBe(2);
    /* An item carries one `group`, so the lens where the circles cross can
       never hold anything. An empty lens the reader is not warned about reads
       as "nothing is shared" — a claim the spec never made. */
    expect(view.container.querySelector('[data-testid="seqchart-note"]')?.textContent).toMatch(
      /cannot say "in both sets"/i,
    );
  });

  it('gives a scorecard a track behind every bar', () => {
    const score = VARIANT_FIXTURES.find((c) => c.kind === 'scorecard') as SeqChart;
    const svg = draw(score);
    expect(svg.querySelectorAll('rect.cbar-track').length).toBe(score.items.length);
  });

  it('closes a flywheel: one arc for every step, back to the first', () => {
    const svg = draw(CHART_FIXTURES.loop);
    const arcs = svg.querySelectorAll('path.cedge');
    expect(arcs.length).toBe(CHART_FIXTURES.loop.items.length);
  });

  it('DIMS A FLYWHEEL ARC THAT DOES NOT TOUCH THE FOCUSED STEP', () => {
    /*
     * LOCKING TEST FOR THE LOW-SEVERITY DEFECT. The arcs were emitted with a
     * hardcoded data-dim="false", so in teach mode the boxes receded while
     * every arrow stayed lit. Dimming now follows the endpoints, as EdgeLayer
     * already does it.
     */
    const focused: SeqChart = { ...CHART_FIXTURES.loop, focusItemId: 'ask' };
    const svg = draw(focused);
    /* The ring is scan→graph→ask→ground→edit→scan. */
    const away = svg.querySelector('[data-item="scan->graph"]');
    expect(away?.getAttribute('data-dim'), 'an arc away from focus should recede').toBe('true');
    const touching = svg.querySelector('[data-item="graph->ask"]');
    expect(touching?.getAttribute('data-dim'), 'an arc into the focused step stays lit').toBe('false');

    /* And with no focus, nothing on the ring dims. */
    const svgPlain = draw(CHART_FIXTURES.loop);
    expect(svgPlain.querySelectorAll('.cedges [data-dim="true"]').length).toBe(0);
  });

  it('uses the authored arms of a feedback loop rather than the ring order', () => {
    const loop = VARIANT_FIXTURES.find((c) => c.kind === 'feedback-loop') as SeqChart;
    const svg = draw(loop);
    const balancing = svg.querySelector('[data-item="trust->rescan"] path');
    expect(balancing?.getAttribute('class')).toContain('t-good');
  });

  it('lays gantt bars end to end, widths in proportion to their durations', () => {
    const gantt = VARIANT_FIXTURES.find((c) => c.kind === 'gantt') as SeqChart;
    const svg = draw(gantt);
    const bars = [...svg.querySelectorAll('rect.cbar')];
    expect(bars.length).toBe(gantt.items.length);
    const widths = bars.map((n) => Number(n.getAttribute('width')));
    /* 26 tenths is the longest phase and 3 the shortest. */
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 3);
    const xs = bars.map((n) => Number(n.getAttribute('x')));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('carries the tone of a claim and not of a column', () => {
    const svg = draw(CHART_FIXTURES.comparison);
    const good = svg.querySelector('[data-item="p1"]')?.getAttribute('class') ?? '';
    const warn = svg.querySelector('[data-item="p4"]')?.getAttribute('class') ?? '';
    expect(good).toContain('t-good');
    /* Same column, different tone — proof the hue came from the item. */
    expect(warn).toContain('t-warn');
  });

  it('leaves an untoned item neutral rather than inventing a hue for it', () => {
    const svg = draw(CHART_FIXTURES.loop);
    expect(svg.querySelector('[data-item="scan"]')?.getAttribute('class')).toContain('t-neutral');
  });
});

describe('the layout core', () => {
  it('terminates on a cycle and keeps every item', () => {
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];
    const links = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ];
    const layers = assignLayers(items, links);
    expect(layers.flat().map((it) => it.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('BOUNDS THE LAYER COUNT ON A CYCLE — no runaway width, no empty columns', () => {
    /*
     * LOCKING TEST FOR THE HIGH-SEVERITY DEFECT. The first cut relaxed over
     * every edge n times, so a→b→c→a reached depth 6-9 and the chart painted
     * that many columns wide with most of them empty. A DAG has at most n − 1
     * layers and no interior gaps, which is exactly what breaking the back edge
     * before layering guarantees.
     */
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];
    const cyclic = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ];
    const layers = assignLayers(items, cyclic);
    expect(layers.length).toBeLessThanOrEqual(items.length);
    expect(layers.every((layer) => layer.length > 0), 'no empty layer column').toBe(true);

    /* A five-node ring is still five columns at most, not fifteen. */
    const ring = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
    const ringLinks = ring.map((_, i) => ({ from: `n${i}`, to: `n${(i + 1) % 5}` }));
    const ringLayers = assignLayers(ring, ringLinks);
    expect(ringLayers.length).toBeLessThanOrEqual(ring.length);
    expect(ringLayers.every((layer) => layer.length > 0)).toBe(true);

    /* And the width the placement reports is bounded — the symptom the owner
       would actually see, proven against the box coordinates rather than the
       layer array. */
    const wide = placeLayered(assignLayers(items, cyclic)).width;
    const straight = placeLayered(assignLayers(items, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).width;
    expect(wide).toBeLessThanOrEqual(straight);
  });

  it('produces the same layers and the same boxes on repeated calls', () => {
    const chart = CHART_FIXTURES['node-link'];
    const first = placeLayered(assignLayers(chart.items, chart.links));
    const second = placeLayered(assignLayers(chart.items, chart.links));
    expect(JSON.stringify(second.nodes)).toBe(JSON.stringify(first.nodes));
    expect([second.width, second.height]).toEqual([first.width, first.height]);
  });

  it('truncates inside the box rather than overflowing it', () => {
    const long = 'a very long service name that cannot possibly fit in one box';
    const cut = fitText(long, 120);
    expect(cut.length).toBeLessThan(long.length);
    expect(cut.endsWith('…')).toBe(true);
    expect(fitText('short', 120)).toBe('short');
  });

  it('separates every layer of a link chain', () => {
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ];
    const layers = assignLayers(items, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);
    expect(layers.map((l) => l.map((it) => it.id))).toEqual([['a'], ['b'], ['c']]);
  });
});
