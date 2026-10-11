/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL KIT: COMPOSITES
   packages/schema/src/visual/composite.ts

   capacity   users -> requests per second -> load per service against its
              capacity, network, and a growth forecast with a saturation line
   dashboard  several kit components in one picture (1 or 2 columns)
   ══════════════════════════════════════════════════════════════════════════ */

import { bar, header, kpi, line } from './charts.js';
import { arr, num, obj, opt, run, str, oneOf, type Problems } from './check.js';
import type { Component } from './types.js';
import { C, clamp, el, fit, fmt, line1, g, n, series, text, textW, utilColor, utilFill, type Frag } from './util.js';

interface Placed {
  span: 1 | 2;
  render: (width: number) => Frag;
}

/** Lay panels out in 1 or 2 columns; a span-2 panel takes a full row. Returns one Frag. */
export function place(panels: Placed[], width: number, columns: 1 | 2, gap = 16): { svg: string; h: number } {
  let svg = '';
  let y = 0;
  let i = 0;
  while (i < panels.length) {
    const p = panels[i]!;
    const q = panels[i + 1];
    if (columns === 2 && p.span === 1 && q && q.span === 1) {
      const cw = (width - gap) / 2;
      const a = p.render(cw);
      const b = q.render(cw);
      svg += g({ transform: `translate(0 ${n(y)})` }, a.svg) + g({ transform: `translate(${n(cw + gap)} ${n(y)})` }, b.svg);
      y += Math.max(a.h, b.h) + gap;
      i += 2;
    } else {
      const f = p.render(width);
      svg += g({ transform: `translate(0 ${n(y)})` }, f.svg);
      y += f.h + gap;
      i += 1;
    }
  }
  return { svg, h: Math.max(0, y - gap) };
}

/* ───────────────────────────── capacity ───────────────────────────── */

const capCheck = obj({
  title: opt(str({ max: 90 })),
  users: num({ min: 1, max: 1e9 }),
  requestsPerUserPerHour: opt(num({ min: 0.01, max: 1e5 })),
  peakFactor: opt(num({ min: 1, max: 100 })),
  payloadKB: opt(obj({ request: num({ min: 0 }), response: num({ min: 0 }) })),
  services: arr(obj({ name: str({ max: 40 }), fanout: opt(num({ min: 0, max: 1000 })), capacityRps: num({ min: 0.001 }), latencyMs: opt(num({ min: 0 })) }), { min: 1, max: 8 }),
  threshold: opt(num({ min: 0.1, max: 1 })),
  growth: opt(obj({ monthlyPct: num({ min: -50, max: 500 }), months: opt(num({ min: 2, max: 36, int: true })) })),
  width: opt(num({ min: 280, max: 1200, int: true })),
});
export type CapSpec = ReturnType<typeof capCheck>;

function capProblems(s: CapSpec, p: Problems): void {
  const names = new Set<string>();
  s.services.forEach((x, i) => {
    if (names.has(x.name)) p.add(`spec.services[${i}].name: "${x.name}" is used twice`);
    names.add(x.name);
  });
}

export interface CapModel {
  avgRps: number;
  peakRps: number;
  rows: { name: string; load: number; cap: number; util: number }[];
  bottleneck: { name: string; util: number };
  headroomUsers: number;
  ingressMbps: number | null;
  egressMbps: number | null;
  months: number;
  growth: number;
  /** Month (0 = today) in which the bottleneck first passes the saturation threshold, or null within the horizon. */
  breachMonth: number | null;
  thr: number;
}

