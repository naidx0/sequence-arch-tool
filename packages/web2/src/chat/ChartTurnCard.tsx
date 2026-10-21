/*
 * A CHART THE TURN DREW, INLINE (owner, 2026-10-12): the source of truth can be
 * the board or the canvas, and it can still show as a little diagram in line,
 * with the option to open it in the surface. The card is the drawing card's
 * chrome (VisualCard, as DiagramBlock uses it) around the chart view; its Open
 * action opens the surface the chart lives on. Lazy: the chart renderers stay
 * out of the boot chunk, like the visual kit.
 */
import type { SeqChart } from '@sequence/schema';

import { SeqChartView } from '../charts/SeqChartView';
import { VisualCard } from './VisualCard';
import { CardAction } from './VisualActions';

export function ChartTurnCard({ chart, onOpen }: { chart: SeqChart; onOpen?: () => void }) {
  return (
    <VisualCard
      kind="chart"
      state="drawn"
      label="Chart"
      source={`chart:${chart.title}:${chart.kind}:${chart.items.length}`}
      resizable
      scaled
      actions={onOpen ? <CardAction icon="open" testId="chat-chart-open" tip="Open on surface" onClick={onOpen} /> : null}
    >
      <div className="dgm-art" data-testid="chat-chart-inline">
        <SeqChartView chart={chart} />
      </div>
    </VisualCard>
  );
}

export default ChartTurnCard;
