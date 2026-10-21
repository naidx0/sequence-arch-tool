/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL KIT: SHARED SVG PARTS (lane components)
   packages/schema/src/visual/util.ts

   Pure and deterministic: the same spec gives the same bytes on every machine
   (no Date, no Math.random, no DOM, no font measuring; text width is an
   estimate from the character count). Output is plain SVG using only the
   elements and attributes the chat's sanitiser allows (chat/svgSanitize.ts),
   coloured with CSS variables that carry a light fallback:

     var(--seq-fg,#1b1b1f)   text           var(--seq-muted,#6b6b76)  secondary text
     var(--seq-edge,#d8d8e0) lines          var(--seq-surface,#f5f5f8) tiles
     var(--seq-s1..s6,...)   series         var(--seq-ok|warn|bad,...) status

   In the app `.dgm-art` defines the variables from the theme tokens, so the
   same bytes are right in light and dark; saved and opened elsewhere they are
   the light fallbacks.
   ══════════════════════════════════════════════════════════════════════════ */

export const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';

const tok = (name: string, fallback: string): string => `var(--seq-${name},${fallback})`;
export const C = {
  fg: tok('fg', '#1b1b1f'),
  muted: tok('muted', '#6b6b76'),
  edge: tok('edge', '#d8d8e0'),
  surface: tok('surface', '#f5f5f8'),
  ok: tok('ok', '#169a68'),
  warn: tok('warn', '#c27a0a'),
  bad: tok('bad', '#d94a44'),
};
/** A panel or tile: the ink at 4% (so it is a faint tint on any background, light or dark), never a slab of its own colour. */
export const TINT = { fill: C.fg, 'fill-opacity': 0.04 } as const;
/** The quiet hairline round a panel or tile. */
export const HAIR = { stroke: C.edge, 'stroke-width': 1 } as const;
/** Solid series marks (bars, slices, segments) are drawn a little see-through so the grid and the page show: quieter than a slab of colour. */
export const SOFT = 0.78;
/** The smallest text the kit draws (px). With the drawing at the column's width this is also the rendered size. */
export const MIN_TEXT = 11;

/** First letter upper case ("dashboard" -> "Dashboard"); the rest is the author's. */
export const cap = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));

/** Six series colours, colour-vision-safe order (blue, orange, green, violet, pink, teal). */
export const SERIES: readonly string[] = [
  tok('s1', '#2f6fed'),
  tok('s2', '#d9822b'),
  tok('s3', '#1f9d6b'),
  tok('s4', '#8b5cf6'),
  tok('s5', '#d6457a'),
  tok('s6', '#1aa7b8'),
];
export const series = (i: number): string => SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length]!;
/** Status colour for a 0..1 utilisation against a saturation threshold. */
export const utilColor = (u: number, threshold = 0.8): string => (u >= 1 ? C.bad : u >= threshold ? C.warn : C.ok);
/** Fill for a utilisation bar: a neutral ink tint while it is under the threshold, the status colour only once it is at or past it (colour means "look here"). */
export const utilFill = (u: number, threshold = 0.8): { fill: string; 'fill-opacity': number } =>
  u >= threshold ? { fill: utilColor(u, threshold), 'fill-opacity': SOFT } : { fill: C.fg, 'fill-opacity': 0.32 };

/** A number as short text: one decimal (two under 10), no exponent, no -0. */
export function n(x: number): string {
  const r = Math.abs(x) < 10 ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Remove characters XML cannot hold, then escape. */
export function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type Attr = string | number | undefined | false;
/** `<tag a="b"/>` or `<tag a="b">children</tag>`; undefined and false attributes are skipped. */
export function el(tag: string, attrs: Record<string, Attr>, children?: string): string {
  let a = '';
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    a += ` ${k}="${typeof v === 'number' ? n(v) : esc(v)}"`;
  }
  return children === undefined ? `<${tag}${a}/>` : `<${tag}${a}>${children}</${tag}>`;
}

