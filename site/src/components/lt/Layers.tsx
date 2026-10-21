import { forwardRef, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DEPTH_MEASURED, kTokens } from '@/components/DepthCharts';
import { useMediaQuery, useReducedMotion } from '@/components/lt/hooks';

/**
 * HOW IT WORKS, AS AN EXPLODED DIAGRAM.
 *
 * One SVG, one exact parallel projection. Three planes (the repository, the
 * graph scanned from it, the chat) are groups drawn through the same matrix,
 * so every line on a plane and every line between planes is a true straight
 * segment of the same 3D scene: P(u, v, z) = (OX + 0.92u - 0.42v, OY + 0.27u +
 * 0.66v - z).
 *
 * EVERYTHING ON IT IS THE SAMPLE SHOP AS THE SCANNER SEES IT. Taken from a scan
 * of packages/analyzer/test/fixtures/shopfront with the analyzer's own scanRepo
 * (2026-10-10): the 24 source files it read, the services, and the edges that
 * touch Orders with their evidence files: gateway/src/routes/orders.ts lines 9
 * and 14 into orders/app/routes.py lines 11 and 19; payments_client.py line 10
 * into payments/src/index.js line 8 (POST /charge); inventory_client.py line 8
 * into inventory/server.py line 22 (the Inventory gRPC stub; its proto is
 * evidence too but not one of the 24 scanned source files); events.py line 10
 * publishing order.created, notifications/worker.py line 11 and
 * shipping/subscriber.go line 23 consuming it; db.py and models.py for the
 * orders table. That is 11 of the 24 source files the scanner read.
 * Edge labels are the strings the app's map shows. The question
 * is the one in the recordings. The numbers are DEPTH_MEASURED, labelled as
 * what they measured (Sequence's own repository, not the sample).
 *
 * THE SEQUENCE, SCRUBBED BY SCROLL: the planes separate, the question drops
 * onto Orders, lines run from Orders to the files it touches (and only those),
 * the impact arrows draw (stroke-dashoffset), then the numbers. Transforms,
 * opacity and stroke offsets only, written from requestAnimationFrame, so
 * nothing on the page moves. Reduced motion and phones: the final state, flat.
 */

/* ── THE PROJECTION ─────────────────────────────────────────────────────── */
const OX = 210;
const OY = 396;
const PW = 640; // plane width (u)
const PD = 440; // plane depth (v)
const G_MIN = 16;
const G_MAX = 186;
const MATRIX = (z: number) => `matrix(0.92 0.27 -0.42 0.66 ${OX} ${OY - z})`;
const P = (u: number, v: number, z: number) => ({ x: OX + 0.92 * u - 0.42 * v, y: OY + 0.27 * u + 0.66 * v - z });
const pt = (p: { x: number; y: number }) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;

/* ── THE REPOSITORY: the 24 source files the scanner read ───────────────── */
type F = { name: string; hit?: true };
const COLS: { u: number; groups: { dir: string; files: F[] }[] }[] = [
  {
    u: 16,
    groups: [
      {
        dir: 'gateway/src/',
        files: [{ name: 'index.ts' }, { name: 'lib/http.ts' }, { name: 'routes/invoices.ts' }, { name: 'routes/orders.ts', hit: true }, { name: 'routes/payments.ts' }, { name: 'routes/shipments.ts' }],
      },
      { dir: 'edge/', files: [{ name: 'default.conf' }] },
    ],
  },
  {
    u: 186,
    groups: [
      {
        dir: 'orders/app/',
        files: [
          { name: 'db.py', hit: true },
          { name: 'events.py', hit: true },
          { name: 'inventory_client.py', hit: true },
          { name: 'main.py' },
          { name: 'models.py', hit: true },
          { name: 'payments_client.py', hit: true },
          { name: 'routes.py', hit: true },
        ],
      },
    ],
  },
  {
    u: 352,
    groups: [
      { dir: 'payments/src/', files: [{ name: 'db.js' }, { name: 'index.js', hit: true }, { name: 'stripe.js' }] },
      { dir: 'notifications/', files: [{ name: 'worker.py', hit: true }] },
      { dir: 'inventory/', files: [{ name: 'server.py', hit: true }] },
    ],
  },
  {
    u: 496,
    groups: [
      { dir: 'shipping/', files: [{ name: 'main.go' }, { name: 'subscriber.go', hit: true }] },
      { dir: 'invoices/…/', files: [{ name: 'InvoiceController.java' }, { name: 'PaymentClient.java' }, { name: 'application.properties' }] },
    ],
  },
];
const ROW = 19;
/* The front of the plane: the part the graph plane above does not cover once separated. */
const TREE_TOP = 256;
type Placed = { key: string; label: string; u: number; v: number; kind: 'dir' | 'file'; hit: boolean };
const TREE: Placed[] = [];
for (const c of COLS) {
  let v = TREE_TOP;
  for (const g of c.groups) {
    TREE.push({ key: `${g.dir}`, label: g.dir, u: c.u, v, kind: 'dir', hit: false });
    v += ROW;
    for (const f of g.files) {
      TREE.push({ key: `${g.dir}${f.name}`, label: f.name, u: c.u + 10, v, kind: 'file', hit: Boolean(f.hit) });
      v += ROW;
    }
  }
}
const FILE_COUNT = TREE.filter((t) => t.kind === 'file').length;
const HITS = TREE.filter((t) => t.hit);

