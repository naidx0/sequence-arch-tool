import { EDGE_EVIDENCE } from '@/data/advantages';
import { APP_BLUE, BLUE, Callout, CORAL, INK, LINE, MONO, MUTED, SANS, clamp, seg, stagger, svgProps, type ArtProps } from './shared';

/**
 * THE SYSTEM DESIGN BENEFIT, AS ONE SCENE IN DEPTH.
 *
 * Owner, second tour (17:56): the per-edge file:line labels "look quite ugly",
 * the files column and the edge-opens moment lacked depth; "more 3D, more
 * visualization, clear everything". So: the sample shop's map as one raised
 * plane in the exploded-layers chapter's projection (P(u, v, z) = (OX + 0.92u
 * - 0.42v, OY + 0.27u + 0.66v - z)), every service a block with a soft
 * shadow, and no labels on the edges. One edge, Gateway to Orders, opens once:
 * it lights, a line rises from it, and a card shows the two lines it was found
 * on (EDGE_EVIDENCE, verbatim from the fixture and gated by
 * tools/ci/site-advantages.test.mjs). Then Orders changes: rings spread on the
 * plane, what breaks turns coral and what it needs turns blue (ORDERS_IMPACT's
 * set: Gateway, Notifications and Shipping break; it needs Payments,
 * Inventory, Postgres and order.created).
 *
 * Pure render of `progress`; transforms, opacity and stroke offsets only.
 */

const W = 720;
const H = 520;

/* ── THE PROJECTION (the layers chapter's) ─────────────────────────────── */
const OX = 166;
const OY = 160;
const PW = 500;
const PD = 300;
const MATRIX = (z: number) => `matrix(0.92 0.27 -0.42 0.66 ${OX} ${OY - z})`;
const P = (u: number, v: number, z = 0) => [OX + 0.92 * u - 0.42 * v, OY + 0.27 * u + 0.66 * v - z] as const;
const pts = (...ps: (readonly [number, number])[]) => ps.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');

/* ── THE MAP: the sample shop's services around Orders ─────────────────── */
type Tone = 'breaks' | 'needs' | 'changed' | null;
type B = { id: string; name: string; u: number; v: number; w: number; tone: Tone; pill?: true };
const BH = 40;
const BZ = 14;
const BLOCKS: B[] = [
  { id: 'gateway', name: 'Gateway', u: 12, v: 6, w: 112, tone: 'breaks' },
  { id: 'orders', name: 'Orders', u: 214, v: 6, w: 112, tone: 'changed' },
  { id: 'payments', name: 'Payments', u: 376, v: 6, w: 112, tone: 'needs' },
  { id: 'inventory', name: 'Inventory', u: 376, v: 104, w: 112, tone: 'needs' },
  { id: 'postgres', name: 'Postgres', u: 12, v: 150, w: 112, tone: 'needs' },
  { id: 'topic', name: 'order.created', u: 214, v: 196, w: 112, tone: 'needs', pill: true },
  { id: 'notifications', name: 'Notifications', u: 376, v: 186, w: 112, tone: 'breaks' },
  { id: 'shipping', name: 'Shipping', u: 376, v: 252, w: 112, tone: 'breaks' },
];
/* Back to front, so nearer blocks paint over farther ones. */
const PAINT = [...BLOCKS].sort((a, b) => a.u + a.v - (b.u + b.v));

type E = { id: string; d: number[][]; tone: 'breaks' | 'needs' };
const EDGES: E[] = [
  /* Gateway calls Orders: the edge that opens. */
  { id: 'gw', d: [[124, 26], [214, 26]], tone: 'breaks' },
  { id: 'pay', d: [[326, 26], [376, 26]], tone: 'needs' },
  { id: 'inv', d: [[300, 46], [300, 124], [376, 124]], tone: 'needs' },
  { id: 'db', d: [[236, 46], [236, 92], [68, 92], [68, 150]], tone: 'needs' },
  { id: 'pub', d: [[270, 46], [270, 196]], tone: 'needs' },
  { id: 'n', d: [[326, 206], [376, 206]], tone: 'breaks' },
  { id: 's', d: [[326, 226], [350, 226], [350, 272], [376, 272]], tone: 'breaks' },
];
const ORD_C = [270, 26] as const;
const OPEN_AT = [169, 26] as const;

