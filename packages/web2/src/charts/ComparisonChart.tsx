/* ══════════════════════════════════════════════════════════════════════════
   COMPARISON — seven kinds, four arrangements
   packages/web2/src/charts/ComparisonChart.tsx

   comparison-table · comparison-matrix · quadrant · venn · pros-and-cons ·
   spectrum · before-and-after

   COLUMNS ARE THE DEFAULT AND FOUR OF THE SEVEN KINDS ARE EXACTLY THAT. A
   pros-and-cons list is two columns. A before-and-after is two columns. A
   comparison table is n columns. The column ORDER is `axes.columns` when the
   author gave it, and first-appearance order otherwise — never alphabetical,
   because "before" does not sort before "after" and a chart that reorders them
   has told the story backwards.

   TONE IS THE ONLY THING THAT SAYS WHICH COLUMN IS THE GOOD ONE. A
   pros-and-cons chart does NOT get a green column and a red column from its
   kind: `tone` is per item and per claim, so an author who marks three pros
   `good` and leaves the fourth neutral gets exactly that, and a chart with no
   tones at all is grey. Colouring by column would be decoration derived from a
   name, which is the thing chart.ts's tone comment forbids in one line.

   ONE HONEST GAP: THE QUADRANT. Placing a point in a 2x2 needs two
   coordinates and ChartItem carries one number and one group. So `group` names
   the quadrant — matched against `axes.columns`, which for this kind is read
   as the four cell names in reading order — and anything unmatched is listed
   in the cell its position implies, with the fallback stated on the chart.
   Deriving an x and a y out of one `value` would be an invention.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, SeqChart } from '@sequence/schema';

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { Caption } from './ChartPrimitives.js';
import {
  PAD,
  ROW_H,
  extent,
  fitText,
  formatValue,
  groupKeys,
  inGroup,
  itemAttrs,
  r,
  toneClass,
} from './chartLayout.js';

const COL_W = 212;
const COL_GAP = 12;
const HEAD_H = 22;
const ROW_GAP = 6;
const CELL_W = 236;
/** A quadrant cell is content-sized between these two. A fixed 176 leaves a
 *  two-item cell three-quarters empty, and a reader reads emptiness as "nothing
 *  here" rather than as "the grid was drawn at a fixed size". */
const CELL_H_MIN = 104;
const CELL_ROW_H = 20;
const CELL_HEAD_H = 44;
const VENN_R = 92;
const SPECTRUM_W = 520;
const SPECTRUM_H = 132;

export function ComparisonChart({ chart, note }: FamilyChartProps) {
  if (chart.kind === 'quadrant') return <Quadrant chart={chart} note={note} />;
  if (chart.kind === 'venn') return <Venn chart={chart} note={note} />;
  if (chart.kind === 'spectrum') return <Spectrum chart={chart} note={note} />;
  return <Columns chart={chart} note={note} />;
}

/* ───────────────────────────────────────────────────────────── columns ── */

function Columns({ chart, note }: FamilyChartProps) {
  const keys = groupKeys(chart.items, chart.axes?.columns);
  const columns = keys.map((key) => inGroup(chart.items, key));
  const deepest = Math.max(1, ...columns.map((column) => column.length));

  const width = PAD * 2 + keys.length * COL_W + Math.max(0, keys.length - 1) * COL_GAP;
  const top = PAD + (keys.some(Boolean) ? HEAD_H : 0);
  const height = top + deepest * (ROW_H + ROW_GAP) + PAD;

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      {keys.map((key, c) => {
        const x = PAD + c * (COL_W + COL_GAP);
        return (
          <g key={key || `col-${c}`} data-column={key}>
            {key ? <Caption x={x + 4} y={PAD + 10} text={fitText(key, COL_W - 8)} /> : null}
            {columns[c].map((item, i) => (
              <Row key={item.id} chart={chart} item={item} x={x} y={top + i * (ROW_H + ROW_GAP)} w={COL_W} />
            ))}
          </g>
        );
      })}
    </ChartFrame>
  );
}

