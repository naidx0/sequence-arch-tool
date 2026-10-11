import type { CSSProperties } from 'react';

/**
 * THE DRAWING LANGUAGE SHARED BY THE FIVE ILLUSTRATIONS.
 *
 * Flat technical drawings on the light page, the way Apple draws a detail of
 * a product next to its exploded hero: ink hairlines (1 px, never scaled),
 * live edges at 1.5 px, one accent blue, coral only for what breaks, the app's
 * dark ground for anything that is the product. Mono for file names, numbers
 * and tool names; Inter for the names of things. Radii: 4 chips, 8 nodes,
 * 12 panels. Everything sits on an 8 px grid.
 *
 * Every piece takes `progress` (0..1) and draws that exact frame from it:
 * transforms, opacity and stroke-dashoffset only, so a scroll driver can set
 * the prop every frame and nothing on the page reflows. progress=1 is the
 * finished drawing. Path lengths are computed here, not measured, so the
 * first frame is already right and the pieces render identically on the
 * server.
 */

export type ArtProps = {
  /** 0..1. The finished drawing at 1 (the default). */
  progress?: number;
  className?: string;
  style?: CSSProperties;
};

/* ── PALETTE (rgb(), never a quoted hex string: the link checker reads one as an in-page anchor) ── */
export const INK = 'rgb(11, 12, 14)';
export const MUTED = 'rgb(95, 97, 102)';
export const LINE = 'rgba(11, 12, 14, 0.12)';
export const LINE_STRONG = 'rgba(11, 12, 14, 0.24)';
export const GRID = 'rgba(11, 12, 14, 0.06)';
export const PAPER = 'rgb(255, 255, 255)';
export const BLUE = 'rgb(31, 79, 224)';
export const BLUE_SOFT = 'rgba(31, 79, 224, 0.55)';
export const BLUE_WASH = 'rgba(31, 79, 224, 0.08)';
export const CORAL = 'rgb(226, 104, 72)';
export const CORAL_WASH = 'rgba(226, 104, 72, 0.1)';
/* The product's dark ground and what sits on it. */
export const APP = 'rgb(32, 32, 31)';
export const APP_NODE = 'rgb(46, 46, 44)';
export const APP_LINE = 'rgba(255, 255, 255, 0.16)';
export const APP_HAIR = 'rgba(255, 255, 255, 0.09)';
export const APP_TEXT = 'rgb(236, 235, 232)';
export const APP_MUTED = 'rgb(163, 162, 157)';
export const APP_BLUE = 'rgb(91, 155, 255)';

export const MONO = "ui-monospace, 'SFMono-Regular', Consolas, monospace";
export const SANS = "'Inter', 'Inter Fallback', system-ui, sans-serif";

/* ── TIMING ─────────────────────────────────────────────────────────────── */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
/** Eased 0..1 over the window [a, b] of progress. */
export const seg = (p: number, a: number, b: number) => ease(clamp((p - a) / (b - a), 0, 1));
/** Item i of n inside the window [a, b], each taking `span` of the window. */
export const stagger = (p: number, a: number, b: number, i: number, n: number, span = 0.6) => {
  const w = b - a;
  const start = a + (w * (1 - span) * i) / Math.max(1, n - 1);
  return seg(p, start, start + w * span);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ── GEOMETRY ───────────────────────────────────────────────────────────── */
export type Pt = readonly [number, number];
export const poly = (d: readonly Pt[]) => d.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
export const polyLen = (d: readonly Pt[]) => {
  let L = 0;
  for (let i = 1; i < d.length; i += 1) L += Math.hypot(d[i]![0] - d[i - 1]![0], d[i]![1] - d[i - 1]![1]);
  return L;
};
/** Rounded-corner orthogonal route through the points (the app's edge style). */
export const route = (d: readonly Pt[], r = 6) => {
  if (d.length < 3) return poly(d);
  let s = `M${d[0]![0]} ${d[0]![1]}`;
  for (let i = 1; i < d.length - 1; i += 1) {
    const a = d[i - 1]!;
    const b = d[i]!;
    const c = d[i + 1]!;
    const inL = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const outL = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const rr = Math.min(r, inL / 2, outL / 2);
    const p1: Pt = [b[0] - ((b[0] - a[0]) / inL) * rr, b[1] - ((b[1] - a[1]) / inL) * rr];
    const p2: Pt = [b[0] + ((c[0] - b[0]) / outL) * rr, b[1] + ((c[1] - b[1]) / outL) * rr];
    s += ` L${p1[0]} ${p1[1]} Q${b[0]} ${b[1]} ${p2[0]} ${p2[1]}`;
  }
  const z = d[d.length - 1]!;
  return `${s} L${z[0]} ${z[1]}`;
};

/* ── TEXT FITTING (estimates; the preview measures the real glyphs) ─────── */
/** Width of a mono string at `size` px: SF Mono / Consolas sit at 0.60–0.62 em. */
export const monoW = (s: string, size: number) => s.length * size * 0.62;
/** Width of an Inter string at `size` px, average glyph 0.56 em (bold 0.58). */
export const sansW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.58 : 0.56);

