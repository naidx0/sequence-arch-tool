/* ══════════════════════════════════════════════════════════════════════════
   LOOP — two kinds, one ring
   packages/web2/src/charts/LoopChart.tsx

   flywheel · feedback-loop

   THE RING IS THE CLAIM. Every other family can draw a cycle as a back edge;
   this family exists because sometimes the cycle IS the point, and a loop drawn
   as a left-to-right chain with one long return arrow reads as a pipeline that
   happens to repeat. Positions are equal angles from the top, clockwise, in the
   spec's order — which means the order of `items` is load-bearing here in a way
   it is not anywhere else, and that is worth knowing when authoring one.

   THE ARROWS COME FROM `links` WHEN THERE ARE ANY. A feedback loop is often
   partly reinforcing and partly balancing, and those arrows are not simply
   "next in the list" — an author who drew them gets exactly what they drew,
   including a tone on the balancing arm. With no links, consecutive items are
   joined and the ring is closed, because that is what "flywheel" means and
   drawing a broken ring would contradict the kind.

   A TWO-ITEM LOOP IS STILL A LOOP and draws as two boxes with two arcs, not as
   a degenerate circle. The radius grows with the item count so the boxes never
   collide, which is why it is computed rather than fixed.
   ══════════════════════════════════════════════════════════════════════════ */

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import {
  arrowHead,
  fitText,
  itemAttrs,
  r,
  toneClass,
} from './chartLayout.js';

const BOX_W = 148;
const BOX_H = 44;
/** Clearance between two neighbouring boxes on the ring.
 *  Measured, not chosen: at 26 the two boxes that land side by side at the
 *  bottom of a five-step flywheel sit two pixels apart, because the ring is
 *  sized by ARC length while the boxes touch along a CHORD. 48 is what keeps a
 *  visible gutter between them at the sizes a teach turn actually uses. */
const RING_PAD = 48;
const MARGIN = 16;
/** How far short of each box the connecting arc stops. */
const ARC_INSET = 0.22;

export function LoopChart({ chart, note }: FamilyChartProps) {
  const items = chart.items;
  const n = Math.max(1, items.length);
  /* Radius from circumference: n boxes plus their clearance have to fit round
     the ring, so the ring is sized by the content instead of the content being
     shrunk to a chosen ring. */
  const radius = Math.max(96, ((BOX_W + RING_PAD) * n) / (2 * Math.PI));
  const cx = MARGIN + radius + BOX_W / 2;
  const cy = MARGIN + radius + BOX_H / 2;
  const width = (radius + BOX_W / 2 + MARGIN) * 2;
  const height = (radius + BOX_H / 2 + MARGIN) * 2;

  const angleOf = (i: number): number => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const centreOf = (i: number): [number, number] => [
    cx + radius * Math.cos(angleOf(i)),
    cy + radius * Math.sin(angleOf(i)),
  ];

  const index = new Map(items.map((it, i) => [it.id, i]));
  const authored = (chart.links ?? []).filter((l) => index.has(l.from) && index.has(l.to));
  const arcs =
    authored.length > 0
      ? authored.map((link) => ({
          from: index.get(link.from) as number,
          to: index.get(link.to) as number,
          tone: toneClass(link.tone),
          label: link.label,
        }))
      : items.map((_, i) => ({ from: i, to: (i + 1) % n, tone: toneClass(undefined), label: undefined as string | undefined }));

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      <g className="cedges" data-testid="seqchart-edges">
        {arcs.map((arc, i) => {
          if (arc.from === arc.to) return null;
          const a0 = angleOf(arc.from) + ARC_INSET;
          const a1 = angleOf(arc.to) - ARC_INSET;
          const ring = radius * 0.62;
          const p0: [number, number] = [cx + ring * Math.cos(a0), cy + ring * Math.sin(a0)];
          const p1: [number, number] = [cx + ring * Math.cos(a1), cy + ring * Math.sin(a1)];
          /* Tangent at the head, so the arrow points along the circle rather
             than at its centre. */
          const head = arrowHead(p1[0], p1[1], -Math.sin(a1), Math.cos(a1), 7);
          const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
          const sweep = a1 > a0 ? 1 : 0;
          /* Dimming follows the endpoints, exactly as EdgeLayer does it: an arc
             between two dimmed steps is context and recedes with them; an arc
             touching the focused step is part of what is being taught and stays
             at full strength. The first cut hardcoded data-dim="false", so in
             teach mode the boxes dimmed while every arrow stayed lit. */
          const fromId = items[arc.from]?.id;
          const toId = items[arc.to]?.id;
          const dim =
            chart.focusItemId !== undefined &&
            fromId !== chart.focusItemId &&
            toId !== chart.focusItemId;
          return (
            <g
              className="ci"
              key={`arc-${i}`}
              data-item={`${fromId}->${toId}`}
              data-dim={String(dim)}
              data-focused="false"
            >
              <path
                className={`cedge ${arc.tone}`}
                data-back="false"
                d={`M ${r(p0[0])} ${r(p0[1])} A ${r(ring)} ${r(ring)} 0 ${large} ${sweep} ${r(p1[0])} ${r(p1[1])}`}
              />
              <polygon className={`cedge-head ${arc.tone}`} points={head} />
              {arc.label ? (
                <text
                  className="cedge-label"
                  x={r((p0[0] + p1[0]) / 2)}
                  y={r((p0[1] + p1[1]) / 2)}
                  textAnchor="middle"
                >
                  {arc.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>

      {items.map((item, i) => {
        const [px, py] = centreOf(i);
        const x = px - BOX_W / 2;
        const y = py - BOX_H / 2;
        const detail = item.detail ?? '';
        return (
          <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
            <title>{detail ? `${item.label} — ${detail}` : item.label}</title>
            <rect className="cbox" x={r(x)} y={r(y)} width={BOX_W} height={BOX_H} rx={8} ry={8} />
            <text
              className="clabel"
              x={r(px)}
              y={r(py + (detail ? -2 : 4))}
              textAnchor="middle"
            >
              {fitText(`${i + 1}. ${item.label}`, BOX_W - 16)}
            </text>
            {detail ? (
              <text className="cdetail" x={r(px)} y={r(py + 13)} textAnchor="middle">
                {fitText(detail, BOX_W - 16)}
              </text>
            ) : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}
