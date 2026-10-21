/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL KIT: ANALYTICS
   packages/schema/src/visual/charts.ts

   line (+area, forecast band, threshold), bar (grouped, stacked, horizontal),
   kpi tiles, sparkline, histogram with percentile marks, donut.
   Each takes a small JSON spec and returns deterministic SVG markup.
   ══════════════════════════════════════════════════════════════════════════ */

import { arr, bool, num, obj, oneOf, opt, run, str, strOrNum } from './check.js';
import type { Component } from './types.js';
import { C, HAIR, KPI_VALUE, MAX_H, SOFT, TINT, big, cap, clamp, el, esc, fit, fmt, line1, g, niceTicks, n, percentile, series, text, textW, utilColor, withUnit, type Frag } from './util.js';

const WIDTH = obj({ width: opt(num({ min: 280, max: 1200, int: true })) });
void WIDTH;

/** Title and subtitle block: returns the markup and the y where content may start. */
export function header(title: string | undefined, subtitle: string | undefined, width: number): { svg: string; h: number } {
  if (!title && !subtitle) return { svg: '', h: 0 };
  let svg = '';
  let h = 0;
  /* one line each (the kit never wraps a title); a title longer than the width is cut with its full text as a tooltip */
  if (title) {
    svg += line1(width / 2, 14, cap(title), width, { size: 14, bold: true, anchor: 'middle' });
    h = 22;
  }
  if (subtitle) {
    svg += line1(width / 2, h + 12, cap(subtitle), width, { fill: C.muted, anchor: 'middle' });
    h += 20;
  }
  return { svg, h: h + 6 };
}

/** Legend of [name, colour] swatches from x=0: items never wrap or drop; a row that is full starts another row (18 px each). */
function legend(items: readonly (readonly [string, string, boolean?])[], y: number, maxW: number): { svg: string; w: number; h: number } {
  let x = 0;
  let row = 0;
  let used = 0;
  let svg = '';
  for (const [name, color, dashed] of items) {
    const room = Math.min(160, maxW - 33);
    const w = 18 + Math.min(textW(name, 11), room) + 16;
    if (x + w - 16 > maxW && x > 0) {
      row += 1;
      x = 0;
    }
    const yy = y + row * 18;
    svg += dashed
      ? el('line', { x1: x, y1: yy, x2: x + 12, y2: yy, stroke: color, 'stroke-width': 2, 'stroke-dasharray': '3 2' })
      : el('rect', { x, y: yy - 5, width: 12, height: 10, rx: 2, fill: color, 'fill-opacity': SOFT });
    svg += line1(x + 17, yy, name, room, { size: 11, fill: C.muted, mid: true });
    x += w;
    used = Math.max(used, x);
  }
  return { svg, w: used, h: (row + 1) * 18 };
}

const unitOf = (u: string | undefined): string | undefined => (u === '' ? undefined : u);

/* ───────────────────────────── line ───────────────────────────── */

const lineCheck = obj({
  title: opt(str({ max: 90 })),
  subtitle: opt(str({ max: 140 })),
  x: arr(strOrNum(), { min: 2, max: 400 }),
  series: arr(obj({ name: str({ max: 40 }), values: arr(num(), { min: 2, max: 400 }), area: opt(bool()) }), { min: 1, max: 6 }),
  unit: opt(str({ max: 12, allowEmpty: true })),
  forecast: opt(
    obj({
      from: opt(num({ min: 1, int: true })),
      periods: opt(num({ min: 1, max: 60, int: true })),
      low: opt(arr(num(), { max: 400 })),
      high: opt(arr(num(), { max: 400 })),
    }),
  ),
  threshold: opt(obj({ value: num(), label: opt(str({ max: 40 })) })),
  yMin: opt(num()),
  yMax: opt(num()),
  height: opt(num({ min: 140, max: 600, int: true })),
  width: opt(num({ min: 280, max: 1200, int: true })),
});
export type LineSpec = ReturnType<typeof lineCheck>;

interface LineModel {
  labels: string[];
  names: string[];
  values: number[][];
  area: boolean[];
  from: number | null;
  low: number[] | null;
  high: number[] | null;
}

/** Least-squares trend over the last `m` points, with a band that widens with distance. */
function trend(values: readonly number[], periods: number): { pred: number[]; low: number[]; high: number[] } {
  const m = Math.min(values.length, 12);
  const ys = values.slice(values.length - m);
  const mx = (m - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / m;
  let sxx = 0;
  let sxy = 0;
  ys.forEach((y, i) => {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (y - my);
  });
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const resid = ys.map((y, i) => y - (a + b * i));
  const sd = m > 2 ? Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / (m - 2)) : 0;
  const sigma = Math.max(sd, Math.abs(my) * 0.02);
  const pred: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  for (let k = 1; k <= periods; k += 1) {
    const p = a + b * (m - 1 + k);
    const half = 1.28 * sigma * (1 + 0.15 * k);
    pred.push(p);
    low.push(p - half);
    high.push(p + half);
  }
  return { pred, low, high };
}

function lineModel(s: LineSpec): LineModel {
  const n0 = s.series[0]!.values.length;
  const names = s.series.map((x) => x.name);
  const values = s.series.map((x) => x.values.slice());
  const area = s.series.map((x) => x.area === true);
  const labels = s.x.map((v) => String(v));
  const f = s.forecast;
  if (!f) return { labels, names, values, area, from: null, low: null, high: null };
  if (f.periods !== undefined) {
    let low: number[] | null = null;
    let high: number[] | null = null;
    values.forEach((vs, i) => {
      const t = trend(vs, f.periods!);
      vs.push(...t.pred);
      if (i === 0) {
        low = [...t.low];
        high = [...t.high];
      }
    });
    while (labels.length < n0 + f.periods) labels.push(`+${labels.length - n0 + 1}`);
    return { labels, names, values, area, from: n0, low, high };
  }
  return { labels, names, values, area, from: f.from ?? null, low: f.low ?? null, high: f.high ?? null };
}

