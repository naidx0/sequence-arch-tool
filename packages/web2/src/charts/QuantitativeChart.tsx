/* ══════════════════════════════════════════════════════════════════════════
   QUANTITATIVE — five kinds, one plot frame
   packages/web2/src/charts/QuantitativeChart.tsx

   bar · line · donut · scatter · heat-map

   THE BAR BASELINE IS ZERO AND IT IS NOT A SETTING. A bar's length is read as
   a quantity, so a baseline anywhere else exaggerates every ratio on the
   chart. "Grounded, not guessed" does not survive an axis that lies about a
   proportion. Line and scatter float, because they are read as shapes.

   SERIES TAKE --viz-1..6, TONE TAKES THE VERDICTS, AND THEY NEVER MIX.
   tokens/graphite.css says it: "--viz-* are for SERIES, not for meaning."
   A bar with `tone: 'bad'` is making a claim and gets the verdict hue; a
   second LINE on the same chart is not making a claim about anything, it is
   the second line, and it gets the second series hue.

   TWO HONEST GAPS, BOTH IN THE CONTRACT RATHER THAN HERE:
     - SCATTER NEEDS TWO NUMBERS PER POINT and ChartItem has one. Rather than
       invent a second axis, x is the item's ORDINAL POSITION and the x-axis
       says so. A real scatter needs a second numeric field in chart.ts.
     - HEAT-MAP NEEDS A ROW AND A COLUMN. `group` supplies the row; the column
       is the item's position within its row, labelled from `axes.columns` when
       the author gave them. A ragged row is drawn ragged instead of padded,
       because a padded cell is a value nobody measured.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, SeqChart } from '@sequence/schema';

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { Caption, sumValues } from './ChartPrimitives.js';
import {
  PAD,
  extent,
  fitText,
  formatValue,
  groupKeys,
  inGroup,
  itemAttrs,
  niceExtent,
  r,
  seriesClass,
  ticks,
} from './chartLayout.js';

/** Left gutter for the value ticks; bottom strip for the category labels. */
const AXIS_L = 52;
const AXIS_B = 38;
const PLOT_H = 200;
/** The band above the plot that holds the y caption. */
const AXIS_T = 18;
const COL_W = 74;
const BAR_MAX_W = 44;
const DOT_R = 4;
/** Donut geometry. The hole is over half the radius so the ring reads as a
 *  ring rather than as a pie with a dot in it. */
const RING_OUT = 92;
const RING_IN = 54;
const HEAT_W = 86;
const HEAT_H = 34;

export function QuantitativeChart({ chart, note }: FamilyChartProps) {
  if (chart.kind === 'donut') return <Donut chart={chart} note={note} />;
  if (chart.kind === 'heat-map') return <Heat chart={chart} note={note} />;
  return <Plot chart={chart} note={note} />;
}

/* ─────────────────────────────────────────────── bar · line · scatter ── */

function Plot({ chart, note }: FamilyChartProps) {
  const isBar = chart.kind === 'bar';
  const series = groupKeys(chart.items, undefined);
  const rows = series.map((key) => inGroup(chart.items, key));
  const columns = Math.max(1, ...rows.map((row) => row.length));

  const plotW = Math.max(320, columns * COL_W);
  const left = PAD + AXIS_L;
  /* The y caption sits ABOVE the plot in its own band. Drawing it level with
     the top tick puts two texts on one line at two different anchors, which is
     precisely the overlap the legibility gate exists to catch. */
  const top = PAD + (chart.axes?.y ? AXIS_T : 0);
  const width = left + plotW + PAD;
  const height = top + PLOT_H + AXIS_B + PAD;

  const values = chart.items.map((it) => (Number.isFinite(it.value) ? (it.value as number) : 0));
  const [lo, hi] = niceExtent(...extent(values, isBar));
  const yOf = (value: number): number => top + PLOT_H - ((value - lo) / (hi - lo || 1)) * PLOT_H;
  const colW = plotW / columns;
  const xOf = (index: number): number => left + (index + 0.5) * colW;
  const zero = yOf(Math.min(Math.max(0, lo), hi));

  const xCaption =
    chart.axes?.x ?? (chart.kind === 'scatter' ? 'position in the listed order' : undefined);

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      {/* grid + value ticks — chrome, never coloured */}
      {ticks(lo, hi, 4).map((value, i) => (
        <g key={`grid-${i}`}>
          <line className="cgrid" x1={r(left)} y1={r(yOf(value))} x2={r(left + plotW)} y2={r(yOf(value))} />
          <text className="ctick" x={r(left - 8)} y={r(yOf(value) + 4)} textAnchor="end">
            {formatValue(value)}
          </text>
        </g>
      ))}
      <line className="caxis" x1={r(left)} y1={r(top)} x2={r(left)} y2={r(top + PLOT_H)} />
      <line className="caxis" x1={r(left)} y1={r(zero)} x2={r(left + plotW)} y2={r(zero)} />

      {chart.axes?.y ? <Caption x={PAD} y={r(PAD + 8)} text={chart.axes.y} /> : null}
      {xCaption ? (
        <text className="caxis-label" x={r(left + plotW)} y={r(height - PAD)} textAnchor="end">
          {xCaption}
        </text>
      ) : null}

      {rows.map((row, s) =>
        chart.kind === 'line' ? (
          <polyline
            key={`line-${s}`}
            className={`cseries-line ${seriesClass(s)}`}
            data-series={series[s]}
            points={row
              .map((it, i) => `${r(xOf(i))},${r(yOf(Number.isFinite(it.value) ? (it.value as number) : 0))}`)
              .join(' ')}
          />
        ) : null,
      )}

      {rows.map((row, s) =>
        row.map((item, i) => (
          <Mark
            key={item.id}
            chart={chart}
            item={item}
            seriesIndex={s}
            x={xOf(i)}
            y={yOf(Number.isFinite(item.value) ? (item.value as number) : 0)}
            zero={zero}
            colW={colW}
            bottom={top + PLOT_H}
          />
        )),
      )}
    </ChartFrame>
  );
}