/** The arithmetic, apart from the drawing (tests and the summary use it). */
export function capacityModel(s: CapSpec): CapModel {
  const thr = s.threshold ?? 0.8;
  const avgRps = (s.users * (s.requestsPerUserPerHour ?? 20)) / 3600;
  const peakRps = avgRps * (s.peakFactor ?? 3);
  const rows = s.services.map((x) => {
    const load = peakRps * (x.fanout ?? 1);
    return { name: x.name, load, cap: x.capacityRps, util: load / x.capacityRps };
  });
  const bottleneck = [...rows].sort((a, b) => b.util - a.util)[0]!;
  const headroomUsers = bottleneck.util === 0 ? Infinity : (s.users * thr) / bottleneck.util;
  const kbps = (kb: number): number => (peakRps * kb * 8) / 1000;
  const growth = (s.growth?.monthlyPct ?? 10) / 100;
  const months = s.growth?.months ?? 12;
  let breachMonth: number | null = null;
  for (let t = 0; t <= months; t += 1) {
    if (bottleneck.util * (1 + growth) ** t >= thr) {
      breachMonth = t;
      break;
    }
  }
  return { avgRps, peakRps, rows, bottleneck, headroomUsers, ingressMbps: s.payloadKB ? kbps(s.payloadKB.request) : null, egressMbps: s.payloadKB ? kbps(s.payloadKB.response) : null, months, growth, breachMonth, thr };
}

/** Per-service load bars: fill = load as a share of that service's capacity, tick = saturation threshold. */
/** Compact capacity shows this many service rows (the most loaded, in the spec's order); the rest are named in one line. */
const CAP_ROWS = 5;

function loadBars(model: CapModel, width: number, compact = false): Frag {
  const hidden = compact && model.rows.length > CAP_ROWS ? model.rows.length - CAP_ROWS : 0;
  const keep = hidden ? new Set([...model.rows].sort((a, b) => b.util - a.util).slice(0, CAP_ROWS).map((r) => r.name)) : null;
  const m: CapModel = keep ? { ...model, rows: model.rows.filter((r) => keep.has(r.name)) } : model;
  /* compact (a chat column): title only and tighter rows, so the whole capacity picture stays inside the card cap (CAP_COMPACT_H) */
  const hd = compact ? { svg: '', h: 0 } : header('Where the load lands', `Peak ${fmt(m.peakRps)} rps against each service's capacity`, width);
  const rowH = compact ? 18 : 26;
  const left = Math.min(width * 0.42, Math.max(...m.rows.map((r) => textW(r.name, 12)), 40) + 26);
  const right = Math.max(...m.rows.map((r) => textW(`${fmt(r.load)} / ${fmt(r.cap)} rps`, 11)), 40) + 10;
  const pw = Math.max(50, width - left - right);
  const scaleMax = Math.max(1.1, ...m.rows.map((r) => Math.min(r.util, 1.5)));
  const X = (u: number): number => left + (u / scaleMax) * pw;
  let svg = hd.svg;
  const top = hd.h + 14;
  m.rows.forEach((r, i) => {
    const y = top + i * rowH;
    svg += line1(left - 8, y + rowH / 2, r.name, left - 14, { anchor: 'end', mid: true });
    svg += el('rect', { x: left, y: y + 6, width: X(1) - left, height: rowH - 12, rx: 4, fill: C.edge, opacity: 0.6 });
    svg += el('rect', { x: left, y: y + 6, width: Math.max(6, X(Math.min(r.util, scaleMax)) - left), height: rowH - 12, rx: 4, ...utilFill(r.util, m.thr) });
    svg += text(left + pw + 8, y + rowH / 2, `${fmt(r.load)} / ${fmt(r.cap)} rps`, { size: 11, fill: C.muted, mid: true });
    if (r.util >= m.thr) svg += text(Math.min(X(r.util), left + pw) - 6, y + rowH / 2, `${Math.round(r.util * 100)}%`, { size: 11, bold: true, anchor: 'end', mid: true, fill: '#fff' });
  });
  const bottom = top + m.rows.length * rowH;
  svg += el('line', { x1: X(m.thr), y1: top - 4, x2: X(m.thr), y2: bottom, stroke: C.fg, 'stroke-width': 1.2, 'stroke-dasharray': '4 3', opacity: 0.7 });
  svg += text(X(m.thr), top - 8, `${Math.round(m.thr * 100)}% saturation`, { size: 11, fill: C.muted, anchor: 'middle' });
  svg += text(X(1), bottom + 14, 'Capacity', { size: 11, fill: C.muted, anchor: 'middle' });
  if (hidden) {
    const under = Math.max(...model.rows.filter((r) => !keep!.has(r.name)).map((r) => r.util));
    svg += line1(0, bottom + 14, `${hidden} more under ${Math.round(under * 100)}%`, Math.max(40, X(1) - 40), { fill: C.muted, size: 11 });
  }
  return { w: width, h: bottom + 22, svg, summary: '' };
}

