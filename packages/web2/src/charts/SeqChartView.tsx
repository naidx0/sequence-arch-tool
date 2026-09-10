/* ══════════════════════════════════════════════════════════════════════════
   SEQ-CHART — THE ENTRY POINT
   packages/web2/src/charts/SeqChartView.tsx

   ONE COMPONENT, FORTY-FIVE NAMES, EIGHT RENDERERS. packages/schema/src/chart.ts
   owns the vocabulary and the mapping; this file owns the pixels and nothing
   else. Everything a caller needs is `<SeqChartView chart={spec} />`.

   THE DISPATCH TABLE IS A Record<ChartFamily, …>, NOT A switch.
   A switch with a default arm is a dispatch gap that compiles: add a family to
   chart.ts and the default arm silently swallows it, which is how a new kind
   ships as a blank box. A total record cannot — the day a ninth family is added
   to ChartFamily, this file stops building until it is drawn. The test that
   walks all forty-five CHART_KINDS is the second half of the same guarantee,
   because a kind can also go missing from chart.ts's own FAMILY_OF map.

   NOTHING IS EVER A BLANK BOX. Three separate things can go wrong and each one
   says so in place, in words, with the reason attached:

     1. THE SPEC IS INVALID — validateChart refuses it, and its problems are
        printed. This is the load-bearing one: chart.ts's first reason for the
        whole contract is that "a chart that CLAIMS repo structure must be
        checkable", and a caller that passes `knownNodeIds` gets exactly that —
        an item naming a node that is not in the scanned graph REFUSES rather
        than draws. A picture that fabricates is worse than prose that
        fabricates, because a picture is believed faster.
     2. THE KIND IS UNKNOWN — a name outside the forty-five, which is what a
        model typo looks like from here.
     3. THE RENDERER THREW — a bug in this package. It is caught rather than
        allowed to unmount the whole transcript around it, and it is REPORTED
        as a bug rather than dressed up as a data problem.

   The refusal is not a toast and not a console line. It renders where the chart
   would have been, because that is the only place the person who can fix it
   will look.
   ══════════════════════════════════════════════════════════════════════════ */

import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

import type { ChartFamily, ChartProblem, SeqChart } from '@sequence/schema';
import { chartFamily, validateChart } from '@sequence/schema';

import { CardsChart } from './CardsChart.js';
import type { FamilyChartProps } from './ChartFrame.js';
import { ComparisonChart } from './ComparisonChart.js';
import { FlowChart } from './FlowChart.js';
import { HierarchyChart } from './HierarchyChart.js';
import { LoopChart } from './LoopChart.js';
import { NodeLinkChart } from './NodeLinkChart.js';
import { QuantitativeChart } from './QuantitativeChart.js';
import { TimelineChart } from './TimelineChart.js';

import './charts.css';

/**
 * `annotated` has no renderer of its own yet and falls back to node-link WITH
 * THE NOTE PRINTED ON THE CHART. An annotated-interface is a screenshot with
 * callouts pinned to coordinates, and ChartItem carries no coordinates — so
 * there is nothing to pin to, and a fallback that stayed quiet about it would
 * be claiming the picture is what was asked for. The note is the difference
 * between a stand-in and a lie.
 */
const FALLBACK_NOTE: Partial<Record<ChartFamily, string>> = {
  annotated: 'drawn as a node-link map: an annotated interface needs pinned coordinates, which this spec has no field for',
};

/** Total by construction. A new family cannot be added without a renderer. */
export const FAMILY_RENDERERS: Record<ChartFamily, ComponentType<FamilyChartProps>> = {
  'node-link': NodeLinkChart,
  flow: FlowChart,
  hierarchy: HierarchyChart,
  timeline: TimelineChart,
  quantitative: QuantitativeChart,
  comparison: ComparisonChart,
  cards: CardsChart,
  loop: LoopChart,
  annotated: NodeLinkChart,
};

export interface SeqChartViewProps {
  chart: SeqChart;
  /**
   * The node ids in the scanned graph. Supply it and a chart that names a node
   * this repository does not have is REFUSED rather than drawn — the grounding
   * check chart.ts's validator exists for. Omit it and only the spec's internal
   * consistency is checked.
   */
  knownNodeIds?: ReadonlySet<string>;
}

export function SeqChartView({ chart, knownNodeIds }: SeqChartViewProps) {
  const verdict = validateChart(chart, knownNodeIds);
  if (!verdict.ok) {
    return <ChartRefusal reason="the spec did not validate" problems={verdict.problems} />;
  }

  const family = chartFamily(verdict.chart.kind);
  const Renderer = FAMILY_RENDERERS[family];
  if (!Renderer) {
    /* Unreachable while chart.ts's FAMILY_OF is total, and kept because "should
       be unreachable" is exactly what the blank box always was. */
    return (
      <ChartRefusal
        reason={`no renderer is registered for the "${family}" family`}
        problems={[{ path: 'kind', message: `kind "${verdict.chart.kind}" maps to an undrawn family` }]}
      />
    );
  }

  return (
    <ChartBoundary chart={verdict.chart}>
      <Renderer chart={verdict.chart} note={FALLBACK_NOTE[family]} />
    </ChartBoundary>
  );
}

/* ─────────────────────────────────────────────────────────────── refusal ── */

export interface ChartRefusalProps {
  reason: string;
  problems?: readonly ChartProblem[];
}

export function ChartRefusal({ reason, problems = [] }: ChartRefusalProps) {
  return (
    <div className="seqchart-fail" data-testid="seqchart-fail" role="note">
      <span className="seqchart-fail-hd">this chart could not be rendered: {reason}</span>
      {problems.length > 0 ? (
        <ul className="seqchart-fail-list" data-testid="seqchart-fail-list">
          {problems.map((problem, i) => (
            <li key={`${problem.path}-${i}`}>
              {problem.path ? `${problem.path}: ` : ''}
              {problem.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── boundary ── */

interface BoundaryProps {
  chart: SeqChart;
  children: ReactNode;
}

interface BoundaryState {
  failure: string | null;
}

/**
 * A throw inside one chart must not take the transcript with it.
 *
 * React unmounts the WHOLE tree on an uncaught render error, so without this a
 * single malformed spec — one that got past the validator because the validator
 * does not know what a renderer needs — would blank the entire chat column and
 * leave nothing on screen to say why. The boundary keeps the damage the size of
 * the chart and prints the error where the chart was.
 */
class ChartBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failure: null };
  }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failure: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* Kept out of the rendered text: a component stack is for whoever is
       reading the console, not for the person reading the lesson. */
    // eslint-disable-next-line no-console
    console.error('[seqchart] renderer threw', this.props.chart.kind, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.failure !== null) {
      return (
        <ChartRefusal
          reason={`the ${this.props.chart.kind} renderer threw`}
          problems={[{ path: '', message: this.state.failure }]}
        />
      );
    }
    return this.props.children;
  }
}