/* ── THE CARD: the opened edge's evidence, flat and in front ───────────── */
const CARD = { x: 290, y: 44, w: 366, h: 142 };
const short = (f: string) => f.split('/').pop() ?? f;
const ROW = EDGE_EVIDENCE.rows[0]!;
const CALL_CODE = ROW.call.code.slice(ROW.call.code.indexOf('getJson'));

const T = { plane: [0, 0.16], blocks: [0.04, 0.3], edges: [0.18, 0.44], light: [0.42, 0.5], rise: [0.46, 0.56], card: [0.52, 0.64], rings: [0.68, 0.84], impact: [0.8, 0.96] } as const;

const BREAK = CORAL;
const NEED = APP_BLUE;
const toneColor = (t: Tone) => (t === 'breaks' ? BREAK : t === 'needs' || t === 'changed' ? NEED : null);
const poly = (d: number[][]) => d.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');

function Head({ d, color, opacity }: { d: number[][]; color: string; opacity: number }) {
  const a = d[d.length - 2]!;
  const b = d[d.length - 1]!;
  const ang = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!);
  const s = 8;
  const p1 = [b[0]! - s * Math.cos(ang - 0.5), b[1]! - s * Math.sin(ang - 0.5)];
  const p2 = [b[0]! - s * Math.cos(ang + 0.5), b[1]! - s * Math.sin(ang + 0.5)];
  return <path d={`M${p1[0]} ${p1[1]} L${b[0]} ${b[1]} L${p2[0]} ${p2[1]}`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity }} />;
}

function Block({ b, t, tImp, tRing }: { b: B; t: number; tImp: number; tRing: number }) {
  const z = BZ * t;
  const { u, v, w } = b;
  const h = BH;
  const col = toneColor(b.tone);
  const lit = b.tone === 'changed' ? tRing : tImp;
  const r = b.pill ? 13 : 7;
  return (
    <g style={{ opacity: Math.min(1, t * 1.6) }}>
      {/* Soft shadow on the plane, offset away from the light. */}
      <g transform={MATRIX(0)}>
        <rect x={u + 4} y={v + 7} width={w} height={h} rx={r} fill="rgb(0, 0, 0)" opacity={0.55 * t} filter="url(#sd-blur)" />
      </g>
      {/* The two sides that face us. */}
      <polygon points={pts(P(u + w, v, 0), P(u + w, v + h, 0), P(u + w, v + h, z), P(u + w, v, z))} fill="rgb(28, 28, 27)" />
      <polygon points={pts(P(u, v + h, 0), P(u + w, v + h, 0), P(u + w, v + h, z), P(u, v + h, z))} fill="rgb(36, 36, 35)" />
      {/* The top, with the name on it. */}
      <g transform={MATRIX(z)}>
        <rect x={u} y={v} width={w} height={h} rx={r} fill="rgb(52, 52, 50)" stroke="rgba(255, 255, 255, 0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {col ? <rect x={u} y={v} width={w} height={h} rx={r} fill="none" stroke={col} strokeWidth={1.6} vectorEffect="non-scaling-stroke" style={{ opacity: lit }} /> : null}
        {!b.pill ? <rect x={u + 10} y={v + h / 2 - 7} width={14} height={14} rx={4} fill="rgba(91, 155, 255, 0.22)" /> : null}
        <text x={b.pill ? u + w / 2 : u + 32} y={v + h / 2 + 5} textAnchor={b.pill ? 'middle' : 'start'} fontFamily={SANS} fontSize={14} fontWeight={600} fill="rgb(236, 235, 232)">
          {b.name}
        </text>
      </g>
    </g>
  );
}