/* ── PRIMITIVES ─────────────────────────────────────────────────────────── */

/** A path that draws itself from 0..1 with stroke-dashoffset. `len` is its exact length. */
export function Drawn({
  d,
  len,
  t,
  stroke,
  width = 1.5,
  dash,
  opacity,
  cap = 'round',
}: {
  d: string;
  len: number;
  t: number;
  stroke: string;
  width?: number;
  /** A visible dash pattern (for claimed edges). Combined with the draw-on mask via a longer period. */
  dash?: string;
  opacity?: number;
  cap?: 'round' | 'butt';
}) {
  /* The draw-on effect needs the dash array to cover the whole path; a visible
     dash pattern can't share that trick, so dashed paths fade instead. */
  if (dash) {
    return <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinecap="butt" style={{ opacity: (opacity ?? 1) * t }} />;
  }
  const L = Math.ceil(len) + 2;
  return <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={`${L} ${L}`} strokeDashoffset={L * (1 - t)} style={opacity === undefined ? undefined : { opacity }} />;
}

/** An open arrowhead at the end of a polyline, in the direction of its last segment. */
export function Head({ d, color, t = 1, size = 6, width = 1.5 }: { d: readonly Pt[]; color: string; t?: number; size?: number; width?: number }) {
  const a = d[d.length - 2]!;
  const b = d[d.length - 1]!;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const p1 = [b[0] - size * Math.cos(ang - 0.5), b[1] - size * Math.sin(ang - 0.5)];
  const p2 = [b[0] - size * Math.cos(ang + 0.5), b[1] - size * Math.sin(ang + 0.5)];
  return <path d={`M${p1[0]} ${p1[1]} L${b[0]} ${b[1]} L${p2[0]} ${p2[1]}`} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: t }} />;
}

