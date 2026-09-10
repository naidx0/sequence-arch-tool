/* ══════════════════════════════════════════════════════════════════════════
   TIMELINE — four kinds, one axis
   packages/web2/src/charts/TimelineChart.tsx

   roadmap · milestone · gantt · journey-map

   ONE HONEST GAP, NAMED HERE BECAUSE THE RENDERER CANNOT CLOSE IT. ChartItem
   carries a single `value`, and a gantt bar needs two numbers — a start and an
   end. There is no third field to read one out of. So this renderer reads
   `value` as a DURATION and lays each lane's bars end to end in the spec's
   order, which is the only reading that cannot fabricate: it never claims a
   date the author did not give, and the picture it draws is exactly "these,
   in this order, for this long". A real start/end needs a contract change
   (`value2`, or a `span: [from, to]`), and that belongs to whoever owns
   chart.ts, not to a renderer inventing a field.

   POSITION COMES FROM `value` ONLY WHEN EVERY ITEM HAS ONE. A half-valued
   timeline positioned by value would silently place the unvalued items at zero
   — at the left edge, looking like the earliest events. Mixed data falls back
   to even spacing in the authored order, which claims a SEQUENCE and no dates,
   and that is what the spec actually contains.

   LANES ARE ROWS AND THE ROW ORDER IS `axes.lanes`. A journey map's rows are
   its stages of experience and their order is the argument.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, SeqChart } from '@sequence/schema';

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { Caption } from './ChartPrimitives.js';
import {
  PAD,
  extent,
  fitText,
  formatValue,
  groupKeys,
  inGroup,
  itemAttrs,
  r,
  ticks,
} from './chartLayout.js';

const LANE_GUTTER = 104;
const COL_W = 152;
const LANE_H = 66;
const HEAD_H = 8;
const AXIS_H = 26;
const DOT_R = 5;
const BAR_H = 22;

export function TimelineChart({ chart, note }: FamilyChartProps) {
  const lanes = groupKeys(chart.items, chart.axes?.lanes);
  const rows = lanes.map((lane) => inGroup(chart.items, lane));
  /* An `axes.lanes` entry with nothing in it still draws its row: a roadmap
     with an empty quarter is telling you something, and dropping the row would
     hide it. */
  const steps = Math.max(1, ...rows.map((row) => row.length));
  const gantt = chart.kind === 'gantt';
  const positioned = !gantt && chart.items.every((it) => Number.isFinite(it.value));

  const axisW = steps * COL_W;
  const left = PAD + LANE_GUTTER;
  const width = left + axisW + PAD;
  const top = PAD + HEAD_H;
  const height = top + lanes.length * LANE_H + AXIS_H + PAD;

  const [lo, hi] = positioned
    ? extent(chart.items.map((it) => it.value as number), false)
    : [0, Math.max(1, steps - 1)];
  const xOf = (value: number): number =>
    left + COL_W / 2 + (hi === lo ? 0 : ((value - lo) / (hi - lo)) * (axisW - COL_W));

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      {lanes.map((lane, i) => (
        <g key={lane || `lane-${i}`} data-lane={lane}>
          <rect
            className={i % 2 === 0 ? 'clane' : 'clane-alt'}
            x={PAD}
            y={r(top + i * LANE_H)}
            width={r(width - PAD * 2)}
            height={LANE_H}
          />
          {lane ? <Caption x={PAD + 8} y={r(top + i * LANE_H + 16)} text={fitText(lane, LANE_GUTTER)} /> : null}
          <line
            className="cspine"
            x1={r(left)}
            y1={r(top + i * LANE_H + LANE_H / 2)}
            x2={r(left + axisW)}
            y2={r(top + i * LANE_H + LANE_H / 2)}
          />
        </g>
      ))}

      {rows.map((row, laneIndex) =>
        gantt ? (
          <GanttRow
            key={`bars-${laneIndex}`}
            chart={chart}
            row={row}
            y={top + laneIndex * LANE_H}
            left={left}
            axisW={axisW}
          />
        ) : (
          row.map((item, stepIndex) => (
            <Marker
              key={item.id}
              chart={chart}
              item={item}
              cx={positioned ? xOf(item.value as number) : left + (stepIndex + 0.5) * COL_W}
              cy={top + laneIndex * LANE_H + LANE_H / 2}
            />
          ))
        ),
      )}

      <line
        className="caxis"
        x1={r(PAD)}
        y1={r(top + lanes.length * LANE_H)}
        x2={r(width - PAD)}
        y2={r(top + lanes.length * LANE_H)}
      />
      {positioned
        ? ticks(lo, hi, 4).map((value, i) => (
            <text
              key={`tick-${i}`}
              className="ctick"
              x={r(xOf(value))}
              y={r(top + lanes.length * LANE_H + 16)}
              textAnchor="middle"
            >
              {formatValue(value)}
            </text>
          ))
        : null}
      {chart.axes?.x ? (
        <text
          className="caxis-label"
          x={r(width - PAD)}
          y={r(top + lanes.length * LANE_H + 16)}
          textAnchor="end"
        >
          {chart.axes.x}
        </text>
      ) : null}
    </ChartFrame>
  );
}

function Marker({ chart, item, cx, cy }: { chart: SeqChart; item: ChartItem; cx: number; cy: number }) {
  const detail = item.detail ?? '';
  return (
    <g {...itemAttrs(item, chart.focusItemId)}>
      <title>{detail ? `${item.label} — ${detail}` : item.label}</title>
      <circle className="cbar" cx={r(cx)} cy={r(cy)} r={DOT_R} />
      <circle className="cbox" cx={r(cx)} cy={r(cy)} r={DOT_R + 3} fillOpacity={0} />
      <text className="clabel" x={r(cx)} y={r(cy - 14)} textAnchor="middle">
        {fitText(item.label, COL_W - 8)}
      </text>
      {detail ? (
        <text className="cdetail" x={r(cx)} y={r(cy + 22)} textAnchor="middle">
          {fitText(detail, COL_W - 8)}
        </text>
      ) : null}
    </g>
  );
}

interface GanttRowProps {
  chart: SeqChart;
  row: readonly ChartItem[];
  y: number;
  left: number;
  axisW: number;
}

/** Bars end to end, width proportional to `value` read as a duration. */
function GanttRow({ chart, row, y, left, axisW }: GanttRowProps) {
  const spans = row.map((it) => (Number.isFinite(it.value) && (it.value as number) > 0 ? (it.value as number) : 1));
  const total = spans.reduce((a, b) => a + b, 0) || 1;
  const unit = axisW / total;
  let cursor = left;
  return (
    <g data-testid="seqchart-gantt-row">
      {row.map((item, i) => {
        const w = spans[i] * unit;
        const x = cursor;
        cursor += w;
        return (
          <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
            <title>{`${item.label} — ${formatValue(spans[i])}`}</title>
            <rect
              className="cbar"
              x={r(x + 1)}
              y={r(y + LANE_H / 2 - BAR_H / 2)}
              width={r(Math.max(2, w - 2))}
              height={BAR_H}
              rx={4}
              ry={4}
            />
            <text className="clabel" x={r(x + 8)} y={r(y + LANE_H / 2 - BAR_H / 2 - 6)}>
              {fitText(item.label, w)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
