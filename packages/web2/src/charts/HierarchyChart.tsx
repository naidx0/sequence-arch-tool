/* ══════════════════════════════════════════════════════════════════════════
   HIERARCHY — six kinds, two arrangements
   packages/web2/src/charts/HierarchyChart.tsx

   hierarchy · organization · pyramid · layer · maturity-model · progression

   THE SPLIT IS THE LINKS, NOT THE NAME. A hierarchy with `links` is a TREE and
   is drawn as one. A hierarchy without links is an ORDERED STACK — which is
   what `layer`, `pyramid`, `maturity-model` and `progression` almost always
   are: five bands in an authored order and no parent-child edges anywhere.
   Choosing on the data rather than on the kind means an `organization` chart
   authored as five flat bands still draws, instead of collapsing into five
   unconnected roots.

   THE TREE IS TIDY BY LEAF ORDER, NOT BY A SIMULATION. Leaves take consecutive
   slots in the order the spec lists them; a parent centres over its children.
   That is one pass, it is total, and it produces the same picture every time.
   A node with two parents is placed under the FIRST one that reaches it and is
   not duplicated — a duplicated node would be two claims where the spec made
   one.

   THE PYRAMID TAPERS AND THE TAPER IS NOT DATA. A pyramid band's width comes
   from its POSITION, because that is what the shape has always meant; it is
   never derived from `value`, because a width that looks quantitative while
   being ordinal is exactly the kind of picture that gets believed too fast. If
   an item carries a value it is printed as a number beside the band.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, SeqChart } from '@sequence/schema';

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { EdgeLayer, NodeBox } from './ChartPrimitives.js';
import {
  GAP_X,
  GAP_Y,
  type LaidNode,
  NODE_H,
  NODE_W,
  PAD,
  fitText,
  formatValue,
  itemAttrs,
  laidEdges,
  r,
} from './chartLayout.js';

/** Band geometry for the stacked arrangement. */
const BAND_W = 460;
const BAND_H = 44;
const BAND_GAP = 8;
/** The narrowest a pyramid's top band may get before its label stops fitting. */
const TAPER_FLOOR = 0.42;
/** Left gutter holding the level number on a maturity model or progression. */
const LEVEL_GUTTER = 26;

export function HierarchyChart({ chart, note }: FamilyChartProps) {
  const useTree = (chart.links?.length ?? 0) > 0 && chart.kind !== 'pyramid';
  return useTree ? <TreeHierarchy chart={chart} note={note} /> : <StackHierarchy chart={chart} note={note} />;
}

/* ──────────────────────────────────────────────────────────────── tree ── */

function TreeHierarchy({ chart, note }: FamilyChartProps) {
  const byId = new Map(chart.items.map((it) => [it.id, it]));
  const children = new Map<string, string[]>();
  const claimed = new Set<string>();
  for (const link of chart.links ?? []) {
    if (!byId.has(link.from) || !byId.has(link.to)) continue;
    if (link.from === link.to || claimed.has(link.to)) continue;
    claimed.add(link.to);
    const list = children.get(link.from);
    if (list) list.push(link.to);
    else children.set(link.from, [link.to]);
  }
  const roots = chart.items.filter((it) => !claimed.has(it.id)).map((it) => it.id);

  const placed = new Map<string, { depth: number; slot: number }>();
  let nextLeaf = 0;
  const walk = (id: string, depth: number, guard: Set<string>): number => {
    if (guard.has(id)) return placed.get(id)?.slot ?? nextLeaf;
    guard.add(id);
    const kids = (children.get(id) ?? []).filter((k) => !guard.has(k));
    if (kids.length === 0) {
      const slot = nextLeaf;
      nextLeaf += 1;
      placed.set(id, { depth, slot });
      return slot;
    }
    const slots = kids.map((kid) => walk(kid, depth + 1, guard));
    const centre = (slots[0] + slots[slots.length - 1]) / 2;
    placed.set(id, { depth, slot: centre });
    return centre;
  };
  const guard = new Set<string>();
  for (const root of roots) walk(root, 0, guard);
  /* Anything a cycle kept out of the walk still gets drawn — a chart that
     silently omits an item it was given is the worst possible failure mode. */
  for (const item of chart.items) {
    if (placed.has(item.id)) continue;
    placed.set(item.id, { depth: 0, slot: nextLeaf });
    nextLeaf += 1;
  }

  const nodes: LaidNode[] = [];
  const laid = new Map<string, LaidNode>();
  let deepest = 0;
  for (const item of chart.items) {
    const at = placed.get(item.id) as { depth: number; slot: number };
    deepest = Math.max(deepest, at.depth);
    const node: LaidNode = {
      item,
      layer: at.depth,
      x: PAD + at.slot * (NODE_W + GAP_X),
      y: PAD + at.depth * (NODE_H + GAP_Y * 2),
      w: NODE_W,
      h: NODE_H,
    };
    nodes.push(node);
    laid.set(item.id, node);
  }

  const width = PAD * 2 + Math.max(1, nextLeaf) * NODE_W + Math.max(0, nextLeaf - 1) * GAP_X;
  const height = PAD * 2 + (deepest + 1) * NODE_H + deepest * GAP_Y * 2;

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      <EdgeLayer
        edges={laidEdges(chart.links, laid)}
        orientation="vertical"
        directed={false}
        focusItemId={chart.focusItemId}
      />
      {nodes.map((node) => (
        <NodeBox key={node.item.id} node={node} focusItemId={chart.focusItemId} />
      ))}
    </ChartFrame>
  );
}