/** A mono chip: `file:line` evidence, a tool name, a count. Centered on (cx, cy). */
export function Chip({
  cx,
  cy,
  text,
  color = BLUE,
  fill = PAPER,
  t = 1,
  size = 10.5,
  dark = false,
}: {
  cx: number;
  cy: number;
  text: string;
  color?: string;
  fill?: string;
  t?: number;
  size?: number;
  dark?: boolean;
}) {
  const w = Math.round(monoW(text, size)) + 14;
  const h = 18;
  const s = 0.92 + 0.08 * t;
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`} style={{ opacity: t }}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill={dark ? APP_NODE : fill} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={0} y={3.5} textAnchor="middle" fontFamily={MONO} fontSize={size} fill={color} data-fit={w - 10}>
        {text}
      </text>
    </g>
  );
}

/** A section header, the way a drawing numbers its callouts: "01 — FILES". */
export function Callout({ x, y, n, label, t = 1, anchor = 'start' }: { x: number; y: number; n: string; label: string; t?: number; anchor?: 'start' | 'end' }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontFamily={MONO} fontSize={10} letterSpacing="0.1em" fill={MUTED} style={{ opacity: t }}>
      <tspan fill={INK}>{n}</tspan>
      {`  ${label}`}
    </text>
  );
}

/** The dotted drafting grid under a drawing. */
export function Grid({ w, h, step = 32, inset = 0 }: { w: number; h: number; step?: number; inset?: number }) {
  const pts: string[] = [];
  for (let x = inset + step; x < w - inset; x += step) for (let y = inset + step; y < h - inset; y += step) pts.push(`M${x} ${y}h0`);
  return <path d={pts.join('')} stroke={LINE_STRONG} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.6} />;
}

/** A dark product panel with a mono label in its corner. */
export function Panel({ x, y, w, h, label, labelAt = 'br', t = 1, children }: { x: number; y: number; w: number; h: number; label?: string; labelAt?: 'br' | 'bl'; t?: number; children?: React.ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`} style={{ opacity: t }}>
      <rect width={w} height={h} rx={12} fill={APP} />
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={11.5} fill="none" stroke={APP_LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {label ? (
        <text x={labelAt === 'br' ? w - 14 : 16} y={h - 12} textAnchor={labelAt === 'br' ? 'end' : 'start'} fontFamily={MONO} fontSize={10} letterSpacing="0.1em" fill={APP_MUTED}>
          {label}
        </text>
      ) : null}
      {children}
    </g>
  );
}

/** A node on the dark graph surface. */
export function DarkNode({ x, y, w = 108, h = 36, name, sub, ring, t = 1, pill = false }: { x: number; y: number; w?: number; h?: number; name: string; sub?: string; ring?: string; t?: number; pill?: boolean }) {
  const r = pill ? h / 2 : 8;
  return (
    <g transform={`translate(${x} ${y})`} style={{ opacity: t }}>
      <rect width={w} height={h} rx={r} fill={APP_NODE} stroke={APP_LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {ring ? <rect x={-0.5} y={-0.5} width={w + 1} height={h + 1} rx={r} fill="none" stroke={ring} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
      {!pill ? <rect x={10} y={h / 2 - 8} width={16} height={16} rx={4} fill="rgba(91, 155, 255, 0.18)" /> : null}
      <text x={pill ? w / 2 : 34} y={sub ? h / 2 - 2 : h / 2 + 4.5} textAnchor={pill ? 'middle' : 'start'} fontFamily={SANS} fontSize={12.5} fontWeight={600} fill={APP_TEXT} data-fit={w - (pill ? 16 : 42)}>
        {name}
      </text>
      {sub ? (
        <text x={34} y={h / 2 + 11} fontFamily={SANS} fontSize={10} fill={APP_MUTED} data-fit={w - 42}>
          {sub}
        </text>
      ) : null}
    </g>
  );
}

/** A node on the light page (the chat / claim layer). */
export function LightNode({ x, y, w = 104, h = 36, name, stroke = LINE_STRONG, t = 1 }: { x: number; y: number; w?: number; h?: number; name: string; stroke?: string; t?: number }) {
  return (
    <g transform={`translate(${x} ${y})`} style={{ opacity: t }}>
      <rect width={w} height={h} rx={8} fill={PAPER} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect x={10} y={h / 2 - 8} width={16} height={16} rx={4} fill={BLUE_WASH} stroke={BLUE_SOFT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={34} y={h / 2 + 4.5} fontFamily={SANS} fontSize={12.5} fontWeight={600} fill={INK} data-fit={w - 42}>
        {name}
      </text>
    </g>
  );
}

export const svgProps = (vb: readonly [number, number], className?: string, style?: CSSProperties, label?: string) => ({
  viewBox: `0 0 ${vb[0]} ${vb[1]}`,
  width: '100%',
  role: 'img' as const,
  'aria-label': label,
  className,
  style: { display: 'block', height: 'auto', overflow: 'visible', ...style },
  fontFamily: SANS,
});