function Row({ chart, item, x, y, w }: { chart: SeqChart; item: ChartItem; x: number; y: number; w: number }) {
  const detail = item.detail ?? '';
  const value = Number.isFinite(item.value) ? formatValue(item.value as number) : '';
  return (
    <g {...itemAttrs(item, chart.focusItemId)}>
      <title>{detail ? `${item.label} — ${detail}` : item.label}</title>
      <rect className="cbox" x={r(x)} y={r(y)} width={r(w)} height={ROW_H} rx={8} ry={8} />
      <text className="clabel" x={r(x + 10)} y={r(y + (detail ? ROW_H / 2 - 2 : ROW_H / 2 + 4))}>
        {fitText(item.label, w - 20 - (value ? 48 : 0))}
      </text>
      {detail ? (
        <text className="cdetail" x={r(x + 10)} y={r(y + ROW_H / 2 + 12)}>
          {fitText(detail, w - 20 - (value ? 48 : 0))}
        </text>
      ) : null}
      {value ? (
        <text className="cvalue" x={r(x + w - 10)} y={r(y + ROW_H / 2 + 5)} textAnchor="end">
          {value}
        </text>
      ) : null}
    </g>
  );
}

/* ──────────────────────────────────────────────────────────── quadrant ── */

function Quadrant({ chart, note }: FamilyChartProps) {
  const named = chart.axes?.columns ?? [];
  const cellOf = (item: ChartItem, index: number): number => {
    const byName = named.indexOf(item.group ?? '');
    if (byName >= 0 && byName < 4) return byName;
    return index % 4;
  };
  const unmatched = chart.items.some((item) => {
    const at = named.indexOf(item.group ?? '');
    return at < 0 || at >= 4;
  });

  const cells: ChartItem[][] = [[], [], [], []];
  chart.items.forEach((item, i) => cells[cellOf(item, i)].push(item));

  /* Each ROW of cells takes the height its fuller half needs, so the two
     columns still line up and neither is padded to a number nobody chose. */
  const rowHeights = [0, 1].map((row) =>
    Math.max(
      CELL_H_MIN,
      CELL_HEAD_H + Math.max(cells[row * 2].length, cells[row * 2 + 1].length) * CELL_ROW_H,
    ),
  );
  const left = PAD + 20;
  const top = PAD + 16;
  const gridH = rowHeights[0] + rowHeights[1];
  const width = left + CELL_W * 2 + PAD;
  const height = top + gridH + PAD + 16;

  const honest = [
    note,
    unmatched
      ? 'some items name no quadrant, so they were placed in listed order — a 2x2 position needs two numbers the spec does not carry'
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ChartFrame chart={chart} width={width} height={height} note={honest || undefined}>
      {cells.map((cell, i) => {
        const cx = left + (i % 2) * CELL_W;
        const cy = top + (i < 2 ? 0 : rowHeights[0]);
        return (
          <g key={`cell-${i}`} data-quadrant={named[i] ?? String(i + 1)}>
            <rect
              className="cplate"
              x={r(cx)}
              y={r(cy)}
              width={CELL_W}
              height={r(rowHeights[i < 2 ? 0 : 1])}
            />
            {named[i] ? <Caption x={cx + 8} y={cy + 16} text={fitText(named[i], CELL_W - 16)} /> : null}
            {cell.map((item, j) => (
              <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
                <title>{item.detail ? `${item.label} — ${item.detail}` : item.label}</title>
                <circle className="cbar" cx={r(cx + 16)} cy={r(cy + 34 + j * 20)} r={4} />
                <text className="clabel" x={r(cx + 28)} y={r(cy + 38 + j * 20)}>
                  {fitText(item.label, CELL_W - 40)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      <line className="caxis" x1={r(left + CELL_W)} y1={r(top)} x2={r(left + CELL_W)} y2={r(top + gridH)} />
      <line
        className="caxis"
        x1={r(left)}
        y1={r(top + rowHeights[0])}
        x2={r(left + CELL_W * 2)}
        y2={r(top + rowHeights[0])}
      />
      {chart.axes?.x ? (
        <text className="caxis-label" x={r(left + CELL_W)} y={r(height - PAD)} textAnchor="middle">
          {chart.axes.x}
        </text>
      ) : null}
      {chart.axes?.y ? <Caption x={PAD} y={PAD + 8} text={chart.axes.y} /> : null}
    </ChartFrame>
  );
}

/* ──────────────────────────────────────────────────────────────── venn ── */

function Venn({ chart, note }: FamilyChartProps) {
  const keys = groupKeys(chart.items, chart.axes?.columns);
  /* Two or three sets. A four-set Venn has fourteen regions and no honest
     circular drawing, so the fourth group onward is listed as an overlap
     rather than drawn as a lie. */
  const drawn = keys.slice(0, Math.min(3, Math.max(1, keys.length)));
  const spare = keys.slice(drawn.length);

  const centres: [number, number][] =
    drawn.length >= 3
      ? [
          [PAD + VENN_R + 40, PAD + VENN_R],
          [PAD + VENN_R + 120, PAD + VENN_R],
          [PAD + VENN_R + 80, PAD + VENN_R + 74],
        ]
      : drawn.length === 2
        ? [
            [PAD + VENN_R, PAD + VENN_R],
            [PAD + VENN_R + 104, PAD + VENN_R],
          ]
        : [[PAD + VENN_R, PAD + VENN_R]];

  const width = PAD * 2 + VENN_R * 2 + (drawn.length >= 2 ? 120 : 0) + 40;
  const height = PAD * 2 + VENN_R * 2 + (drawn.length >= 3 ? 90 : 0) + spare.length * 20;

  const honest = [
    note,
    /* THE OVERLAP IS DRAWN AND CANNOT BE POPULATED, AND SAYING SO IS THE POINT.
       A ChartItem carries ONE `group`, so nothing in this contract can express
       "in both sets" — the lens where two circles cross is exactly the region a
       Venn exists to show, and it will always be empty here. A reader who is not
       told that will read an empty lens as "nothing is shared", which is a claim
       the spec never made. */
    drawn.length > 1
      ? 'the overlap is empty because an item carries one group — this contract cannot say "in both sets"'
      : undefined,
    spare.length > 0 ? `${spare.length} further set(s) listed rather than drawn — three is the honest ceiling for circles` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ChartFrame chart={chart} width={width} height={height} note={honest || undefined}>
      {drawn.map((key, i) => {
        const members = inGroup(chart.items, key);
        /* A set takes the tone of its FIRST member, because a set is not an
           item and has no tone of its own. Untoned members leave the ring
           grey, which is the honest default. */
        const setTone = toneClass(members[0]?.tone);
        return (
          <g key={key || `set-${i}`} data-set={key}>
            <circle className={`cvenn ${setTone}`} cx={r(centres[i][0])} cy={r(centres[i][1])} r={VENN_R} />
            <Caption
              x={centres[i][0]}
              y={r(centres[i][1] - VENN_R + 16)}
              anchor="middle"
              text={fitText(key || 'set', VENN_R * 2 - 20)}
            />
            {members.map((item, j) => (
              <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
                <title>{item.detail ? `${item.label} — ${item.detail}` : item.label}</title>
                <text className="clabel" x={r(centres[i][0])} y={r(centres[i][1] - 6 + j * 16)} textAnchor="middle">
                  {fitText(item.label, VENN_R * 1.4)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {spare.map((key, i) => (
        <text key={`spare-${key}`} className="cdetail" x={PAD} y={r(height - PAD - i * 16)}>
          {fitText(`${key}: ${inGroup(chart.items, key).map((it) => it.label).join(', ')}`, width - PAD * 2)}
        </text>
      ))}
    </ChartFrame>
  );
}

/* ──────────────────────────────────────────────────────────── spectrum ── */

function Spectrum({ chart, note }: FamilyChartProps) {
  const positioned = chart.items.every((it) => Number.isFinite(it.value));
  const [lo, hi] = positioned
    ? extent(chart.items.map((it) => it.value as number), false)
    : [0, Math.max(1, chart.items.length - 1)];

  const left = PAD + 60;
  const axisW = SPECTRUM_W;
  const width = left + axisW + PAD + 60;
  const height = PAD * 2 + SPECTRUM_H;
  const mid = PAD + SPECTRUM_H / 2;
  const xOf = (value: number): number => left + (hi === lo ? 0.5 : (value - lo) / (hi - lo)) * axisW;

  return (
    <ChartFrame chart={chart} width={width} height={height} note={note}>
      <line className="caxis" x1={r(left)} y1={r(mid)} x2={r(left + axisW)} y2={r(mid)} />
      {chart.axes?.x ? <Caption x={left} y={r(mid + 26)} text={chart.axes.x} /> : null}
      {chart.axes?.y ? <Caption x={left + axisW} y={r(mid + 26)} anchor="end" text={chart.axes.y} /> : null}
      {chart.items.map((item, i) => {
        const x = positioned ? xOf(item.value as number) : xOf(i);
        const above = i % 2 === 0;
        const y = above ? mid - 18 : mid + 18;
        return (
          <g key={item.id} {...itemAttrs(item, chart.focusItemId)}>
            <title>{item.detail ? `${item.label} — ${item.detail}` : item.label}</title>
            <line className="cspine" x1={r(x)} y1={r(mid)} x2={r(x)} y2={r(above ? y + 6 : y - 10)} />
            <circle className="cbar" cx={r(x)} cy={r(mid)} r={4} />
            <text className="clabel" x={r(x)} y={r(y)} textAnchor="middle">
              {fitText(item.label, 120)}
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}