/* ─────────────────────────────────────────────────────────────── stack ── */

function StackHierarchy({ chart, note }: FamilyChartProps) {
  const items = chart.items;
  const numbered = chart.kind === 'maturity-model' || chart.kind === 'progression';
  const gutter = numbered ? LEVEL_GUTTER : 0;
  const width = PAD * 2 + gutter + BAND_W;
  const height = PAD * 2 + items.length * BAND_H + Math.max(0, items.length - 1) * BAND_GAP;

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      {items.map((item, i) => (
        <Band
          key={item.id}
          chart={chart}
          item={item}
          index={i}
          total={items.length}
          gutter={gutter}
          numbered={numbered}
        />
      ))}
    </ChartFrame>
  );
}

interface BandProps {
  chart: SeqChart;
  item: ChartItem;
  index: number;
  total: number;
  gutter: number;
  numbered: boolean;
}

function Band({ chart, item, index, total, gutter, numbered }: BandProps) {
  const taper = chart.kind === 'pyramid' ? bandTaper(index, total) : 1;
  const w = BAND_W * taper;
  const x = PAD + gutter + (BAND_W - w) / 2;
  const y = PAD + index * (BAND_H + BAND_GAP);
  const detail = item.detail ?? '';
  const value = Number.isFinite(item.value) ? formatValue(item.value as number) : '';

  return (
    <g {...itemAttrs(item, chart.focusItemId)}>
      <title>{detail ? `${item.label} — ${detail}` : item.label}</title>
      {numbered ? (
        <text className="ctick" x={PAD} y={r(y + BAND_H / 2 + 4)}>
          {index + 1}
        </text>
      ) : null}
      <rect className="cbox" x={r(x)} y={r(y)} width={r(w)} height={BAND_H} rx={8} ry={8} />
      <text className="clabel" x={r(x + 12)} y={r(y + (detail ? BAND_H / 2 - 2 : BAND_H / 2 + 4))}>
        {fitText(item.label, w - 24 - (value ? 56 : 0))}
      </text>
      {detail ? (
        <text className="cdetail" x={r(x + 12)} y={r(y + BAND_H / 2 + 13)}>
          {fitText(detail, w - 24 - (value ? 56 : 0))}
        </text>
      ) : null}
      {value ? (
        <text className="cvalue" x={r(x + w - 12)} y={r(y + BAND_H / 2 + 5)} textAnchor="end">
          {value}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Band width by position, floored so the top band still holds a label.
 *
 * A true triangle puts the apex at zero width, and a zero-width band is a band
 * whose text has nowhere to go. The floor is stated rather than discovered.
 */
function bandTaper(index: number, total: number): number {
  if (total <= 1) return 1;
  const ratio = index / (total - 1);
  return TAPER_FLOOR + (1 - TAPER_FLOOR) * ratio;
}