/* ── THE GRAPH: the scanned services (names and subtitles as the map shows them) */
const NW = 136;
const NH = 48;
type N = { id: string; name: string; sub: string; u: number; v: number };
const NODES: N[] = [
  { id: 'edge', name: 'Edge', sub: 'Service', u: 14, v: 26 },
  { id: 'gateway', name: 'Gateway', sub: 'ts, express', u: 186, v: 26 },
  { id: 'invoices', name: 'Invoices', sub: 'java, 2 files', u: 346, v: 26 },
  { id: 'payments', name: 'Payments', sub: 'js, express', u: 498, v: 26 },
  { id: 'orders', name: 'Orders', sub: 'py, fastapi', u: 186, v: 172 },
  { id: 'inventory', name: 'Inventory', sub: 'py, 1 file', u: 346, v: 150 },
  { id: 'notifications', name: 'Notifications', sub: 'py, 1 file', u: 498, v: 216 },
  { id: 'topic', name: 'Order Created', sub: 'Topic', u: 346, v: 270 },
  { id: 'shipping', name: 'Shipping', sub: 'go, 2 files', u: 498, v: 334 },
  { id: 'postgres', name: 'Postgres', sub: 'Datastore', u: 186, v: 334 },
  { id: 'redis', name: 'Redis', sub: 'broker', u: 14, v: 334 },
];
const node = (id: string) => NODES.find((n) => n.id === id)!;
const ORD = node('orders');
const ORD_C = { u: ORD.u + NW / 2, v: ORD.v + NH / 2 };

/* Context edges (faint), real but not Orders'. Polylines in plane coordinates. */
const CONTEXT: number[][][] = [
  [[150, 50], [186, 50]], // edge -> gateway (proxy /api/)
  [[322, 42], [346, 42]], // gateway -> invoices
  [[482, 42], [498, 42]], // invoices -> payments
  [[254, 26], [254, 12], [566, 12], [566, 26]], // gateway -> payments
];

/* Orders' edges, the impact set. kind: 'breaks' = impacted if Orders changes; 'needs' = Orders depends on it. */
type E = { id: string; d: number[][]; label: string; at: number[]; kind: 'breaks' | 'needs'; end?: true };
const IMPACT: E[] = [
  { id: 'gw', d: [[254, 74], [254, 172]], label: 'GET /orders/* +1 more', at: [262, 128], kind: 'breaks' },
  { id: 'pay', d: [[322, 180], [334, 180], [334, 118], [566, 118], [566, 74]], label: 'POST /charge', at: [424, 112], kind: 'needs' },
  { id: 'inv', d: [[322, 194], [346, 194]], label: 'grpc', at: [326, 210], kind: 'needs' },
  { id: 'db', d: [[220, 220], [220, 334]], label: 'db +3 more', at: [212, 296], kind: 'needs', end: true },
  { id: 'pub', d: [[296, 220], [296, 294], [346, 294]], label: 'publish order.created', at: [302, 262], kind: 'needs' },
  { id: 'n', d: [[482, 286], [490, 286], [490, 240], [498, 240]], label: '', at: [0, 0], kind: 'breaks' },
  { id: 's', d: [[482, 302], [490, 302], [490, 358], [498, 358]], label: 'consume order.created', at: [352, 340], kind: 'breaks' },
];

