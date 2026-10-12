import type { ReactNode } from 'react';

/**
 * THE BENCHMARK CHARTS. Plain HTML on a linear scale: every bar, dot and tick
 * is placed by a percentage of a fixed axis, so nothing is measured after
 * render, nothing shifts, and the text stays real text at every width.
 * Axes always start at zero and carry their unit; ticks are evenly spaced so
 * the gridlines are one CSS background.
 */

export type Tone = 'seq' | 'base' | 'soft';

const at = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

function Frame({
  title,
  sub,
  legend,
  children,
  foot,
}: {
  title: string;
  sub?: string;
  legend?: readonly { tone: Tone; label: string }[];
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <figure className="bn-chart">
      <figcaption className="bn-chart-head">
        <p className="bn-chart-title">{title}</p>
        {sub ? <p className="bn-chart-sub">{sub}</p> : null}
        {legend ? <Legend items={legend} /> : null}
      </figcaption>
      {/* The body sits at the bottom, so two charts side by side share their axis line. */}
      <div className="bn-chart-body">{children}</div>
      {foot ? <div className="bn-chart-foot">{foot}</div> : null}
    </figure>
  );
}

function Axis({ ticks, unit, fmt }: { ticks: readonly number[]; unit: string; fmt: (n: number) => string }) {
  const max = ticks[ticks.length - 1]!;
  return (
    <>
      <div className="bn-row bn-axis" aria-hidden="true">
        <span />
        <div className="bn-ticks">
          {ticks.map((t, i) => (
            <span key={t} className={i === 0 ? 'is-first' : i === ticks.length - 1 ? 'is-last' : ''} style={{ left: at(t, max) }}>
              {fmt(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="bn-row bn-axis-title" aria-hidden="true">
        <span />
        <span>{unit}</span>
      </div>
    </>
  );
}

const gridStyle = (ticks: readonly number[]) => ({ ['--bn-steps' as string]: String(ticks.length - 1) });

export type BarRow = { label: string; value: number; shown: string; tone?: Tone; note?: string };

/** Horizontal bars on one linear axis from 0 to the last tick. */
export function HBars({
  title,
  sub,
  rows,
  ticks,
  unit,
  tickFmt,
  foot,
}: {
  title: string;
  sub?: string;
  rows: readonly BarRow[];
  ticks: readonly number[];
  unit: string;
  tickFmt: (n: number) => string;
  foot?: ReactNode;
}) {
  const max = ticks[ticks.length - 1]!;
  return (
    <Frame title={title} sub={sub} foot={foot}>
      <div className="bn-plot" style={gridStyle(ticks)} role="list">
        {rows.map((r) => {
          const p = (r.value / max) * 100;
          const inside = p > 70;
          return (
            <div key={`${r.label}|${r.note ?? ''}`} className="bn-row" role="listitem" aria-label={`${r.label}${r.note ? `, ${r.note}` : ''}: ${r.shown}`}>
              <span className="bn-label">
                {r.label}
                {r.note ? <span className="bn-label-note">{r.note}</span> : null}
              </span>
              <div className="bn-track">
                <div className={`bn-fill is-${r.tone ?? 'base'}`} style={{ width: at(r.value, max) }} />
                <span
                  className={`bn-val ${inside ? 'is-inside' : ''} ${r.tone === 'seq' ? 'is-seq' : ''}`}
                  style={inside ? { right: `calc(${100 - p}% + 10px)` } : { left: `calc(${at(r.value, max)} + 8px)` }}
                >
                  {r.shown}
                </span>
              </div>
            </div>
          );
        })}
        <Axis ticks={ticks} unit={unit} fmt={tickFmt} />
      </div>
    </Frame>
  );
}

export type DumbRow = { label: string; from: number; to: number; fromShown: string; toShown: string; note?: string };

/** From a grey dot (without) to a blue dot (with), per row, on one axis. */
export function Dumbbell({
  title,
  sub,
  rows,
  ticks,
  unit,
  tickFmt,
  legend,
  foot,
}: {
  title: string;
  sub?: string;
  rows: readonly DumbRow[];
  ticks: readonly number[];
  unit: string;
  tickFmt: (n: number) => string;
  legend: readonly [string, string];
  foot?: ReactNode;
}) {
  const max = ticks[ticks.length - 1]!;
  return (
    <Frame title={title} sub={sub} foot={foot} legend={[{ tone: 'base', label: legend[0] }, { tone: 'seq', label: legend[1] }]}>
      <div className="bn-plot" style={gridStyle(ticks)} role="list">
        {rows.map((r) => {
          const lo = Math.min(r.from, r.to);
          const hi = Math.max(r.from, r.to);
          /* Labels point away from each other: the lower one ends at its dot (unless it hugs zero),
             the higher one begins at its dot (or ends there at the right edge). */
          const side = (v: number) => (v === lo && v !== hi ? (v / max < 0.1 ? '' : 'is-end') : v / max > 0.9 ? 'is-end' : 'is-start');
          return (
            <div key={`${r.label}|${r.note ?? ''}`} className="bn-row" role="listitem" aria-label={`${r.label}: ${r.fromShown} to ${r.toShown}`}>
              <span className="bn-label">
                {r.label}
                {r.note ? <span className="bn-label-note">{r.note}</span> : null}
              </span>
              <div className="bn-track is-thin">
                <span className={`bn-link ${r.to < r.from ? 'is-down' : ''}`} style={{ left: at(lo, max), width: `calc(${at(hi, max)} - ${at(lo, max)})` }} />
                <span className="bn-dot is-base" style={{ left: at(r.from, max) }} />
                <span className="bn-dot is-seq" style={{ left: at(r.to, max) }} />
                <span className={`bn-dval is-base ${side(r.from)}`} style={{ left: at(r.from, max) }}>
                  {r.fromShown}
                </span>
                <span className={`bn-dval is-seq ${side(r.to)}`} style={{ left: at(r.to, max) }}>
                  {r.toShown}
                </span>
              </div>
            </div>
          );
        })}
        <Axis ticks={ticks} unit={unit} fmt={tickFmt} />
      </div>
    </Frame>
  );
}

export type StripRow = { label: string; runs: readonly number[]; tone: Tone; meanShown: string; mean: number };

/** Every run as its own dot, the mean as a tick: the noise, drawn. */
export function DotStrip({
  title,
  sub,
  rows,
  ticks,
  unit,
  tickFmt,
  foot,
}: {
  title: string;
  sub?: string;
  rows: readonly StripRow[];
  ticks: readonly number[];
  unit: string;
  tickFmt: (n: number) => string;
  foot?: ReactNode;
}) {
  const max = ticks[ticks.length - 1]!;
  return (
    <Frame title={title} sub={sub} foot={foot}>
      <div className="bn-plot" style={gridStyle(ticks)} role="list">
        {rows.map((r) => (
          <div key={r.label} className="bn-row" role="listitem" aria-label={`${r.label}: runs ${r.runs.join(', ')}, mean ${r.meanShown}`}>
            <span className="bn-label">{r.label}</span>
            <div className="bn-track is-thin">
              {r.runs.map((v, i) => (
                <span key={i} className={`bn-dot is-run is-${r.tone}`} style={{ left: at(v, max) }} />
              ))}
              <span className={`bn-mean is-${r.tone}`} style={{ left: at(r.mean, max) }} />
              <span className={`bn-dval is-${r.tone}`} style={{ left: at(r.mean, max) }}>
                {r.meanShown}
              </span>
            </div>
          </div>
        ))}
        <Axis ticks={ticks} unit={unit} fmt={tickFmt} />
      </div>
    </Frame>
  );
}

export type ColGroup = { label: string; bars: readonly { value: number; shown: string; tone: Tone }[] };

/** Grouped vertical bars on a fixed-height plot, y from 0 to the last tick. */
export function Columns({
  title,
  sub,
  groups,
  ticks,
  unit,
  tickFmt,
  xTitle,
  legend,
  foot,
}: {
  title: string;
  sub?: string;
  groups: readonly ColGroup[];
  ticks: readonly number[];
  unit: string;
  tickFmt: (n: number) => string;
  xTitle: string;
  legend: readonly { tone: Tone; label: string }[];
  foot?: ReactNode;
}) {
  const max = ticks[ticks.length - 1]!;
  return (
    <Frame title={title} sub={sub} foot={foot} legend={legend}>
      <div className="bn-cols">
        <span className="bn-cols-unit" aria-hidden="true">
          {unit}
        </span>
        <div className="bn-cols-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: at(t, max) }}>
              {tickFmt(t)}
            </span>
          ))}
        </div>
        <div className="bn-cols-plot" style={gridStyle(ticks)} role="list">
          {groups.map((g) => (
            <div key={g.label} className="bn-col-group" role="listitem" aria-label={`${g.label}: ${g.bars.map((b) => b.shown).join(' against ')}`}>
              <div className="bn-col-bars">
                {g.bars.map((b, i) => (
                  <div key={i} className="bn-col-slot">
                    <span className={`bn-col-val is-${b.tone}`} style={{ bottom: `calc(${at(b.value, max)} + 6px)` }}>
                      {b.shown}
                    </span>
                    <div className={`bn-col is-${b.tone}`} style={{ height: at(b.value, max) }} />
                  </div>
                ))}
              </div>
              <span className="bn-col-x">{g.label}</span>
            </div>
          ))}
        </div>
        <span />
        <span className="bn-cols-xtitle" aria-hidden="true">
          {xTitle}
        </span>
      </div>
    </Frame>
  );
}

export function Legend({ items }: { items: readonly { tone: Tone; label: string }[] }) {
  return (
    <ul className="bn-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`bn-swatch is-${i.tone}`} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