export function SystemDesignArt({ progress = 1, className, style }: ArtProps) {
  const p = clamp(progress, 0, 1);
  const tPlane = seg(p, T.plane[0], T.plane[1]);
  const tLight = seg(p, T.light[0], T.light[1]);
  const tRise = seg(p, T.rise[0], T.rise[1]);
  const tCard = seg(p, T.card[0], T.card[1]);
  const tRings = seg(p, T.rings[0], T.rings[1]);
  const tImp = seg(p, T.impact[0], T.impact[1]);

  /* The plane's corners, and its edge thickness. */
  const c1 = P(PW, 0);
  const c2 = P(PW, PD);
  const c3 = P(0, PD);
  const SLAB = 8;

  /* The rising line: from the middle of the opened edge, straight up to the card. */
  const base = P(OPEN_AT[0], OPEN_AT[1], 0);
  const top = CARD.y + CARD.h;
  const riseY = base[1] - (base[1] - top) * tRise;

  return (
    <svg {...svgProps([W, H], className, style, `The sample shop's map as one raised plane of services. The edge from ${EDGE_EVIDENCE.from} to ${EDGE_EVIDENCE.to} opens to the two lines of code it was found on; then Orders changes, and the services that break turn coral while the ones it needs turn blue.`)}>
      <defs>
        <filter id="sd-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="sd-lift" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="rgb(11, 12, 14)" floodOpacity="0.22" />
        </filter>
        <filter id="sd-card" x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="rgb(11, 12, 14)" floodOpacity="0.18" />
        </filter>
        <clipPath id="sd-plane">
          <rect x={0} y={0} width={PW} height={PD} rx={6} />
        </clipPath>
      </defs>

      {/* Callouts, on one rule. */}
      <Callout x={24} y={24} n="01" label="THE MAP, READ FROM CODE" />
      <Callout x={696} y={24} n="02" label="ONE EDGE, OPENED" anchor="end" t={0.35 + 0.65 * tCard} />
      <line x1={24} y1={32} x2={696} y2={32} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />

      {/* ── THE PLANE: a dark slab with a soft shadow under it ── */}
      <g style={{ opacity: tPlane }} transform={`translate(0 ${(1 - tPlane) * 14})`}>
        <polygon points={pts(c3, c2, [c2[0], c2[1] + SLAB], [c3[0], c3[1] + SLAB])} fill="rgb(26, 26, 25)" />
        <polygon points={pts(c1, c2, [c2[0], c2[1] + SLAB], [c1[0], c1[1] + SLAB])} fill="rgb(19, 19, 18)" />
        <g transform={MATRIX(0)} filter="url(#sd-lift)">
          <rect x={0} y={0} width={PW} height={PD} rx={6} fill="rgb(32, 32, 31)" />
        </g>
        <g transform={MATRIX(0)}>
          <rect x={0} y={0} width={PW} height={PD} rx={6} fill="none" stroke="rgba(255, 255, 255, 0.16)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <g stroke="rgba(255, 255, 255, 0.045)" strokeWidth={1} vectorEffect="non-scaling-stroke">
            {Array.from({ length: Math.floor(PW / 40) - 1 }, (_, i) => (
              <line key={`u${i}`} x1={(i + 1) * 40} y1={0} x2={(i + 1) * 40} y2={PD} vectorEffect="non-scaling-stroke" />
            ))}
            {Array.from({ length: Math.floor(PD / 40) - 1 }, (_, i) => (
              <line key={`v${i}`} x1={0} y1={(i + 1) * 40} x2={PW} y2={(i + 1) * 40} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <text x={PW - 16} y={PD - 14} textAnchor="end" fontFamily={MONO} fontSize={11} letterSpacing="0.1em" fill="rgba(255, 255, 255, 0.4)">
            MAP
          </text>

          {/* Impact rings around Orders, on the plane. */}
          <g clipPath="url(#sd-plane)">
            {[60, 120, 180, 240].map((r, i) => {
              const t = stagger(tRings, 0, 1, i, 4, 0.5);
              return <circle key={r} cx={ORD_C[0]} cy={ORD_C[1]} r={r * (0.4 + 0.6 * t)} fill="none" stroke={APP_BLUE} strokeWidth={1.2} strokeDasharray="3 6" vectorEffect="non-scaling-stroke" style={{ opacity: (0.7 - i * 0.14) * t }} />;
            })}
            <circle cx={ORD_C[0]} cy={ORD_C[1]} r={240 * (0.2 + 0.8 * tRings)} fill={`rgba(91, 155, 255, ${0.07 * tRings})`} />
          </g>

          {/* Edges on the plane: drawn on, then coloured by the impact. No labels. */}
          {EDGES.map((e, i) => {
            const t = stagger(p, T.edges[0], T.edges[1], i, EDGES.length);
            const col = e.tone === 'breaks' ? BREAK : NEED;
            const opened = e.id === 'gw';
            return (
              <g key={e.id}>
                <path d={poly(e.d)} fill="none" stroke="rgba(255, 255, 255, 0.55)" strokeWidth={1.8} strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - t} />
                <Head d={e.d} color="rgba(255, 255, 255, 0.55)" opacity={t > 0.96 ? 1 - tImp : 0} />
                {opened ? <path d={poly(e.d)} fill="none" stroke={APP_BLUE} strokeWidth={7} strokeLinecap="round" style={{ opacity: 0.28 * tLight * (1 - tImp) }} /> : null}
                {opened ? <path d={poly(e.d)} fill="none" stroke={APP_BLUE} strokeWidth={2.2} style={{ opacity: tLight * (1 - tImp) }} /> : null}
                <path d={poly(e.d)} fill="none" stroke={col} strokeWidth={2.2} strokeLinejoin="round" style={{ opacity: tImp }} />
                <Head d={e.d} color={col} opacity={tImp} />
              </g>
            );
          })}
          {/* Where the opened edge rises from. */}
          <circle cx={OPEN_AT[0]} cy={OPEN_AT[1]} r={4} fill="rgb(255, 255, 255)" stroke={APP_BLUE} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ opacity: tLight }} />
        </g>
      </g>

      {/* ── THE BLOCKS: back to front, each rises from the plane ── */}
      {PAINT.map((b) => {
        const i = BLOCKS.indexOf(b);
        return <Block key={b.id} b={b} t={stagger(p, T.blocks[0], T.blocks[1], i, BLOCKS.length)} tImp={tImp} tRing={tRings} />;
      })}

      {/* ── THE EDGE OPENS: a line rises to the card with the two lines it was found on ── */}
      <line x1={base[0]} y1={base[1]} x2={base[0]} y2={riseY} stroke={BLUE} strokeWidth={1.4} strokeDasharray="3 4" style={{ opacity: tRise > 0 ? 1 : 0 }} />
      <g transform={`translate(${CARD.x} ${CARD.y + (1 - tCard) * 14})`} style={{ opacity: tCard }} filter="url(#sd-card)">
        <rect width={CARD.w} height={CARD.h} rx={14} fill="rgb(255, 255, 255)" stroke="rgba(31, 79, 224, 0.4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle cx={20} cy={26} r={4} fill={BLUE} />
        <text x={32} y={30.5} fontFamily={SANS} fontSize={13.5} fontWeight={600} fill={INK}>
          {EDGE_EVIDENCE.from} → {EDGE_EVIDENCE.to}
        </text>
        <text x={CARD.w - 18} y={30.5} textAnchor="end" fontFamily={SANS} fontSize={12} fill={MUTED}>
          found in code
        </text>
        <line x1={16} y1={46} x2={CARD.w - 16} y2={46} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {[
          { f: short(ROW.call.file), n: ROW.call.line, code: CALL_CODE },
          { f: short(ROW.handler.file), n: ROW.handler.line, code: ROW.handler.code },
        ].map((r, i) => (
          <g key={r.f} transform={`translate(18 ${68 + i * 38})`}>
            <text x={0} y={0} fontFamily={MONO} fontSize={10} fill={MUTED}>
              {r.f}
              <tspan fill={BLUE}>{`  line ${r.n}`}</tspan>
            </text>
            <rect x={-6} y={7} width={CARD.w - 24} height={20} rx={5} fill="rgba(31, 79, 224, 0.06)" />
            <text x={4} y={21} fontFamily={MONO} fontSize={10.5} fill={INK}>
              {r.code}
            </text>
          </g>
        ))}
      </g>

      {/* The reading, under the drawing. */}
      <text x={24} y={H - 8} fontFamily={SANS} fontSize={12.5} fill={MUTED}>
        Every edge opens to the lines it was found on.
      </text>
      <text x={696} y={H - 8} textAnchor="end" fontFamily={SANS} fontSize={12.5} fill={BLUE} style={{ opacity: tImp }}>
        If Orders changes, three services break.
      </text>
    </svg>
  );
}