/** Narrower than this the capacity picture is one column (the chat column); it then fits the 420 px card cap. */
export const CAP_WIDE = 640;
/** Natural height the compact capacity picture stays under (the chat card's default cap is 420). */
export const CAP_COMPACT_H = 410;

function capacityParts(s: CapSpec, width: number, capTitle: string): { frags: Placed[]; model: CapModel; summary: string } {
  const compact = width < CAP_WIDE;
  const m = capacityModel(s);
  const tiles: { label: string; value: string | number; unit?: string; delta?: string; status?: 'ok' | 'warn' | 'bad' }[] = [
    { label: 'Users', value: s.users },
    { label: 'Average load', value: Math.round(m.avgRps * 10) / 10, unit: 'rps', delta: `${s.requestsPerUserPerHour ?? 20} / user / hour` },
    { label: 'Peak load', value: Math.round(m.peakRps * 10) / 10, unit: 'rps', delta: `${s.peakFactor ?? 3}x average` },
  ];
  if (m.ingressMbps !== null) tiles.push({ label: 'Network in / out', value: `${fmt(m.ingressMbps)} / ${fmt(m.egressMbps!)}`, unit: 'Mbps', delta: 'at peak' });
  const worst = m.bottleneck.util;
  tiles.push({
    label: `Headroom to ${Math.round(m.thr * 100)}%`,
    value: Number.isFinite(m.headroomUsers) ? Math.round(m.headroomUsers) : 'unbounded',
    unit: 'users',
    delta: `${m.bottleneck.name} at ${Math.round(worst * 100)}%`,
    status: worst >= 1 ? 'bad' : worst >= m.thr ? 'warn' : 'ok',
  });
  /* compact: one row of tiles (peak, network or users, headroom; two when three do not fit a row) instead of two */
  const pick = compact ? [tiles[2]!, tiles[m.ingressMbps !== null ? 3 : 0]!, tiles[tiles.length - 1]!] : tiles;
  let shown = pick;
  let kpiH = 0;
  if (compact) {
    for (const keep of [pick, [pick[0]!, pick[2]!]]) {
      shown = keep;
      kpiH = kpi.render(kpi.parse({ tiles: shown }), width).h;
      if (kpiH <= 62) break;
    }
  }
  const barsH = 14 + Math.min(m.rows.length, CAP_ROWS) * 18 + 22;
  /* the forecast takes what is left of the cap: title + tiles + bars + the two 16 px gaps */
  const lineH = compact ? clamp(CAP_COMPACT_H - header(capTitle, undefined, width).h - kpiH - 32 - barsH, 140, 150) : 220;
  const order = [...m.rows].sort((a, b) => b.util - a.util);
  const top = order.slice(0, 4);
  const pct = (name: string, t: number): number => {
    const r = m.rows.find((x) => x.name === name)!;
    return Math.round(r.util * (1 + m.growth) ** t * 1000) / 10;
  };
  const xs = Array.from({ length: m.months + 1 }, (_, t) => (t === 0 ? 'Now' : `+${t}m`));
  const lowG = m.growth * 0.5;
  const highG = m.growth * 1.5;
  const b = top[0]!;
  const bandAt = (gr: number, t: number): number => Math.round(b.util * (1 + gr) ** t * 1000) / 10;
  const forecastSubtitle = m.breachMonth === null ? `${top[0]!.name} stays under ${Math.round(m.thr * 100)}% for ${m.months} months at +${s.growth?.monthlyPct ?? 10}% a month` : m.breachMonth === 0 ? `${top[0]!.name} is already past ${Math.round(m.thr * 100)}%` : `${top[0]!.name} passes ${Math.round(m.thr * 100)}% in month ${m.breachMonth} at +${s.growth?.monthlyPct ?? 10}% a month`;
  const frags: Placed[] = [
    { span: 2, render: (w) => kpi.render(kpi.parse({ tiles: shown }), w) },
    { span: 1, render: (w) => loadBars(m, w, compact) },
    {
      span: 1,
      render: (w) =>
        line.render(
          line.parse({
            ...(compact ? {} : { title: 'Utilisation if usage keeps growing' }),
            subtitle: forecastSubtitle,
            x: xs,
            unit: '%',
            series: top.slice(0, compact ? 2 : 4).map((r) => ({ name: r.name, values: xs.map((_, t) => pct(r.name, t)) })),
            forecast: { from: 1, low: xs.slice(1).map((_, t) => Math.min(bandAt(lowG, t + 1), bandAt(highG, t + 1))), high: xs.slice(1).map((_, t) => Math.max(bandAt(lowG, t + 1), bandAt(highG, t + 1))) },
            threshold: { value: Math.round(m.thr * 100), label: `${Math.round(m.thr * 100)}% saturation` },
            height: lineH,
          }),
          w,
        ),
    },
  ];
  void bar;
  const summary =
    `Capacity at ${fmt(s.users)} users: ${fmt(m.avgRps)} rps average, ${fmt(m.peakRps)} rps at peak; ` +
    `${m.bottleneck.name} is the tightest at ${Math.round(worst * 100)}% of capacity (saturation line ${Math.round(m.thr * 100)}%)` +
    (Number.isFinite(m.headroomUsers) ? `; headroom to saturation about ${fmt(m.headroomUsers)} users` : '') +
    (m.ingressMbps !== null ? `; network ${fmt(m.ingressMbps)} Mbps in, ${fmt(m.egressMbps!)} Mbps out` : '') +
    (m.breachMonth === null ? `; no breach in ${m.months} months at ${s.growth?.monthlyPct ?? 10}% monthly growth` : m.breachMonth === 0 ? '; already over the saturation line' : `; breach in month ${m.breachMonth} at ${s.growth?.monthlyPct ?? 10}% monthly growth`);
  void width;
  return { frags, model: m, summary };
}