/* The question card on the chat plane, its front edge directly above Orders. */
const CARD = { u: ORD_C.u - 116, v: ORD_C.v - 112, w: 232, h: 112 };

/* ── STAGES ─────────────────────────────────────────────────────────────── */
const STAGES = [
  { n: '01', title: 'Three layers.', body: 'Your repository, the graph scanned from it, and the chat on top.' },
  { n: '02', title: 'A question about one service.', body: 'Asked on Orders, it lands on the Orders node, not on the whole repository.' },
  { n: '03', title: 'Only the files it touches.', body: `Orders reaches ${HITS.length} of the ${FILE_COUNT} source files, through the edges the scanner found.` },
  { n: '04', title: 'What breaks, and what it needs.', body: 'Its callers and the consumers of order.created break if it changes. It needs Payments, Inventory and Postgres.' },
  { n: '05', title: 'Less to read.', body: 'Far fewer lookups and tokens for the same answer.' },
] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const seg = (p: number, a: number, b: number) => ease(clamp((p - a) / (b - a), 0, 1));

/* Stage boundaries in scroll progress. */
const T = { sep: [0.02, 0.2], drop: [0.24, 0.36], files: [0.4, 0.56], impact: [0.6, 0.76], nums: [0.8, 0.88] } as const;

export function Layers() {
  const reduced = useReducedMotion();
  const narrow = useMediaQuery('(max-width: 959px)');
  return reduced || narrow ? <LayersStatic /> : <LayersPinned />;
}

