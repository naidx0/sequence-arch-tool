/* ══════════════════════════════════════════════════════════════════════════
   SEQ-CHART — SHARED MARKS
   packages/web2/src/charts/ChartPrimitives.tsx

   The box and the connector are drawn once. Three families lay them out
   differently and all three draw them identically, which is the point: a
   "dependency map", a "user flow" and an "org chart" are the same two marks in
   three arrangements, and if each family drew its own rectangle they would
   drift into three different products inside a month.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem } from '@sequence/schema';

import {
  type LaidEdge,
  type LaidNode,
  type Orientation,
  arrowHead,
  edgeMid,
  edgePath,
  fitText,
  itemAttrs,
  r,
  toneClass,
} from './chartLayout.js';

/** Mirrors --r-8. An SVG geometry attribute cannot read a custom property, so
 *  the number is written here rather than pretended into CSS. */
const BOX_R = 8;
/** Inner padding of a drawn box. Mirrors --sp-10. */
const BOX_PAD = 10;

export interface NodeBoxProps {
  node: LaidNode;
  focusItemId?: string;
}

/**
 * One item as a box.
 *
 * ONE LINE OF LABEL AND ONE OF DETAIL, both truncated. Wrapping would make the
 * box height depend on the string, and then two charts of the same shape would
 * not be the same picture — the determinism claim dies on a text reflow. The
 * full string stays reachable: it is in the title element, which is also what
 * a screen reader reads for the shape.
 */
export function NodeBox({ node, focusItemId }: NodeBoxProps) {
  const { item, x, y, w, h } = node;
  const detail = item.detail ?? '';
  const twoLine = detail !== '';
  return (
    <g {...itemAttrs(item, focusItemId)}>
      <title>{detail ? `${item.label} — ${detail}` : item.label}</title>
      <rect className="cbox" x={r(x)} y={r(y)} width={r(w)} height={r(h)} rx={BOX_R} ry={BOX_R} />
      <text
        className="clabel"
        x={r(x + BOX_PAD)}
        y={r(y + (twoLine ? h / 2 - 2 : h / 2 + 4))}
      >
        {fitText(item.label, w - BOX_PAD * 2)}
      </text>
      {twoLine ? (
        <text className="cdetail" x={r(x + BOX_PAD)} y={r(y + h / 2 + 13)}>
          {fitText(detail, w - BOX_PAD * 2)}
        </text>
      ) : null}
    </g>
  );
}

export interface EdgeLayerProps {
  edges: readonly LaidEdge[];
  orientation?: Orientation;
  /** Arrowheads. A flow is directed; a relationship map is not. */
  directed?: boolean;
  focusItemId?: string;
}

/**
 * Every connector, under every box.
 *
 * DIMMING FOLLOWS THE ENDPOINTS. In teach mode a connector between two dimmed
 * items is context and recedes with them; a connector touching the focused item
 * is part of what is being taught and stays at full strength. Deciding this per
 * edge rather than dimming the whole edge layer is what keeps the focused item
 * attached to the picture instead of floating above a grey ghost of it.
 */
export function EdgeLayer({ edges, orientation = 'horizontal', directed = true, focusItemId }: EdgeLayerProps) {
  return (
    <g className="cedges" data-testid="seqchart-edges">
      {edges.map((edge, i) => {
        const dim =
          focusItemId !== undefined &&
          edge.from.item.id !== focusItemId &&
          edge.to.item.id !== focusItemId;
        const tone = toneClass(edge.link.tone);
        const [mx, my] = edgeMid(edge, orientation);
        const head = headFor(edge, orientation);
        return (
          <g className="ci" key={`${edge.link.from}->${edge.link.to}-${i}`} data-item={`${edge.link.from}->${edge.link.to}`} data-dim={String(dim)} data-focused="false">
            <path
              className={`cedge ${tone}`}
              data-back={String(edge.back)}
              d={edgePath(edge, orientation)}
            />
            {directed ? <polygon className={`cedge-head ${tone}`} points={head} /> : null}
            {edge.link.label ? (
              <g className="cedge-tag">
                <rect
                  className="cedge-label-plate"
                  x={r(mx - (edge.link.label.length * 3.1 + 4))}
                  y={r(my - 13)}
                  width={r(edge.link.label.length * 6.2 + 8)}
                  height={16}
                  rx={4}
                  ry={4}
                />
                <text className="cedge-label" x={r(mx)} y={r(my - 2)} textAnchor="middle">
                  {edge.link.label}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function headFor(edge: LaidEdge, orientation: Orientation): string {
  const { to, back } = edge;
  if (orientation === 'horizontal') {
    const x = back ? to.x + to.w : to.x;
    const y = to.y + to.h / 2;
    return arrowHead(x, y, back ? -1 : 1, 0);
  }
  const x = to.x + to.w / 2;
  const y = back ? to.y + to.h : to.y;
  return arrowHead(x, y, 0, back ? -1 : 1);
}

/** A caption above a band, lane or column. Chrome: never coloured. */
export function Caption({ x, y, text, anchor = 'start' }: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text className="ccap" x={r(x)} y={r(y)} textAnchor={anchor}>
      {text}
    </text>
  );
}

/** Total of an item list, treating a missing value as zero rather than as one. */
export function sumValues(items: readonly ChartItem[]): number {
  return items.reduce((total, it) => total + (Number.isFinite(it.value) ? (it.value as number) : 0), 0);
}