/** Estimated text width in px at `size` (sans, mixed case, digits wider than letters). */
export function textW(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c > 0x2e80 ? 1 : /[A-Z]/.test(ch) ? 0.64 : /[0-9]/.test(ch) ? 0.58 : /[ilj.,:;'|!]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.88 : 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}

/** `s` cut with an ellipsis so it fits `max` px. */
export function fit(s: string, max: number, size: number, bold = false): string {
  if (textW(s, size, bold) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (textW(out + ch + '…', size, bold) > max) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

export interface TextOpts {
  size?: number;
  bold?: boolean;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  /** y is the vertical centre of the line, not the baseline. */
  mid?: boolean;
  opacity?: number;
  /** The full text as a tooltip (a <title> child), for text that had to be cut. */
  tip?: string;
}
export function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const size = o.size ?? 12;
  return el(
    'text',
    {
      x,
      y: o.mid ? y + size * 0.35 : y,
      'font-size': size === 12 ? undefined : size,
      'font-weight': o.bold ? 600 : undefined,
      fill: o.fill === C.fg ? undefined : (o.fill ?? C.fg),
      'text-anchor': o.anchor && o.anchor !== 'start' ? o.anchor : undefined,
      opacity: o.opacity,
    },
    esc(s) + (o.tip !== undefined && o.tip !== s ? el('title', {}, esc(o.tip)) : ''),
  );
}

/**
 * One line of text in `max` px: the kit never wraps a title, label, caption or legend item.
 * Layout makes room first (the callers); if it still does not fit, the end is cut with "…" and the
 * full text rides along as a tooltip. Numbers are never cut (callers shrink or move them instead).
 */
export function line1(x: number, y: number, s: string, max: number, o: TextOpts = {}): string {
  const size = o.size ?? 12;
  return text(x, y, fit(s, max, size, o.bold), { ...o, tip: s });
}

/**
 * THE SIZE SCALE. Every kit visual sits in one weight band at chat width (340-560 px):
 *   text      11 px minimum, 12 body, 14 titles; KPI values 20 px (16 when a tile is tight)
 *   heights   the most a component may be at chat width for a typical spec (up to ~8 items);
 *             components with a free height clamp to it, list-like ones (bar rows, timeline,
 *             sequence, flow) tighten their rows, and only beyond ~8 items grow one row per item.
 * The README of the kit (schema/src/visual/README.md) states the same rule; a test holds both.
 */
export const MAX_H: Readonly<Record<string, number>> = {
  line: 260,
  bar: 280,
  kpi: 200,
  sparkline: 64,
  histogram: 260,
  donut: 240,
  flow: 400,
  sequence: 400,
  loadpath: 340,
  timeline: 300,
  capacity: 420,
  dashboard: 420,
};
export const KPI_VALUE = 20;

/** 1, 2, 5 times a power of ten steps covering [lo, hi] with about `count` ticks. */
export function niceTicks(lo: number, hi: number, count = 5): { ticks: number[]; min: number; max: number } {
  if (!(hi > lo)) {
    hi = lo + 1;
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, min, max };
}

/** 1234 -> 1.2k, 2500000 -> 2.5M, 0.5 -> 0.5. */
export function fmt(v: number, digits = 1): string {
  const a = Math.abs(v);
  const trim = (x: number): string => String(Math.round(x * 10 ** digits) / 10 ** digits);
  if (a >= 1e9) return `${trim(v / 1e9)}B`;
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e4) return `${trim(v / 1e3)}k`;
  if (a >= 1e3) return `${trim(v / 1e3)}k`;
  if (a >= 100) return trim(Math.round(v));
  return trim(v);
}

/** 1000 -> "1,000" (whole numbers under a million), else the short form. */
export function big(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e6) return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fmt(v);
}

/** A value with its unit, "420 ms", "12%". */
export const withUnit = (v: number, unit?: string): string => (unit ? (unit === '%' ? `${fmt(v)}%` : `${fmt(v)} ${unit}`) : fmt(v));

/** What a component draws: its size and the markup positioned from (0,0). */
export interface Frag {
  w: number;
  h: number;
  svg: string;
  /** One line for the agent and for aria. */
  summary: string;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The root element: viewBox plus pixel size, title and description for assistive tech. */
export function root(f: Frag, title: string, source?: string): string {
  const w = Math.ceil(f.w);
  const h = Math.ceil(f.h);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" font-family="${FONT}" font-size="12" fill="${C.fg}">` +
    (source ? `<!--visual ${source}-->` : '') +
    el('title', {}, esc(title)) +
    el('desc', {}, esc(f.summary)) +
    f.svg +
    '</svg>'
  );
}

/** The arrowhead marker every diagram shares. Ids are namespaced per document by `ns`. */
export function arrowDefs(ns: string, color: string = C.muted): string {
  return el('defs', {}, el('marker', { id: `${ns}a`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' }, el('path', { d: 'M0 0.5L7.5 4L0 7.5z', fill: color })));
}

/** Percentile of a sorted copy, linear interpolation. */
export function percentile(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

/** Group markup so its children share attributes (smaller output). */
export const g = (attrs: Record<string, Attr>, children: string): string => el('g', attrs, children);