export const capacity: Component<CapSpec> = {
  id: 'capacity',
  blurb: 'Capacity and load forecast: users to requests per second to load on each service against its capacity, network, headroom and a growth forecast.',
  shape:
    'capacity {title?, users, requestsPerUserPerHour? (20), peakFactor? (3), payloadKB?:{request,response}, ' +
    'services:[{name, fanout? (calls per user request, 1), capacityRps, latencyMs?}] (1-8), threshold? (saturation 0.8), growth?:{monthlyPct (10), months (12)}, width?}',
  example: {
    title: 'AI feature gateway at 1,000 users',
    users: 1000,
    requestsPerUserPerHour: 40,
    peakFactor: 4,
    payloadKB: { request: 6, response: 24 },
    services: [{ name: 'API gateway', capacityRps: 200 }, { name: 'Auth / quota', fanout: 1, capacityRps: 400 }, { name: 'Cache', fanout: 1, capacityRps: 2000 }, { name: 'Model proxy', fanout: 0.7, capacityRps: 48 }, { name: 'Usage events', fanout: 1, capacityRps: 150 }],
    growth: { monthlyPct: 8, months: 12 },
  },
  parse: (spec) => run('capacity', capCheck, spec, capProblems),
  render: (s, w) => {
    const width = s.width ?? w;
    const hd = header(s.title ?? 'Capacity and load forecast', undefined, width);
    const { frags, summary } = capacityParts(s, width, s.title ?? 'Capacity and load forecast');
    const body = place(frags, width, width >= 640 ? 2 : 1);
    return { w: width, h: hd.h + body.h, svg: hd.svg + g({ transform: `translate(0 ${n(hd.h)})` }, body.svg), summary };
  },
};