interface MarkProps {
  chart: SeqChart;
  item: ChartItem;
  seriesIndex: number;
  x: number;
  y: number;
  zero: number;
  colW: number;
  bottom: number;
}

function Mark({ chart, item, seriesIndex, x, y, zero, colW, bottom }: MarkProps) {
  const attrs = itemAttrs(item, chart.focusItemId);
  const label = fitText(item.label, colW - 6);
  const value = Number.isFinite(item.value) ? formatValue(item.value as number) : '—';
  const barW = Math.min(BAR_MAX_W, colW - 16);

  return (
    <g {...attrs} className={`${attrs.className} ${seriesClass(seriesIndex)}`}>
      <title>{`${item.label}: ${value}${item.detail ? ` — ${item.detail}` : ''}`}</title>
      {chart.kind === 'bar' ? (
        <>
          <rect
            className="cbar"
            x={r(x - barW / 2)}
            y={r(Math.min(y, zero))}
            width={r(barW)}
            height={r(Math.max(1, Math.abs(zero - y)))}
            rx={2}
            ry={2}
          />
          <text className="cvalue" x={r(x)} y={r(Math.min(y, zero) - 6)} textAnchor="middle">
            {value}
          </text>
        </>
      ) : (
        <circle className="cdot" cx={r(x)} cy={r(y)} r={DOT_R} />
      )}
      <text className="ctick" x={r(x)} y={r(bottom + 16)} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

/* ─────────────────────────────────────────────────────────────── donut ── */

function Donut({ chart, note }: FamilyChartProps) {
  const total = sumValues(chart.items);
  const legendW = 200;
  const width = PAD * 2 + RING_OUT * 2 + legendW;
  const height = PAD * 2 + Math.max(RING_OUT * 2, chart.items.length * 22);
  const cx = PAD + RING_OUT;
  const cy = PAD + RING_OUT;

  /* A donut of nothing is not an empty circle — it is a chart that cannot be
     drawn, and it says so rather than painting a plausible ring. */
  const honest =
    total > 0
      ? note
      : [note, 'no item carries a positive value, so no share can be drawn']
          .filter(Boolean)
          .join(' · ');

  let angle = -Math.PI / 2;
  return (
    <ChartFrame chart={chart} width={width} height={height} note={honest}>
      <circle className="cplate" cx={cx} cy={cy} r={RING_OUT} />
      {total > 0
        ? chart.items.map((item, i) => {
            const share = (Number.isFinite(item.value) ? Math.max(0, item.value as number) : 0) / total;
            const from = angle;
            const to = angle + share * Math.PI * 2;
            angle = to;
            /* A SLICE THAT IS THE WHOLE RING NEEDS A CLOSED ANNULUS, NOT AN ARC.
               When one item is ~100% of the total, `from` and `to` land on the
               same point, and an SVG arc whose endpoints coincide is a zero
               path — it draws nothing, so a one-item donut with total > 0 came
               out blank. A full annulus (two circles, hole punched by
               fill-rule) has no coincident endpoints and always paints. */
            const full = share >= 1 - 1e-6;
            return (
              <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
                <title>{`${item.label}: ${formatValue(item.value ?? 0)} (${Math.round(share * 100)}%)`}</title>
                <path
                  className={`carc ${seriesClass(i)}${item.tone ? ' toned' : ''}`}
                  style={full ? { fillRule: 'evenodd' } : undefined}
                  d={full ? fullRing(cx, cy, RING_OUT, RING_IN) : ringSlice(cx, cy, RING_OUT, RING_IN, from, to)}
                />
              </g>
            );
          })
        : null}
      {chart.items.map((item, i) => (
        <g key={`key-${item.id}`} {...itemAttrs(item, chart.focusItemId)}>
          <rect
            className={`ckey ${seriesClass(i)}${item.tone ? ' toned' : ''}`}
            x={r(PAD + RING_OUT * 2 + 12)}
            y={r(PAD + i * 22)}
            width={10}
            height={10}
            rx={2}
            ry={2}
          />
          <text className="clabel" x={r(PAD + RING_OUT * 2 + 28)} y={r(PAD + i * 22 + 9)}>
            {fitText(`${item.label}  ${formatValue(item.value ?? 0)}`, legendW - 40)}
          </text>
        </g>
      ))}
    </ChartFrame>
  );
}

/** A closed annulus — the whole ring — as one path. Outer circle clockwise,
 *  inner circle counter-clockwise, so `fill-rule: evenodd` punches the hole.
 *  Each circle is TWO half-arcs because a single 360° arc also has coincident
 *  endpoints and would collapse the same way the full slice did. */
function fullRing(cx: number, cy: number, out: number, inner: number): string {
  return [
    `M ${r(cx - out)} ${r(cy)}`,
    `A ${out} ${out} 0 1 1 ${r(cx + out)} ${r(cy)}`,
    `A ${out} ${out} 0 1 1 ${r(cx - out)} ${r(cy)}`,
    'Z',
    `M ${r(cx - inner)} ${r(cy)}`,
    `A ${inner} ${inner} 0 1 0 ${r(cx + inner)} ${r(cy)}`,
    `A ${inner} ${inner} 0 1 0 ${r(cx - inner)} ${r(cy)}`,
    'Z',
  ].join(' ');
}

/** One ring segment. Written out rather than pulled from a library — an arc is
 *  four numbers and a flag, and a dependency for that is a dependency. */
function ringSlice(cx: number, cy: number, out: number, inner: number, a0: number, a1: number): string {
  const sweep = a1 - a0 >= Math.PI ? 1 : 0;
  const p = (radius: number, angle: number): string =>
    `${r(cx + radius * Math.cos(angle))} ${r(cy + radius * Math.sin(angle))}`;
  return [
    `M ${p(out, a0)}`,
    `A ${out} ${out} 0 ${sweep} 1 ${p(out, a1)}`,
    `L ${p(inner, a1)}`,
    `A ${inner} ${inner} 0 ${sweep} 0 ${p(inner, a0)}`,
    'Z',
  ].join(' ');
}

/* ────────────────────────────────────────────────────────────── heat map ── */

function Heat({ chart, note }: FamilyChartProps) {
  const rowKeys = groupKeys(chart.items, chart.axes?.lanes);
  const rows = rowKeys.map((key) => inGroup(chart.items, key));
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const columnLabels = chart.axes?.columns ?? [];

  const left = PAD + 96;
  const top = PAD + 18;
  const width = left + columns * HEAT_W + PAD;
  const height = top + rows.length * HEAT_H + PAD;

  const values = chart.items.map((it) => (Number.isFinite(it.value) ? (it.value as number) : 0));
  const [lo, hi] = extent(values, true);

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      {Array.from({ length: columns }, (_, c) => (
        <Caption
          key={`col-${c}`}
          x={left + c * HEAT_W + HEAT_W / 2}
          y={top - 6}
          anchor="middle"
          text={fitText(columnLabels[c] ?? String(c + 1), HEAT_W - 6)}
        />
      ))}
      {rows.map((row, rIndex) => (
        <g key={rowKeys[rIndex] || `row-${rIndex}`}>
          {rowKeys[rIndex] ? (
            <Caption x={PAD} y={r(top + rIndex * HEAT_H + HEAT_H / 2 + 4)} text={fitText(rowKeys[rIndex], 88)} />
          ) : null}
          {row.map((item, c) => {
            const value = Number.isFinite(item.value) ? (item.value as number) : 0;
            const strength = hi === lo ? 0.5 : (value - lo) / (hi - lo);
            return (
              <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
                <title>{`${item.label}: ${formatValue(value)}`}</title>
                <rect
                  className={`cheat ${seriesClass(0)}`}
                  x={r(left + c * HEAT_W)}
                  y={r(top + rIndex * HEAT_H)}
                  width={HEAT_W}
                  height={HEAT_H}
                  /* Intensity is OPACITY of one series hue, not a five-step
                     colour ramp. graphite.css deleted its heat ramp on purpose:
                     "An ungoverned five-step hue ramp sitting in the substrate
                     is the exact hole through which kind-by-hue comes back." */
                  fillOpacity={r(0.12 + strength * 0.68)}
                />
                <text
                  className="cheat-label"
                  x={r(left + c * HEAT_W + HEAT_W / 2)}
                  y={r(top + rIndex * HEAT_H + HEAT_H / 2 + 4)}
                  textAnchor="middle"
                >
                  {fitText(item.label, HEAT_W - 8)}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </ChartFrame>
  );
}