function LayersPinned() {
  const track = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [stage, setStage] = useState(0);
  const stageRef = useRef(0);

  /* Layout effect: the closed-up state is written before the first paint. */
  useLayoutEffect(() => {
    let raf = 0;
    const root = svg.current;
    if (!root) return undefined;
    const q = <T extends Element>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
    const planes = q<SVGGElement>('[data-plane]');
    const drop = q<SVGPathElement>('[data-drop]');
    const fileLines = q<SVGPathElement>('[data-fline]');
    const fileDots = q<SVGElement>('[data-fdot]');
    const hitRows = q<SVGElement>('[data-hit]');
    const missRows = q<SVGElement>('[data-miss]');
    const impact = q<SVGPathElement>('[data-impact]');
    const heads = q<SVGElement>('[data-head]');
    const labels = q<SVGElement>('[data-elabel]');
    const ordersRing = q<SVGElement>('[data-orders-ring]');
    const lens = new Map<Element, number>();
    for (const el of [...drop, ...fileLines, ...impact]) {
      const L = el.getTotalLength();
      lens.set(el, L);
      el.style.strokeDasharray = `${L} ${L}`;
    }
    const nums = track.current?.querySelector<HTMLElement>('[data-nums]');

    const draw = () => {
      raf = 0;
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? clamp(-r.top / span, 0, 1) : 0;

      const g = G_MIN + (G_MAX - G_MIN) * seg(p, T.sep[0], T.sep[1]);
      planes.forEach((pl) => {
        const i = Number(pl.dataset.plane);
        /* The planes are drawn at their final heights; the lift closes the gap. */
        pl.setAttribute('transform', `translate(0 ${((G_MAX - g) * i).toFixed(2)})`);
      });
      const tDrop = seg(p, T.drop[0], T.drop[1]);
      const tFiles = seg(p, T.files[0], T.files[1]);
      const tImp = seg(p, T.impact[0], T.impact[1]);
      const tNums = seg(p, T.nums[0], T.nums[1]);
      const off = (els: SVGPathElement[], t: number, stagger = 0) =>
        els.forEach((e, i) => {
          const L = lens.get(e) ?? 0;
          const local = stagger ? clamp(t * (1 + stagger * els.length) - i * stagger, 0, 1) : t;
          e.style.strokeDashoffset = String(L * (1 - local));
        });
      off(drop, tDrop);
      off(fileLines, tFiles, 0.08);
      off(impact, tImp, 0.06);
      ordersRing.forEach((e) => (e.style.opacity = String(tDrop)));
      fileDots.forEach((e) => (e.style.opacity = String(tFiles > 0.92 ? 1 : 0)));
      hitRows.forEach((e) => (e.style.opacity = String(tFiles)));
      missRows.forEach((e) => (e.style.opacity = String(1 - 0.55 * tFiles)));
      heads.forEach((e) => (e.style.opacity = String(tImp > 0.95 ? 1 : 0)));
      labels.forEach((e) => (e.style.opacity = String(clamp((tImp - 0.5) * 2, 0, 1))));
      if (nums) {
        nums.style.opacity = String(tNums);
        nums.style.transform = `translateY(${(1 - tNums) * 12}px)`;
      }
      const s = p < T.drop[0] ? 0 : p < T.files[0] ? 1 : p < T.impact[0] ? 2 : p < T.nums[0] ? 3 : 4;
      if (s !== stageRef.current) {
        stageRef.current = s;
        setStage(s);
      }
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={track} id="layers" className="lt-layers" aria-labelledby="layers-title" data-testid="layers" data-stage={stage}>
      <div className="lt-layers-pin">
        <div className="lt-wrap-wide lt-layers-grid">
          <div className="lt-layers-text">
            <p className="lt-kicker">How it works</p>
            <h2 id="layers-title" className="lt-layers-h">
              From one question to the few files that matter.
            </h2>
            <ol className="lt-layers-list is-compact">
              {STAGES.map((s, i) => (
                <li key={s.n} className={i === stage ? 'is-on' : i < stage ? 'is-done' : ''} aria-current={i === stage ? 'step' : undefined}>
                  <span className="lt-step-n">{s.n}</span>
                  <p className="lt-layers-title">{s.title}</p>
                </li>
              ))}
            </ol>
            {/* Every caption in one cell, only the current one visible: the block keeps the tallest height, so nothing moves. */}
            <div className="lt-layers-cap" aria-live="polite">
              {STAGES.map((s, i) => (
                <p key={s.n} className={i === stage ? 'is-on' : ''} aria-hidden={i === stage ? undefined : true}>
                  {s.body}
                </p>
              ))}
            </div>
            <Numbers live />
          </div>
          <div className="lt-layers-stage">
            <Scene ref={svg} final={false} />
            <Legend />
          </div>
        </div>
      </div>
    </section>
  );
}

function LayersStatic() {
  return (
    <section id="layers" className="lt-chapter" aria-labelledby="layers-title" data-testid="layers-static">
      <div className="lt-wrap-wide lt-layers-grid lt-layers-static">
        <div className="lt-layers-text">
          <p className="lt-kicker">How it works</p>
          <h2 id="layers-title" className="lt-layers-h">
            From one question to the few files that matter.
          </h2>
        </div>
        <div className="lt-layers-stage">
          <Scene final />
          <Legend />
        </div>
        <div>
          <ol className="lt-layers-list is-static">
            {STAGES.map((s) => (
              <li key={s.n} className="is-on">
                <span className="lt-step-n">{s.n}</span>
                <div>
                  <p className="lt-layers-title">{s.title}</p>
                  <p className="lt-layers-body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Numbers />
          <ul className="lt-layers-files">
            {HITS.map((h) => (
              <li key={h.key}>{h.key}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The measured numbers, labels above, nothing under. */
function Numbers({ live = false }: { live?: boolean }) {
  const last = DEPTH_MEASURED.rows[DEPTH_MEASURED.rows.length - 1]!;
  return (
    <div className="lt-layers-nums lt-glass" data-nums={live ? '' : undefined} style={live ? { opacity: 0 } : undefined}>
      <p className="lt-layers-nums-head">
        A four-hop dependency question, measured on internal tests
      </p>
      <div className="lt-layers-nums-grid">
        <div>
          <p className="lt-layers-nums-label">Lookups, grep then Sequence</p>
          <p className="lt-layers-nums-val">
            {last.grep} <span>→</span> <em>{last.sequence}</em>
          </p>
        </div>
        <div>
          <p className="lt-layers-nums-label">Tokens read, then answered</p>
          <p className="lt-layers-nums-val">
            {kTokens(last.bytesRead)} <span>→</span> <em>{kTokens(last.bytesAnswer)}</em>
          </p>
        </div>
      </div>
      <p className="lt-layers-nums-foot">
        Agents ask through <code>find_files</code>: a model we trained for this job returns the five files that matter in under 800
        tokens.
      </p>
    </div>
  );
}

function Legend() {
  return (
    <ul className="lt-layers-legend" aria-hidden="true">
      <li>
        <i className="is-breaks" /> Breaks if Orders changes
      </li>
      <li>
        <i className="is-needs" /> Orders needs it
      </li>
      <li>
        <i className="is-file" /> File an edge was found in
      </li>
    </ul>
  );
}

/* ── THE SCENE ──────────────────────────────────────────────────────────── */

const MONO = "ui-monospace, 'SFMono-Regular', Consolas, monospace";
const SANS = "'Inter', 'Inter Fallback', system-ui, sans-serif";

/** A plane outline with its hairline grid, in plane coordinates. */
function PlaneBase({ fill, stroke, grid, label }: { fill: string; stroke: string; grid: string; label: string }) {
  const lines: ReactNode[] = [];
  for (let u = 40; u < PW; u += 40) lines.push(<line key={`u${u}`} x1={u} y1={0} x2={u} y2={PD} />);
  for (let v = 40; v < PD; v += 40) lines.push(<line key={`v${v}`} x1={0} y1={v} x2={PW} y2={v} />);
  return (
    <>
      <rect x={0} y={0} width={PW} height={PD} rx={14} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <g stroke={grid} strokeWidth={1} vectorEffect="non-scaling-stroke">
        {lines}
      </g>
      <text x={PW - 14} y={PD - 12} textAnchor="end" fontFamily={MONO} fontSize={11} fill={stroke} letterSpacing="0.08em">
        {label}
      </text>
    </>
  );
}

const poly = (d: number[][]) => d.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');

/** Arrowhead at the end of a polyline, in plane coordinates. */
function Head({ d, color, data = true }: { d: number[][]; color: string; data?: boolean }) {
  const a = d[d.length - 2]!;
  const b = d[d.length - 1]!;
  const ang = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!);
  const s = 7;
  const p1 = [b[0]! - s * Math.cos(ang - 0.45), b[1]! - s * Math.sin(ang - 0.45)];
  const p2 = [b[0]! - s * Math.cos(ang + 0.45), b[1]! - s * Math.sin(ang + 0.45)];
  return <path d={`M${p1[0]} ${p1[1]} L${b[0]} ${b[1]} L${p2[0]} ${p2[1]}`} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" data-head={data ? '' : undefined} />;
}

const BREAKS = 'rgb(226, 104, 72)';
const NEEDS = 'rgb(91, 155, 255)';


/**
 * EVERY LABEL INSIDE ITS BOX. Text widths depend on the font that actually
 * loaded, so they are measured, not guessed: a text with data-fit={right} is
 * scaled down until its right edge is inside that x (in its group's
 * coordinates), a file highlight takes its width from the name it sits under,
 * and the chip takes its width from its word. Runs before the first paint and
 * again once the web fonts are in. SVG attributes only, so nothing on the page
 * moves.
 */
function fitScene(root: SVGSVGElement) {
  root.querySelectorAll<SVGTextElement>('text[data-fit]').forEach((t) => {
    const right = Number(t.dataset.fit);
    const base = Number(t.dataset.fs ?? t.getAttribute('font-size'));
    t.dataset.fs = String(base);
    t.setAttribute('font-size', String(base));
    const b = t.getBBox();
    if (b.width > 0 && b.x + b.width > right) t.setAttribute('font-size', ((base * (right - b.x)) / b.width).toFixed(2));
  });
  root.querySelectorAll<SVGRectElement>('rect[data-hit-box]').forEach((r) => {
    const t = r.parentElement?.querySelector<SVGTextElement>('text');
    if (!t) return;
    const b = t.getBBox();
    if (b.width > 0) r.setAttribute('width', (b.width + 10).toFixed(1));
  });
  root.querySelectorAll<SVGGElement>('g[data-chip]').forEach((g) => {
    const r = g.querySelector('rect');
    const t = g.querySelector('text');
    if (!r || !t) return;
    const b = t.getBBox();
    if (b.width > 0) r.setAttribute('width', (b.width + 24).toFixed(1));
  });
}

const Scene = forwardRef<SVGSVGElement, { final: boolean }>(function Scene({ final }, ref) {
  const own = useRef<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    const root = own.current;
    if (!root) return undefined;
    let live = true;
    fitScene(root);
    document.fonts?.ready.then(() => {
      if (live) fitScene(root);
    });
    return () => {
      live = false;
    };
  }, []);
  const setRef = (el: SVGSVGElement | null) => {
    own.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  /* At rest the planes are drawn at their final heights; the pinned version
     closes them up with a translate before the first frame paints. */
  const show = final ? 1 : 0;
  const zTree = 0;
  const zGraph = G_MAX;
  const zChat = 2 * G_MAX;
  const ordTop = P(ORD_C.u, ORD_C.v, zGraph);
  const cardFront = P(ORD_C.u, ORD_C.v, zChat);

  return (
    <svg ref={setRef} className="lt-scene" viewBox="0 0 820 880" role="img" aria-labelledby="lt-scene-title" data-final={final ? 'true' : 'false'}>
      <title id="lt-scene-title">
        {`An exploded view of Sequence on the sample shop: the repository's ${FILE_COUNT} source files, the graph scanned from them, and a question about Orders in the chat. Lines run from Orders to the ${HITS.length} files its edges were found in, and arrows show what breaks if Orders changes and what it needs.`}
      </title>
      <defs>
        <filter id="lt-soft" x="-10%" y="-10%" width="120%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="rgb(11, 12, 14)" floodOpacity="0.12" />
        </filter>
      </defs>

      {/* ── PLANE 0: THE REPOSITORY ── */}
      <g data-plane="0">
        <g transform={MATRIX(zTree)}>
          <g filter="url(#lt-soft)">
            <PlaneBase fill="rgb(255, 255, 255)" stroke="rgba(11, 12, 14, 0.18)" grid="rgba(11, 12, 14, 0.05)" label="REPOSITORY" />
          </g>
          <text x={16} y={PD - 12} fontFamily={SANS} fontSize={14} fontWeight={600} fill="rgb(11, 12, 14)">
            shopfront
          </text>
          <text x={100} y={PD - 12} fontFamily={MONO} fontSize={11.5} fill="rgb(95, 97, 102)">
            {FILE_COUNT} source files scanned
          </text>
          {TREE.map((t) =>
            t.kind === 'dir' ? (
              <text key={t.key} x={t.u} y={t.v} fontFamily={MONO} fontSize={12} fontWeight={600} fill="rgb(58, 61, 68)">
                {t.label}
              </text>
            ) : (
              <g key={t.key}>
                {t.hit ? (
                  <rect data-hit="" data-hit-box="" x={t.u - 5} y={t.v - 13} width={t.label.length * 7.3 + 12} height={18} rx={5} fill="rgba(31, 79, 224, 0.1)" stroke="rgba(31, 79, 224, 0.55)" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ opacity: show }} />
                ) : null}
                <text
                  x={t.u}
                  y={t.v}
                  fontFamily={MONO}
                  fontSize={12}
                  fill="rgb(95, 97, 102)"
                  data-miss={t.hit ? undefined : ''}
                  style={t.hit ? undefined : { opacity: final ? 0.45 : 1 }}
                >
                  {t.label}
                </text>
                {t.hit ? (
                  /* The same name in blue over the grey one, faded in when the line reaches it. */
                  <text data-hit="" x={t.u} y={t.v} fontFamily={MONO} fontSize={12} fill="rgb(31, 79, 224)" style={{ opacity: show }}>
                    {t.label}
                  </text>
                ) : null}
              </g>
            ),
          )}
        </g>
      </g>

      {/* ── PLANE 1: THE GRAPH ── */}
      <g data-plane="1">
        <g transform={MATRIX(zGraph)}>
          <g filter="url(#lt-soft)">
            <PlaneBase fill="rgba(32, 32, 31, 0.94)" stroke="rgba(255, 255, 255, 0.22)" grid="rgba(255, 255, 255, 0.05)" label="GRAPH" />
          </g>
          <g fill="none" stroke="rgba(255, 255, 255, 0.2)" strokeWidth={1} vectorEffect="non-scaling-stroke">
            {CONTEXT.map((d, i) => (
              <path key={i} d={poly(d)} vectorEffect="non-scaling-stroke" strokeDasharray={i === 0 ? '4 4' : undefined} />
            ))}
          </g>
          {IMPACT.map((e) => {
            const color = e.kind === 'breaks' ? BREAKS : NEEDS;
            return (
              <g key={e.id}>
                <path d={poly(e.d)} fill="none" stroke="rgba(255, 255, 255, 0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <path
                  data-impact=""
                  d={poly(e.d)}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
                <Head d={e.d} color={color} />
                {e.label ? (
                  <text data-elabel="" x={e.at[0]} y={e.at[1]} textAnchor={e.end ? 'end' : undefined} fontFamily={MONO} fontSize={10.5} fill={color} style={{ opacity: show }}>
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </g>

      {/* ── LINES FROM ORDERS TO ITS FILES (over the graph plane, under its boxes, so they read as leaving Orders) ── */}
      <g data-plane="0">
        {HITS.map((h) => {
          const a = P(ORD_C.u, ORD.v + NH, zGraph);
          const b = P(h.u - 6, h.v - 4, zTree);
          return (
            <g key={h.key}>
              <path data-fline="" d={`M${pt(a)} L${pt(b)}`} fill="none" stroke="rgba(31, 79, 224, 0.75)" strokeWidth={1} style={{ strokeDasharray: final ? undefined : '0 1' }} />
              <circle data-fdot="" cx={b.x} cy={b.y} r={2.6} fill="rgb(31, 79, 224)" style={{ opacity: show }} />
            </g>
          );
        })}
      </g>

      {/* ── THE GRAPH'S BOXES, over the file lines: the lines run under the boxes, so every name stays readable ── */}
      <g data-plane="1">
        <g transform={MATRIX(zGraph)}>
          {NODES.map((n) => {
            const isOrd = n.id === 'orders';
            return (
              <g key={n.id} transform={`translate(${n.u} ${n.v})`}>
                <rect width={NW} height={NH} rx={9} fill="rgb(46, 46, 44)" stroke={isOrd ? 'rgba(91, 155, 255, 0.9)' : 'rgba(255, 255, 255, 0.16)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {isOrd ? <rect data-orders-ring="" x={-5} y={-5} width={NW + 10} height={NH + 10} rx={12} fill="none" stroke={NEEDS} strokeWidth={1.4} vectorEffect="non-scaling-stroke" style={{ opacity: show }} /> : null}
                <rect x={10} y={13} width={22} height={22} rx={6} fill="rgba(91, 155, 255, 0.16)" />
                <text x={42} y={22} fontFamily={SANS} fontSize={14} fontWeight={600} fill="rgb(236, 235, 232)" data-fit={NW - 10}>
                  {n.name}
                </text>
                <text x={42} y={38} fontFamily={SANS} fontSize={11} fill="rgb(163, 162, 157)" data-fit={NW - 10}>
                  {n.sub}
                </text>
              </g>
            );
          })}
        </g>
      </g>

      {/* ── THE QUESTION DROPS ONTO ORDERS (between plane 2 and plane 1) ── */}
      <g data-plane="1">
        <path data-drop="" d={`M${pt(cardFront)} L${pt(ordTop)}`} fill="none" stroke={NEEDS} strokeWidth={1.4} strokeDasharray={final ? '4 4' : undefined} />
      </g>

      {/* ── PLANE 2: THE CHAT ── */}
      <g data-plane="2">
        <g transform={MATRIX(zChat)}>
          <PlaneBase fill="rgba(255, 255, 255, 0.1)" stroke="rgba(31, 79, 224, 0.45)" grid="rgba(31, 79, 224, 0.06)" label="CHAT" />
          <g transform={`translate(${CARD.u} ${CARD.v})`} filter="url(#lt-soft)">
            <rect width={CARD.w} height={CARD.h} rx={14} fill="rgb(255, 255, 255)" stroke="rgba(31, 79, 224, 0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {/* The question as the recordings ask it, set on two lines so it sits inside the card; the fit pass below shrinks it if a font ever runs wider. */}
            <text x={20} y={36} fontFamily={SANS} fontSize={15} fill="rgb(11, 12, 14)" data-fit={CARD.w - 20}>
              What depends on this,
            </text>
            <text x={20} y={57} fontFamily={SANS} fontSize={15} fill="rgb(11, 12, 14)" data-fit={CARD.w - 20}>
              and what would break?
            </text>
            <g data-chip="">
              <rect x={20} y={72} width={72} height={24} rx={12} fill="rgba(31, 79, 224, 0.08)" stroke="rgba(31, 79, 224, 0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={32} y={88.5} fontFamily={SANS} fontSize={12.5} fill="rgb(31, 79, 224)">
                orders
              </text>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
});
