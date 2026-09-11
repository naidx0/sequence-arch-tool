/* ══════════════════════════════════════════════════════════════════════════
   CARDS — two kinds, one grid
   packages/web2/src/charts/CardsChart.tsx

   statistic-cards · scorecard

   THE NUMBER IS THE MARK. This is the one family where there is no geometry to
   read — the reader reads digits — so the whole design is typographic: the
   value in mono at the top of the type ramp, the label under it, the detail
   under that in the quietest ink. Mono is not a style choice here, it is
   tokens/graphite.css's rule that "every number, identifier, path, log line"
   sets in JetBrains Mono, and the reason is column alignment: four statistic
   cards whose digits do not line up read as four unrelated facts.

   A SCORECARD ADDS A TRACK, AND THE TRACK IS RELATIVE TO THE CHART'S OWN
   MAXIMUM, WHICH IS SAID ON THE CARD. There is no field in ChartItem for a
   denominator — no `max`, no `target` — so a filled bar that implied "out of
   100" would be inventing the scale. The bar therefore says what it is: this
   value against the largest value present. When the contract grows a target
   field this becomes a real gauge; until then it is a comparison and is
   labelled as one.

   A CARD WITH NO VALUE STILL DRAWS. It shows an em dash where the number goes,
   because "this metric was not measured" is information and a missing card is
   not.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, SeqChart } from '@sequence/schema';

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { PAD, fitText, formatValue, itemAttrs, r } from './chartLayout.js';

const CARD_W = 176;
const CARD_H = 96;
const CARD_GAP = 12;
const PER_ROW = 4;
const TRACK_H = 8;

export function CardsChart({ chart, note }: FamilyChartProps) {
  const scored = chart.kind === 'scorecard';
  const columns = Math.min(PER_ROW, Math.max(1, chart.items.length));
  const rows = Math.ceil(chart.items.length / columns);

  const width = PAD * 2 + columns * CARD_W + (columns - 1) * CARD_GAP;
  const height = PAD * 2 + rows * CARD_H + (rows - 1) * CARD_GAP;

  const values = chart.items
    .map((it) => (Number.isFinite(it.value) ? Math.abs(it.value as number) : 0));
  const top = Math.max(...values, 0);

  const honest = [
    note,
    scored && top > 0 ? 'bars are each value against the largest on this card set — the spec carries no target' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ChartFrame chart={chart} width={width} height={height} note={honest || undefined}>
      {chart.items.map((item, i) => (
        <Card
          key={item.id}
          chart={chart}
          item={item}
          x={PAD + (i % columns) * (CARD_W + CARD_GAP)}
          y={PAD + Math.floor(i / columns) * (CARD_H + CARD_GAP)}
          share={top > 0 ? values[i] / top : 0}
          scored={scored}
        />
      ))}
    </ChartFrame>
  );
}

interface CardProps {
  chart: SeqChart;
  item: ChartItem;
  x: number;
  y: number;
  share: number;
  scored: boolean;
}

function Card({ chart, item, x, y, share, scored }: CardProps) {
  const value = Number.isFinite(item.value) ? formatValue(item.value as number) : '—';
  const detail = item.detail ?? '';
  return (
    <g {...itemAttrs(item, chart.focusItemId)}>
      <title>{`${item.label}: ${value}${detail ? ` — ${detail}` : ''}`}</title>
      <rect className="ccard" x={r(x)} y={r(y)} width={CARD_W} height={CARD_H} rx={8} ry={8} />
      <text className="cbignum" x={r(x + 14)} y={r(y + 36)}>
        {fitText(value, CARD_W - 28)}
      </text>
      <text className="clabel" x={r(x + 14)} y={r(y + 56)}>
        {fitText(item.label, CARD_W - 28)}
      </text>
      {detail ? (
        <text className="cdetail" x={r(x + 14)} y={r(y + 72)}>
          {fitText(detail, CARD_W - 28)}
        </text>
      ) : null}
      {scored ? (
        <>
          <rect
            className="cbar-track"
            x={r(x + 14)}
            y={r(y + CARD_H - 18)}
            width={CARD_W - 28}
            height={TRACK_H}
            rx={2}
            ry={2}
          />
          <rect
            className="cbar"
            x={r(x + 14)}
            y={r(y + CARD_H - 18)}
            width={r(Math.max(0, (CARD_W - 28) * share))}
            height={TRACK_H}
            rx={2}
            ry={2}
          />
        </>
      ) : null}
    </g>
  );
}