/* ───────────────────────────── dashboard ───────────────────────────── */

const dashCheck = obj({
  title: opt(str({ max: 90 })),
  columns: opt(oneOf('1', '2')),
  panels: arr(obj({ component: str({ max: 20 }), spec: obj({}) as never, span: opt(oneOf('1', '2')) }), { min: 1, max: 8 }),
  width: opt(num({ min: 280, max: 1200, int: true })),
});

/** The dashboard needs the registry to parse its panels, which needs the dashboard: it is built from a lookup. */
export function makeDashboard(find: (id: string) => Component | undefined, ids: () => string[]): Component {
  type Parsed = { title?: string; columns: 1 | 2; width?: number; panels: { c: Component; spec: unknown; span: 1 | 2 }[] };
  const check = obj({
    title: opt(str({ max: 90 })),
    columns: opt(num({ min: 1, max: 2, int: true })),
    panels: arr(obj({ component: str({ max: 20 }), spec: (v, path, p) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : (p.add(`${path}: expected the panel's spec object`), {})), span: opt(num({ min: 1, max: 2, int: true })) }), { min: 1, max: 8 }),
    width: opt(num({ min: 280, max: 1200, int: true })),
  });
  void dashCheck;
  return {
    id: 'dashboard',
    blurb: 'Several components in one picture: panels in one or two columns, each a component with its spec.',
    shape: 'dashboard {title?, columns? (1|2, default 2), panels:[{component:"line"|"bar"|"kpi"|..., spec:{...that component\'s spec}, span?:2 (full row)}] (1-8), width?}',
    example: { title: 'Gateway pilot', panels: [{ component: 'kpi', span: 2, spec: { tiles: [{ label: 'Users', value: 1000 }, { label: 'Peak', value: 17, unit: 'rps' }] } }, { component: 'sparkline', spec: { label: 'rps', values: [4, 6, 9, 12, 17] } }, { component: 'donut', spec: { parts: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] } }] },
    parse: (spec) =>
      run<Parsed>(
        'dashboard',
        (v, path, p) => {
          const c = check(v, path, p);
          const panels = c.panels.map((pn, i) => {
            const comp = find(pn.component);
            if (!comp || comp.id === 'dashboard') {
              p.add(`spec.panels[${i}].component: "${pn.component}" is not a panel component (${ids().filter((x) => x !== 'dashboard').join(', ')})`);
              return { c: line as Component, spec: {}, span: 1 as const };
            }
            let parsed: unknown = null;
            try {
              parsed = comp.parse(pn.spec);
            } catch (e) {
              const msg = e instanceof Error ? e.message.replace(/^visual [a-z]+: /, '') : String(e);
              p.add(`spec.panels[${i}] (${comp.id}): ${msg.replace(/spec\./g, `panels[${i}].spec.`)}`);
            }
            return { c: comp, spec: parsed, span: (pn.span === 2 ? 2 : 1) as 1 | 2 };
          });
          return { title: c.title, columns: c.columns === 1 ? 1 : 2, width: c.width, panels };
        },
        spec,
      ),
    render: (d, w) => {
      const s = d as unknown as Parsed;
      const width = s.width ?? w;
      const hd = header(s.title, undefined, width);
      const frs: Frag[] = [];
      const body = place(
        s.panels.map((pn) => ({
          span: pn.span,
          render: (cw: number) => {
            const f = pn.c.render(pn.spec, cw);
            frs.push(f);
            return f;
          },
        })),
        width,
        s.columns,
      );
      return { w: width, h: hd.h + body.h, svg: hd.svg + g({ transform: `translate(0 ${n(hd.h)})` }, body.svg), summary: `Dashboard${s.title ? ` "${s.title}"` : ''}: ${frs.map((f) => f.summary).filter(Boolean).join(' | ')}` };
    },
  };
}
void clamp;
void series;
