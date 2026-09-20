/* ══════════════════════════════════════════════════════════════════════════
   FLOW — eight kinds, one renderer, three arrangements
   packages/web2/src/charts/FlowChart.tsx

   data-flow · information-flow · user-flow · code-to-outcome · how-it-works ·
   incident-reconstruction · swimlane · sankey

   A flow is a node-link chart that has committed to a DIRECTION, and the three
   arrangements below are the three things a spec can additionally say:

     plain     nothing extra              layered left to right, arrowheads on
     lanes     items carry `group`        one band per lane, order authored
     sankey    links carry `value`        ribbon width IS the number

   THE LANE ORDER COMES FROM `axes.lanes` AND IS NOT SORTED. An incident
   reconstruction reads "browser → gateway → worker → store" because someone
   chose that order; re-sorting it alphabetically would rewrite the story into
   one nobody told.

   SANKEY DRAWS THE WEIGHT AS A STROKE WIDTH, WHICH IS THE ONE PLACE THIS
   RENDERER OVERRIDES A TOKEN. --w-edge and --w-flow are chrome weights, and a
   sankey's ribbon is not chrome — it is the datum. A link with no value gets
   the thinnest ribbon and is NOT silently promoted to the average: an unstated
   number stays unstated.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, SeqChart } from '@sequence/schema';

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { Caption, EdgeLayer, NodeBox } from './ChartPrimitives.js';
import {
  GAP_X,
  GAP_Y,
  type LaidEdge,
  type LaidNode,
  NODE_H,
  NODE_W,
  PAD,
  assignLayers,
  edgePath,
  fitText,
  groupKeys,
  laidEdges,
  placeLayered,
  r,
  toneClass,
} from './chartLayout.js';

/** Room for the lane names on the left. Wide enough for a two-word service. */
const LANE_GUTTER = 104;
/** The lane caption strip above the first band. */
const LANE_HEAD = 20;
/** Thinnest and thickest sankey ribbon. */
const RIBBON_MIN = 2;
const RIBBON_MAX = 16;

export function FlowChart({ chart, note }: FamilyChartProps) {
  const laneKeys = laneKeysOf(chart);
  if (laneKeys) return <LaneFlow chart={chart} note={note} laneKeys={laneKeys} />;
  return <StraightFlow chart={chart} note={note} />;
}

/**
 * Lanes only when the spec actually says so.
 *
 * A `group` on a data-flow item may be a series, a stage or a subsystem, and
 * turning any of them into a swimlane would invent a structure. Lanes are drawn
 * when the kind is `swimlane`, or when the author named the lanes outright.
 */
function laneKeysOf(chart: SeqChart): string[] | null {
  const declared = chart.axes?.lanes;
  if (declared && declared.length > 0) return groupKeys(chart.items, declared);
  if (chart.kind !== 'swimlane') return null;
  const keys = groupKeys(chart.items);
  return keys.length > 1 || keys[0] !== '' ? keys : null;
}

/* ─────────────────────────────────────────────────────────────── plain ── */

/*
 * ── FIT A CHART THAT WOULD OTHERWISE BE CLIPPED ───────────────────────────
 *
 * `ChartFrame` owns a horizontal scroll, and its rule 2 is right: a twelve-layer
 * flow cannot be honestly shrunk into a chat column. But a THREE-layer concept
 * chart is not that. At the defaults it measures
 * `PAD*2 + 3*NODE_W + 2*GAP_X = 616`, and the AI Canvas gives it 440 — so the
 * outbound node sat past the clip, and the picture read as an arrow leaving
 * `brief.ts` and ending in nothing. Every box was drawn and reachable by
 * scrolling; nobody scrolls a screenshot, and a reader who does not scroll sees
 * a broken diagram.
 *
 * So: close the gaps first, then narrow the boxes, and only as far as a floor
 * that keeps a truncated filename readable. A chart that still does not fit is
 * left to the scroll, which is what the scroll is for. NODE_W itself is not
 * touched — it is "half a board card wide" on purpose, so a chart beside the
 * board does not read as a second board, and that reason holds for every chart
 * that already fits.
 */
const FIT_W = 440;
const GAP_X_MIN = 20;
const NODE_W_MIN = 120;

function fitOptions(layerCount: number): { gapX?: number; nodeW?: number } {
  const width = (nodeW: number, gapX: number) =>
    PAD * 2 + layerCount * nodeW + Math.max(0, layerCount - 1) * gapX;
  if (layerCount < 2 || width(NODE_W, GAP_X) <= FIT_W) return {};
  for (const gapX of [GAP_X, 40, 28, GAP_X_MIN]) {
    for (const nodeW of [NODE_W, 140, 130, NODE_W_MIN]) {
      if (width(nodeW, gapX) <= FIT_W) return { gapX, nodeW };
    }
  }
  /* Past the floor the scroll owns it, as designed. */
  return { gapX: GAP_X_MIN, nodeW: NODE_W_MIN };
}

function StraightFlow({ chart, note }: FamilyChartProps) {
  const layers = assignLayers(chart.items, chart.links);
  const placement = placeLayered(layers, fitOptions(layers.length));
  const edges = laidEdges(chart.links, placement.byId);
  const sankey = chart.kind === 'sankey';

  return (
    <ChartFrame chart={chart} width={placement.width} height={placement.height} note={note}>
      {sankey ? (
        <Ribbons edges={edges} focusItemId={chart.focusItemId} />
      ) : (
        <EdgeLayer edges={edges} orientation="horizontal" directed focusItemId={chart.focusItemId} />
      )}
      {placement.nodes.map((node) => (
        <NodeBox key={node.item.id} node={node} focusItemId={chart.focusItemId} />
      ))}
    </ChartFrame>
  );
}

