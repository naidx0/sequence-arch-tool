/* ══════════════════════════════════════════════════════════════════════════
   THE CHART FRAME — title, caption, scroll box, accessible name
   packages/web2/src/charts/ChartFrame.tsx

   Every family draws different geometry and NONE of them draws its own chrome.
   The frame is written once because three of its decisions are product laws
   rather than layout taste:

   1. THE CAPTION IS NOT DECORATION. chart.ts calls it "One sentence: what this
      picture is claiming." A picture is believed faster than prose, so the
      claim it is making is printed beside it in words that can be argued with.

   2. THE SCROLL LIVES IN THE CHART, NEVER IN THE PAGE. A twelve-layer flow is
      wider than a 392px chat column and there is no honest way to shrink it to
      fit; what there is no excuse for is a chart that pushes the transcript
      sideways. The overflow is owned by one box, and that box is this one.

   3. role="img" SITS ON THE SVG AND THE TITLE STAYS IN THE DOCUMENT. Putting
      the role on the outer figure would swallow the title and caption into the
      label and leave a screen reader with one long string and no headings;
      putting it on the svg names the drawing, and the words stay words.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ReactNode } from 'react';

import type { SeqChart } from '@sequence/schema';
import { chartFamily } from '@sequence/schema';

/**
 * What every family renderer takes, and all it takes.
 *
 * Declared HERE rather than in whichever family happened to be written first,
 * so the eight renderers depend on the frame and never on each other.
 */
export interface FamilyChartProps {
  chart: SeqChart;
  /** An honest line about what this renderer could not do with this spec. */
  note?: string;
}

export interface ChartFrameProps {
  chart: SeqChart;
  /** Intrinsic drawing size, in the same units as the children's coordinates. */
  width: number;
  height: number;
  /** An honest line about what this renderer could not do with the spec. */
  note?: string;
  children: ReactNode;
}

/** The accessible name: the title, then the claim, then how much is drawn. */
export function chartLabel(chart: SeqChart): string {
  const parts = [`${chart.kind} chart: ${chart.title}`];
  if (chart.caption) parts.push(chart.caption);
  parts.push(`${chart.items.length} item${chart.items.length === 1 ? '' : 's'}`);
  if (chart.focusItemId) {
    const focused = chart.items.find((it) => it.id === chart.focusItemId);
    if (focused) parts.push(`focused on ${focused.label}`);
  }
  return parts.join('. ');
}

export function ChartFrame({ chart, width, height, note, children }: ChartFrameProps) {
  /* THE VIEWPORT IS ROUNDED HERE AND NOWHERE ELSE. A ring layout divides by pi
     and hands back 352.9296009798979; that number is deterministic, but it is
     also seventeen digits of float in a DOM attribute, and the last of them are
     exactly what two engines are free to disagree about when serialising. One
     ceil, at the one place every family passes through. */
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  return (
    <figure
      className="seqchart"
      data-testid="seqchart"
      data-kind={chart.kind}
      data-family={chartFamily(chart.kind)}
      /* The spotlight is a state of the whole figure, so the dim rule can be
         written once against the figure rather than per family. */
      data-focus={chart.focusItemId ? 'on' : 'off'}
    >
      <figcaption className="seqchart-hd">
        <span className="seqchart-title" data-testid="seqchart-title">
          {chart.title}
        </span>
        {chart.caption ? (
          <span className="seqchart-cap" data-testid="seqchart-cap">
            {chart.caption}
          </span>
        ) : null}
      </figcaption>
      <div className="seqchart-scroll" data-testid="seqchart-scroll">
        <svg
          className="seqchart-svg"
          data-testid="seqchart-svg"
          role="img"
          aria-label={chartLabel(chart)}
          viewBox={`0 0 ${w} ${h}`}
          width={w}
          height={h}
        >
          {children}
        </svg>
      </div>
      {note ? (
        <p className="seqchart-note" data-testid="seqchart-note">
          {note}
        </p>
      ) : null}
    </figure>
  );
}