function lineProblems(s: LineSpec, p: { add(m: string): void }): void {
  const n0 = s.series[0]!.values.length;
  s.series.forEach((x, i) => {
    if (x.values.length !== n0) p.add(`spec.series[${i}].values: has ${x.values.length} values but series[0] has ${n0}; every series needs the same number`);
  });
  const f = s.forecast;
  if (f) {
    if (f.periods !== undefined && f.from !== undefined) p.add('spec.forecast: give periods (auto trend) or from (+ low/high), not both');
    if (f.periods === undefined && f.from === undefined) p.add('spec.forecast: give periods (auto trend, e.g. 6) or from (index where the forecast starts)');
    if (f.from !== undefined && f.from >= n0) p.add(`spec.forecast.from: ${f.from} is past the last point (${n0 - 1})`);
    if ((f.low === undefined) !== (f.high === undefined)) p.add('spec.forecast: low and high go together');
    if (f.low && f.high && f.from !== undefined) {
      const want = n0 - f.from;
      if (f.low.length !== want) p.add(`spec.forecast.low: needs ${want} values (points from index ${f.from} on), got ${f.low.length}`);
      if (f.high.length !== want) p.add(`spec.forecast.high: needs ${want} values (points from index ${f.from} on), got ${f.high.length}`);
    }
    if (f.low && f.periods !== undefined) p.add('spec.forecast: low/high are only for from; periods computes its own band');
  }
  if (s.yMin !== undefined && s.yMax !== undefined && s.yMin >= s.yMax) p.add(`spec.yMin: ${s.yMin} must be below yMax (${s.yMax})`);
  const total = n0 + (f?.periods ?? 0);
  if (s.x.length !== n0 && s.x.length !== total) p.add(`spec.x: has ${s.x.length} labels but the series have ${n0} points${f?.periods ? ` (${total} with the forecast)` : ''}`);
}