/* ─────────────────────────────────────────────────────────────── lanes ── */

function LaneFlow({ chart, note, laneKeys }: FamilyChartProps & { laneKeys: string[] }) {
  const layers = assignLayers(chart.items, chart.links);
  const layerOf = new Map<string, number>();
  layers.forEach((layer, k) => layer.forEach((it) => layerOf.set(it.id, k)));

  /* Cell = (lane, layer). Two items in the same cell stack, so a lane that
     does three things at one step draws three boxes rather than one on top of
     another. The tallest cell sets the band height for its lane. */
  const laneIndex = new Map<string, number>();
  laneKeys.forEach((key, i) => laneIndex.set(key, i));
  const cells = new Map<string, ChartItem[]>();
  for (const item of chart.items) {
    const lane = laneIndex.has(item.group ?? '') ? (item.group ?? '') : laneKeys[0];
    const key = `${lane}|${layerOf.get(item.id) ?? 0}`;
    const list = cells.get(key);
    if (list) list.push(item);
    else cells.set(key, [item]);
  }

  const laneRows = laneKeys.map((lane) => {
    let tallest = 1;
    for (let k = 0; k < layers.length; k += 1) {
      tallest = Math.max(tallest, cells.get(`${lane}|${k}`)?.length ?? 0);
    }
    return tallest;
  });
  const laneHeights = laneRows.map((rows) => rows * NODE_H + (rows + 1) * GAP_Y);
  const laneTops: number[] = [];
  let cursor = PAD + LANE_HEAD;
  for (const height of laneHeights) {
    laneTops.push(cursor);
    cursor += height;
  }

  const nodes: LaidNode[] = [];
  const byId = new Map<string, LaidNode>();
  for (const [key, items] of cells) {
    const [lane, layerText] = key.split('|');
    const k = Number(layerText);
    const top = laneTops[laneIndex.get(lane) ?? 0];
    items.forEach((item, j) => {
      const node: LaidNode = {
        item,
        layer: k,
        x: PAD + LANE_GUTTER + k * (NODE_W + GAP_X),
        y: top + GAP_Y + j * (NODE_H + GAP_Y),
        w: NODE_W,
        h: NODE_H,
      };
      nodes.push(node);
      byId.set(item.id, node);
    });
  }
  /* Draw order is the SPEC's order, not the map's insertion order, so two runs
     of the same chart emit the same element sequence. */
  nodes.sort(
    (a, b) =>
      chart.items.findIndex((it) => it.id === a.item.id) -
      chart.items.findIndex((it) => it.id === b.item.id),
  );

  const edges = laidEdges(chart.links, byId);
  const width = PAD * 2 + LANE_GUTTER + layers.length * NODE_W + Math.max(0, layers.length - 1) * GAP_X;
  const height = cursor + PAD;

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      <g className="clanes" data-testid="seqchart-lanes">
        {laneKeys.map((lane, i) => (
          <g key={lane || `lane-${i}`} data-lane={lane}>
            <rect
              className={i % 2 === 0 ? 'clane' : 'clane-alt'}
              x={PAD}
              y={r(laneTops[i])}
              width={r(width - PAD * 2)}
              height={r(laneHeights[i])}
            />
            <Caption x={PAD + 8} y={r(laneTops[i] + 16)} text={fitText(lane || 'unassigned', LANE_GUTTER)} />
          </g>
        ))}
      </g>
      <EdgeLayer edges={edges} orientation="horizontal" directed focusItemId={chart.focusItemId} />
      {nodes.map((node) => (
        <NodeBox key={node.item.id} node={node} focusItemId={chart.focusItemId} />
      ))}
    </ChartFrame>
  );
}

/* ────────────────────────────────────────────────────────────── sankey ── */

function Ribbons({ edges, focusItemId }: { edges: readonly LaidEdge[]; focusItemId?: string }) {
  const values = edges.map((e) => (Number.isFinite(e.link.value) ? (e.link.value as number) : 0));
  const top = Math.max(...values, 0);
  const scale = (value: number): number => {
    if (top <= 0) return RIBBON_MIN;
    return RIBBON_MIN + (RIBBON_MAX - RIBBON_MIN) * (Math.max(value, 0) / top);
  };

  return (
    <g className="cedges" data-testid="seqchart-edges">
      {edges.map((edge, i) => {
        const dim =
          focusItemId !== undefined &&
          edge.from.item.id !== focusItemId &&
          edge.to.item.id !== focusItemId;
        return (
          <g
            className="ci"
            key={`${edge.link.from}->${edge.link.to}-${i}`}
            data-item={`${edge.link.from}->${edge.link.to}`}
            data-dim={String(dim)}
            data-focused="false"
          >
            <title>{`${edge.link.from} → ${edge.link.to}: ${edge.link.value ?? 'unweighted'}`}</title>
            <path
              className={`cedge ${toneClass(edge.link.tone)}`}
              data-back={String(edge.back)}
              data-weight={edge.link.value === undefined ? 'unstated' : String(edge.link.value)}
              d={edgePath(edge, 'horizontal')}
              /*
               * INLINE, NOT A PRESENTATION ATTRIBUTE.
               *
               * `strokeWidth={n}` on an SVG element is a PRESENTATION
               * ATTRIBUTE, and every presentation attribute loses to any
               * author stylesheet rule — `.seqchart .cedge { stroke-width: … }`
               * beats it outright. The first cut of this file set the
               * attribute, a test asserted the attribute differed per link,
               * the test passed, and every ribbon painted at the same 1.2px:
               * green, and wrong on screen. An inline style is the only form
               * that outranks the class rule.
               */
              style={{ strokeWidth: r(scale(values[i])), strokeOpacity: 0.55 }}
            />
          </g>
        );
      })}
    </g>
  );
}