function renderLine(s: LineSpec, width: number): Frag {
  const m = lineModel(s);
  const N = m.labels.length;
  const unit = unitOf(s.unit);
  const hd = header(s.title, s.subtitle, width);
  const showLegend = m.names.length > 1 || m.from !== null;
  const legendY = hd.h + 8;
  const legendItems: [string, string, boolean?][] = m.names.map((nm, i) => [nm, series(i)]);
  if (m.from !== null) legendItems.push(['Forecast', C.muted, true]);
  const lg = showLegend ? legend(legendItems, 0, width) : null;
  const top = hd.h + (lg ? lg.h + 6 : 6);
  /* the size scale: a line chart is at most MAX_H.line tall at any asked height */
  const H = Math.min(s.height ?? 240, MAX_H.line!);
  const bottom = 28;
  const ph = H - top - bottom;

  const all = m.values.flat();
  if (m.low) all.push(...m.low);
  if (m.high) all.push(...m.high);
  if (s.threshold) all.push(s.threshold.value);
  const dmin = Math.min(...all);
  const dmax = Math.max(...all);
  const anyArea = m.area.some(Boolean);
  const lo = s.yMin ?? (anyArea || (dmin >= 0 && dmin <= dmax * 0.5) ? Math.min(0, dmin) : dmin);
  const hi = s.yMax ?? dmax;
  const ticks = niceTicks(lo, hi, 4);
  const yMin = s.yMin ?? ticks.min;
  const yMax = s.yMax ?? ticks.max;
  const tickLabels = ticks.ticks.filter((t) => t >= yMin - 1e-9 && t <= yMax + 1e-9).map((t) => ({ t, label: unit === '%' ? `${fmt(t)}%` : fmt(t) }));
  const left = Math.max(...tickLabels.map((t) => textW(t.label, 11)), 8) + 10;

  /* End-of-line labels need room on the right. */
  const lastActual = m.from !== null ? m.from - 1 : N - 1;
  const endLabels = m.values.map((vs) => withUnit(vs[N - 1]!, unit));
  const right = Math.max(...endLabels.map((l) => textW(l, 11)), 20) + 14;
  const pw = Math.max(60, width - left - right);
  const X = (i: number): number => left + (N === 1 ? 0 : (i / (N - 1)) * pw);
  const Y = (v: number): number => top + ph - ((clamp(v, yMin, yMax) - yMin) / (yMax - yMin || 1)) * ph;

  let svg = hd.svg;
  if (lg) svg += g({ transform: `translate(0 ${n(legendY)})` }, lg.svg);
  /* grid and y labels */
  let grid = '';
  for (const t of tickLabels) {
    const y = Y(t.t);
    grid += el('line', { x1: left, y1: y, x2: left + pw, y2: y });
  }
  svg += g({ stroke: C.edge, 'stroke-width': 1, opacity: 0.7 }, grid);
  svg += g({}, tickLabels.map((t) => text(left - 6, Y(t.t), t.label, { size: 11, fill: C.muted, anchor: 'end', mid: true })).join(''));
  /* x labels: about every step so none overlap */
  const widest = Math.max(...m.labels.map((l) => textW(l, 11)));
  const every = Math.max(1, Math.ceil((widest + 12) / (pw / Math.max(1, N - 1))));
  let xl = '';
  for (let i = 0; i < N; i += every) {
    const anchor = i === 0 && left < widest / 2 ? 'start' : 'middle';
    xl += line1(X(i), top + ph + 17, m.labels[i]!, Math.max(40, every * (pw / Math.max(1, N - 1))), { size: 11, fill: C.muted, anchor });
  }
  svg += xl;
  /* forecast band and separator */
  if (m.from !== null) {
    const x0 = X(m.from - 1);
    svg += el('line', { x1: x0, y1: top, x2: x0, y2: top + ph, stroke: C.muted, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.6 });
    svg += text(x0 + 5, top + 9, 'Forecast', { size: 11, fill: C.muted });
    if (m.low && m.high) {
      const anchorV = m.values[0]![m.from - 1]!;
      const up = [`${n(x0)},${n(Y(anchorV))}`];
      const dn: string[] = [];
      m.high.forEach((v, k) => up.push(`${n(X(m.from! + k))},${n(Y(v))}`));
      m.low.forEach((v, k) => dn.push(`${n(X(m.from! + k))},${n(Y(v))}`));
      svg += el('polygon', { points: [...up, ...dn.reverse()].join(' '), fill: series(0), 'fill-opacity': 0.14 });
    }
  }
  /* threshold */
  if (s.threshold) {
    const y = Y(s.threshold.value);
    svg += el('line', { x1: left, y1: y, x2: left + pw, y2: y, stroke: C.bad, 'stroke-width': 1.2, 'stroke-dasharray': '5 3' });
    svg += text(left + pw, y - 4, s.threshold.label ?? `limit ${withUnit(s.threshold.value, unit)}`, { size: 11, fill: C.bad, anchor: 'end' });
  }
  /* area, lines */
  const base = Y(Math.max(yMin, Math.min(0, yMax)));
  m.values.forEach((vs, si) => {
    const color = series(si);
    const cut = m.from ?? N;
    const act = vs.slice(0, cut).map((v, i) => `${n(X(i))},${n(Y(v))}`);
    if (m.area[si] && act.length > 1) {
      svg += el('polygon', { points: `${n(X(0))},${n(base)} ${act.join(' ')} ${n(X(cut - 1))},${n(base)}`, fill: color, 'fill-opacity': 0.14 });
    }
    svg += el('polyline', { points: act.join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (m.from !== null) {
      const fc = vs.slice(m.from - 1).map((v, k) => `${n(X(m.from! - 1 + k))},${n(Y(v))}`);
      svg += el('polyline', { points: fc.join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': '5 4', 'stroke-linecap': 'round' });
    }
    svg += el('circle', { cx: X(lastActual), cy: Y(vs[lastActual]!), r: 3, fill: color });
  });
  /* end labels, nudged apart */
  const ends = m.values.map((vs, i) => ({ i, y: Y(vs[N - 1]!), label: endLabels[i]! })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k += 1) ends[k]!.y = Math.max(ends[k]!.y, ends[k - 1]!.y + 13);
  /* pushed past the bottom: walk back up so they stay 13 px apart instead of piling on the axis */
  if (ends.length) ends[ends.length - 1]!.y = Math.min(ends[ends.length - 1]!.y, top + ph + 4);
  for (let k = ends.length - 2; k >= 0; k -= 1) ends[k]!.y = Math.min(ends[k]!.y, ends[k + 1]!.y - 13);
  for (const e of ends) svg += text(X(N - 1) + 7, e.y, e.label, { size: 11, bold: true, mid: true });

  const first = m.values[0]!;
  const summary =
    `Line chart${s.title ? ` "${s.title}"` : ''}: ${m.names.join(', ')}; ${m.names[0]} goes ${withUnit(first[0]!, unit)} to ${withUnit(first[lastActual]!, unit)} over ${lastActual + 1} points` +
    (m.from !== null ? `, forecast reaches ${withUnit(first[N - 1]!, unit)}` : '') +
    (s.threshold ? `, limit ${withUnit(s.threshold.value, unit)}` : '');
  return { w: width, h: H, svg, summary };
}

export const line: Component<LineSpec> = {
  id: 'line',
  blurb: 'Line or area chart, several series, optional forecast band and threshold line.',
  shape:
    'line {title?, subtitle?, x:[labels], series:[{name, values:[numbers], area?}] (1-6, same length), unit?, ' +
    'forecast?:{periods:N} (auto linear trend + band) | {from:index, low?:[..], high?:[..]} (your own numbers from that index on), ' +
    'threshold?:{value, label?}, yMin?, yMax?, height?, width?}',
  example: { title: 'Requests per second', x: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Gateway', values: [120, 150, 190, 240, 310, 380], area: true }], unit: 'rps', forecast: { periods: 4 }, threshold: { value: 800, label: 'capacity' } },
  parse: (spec) => run('line', lineCheck, spec, lineProblems),
  render: (s, w) => renderLine(s, s.width ?? w),
};

/* ───────────────────────────── bar ───────────────────────────── */

const barCheck = obj({
  title: opt(str({ max: 90 })),
  subtitle: opt(str({ max: 140 })),
  categories: arr(str({ max: 60 }), { min: 1, max: 60 }),
  series: arr(obj({ name: str({ max: 40 }), values: arr(num(), { min: 1, max: 60 }) }), { min: 1, max: 6 }),
  stacked: opt(bool()),
  horizontal: opt(bool()),
  unit: opt(str({ max: 12, allowEmpty: true })),
  threshold: opt(obj({ value: num(), label: opt(str({ max: 40 })) })),
  labels: opt(bool()),
  height: opt(num({ min: 100, max: 700, int: true })),
  width: opt(num({ min: 280, max: 1200, int: true })),
});
export type BarSpec = ReturnType<typeof barCheck>;

function barProblems(s: BarSpec, p: { add(m: string): void }): void {
  s.series.forEach((x, i) => {
    if (x.values.length !== s.categories.length) p.add(`spec.series[${i}].values: has ${x.values.length} values for ${s.categories.length} categories`);
  });
  if (s.stacked && s.series.some((x) => x.values.some((v) => v < 0))) p.add('spec.series: stacked bars cannot hold negative values');
}

function renderBar(s: BarSpec, width: number): Frag {
  const cats = s.categories;
  const ns = s.series.length;
  const unit = unitOf(s.unit);
  const hd = header(s.title, s.subtitle, width);
  const showLegend = ns > 1;
  const lg = showLegend ? legend(s.series.map((x, i) => [x.name, series(i)] as const), 0, width) : null;
  const top = hd.h + (lg ? lg.h + 6 : 4);
  const totals = cats.map((_, i) => (s.stacked ? s.series.reduce((a, x) => a + x.values[i]!, 0) : Math.max(...s.series.map((x) => x.values[i]!))));
  const dmax = Math.max(...totals, s.threshold?.value ?? 0, 0);
  const dmin = Math.min(0, ...s.series.flatMap((x) => x.values));
  const ticks = niceTicks(dmin, dmax <= 0 ? 1 : dmax, 4);
  const lo = ticks.min;
  const hi = ticks.max;
  const labelsOn = s.labels ?? cats.length * (s.stacked ? 1 : ns) <= 24;
  let svg = hd.svg;
  if (lg) svg += g({ transform: `translate(0 ${n(hd.h + 8)})` }, lg.svg);

  if (s.horizontal) {
    /* rows tighten (down to 18 px a bar) to keep the chart inside the size scale */
    const want = s.stacked || ns === 1 ? 26 : 12 * ns + 14;
    const rowH = Math.max(s.stacked || ns === 1 ? 18 : 8 * ns + 8, Math.min(want, (MAX_H.bar! - top - 28) / cats.length));
    const H = Math.min(s.height ?? top + cats.length * rowH + 28, Math.max(MAX_H.bar!, top + cats.length * rowH + 28));
    const left = Math.min(width * 0.4, Math.max(...cats.map((c) => textW(c, 12)), 20) + 26);
    const right = Math.max(...totals.map((t) => textW(withUnit(t, unit), 11)), 10) + 14;
    const pw = Math.max(60, width - left - right);
    const X = (v: number): number => left + ((v - lo) / (hi - lo || 1)) * pw;
    let grid = '';
    let tl = '';
    for (const t of ticks.ticks) {
      grid += el('line', { x1: X(t), y1: top, x2: X(t), y2: top + cats.length * rowH });
      tl += text(X(t), top + cats.length * rowH + 14, unit === '%' ? `${fmt(t)}%` : fmt(t), { size: 11, fill: C.muted, anchor: 'middle' });
    }
    svg += g({ stroke: C.edge, opacity: 0.7 }, grid) + tl;
    cats.forEach((c, i) => {
      const y0 = top + i * rowH;
      svg += line1(left - 8, y0 + rowH / 2, c, left - 14, { anchor: 'end', mid: true });
      if (s.stacked) {
        let acc = 0;
        s.series.forEach((x, si) => {
          const v = x.values[i]!;
          if (v > 0) svg += el('rect', { x: X(acc), y: y0 + 4, width: Math.max(4, X(acc + v) - X(acc)), height: rowH - 8, fill: series(si), 'fill-opacity': SOFT });
          acc += v;
        });
        if (labelsOn) svg += text(X(acc) + 6, y0 + rowH / 2, withUnit(acc, unit), { size: 11, fill: C.muted, mid: true });
      } else {
        const bh = ns === 1 ? rowH - 10 : 11;
        s.series.forEach((x, si) => {
          const v = x.values[i]!;
          const y = y0 + (rowH - bh * ns) / 2 + si * bh;
          svg += el('rect', { x: X(Math.min(0, v)), y: y + 0.5, width: Math.max(v === 0 ? 1 : 4, Math.abs(X(v) - X(0))), height: bh - 1, rx: 2, fill: series(si), 'fill-opacity': SOFT });
          if (labelsOn) svg += text(X(Math.max(0, v)) + 6, y + bh / 2, withUnit(v, unit), { size: 11, fill: C.muted, mid: true });
        });
      }
    });
    if (s.threshold) {
      svg += el('line', { x1: X(s.threshold.value), y1: top - 2, x2: X(s.threshold.value), y2: top + cats.length * rowH, stroke: C.bad, 'stroke-width': 1.2, 'stroke-dasharray': '5 3' });
      svg += text(X(s.threshold.value), top - 6, s.threshold.label ?? `limit ${withUnit(s.threshold.value, unit)}`, { size: 11, fill: C.bad, anchor: 'middle' });
    }
    return { w: width, h: H, svg, summary: barSummary(s, unit) };
  }

  const H = Math.min(s.height ?? 240, MAX_H.bar!);
  const bottom = 30;
  const ph = H - top - bottom - (s.threshold ? 8 : 0);
  const tickLabels = ticks.ticks.map((t) => unit === '%' ? `${fmt(t)}%` : fmt(t));
  const left = Math.max(...tickLabels.map((l) => textW(l, 11)), 8) + 10;
  const pw = width - left - 8;
  const Y = (v: number): number => top + 8 + ph - ((v - lo) / (hi - lo || 1)) * ph;
  let grid = '';
  let tl = '';
  ticks.ticks.forEach((t, i) => {
    grid += el('line', { x1: left, y1: Y(t), x2: left + pw, y2: Y(t) });
    tl += text(left - 6, Y(t), tickLabels[i]!, { size: 11, fill: C.muted, anchor: 'end', mid: true });
  });
  svg += g({ stroke: C.edge, opacity: 0.7 }, grid) + tl;
  const gw = pw / cats.length;
  const inner = gw * 0.72;
  const bw = s.stacked ? inner : inner / ns;
  cats.forEach((c, i) => {
    const gx = left + i * gw + (gw - inner) / 2;
    if (s.stacked) {
      let acc = 0;
      s.series.forEach((x, si) => {
        const v = x.values[i]!;
        if (v > 0) svg += el('rect', { x: gx, y: Y(acc + v), width: bw, height: Math.max(4, Y(acc) - Y(acc + v)), fill: series(si), 'fill-opacity': SOFT });
        acc += v;
      });
      if (labelsOn) svg += text(gx + bw / 2, Y(acc) - 5, withUnit(acc, unit), { size: 11, fill: C.muted, anchor: 'middle' });
    } else {
      s.series.forEach((x, si) => {
        const v = x.values[i]!;
        const y1 = Y(Math.max(0, v));
        svg += el('rect', { x: gx + si * bw + 0.5, y: y1, width: Math.max(1, bw - 1), height: Math.max(v === 0 ? 1 : 4, Math.abs(Y(v) - Y(0))), rx: 2, fill: series(si), 'fill-opacity': SOFT });
        if (labelsOn) svg += text(gx + si * bw + bw / 2, (v >= 0 ? y1 : Y(v)) - 5, fmt(v), { size: 11, fill: C.muted, anchor: 'middle' });
      });
    }
    svg += line1(left + i * gw + gw / 2, top + 8 + ph + 17, c, gw - 4, { size: 11, fill: C.muted, anchor: 'middle' });
  });
  if (s.threshold) {
    const y = Y(s.threshold.value);
    svg += el('line', { x1: left, y1: y, x2: left + pw, y2: y, stroke: C.bad, 'stroke-width': 1.2, 'stroke-dasharray': '5 3' });
    svg += text(left + pw, y - 4, s.threshold.label ?? `limit ${withUnit(s.threshold.value, unit)}`, { size: 11, fill: C.bad, anchor: 'end' });
  }
  return { w: width, h: H, svg, summary: barSummary(s, unit) };
}

function barSummary(s: BarSpec, unit: string | undefined): string {
  const totals = s.categories.map((c, i) => [c, s.stacked ? s.series.reduce((a, x) => a + x.values[i]!, 0) : s.series[0]!.values[i]!] as const);
  const top = [...totals].sort((a, b) => b[1] - a[1])[0]!;
  return `${s.stacked ? 'Stacked bar' : 'Bar'} chart${s.title ? ` "${s.title}"` : ''}: ${s.categories.length} categories, ${s.series.map((x) => x.name).join(', ')}; largest ${top[0]} at ${withUnit(top[1], unit)}`;
}

export const bar: Component<BarSpec> = {
  id: 'bar',
  blurb: 'Bar chart: grouped, stacked or horizontal, with an optional limit line.',
  shape:
    'bar {title?, subtitle?, categories:[names], series:[{name, values:[numbers per category]}] (1-6), stacked?, horizontal?, unit?, ' +
    'threshold?:{value, label?}, labels? (value labels, default on when few bars), height?, width?}',
  example: { title: 'Peak load by service', categories: ['Gateway', 'Auth', 'Model proxy', 'Cache'], series: [{ name: 'rps', values: [420, 380, 140, 900] }], horizontal: true, unit: 'rps', threshold: { value: 800, label: 'limit' } },
  parse: (spec) => run('bar', barCheck, spec, barProblems),
  render: (s, w) => renderBar(s, s.width ?? w),
};

/* ───────────────────────────── kpi ───────────────────────────── */

const kpiCheck = obj({
  title: opt(str({ max: 90 })),
  tiles: arr(
    obj({
      label: str({ max: 40 }),
      value: strOrNum(),
      unit: opt(str({ max: 12 })),
      delta: opt(strOrNum()),
      status: opt(oneOf('ok', 'warn', 'bad')),
      spark: opt(arr(num(), { min: 2, max: 60 })),
    }),
    { min: 1, max: 12 },
  ),
  columns: opt(num({ min: 1, max: 6, int: true })),
  width: opt(num({ min: 280, max: 1200, int: true })),
});
export type KpiSpec = ReturnType<typeof kpiCheck>;

/** A polyline path through `values` fitted into a w x h box at (x, y). */
function sparkPoints(values: readonly number[], x: number, y: number, w: number, h: number): string[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v, i) => `${n(x + (i / (values.length - 1)) * w)},${n(y + h - ((v - lo) / (hi - lo || 1)) * h)}`);
}

/**
 * Compact tiles (the size scale: 20 px values, 10 px padding, 50-62 px tall), every line on one line.
 * Layout before cutting: each tile needs the width of its longest line (label, value with unit,
 * change line, sparkline); tiles are packed into rows of up to four in order and a row's spare width
 * is shared out, so a long tile gets more room and a short last row is stretched, never one lone
 * small tile. Only a label or change line wider than a whole row is cut, with its full text as a
 * tooltip; a value is never cut (it shrinks to 16 px).
 */
function renderKpi(s: KpiSpec, width: number): Frag {
  const hd = header(s.title, undefined, width);
  const gap = 8;
  const PAD = 10;
  const SPARK = 56;
  const maxPer = Math.max(1, Math.min(4, s.columns ?? 4));
  const valueOf = (t: KpiSpec['tiles'][number]): string => (typeof t.value === 'number' ? big(t.value) : t.value);
  const deltaOf = (t: KpiSpec['tiles'][number]): string => (t.delta === undefined ? '' : typeof t.delta === 'number' ? `${t.delta > 0 ? '+' : ''}${fmt(t.delta)}` : t.delta);
  const unitW = (t: KpiSpec['tiles'][number]): number => (t.unit ? textW(t.unit, 12) + 5 : 0);
  const need = s.tiles.map((t) => {
    const valueRow = textW(valueOf(t), KPI_VALUE, true) + unitW(t) + (t.spark ? SPARK + 8 : 0);
    return Math.max(76, textW(cap(t.label), 11), textW(deltaOf(t), 11), valueRow) + PAD * 2 + 2;
  });
  /* pack in order */
  const rows: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  need.forEach((w, i) => {
    const add = (cur.length ? gap : 0) + w;
    if (cur.length && (cur.length >= maxPer || used + add > width)) {
      rows.push(cur);
      cur = [];
      used = 0;
    }
    used += (cur.length ? gap : 0) + w;
    cur.push(i);
  });
  rows.push(cur);
  /* a lone tile after a full row borrows one from it when both still fit */
  for (let r = rows.length - 1; r > 0; r -= 1) {
    const last = rows[r]!;
    const prev = rows[r - 1]!;
    if (last.length === 1 && prev.length >= 3) {
      const moved = [prev[prev.length - 1]!, ...last];
      if (moved.reduce((a, i) => a + need[i]!, 0) + gap * (moved.length - 1) <= width) {
        rows[r] = moved;
        prev.pop();
      }
    }
  }
  const anyDelta = s.tiles.some((t) => deltaOf(t));
  const th = anyDelta ? 62 : 50;
  let svg = hd.svg;
  let y = hd.h;
  for (const row of rows) {
    const total = row.reduce((a, i) => a + need[i]!, 0) + gap * (row.length - 1);
    const extra = Math.max(0, width - total) / row.length;
    const squeeze = total > width ? (width - gap * (row.length - 1)) / (total - gap * (row.length - 1)) : 1;
    let x = 0;
    for (const i of row) {
      const t = s.tiles[i]!;
      const tw = need[i]! * squeeze + extra;
      const color = t.status === 'bad' ? C.bad : t.status === 'warn' ? C.warn : t.status === 'ok' ? C.ok : series(0);
      let inner = el('rect', { x: 0.5, y: 0.5, width: tw - 1, height: th - 1, rx: 7, ...TINT, ...HAIR });
      inner += line1(PAD, 17, cap(t.label), tw - PAD * 2, { size: 11, fill: C.muted });
      const val = valueOf(t);
      const sparkRoom = t.spark && tw - PAD * 2 >= textW(val, 16, true) + unitW(t) + SPARK + 8 ? SPARK + 8 : 0;
      const avail = tw - PAD * 2 - sparkRoom - unitW(t);
      const vw = textW(val, KPI_VALUE, true);
      const vsize = vw <= avail ? KPI_VALUE : Math.max(16, Math.floor((KPI_VALUE * avail) / vw));
      const unit = t.unit ? el('tspan', { dx: 5, 'font-size': 12, 'font-weight': 400, fill: C.muted }, esc(t.unit)) : '';
      inner += el('text', { x: PAD, y: 40, 'font-size': vsize, 'font-weight': 600 }, esc(val) + unit);
      const d = deltaOf(t);
      if (d) inner += line1(PAD, 55, d, tw - PAD * 2, { size: 11, fill: t.status ? color : C.muted });
      if (sparkRoom) {
        const pts = sparkPoints(t.spark!, tw - PAD - SPARK, 24, SPARK, 18);
        inner += el('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
        const last = pts[pts.length - 1]!.split(',');
        inner += el('circle', { cx: Number(last[0]), cy: Number(last[1]), r: 2, fill: color });
      }
      svg += g({ transform: `translate(${n(x)} ${n(y)})` }, inner);
      x += tw + gap;
    }
    y += th + gap;
  }
  return { w: width, h: y - gap, svg, summary: `KPI tiles: ${s.tiles.map((t) => `${t.label} ${valueOf(t)}${t.unit ? ` ${t.unit}` : ''}`).join('; ')}` };
}

export const kpi: Component<KpiSpec> = {
  id: 'kpi',
  blurb: 'Row of headline number tiles with unit, change, status colour and an optional sparkline.',
  shape: 'kpi {title?, tiles:[{label, value (number|text), unit?, delta? (e.g. "+12%"), status?:"ok"|"warn"|"bad", spark?:[numbers]}] (1-12), columns? (most per row, default 4), width?}',
  example: { tiles: [{ label: 'Active users', value: 1000 }, { label: 'Peak load', value: 42, unit: 'rps', delta: '+8% / month', spark: [20, 24, 28, 31, 38, 42] }, { label: 'p99 latency', value: 870, unit: 'ms', status: 'warn' }] },
  parse: (spec) => run('kpi', kpiCheck, spec),
  render: (s, w) => renderKpi(s, s.width ?? w),
};

/* ───────────────────────────── sparkline ───────────────────────────── */

const sparkCheck = obj({
  label: opt(str({ max: 40 })),
  values: arr(num(), { min: 2, max: 400 }),
  unit: opt(str({ max: 12 })),
  width: opt(num({ min: 120, max: 1200, int: true })),
});
export type SparkSpec = ReturnType<typeof sparkCheck>;

function renderSpark(s: SparkSpec, width: number): Frag {
  const w = Math.min(width, s.width ?? 280);
  const H = 40;
  const last = s.values[s.values.length - 1]!;
  const text1 = withUnit(last, s.unit);
  const lw = Math.max(textW(s.label ?? '', 11), textW(text1, 16, true)) + 12;
  const pts = sparkPoints(s.values, lw, 6, w - lw - 8, H - 12);
  const hiI = s.values.indexOf(Math.max(...s.values));
  const loI = s.values.indexOf(Math.min(...s.values));
  let svg = '';
  if (s.label) svg += line1(0, 15, s.label, lw - 8, { size: 11, fill: C.muted });
  svg += text(0, s.label ? 33 : 24, text1, { size: 16, bold: true });
  svg += el('polyline', { points: pts.join(' '), fill: 'none', stroke: series(0), 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  for (const [i, c] of [[hiI, C.ok], [loI, C.muted], [s.values.length - 1, series(0)]] as const) {
    const [px, py] = pts[i]!.split(',').map(Number);
    svg += el('circle', { cx: px!, cy: py!, r: i === s.values.length - 1 ? 3 : 2, fill: c });
  }
  return { w, h: H, svg, summary: `Sparkline${s.label ? ` ${s.label}` : ''}: ${s.values.length} points, last ${text1}, min ${fmt(Math.min(...s.values))}, max ${fmt(Math.max(...s.values))}` };
}

export const sparkline: Component<SparkSpec> = {
  id: 'sparkline',
  blurb: 'Tiny inline trend with its latest value.',
  shape: 'sparkline {label?, values:[numbers] (2+), unit?, width? (default 280)}',
  example: { label: 'Requests / min', values: [12, 15, 14, 19, 22, 21, 28, 31], unit: 'rpm' },
  parse: (spec) => run('sparkline', sparkCheck, spec),
  render: (s, w) => renderSpark(s, w),
};

/* ───────────────────────────── histogram ───────────────────────────── */

const histCheck = obj({
  title: opt(str({ max: 90 })),
  subtitle: opt(str({ max: 140 })),
  values: opt(arr(num(), { min: 2, max: 5000 })),
  bins: opt(num({ min: 3, max: 40, int: true })),
  buckets: opt(arr(obj({ from: num(), to: num(), count: num({ min: 0 }) }), { min: 2, max: 60 })),
  percentiles: opt(arr(obj({ name: str({ max: 12 }), value: num() }), { min: 1, max: 8 })),
  unit: opt(str({ max: 12, allowEmpty: true })),
  marks: opt(arr(num({ min: 0, max: 100 }), { max: 4 })),
  lines: opt(arr(obj({ name: str({ max: 16 }), value: num() }), { max: 5 })),
  threshold: opt(obj({ value: num(), label: opt(str({ max: 40 })) })),
  height: opt(num({ min: 120, max: 600, int: true })),
  width: opt(num({ min: 280, max: 1200, int: true })),
});
export type HistSpec = ReturnType<typeof histCheck>;

function histProblems(s: HistSpec, p: { add(m: string): void }): void {
  const given = [s.values, s.buckets, s.percentiles].filter((x) => x !== undefined).length;
  if (given !== 1) p.add('spec: give exactly one of values (raw samples), buckets ([{from,to,count}]) or percentiles ([{name,value}])');
  if (s.buckets) s.buckets.forEach((b, i) => b.to <= b.from && p.add(`spec.buckets[${i}]: to (${b.to}) must be greater than from (${b.from})`));
  if (s.marks && !s.values) p.add('spec.marks: percentile marks need values (raw samples); with buckets give lines:[{name,value}]');
  if (s.lines && s.percentiles) p.add('spec.lines: draw on a histogram (values or buckets), not on the percentile ladder');
}

function renderHist(s: HistSpec, width: number): Frag {
  const unit = unitOf(s.unit);
  if (s.percentiles) {
    const horiz: BarSpec = { title: s.title, subtitle: s.subtitle, categories: s.percentiles.map((x) => x.name), series: [{ name: 'value', values: s.percentiles.map((x) => x.value) }], horizontal: true, unit: s.unit, threshold: s.threshold, labels: true, height: undefined, stacked: undefined, width: undefined };
    const f = renderBar(horiz, width);
    return { ...f, summary: `Latency percentiles${s.title ? ` "${s.title}"` : ''}: ${s.percentiles.map((x) => `${x.name} ${withUnit(x.value, unit)}`).join(', ')}` };
  }
  let buckets: { from: number; to: number; count: number }[];
  if (s.buckets) buckets = s.buckets.slice().sort((a, b) => a.from - b.from);
  else {
    const vs = s.values!;
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const k = s.bins ?? clamp(Math.ceil(Math.sqrt(vs.length)), 6, 24);
    const step = (hi - lo || 1) / k;
    buckets = Array.from({ length: k }, (_, i) => ({ from: lo + i * step, to: lo + (i + 1) * step, count: 0 }));
    for (const v of vs) buckets[Math.min(k - 1, Math.floor((v - lo) / step))]!.count += 1;
  }
  const marks = s.lines ? s.lines.map((l) => ({ name: l.name, v: l.value })) : s.values ? (s.marks ?? [50, 95, 99]).map((q) => ({ name: `p${q}`, v: percentile(s.values!, q) })) : [];
  const hd = header(s.title, s.subtitle, width);
  const markRows = marks.length > 0 ? (marks.length > 2 ? 32 : 18) : 0;
  const top = hd.h + 6 + markRows;
  const H = Math.min(s.height ?? 230, MAX_H.histogram!);
  const ph = H - top - 30;
  const xlo = buckets[0]!.from;
  const xhi = Math.max(buckets[buckets.length - 1]!.to, ...marks.map((m) => m.v), s.threshold?.value ?? -Infinity);
  const ymax = niceTicks(0, Math.max(...buckets.map((b) => b.count), 1), 4);
  const left = Math.max(...ymax.ticks.map((t) => textW(fmt(t), 11)), 8) + 10;
  const pw = width - left - 30;
  const X = (v: number): number => left + ((v - xlo) / (xhi - xlo || 1)) * pw;
  const Y = (v: number): number => top + ph - (v / (ymax.max || 1)) * ph;
  let svg = hd.svg;
  let grid = '';
  let tl = '';
  for (const t of ymax.ticks) {
    grid += el('line', { x1: left, y1: Y(t), x2: left + pw, y2: Y(t) });
    tl += text(left - 6, Y(t), fmt(t), { size: 11, fill: C.muted, anchor: 'end', mid: true });
  }
  svg += g({ stroke: C.edge, opacity: 0.7 }, grid) + tl;
  svg += g({ fill: series(0), 'fill-opacity': SOFT }, buckets.map((b) => el('rect', { x: X(b.from) + 0.5, y: Y(b.count), width: Math.max(1, X(b.to) - X(b.from) - 1), height: Math.max(0, top + ph - Y(b.count)) })).join(''));
  const xt = niceTicks(xlo, xhi, 6);
  for (const t of xt.ticks) if (t >= xlo - 1e-9 && t <= xhi + 1e-9) svg += text(X(t), top + ph + 17, withUnit(t, unit), { size: 11, fill: C.muted, anchor: 'middle' });
  const rowEnds: number[] = [];
  marks.forEach((m, i) => {
    const x = X(m.v);
    const label = `${m.name} ${withUnit(m.v, unit)}`;
    const lw = textW(label, 11, true);
    const anchor = x + lw + 6 > width - 4 ? 'end' : 'start';
    const x0 = anchor === 'start' ? x + 4 : x - 4;
    const a = anchor === 'start' ? x0 : x0 - lw;
    let row = rowEnds.findIndex((e) => a > e + 8);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = a + lw;
    const color = i === 0 ? C.muted : series(1 + Math.min(i, 3));
    const ly = top - 6 - (markRows - 18) + row * 14 - 0;
    svg += el('line', { x1: x, y1: ly + 3, x2: x, y2: top + ph, stroke: color, 'stroke-width': 1.4, 'stroke-dasharray': '4 3' });
    svg += text(x0, ly, label, { size: 11, bold: true, anchor });
  });
  if (s.threshold) {
    svg += el('line', { x1: X(s.threshold.value), y1: top, x2: X(s.threshold.value), y2: top + ph, stroke: C.bad, 'stroke-width': 1.2, 'stroke-dasharray': '5 3' });
    svg += text(X(s.threshold.value) - 4, top + 10, s.threshold.label ?? `limit ${withUnit(s.threshold.value, unit)}`, { size: 11, fill: C.bad, anchor: 'end' });
  }
  const summary = `Histogram${s.title ? ` "${s.title}"` : ''}: ${buckets.reduce((a, b) => a + b.count, 0)} samples${marks.length ? `, ${marks.map((m) => `${m.name} ${withUnit(m.v, unit)}`).join(', ')}` : ''}`;
  return { w: width, h: H, svg, summary };
}

export const histogram: Component<HistSpec> = {
  id: 'histogram',
  blurb: 'Distribution of samples (latency) with p50/p95/p99 marks, or a percentile ladder.',
  shape:
    'histogram {title?, subtitle?, unit?, ONE OF values:[samples] (+bins?, marks?:[50,95,99] computed) | buckets:[{from,to,count}] | percentiles:[{name:"p50",value}] (a ladder), lines?:[{name,value}] (your own markers, e.g. p95), threshold?:{value,label?}, height?, width?}',
  example: { title: 'Gateway latency', unit: 'ms', values: Array.from({ length: 60 }, (_, i) => 80 + ((i * 37) % 23) * 9 + (i % 7 === 0 ? 400 : 0)), threshold: { value: 800, label: 'SLO' } },
  parse: (spec) => run('histogram', histCheck, spec, histProblems),
  render: (s, w) => renderHist(s, s.width ?? w),
};

/* ───────────────────────────── donut ───────────────────────────── */

const donutCheck = obj({
  title: opt(str({ max: 90 })),
  parts: arr(obj({ label: str({ max: 40 }), value: num({ min: 0 }) }), { min: 1, max: 8 }),
  unit: opt(str({ max: 12 })),
  center: opt(str({ max: 20 })),
  width: opt(num({ min: 280, max: 1200, int: true })),
});
export type DonutSpec = ReturnType<typeof donutCheck>;

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number): string => `${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${n(r1)} ${n(r1)} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${n(r0)} ${n(r0)} 0 ${large} 0 ${p(r0, a0)}Z`;
}

function renderDonut(s: DonutSpec, width: number): Frag {
  const total = s.parts.reduce((a, x) => a + x.value, 0);
  const hd = header(s.title, undefined, width);
  const R = 60;
  const r0 = 38;
  /* Legend beside the ring when every label fits there on one line; otherwise (a dashboard half, a phone) under it, with the whole width. */
  const longest = Math.max(...s.parts.map((p) => textW(p.label, 12)));
  const stacked = longest > width - (2 * R + 4 + 28) - 16 - 50;
  const cx = stacked ? width / 2 : R + 4;
  const cy = hd.h + R + 4;
  let svg = hd.svg;
  let a = -Math.PI / 2;
  s.parts.forEach((pt, i) => {
    const frac = total === 0 ? 0 : pt.value / total;
    if (frac <= 0) return;
    const span = Math.min(frac * Math.PI * 2, Math.PI * 2 - 0.001);
    svg += el('path', { d: arc(cx, cy, r0, R, a, a + span), fill: series(i), 'fill-opacity': SOFT });
    a += frac * Math.PI * 2;
  });
  svg += text(cx, cy - 2, s.center ?? fmt(total), { size: 20, bold: true, anchor: 'middle', mid: true });
  if (s.unit) svg += text(cx, cy + 16, s.unit, { size: 11, fill: C.muted, anchor: 'middle' });
  const lx = stacked ? 0 : cx + R + 28;
  const ly0 = stacked ? cy + R + 18 : cy - ((s.parts.length - 1) * 22) / 2;
  s.parts.forEach((pt, i) => {
    const y = ly0 + i * 22;
    svg += el('rect', { x: lx, y: y - 5, width: 10, height: 10, rx: 2, fill: series(i), 'fill-opacity': SOFT });
    svg += line1(lx + 16, y, pt.label, width - lx - 16 - 50, { mid: true });
    svg += text(width, y, `${fmt(total === 0 ? 0 : (pt.value / total) * 100)}%`, { fill: C.muted, anchor: 'end', mid: true });
  });
  return { w: width, h: stacked ? ly0 + (s.parts.length - 1) * 22 + 14 : hd.h + 2 * R + 8, svg, summary: `Donut${s.title ? ` "${s.title}"` : ''}: ${s.parts.map((x) => `${x.label} ${fmt(total === 0 ? 0 : (x.value / total) * 100)}%`).join(', ')}` };
}

export const donut: Component<DonutSpec> = {
  id: 'donut',
  blurb: 'Share of a whole, up to 8 parts, total in the middle.',
  shape: 'donut {title?, parts:[{label, value}] (1-8), unit?, center? (text in the hole, default total), width?}',
  example: { title: 'Traffic by feature', parts: [{ label: 'Summaries', value: 52 }, { label: 'Search', value: 31 }, { label: 'Drafts', value: 17 }], unit: '% of calls' },
  parse: (spec) => run('donut', donutCheck, spec),
  render: (s, w) => renderDonut(s, s.width ?? w),
};

export const CHARTS = [line, bar, kpi, sparkline, histogram, donut] as unknown as Component[];
export { utilColor };
