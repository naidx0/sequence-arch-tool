import { APP_BLUE, APP_LINE, APP_NODE, APP_TEXT, BLUE, BLUE_SOFT, BLUE_WASH, Callout, Drawn, Head, INK, LINE, LINE_STRONG, MONO, MUTED, PAPER, Panel, SANS, clamp, lerp, poly, polyLen, route, seg, stagger, svgProps, type ArtProps, type Pt } from './shared';

/**
 * OUR MODELS: ONE GRAPH, ANY AGENT.
 *
 * The graph is scanned once from the repository. Whatever answers the
 * question reads it through the same tools: Claude Code, started with
 * Sequence's hooks (packages/web2/src/agents/startWithHooks.tsx); Codex, over
 * ACP, with the model it reports for the run (agents/activeModel.ts); or a
 * local model on this machine through Ollama or LM Studio, no key, offline
 * (settings/providerPresets.ts, settings/LocalSetupCard.tsx). The tools on
 * the trunk are two of the MCP server's (packages/mcp/src/index.ts):
 * find_files and impact. The slider is the reasoning-effort control the
 * model menu shows for an agent that offers efforts, with its stops as the
 * menu labels them (shell2/ModelMenu.tsx effortLabelOf).
 */

const W = 720;
const H = 400;

/* The graph, left. */
const PANEL = { x: 24, y: 44, w: 264, h: 328 };
const NW = 92;
const NH = 26;
type MiniNode = { id: string; name: string; x: number; y: number; pill?: boolean };
const NODES: MiniNode[] = [
  { id: 'gateway', name: 'Gateway', x: 44, y: 72 },
  { id: 'orders', name: 'Orders', x: 44, y: 148 },
  { id: 'postgres', name: 'Postgres', x: 44, y: 300 },
  { id: 'payments', name: 'Payments', x: 172, y: 72 },
  { id: 'inventory', name: 'Inventory', x: 172, y: 148 },
  { id: 'topic', name: 'order.created', x: 172, y: 224, pill: true },
  { id: 'shipping', name: 'Shipping', x: 172, y: 300 },
];
const EDGES: Pt[][] = [
  [[90, 98], [90, 148]], // gateway -> orders
  [[136, 154], [154, 154], [154, 85], [172, 85]], // orders -> payments (POST /charge)
  [[136, 161], [172, 161]], // orders -> inventory (grpc)
  [[136, 168], [154, 168], [154, 237], [172, 237]], // orders -> order.created (publish)
  [[218, 250], [218, 300]], // order.created -> shipping (consume)
  [[90, 174], [90, 300]], // orders -> postgres
];

/* The trunk and the spine. */
const TRUNK: Pt[] = [[288, 208], [380, 208]];
const SPINE: Pt[] = [[380, 96], [380, 304]];

/* The slots, right. */
const CARD = { x: 440, w: 256, h: 64 };
const SLOTS = [
  { y: 64, name: 'Claude Code', sub: 'Started with Sequence’s hooks' },
  { y: 176, name: 'Codex', sub: 'Over ACP, model picked per run' },
  { y: 272, name: 'Local model', sub: 'Ollama or LM Studio, offline' },
] as const;

/* The effort slider. */
const STOPS = ['Off', 'Low', 'Medium', 'High', 'X-High', 'Max'];
const SLIDER = { x: 440, y: 366, w: 256 };
const stopX = (i: number) => SLIDER.x + (i / (STOPS.length - 1)) * SLIDER.w;

const T = { nodes: [0, 0.2], edges: [0.1, 0.32], trunk: [0.3, 0.42], spine: [0.4, 0.52], slots: [0.5, 0.82], slider: [0.82, 1] } as const;

export function ModelsArt({ progress = 1, className, style }: ArtProps) {
  const p = clamp(progress, 0, 1);
  const tTrunk = seg(p, T.trunk[0], T.trunk[1]);
  const tSpine = seg(p, T.spine[0], T.spine[1]);
  const tSlider = seg(p, T.slider[0], T.slider[1]);
  const knobX = lerp(stopX(1), stopX(3), tSlider);

  return (
    <svg {...svgProps([W, H], className, style, 'One graph scanned from the repository feeds the same context to Claude Code, Codex, or a local model through Ollama or LM Studio, with a reasoning-effort slider from Off to Max.')}>
      <Callout x={24} y={24} n="01" label="ONE GRAPH, SCANNED ONCE" />
      <Callout x={440} y={24} n="02" label="THE AGENT YOU RUN" t={0.35 + 0.65 * seg(p, T.slots[0], T.slots[1])} />
      <line x1={24} y1={32} x2={696} y2={32} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />

      {/* ── 01 THE GRAPH ── */}
      <Panel x={PANEL.x} y={PANEL.y} w={PANEL.w} h={PANEL.h} label="GRAPH">
        {EDGES.map((e, i) => {
          const d = e.map(([x, y]): Pt => [x - PANEL.x, y - PANEL.y]);
          const t = stagger(p, T.edges[0], T.edges[1], i, EDGES.length);
          return (
            <g key={i}>
              <Drawn d={route(d)} len={polyLen(d)} t={t} stroke="rgba(255, 255, 255, 0.45)" width={1} cap="butt" />
              <Head d={d} color="rgba(255, 255, 255, 0.45)" t={t > 0.96 ? 1 : 0} size={4} width={1} />
            </g>
          );
        })}
        {NODES.map((n, i) => {
          const t = stagger(p, T.nodes[0], T.nodes[1], i, NODES.length);
          return (
            <g key={n.id} transform={`translate(${n.x - PANEL.x} ${n.y - PANEL.y})`} style={{ opacity: t }}>
              <rect width={NW} height={NH} rx={n.pill ? NH / 2 : 6} fill={APP_NODE} stroke={APP_LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {!n.pill ? <rect x={8} y={NH / 2 - 5} width={10} height={10} rx={3} fill="rgba(91, 155, 255, 0.18)" /> : null}
              <text x={n.pill ? NW / 2 : 24} y={NH / 2 + 3.5} textAnchor={n.pill ? 'middle' : 'start'} fontFamily={SANS} fontSize={10} fontWeight={600} fill={APP_TEXT} data-fit={n.pill ? NW - 10 : NW - 30}>
                {n.name}
              </text>
            </g>
          );
        })}
        <text x={20} y={PANEL.h - 12} fontFamily={MONO} fontSize={10} fill={APP_BLUE} data-fit={160}>
          scan_repo
        </text>
      </Panel>

      {/* The trunk: the graph's context, through two of its tools. */}
      <Drawn d={poly(TRUNK)} len={polyLen(TRUNK)} t={tTrunk} stroke={BLUE} width={1.5} cap="butt" />
      <text x={296} y={200} fontFamily={MONO} fontSize={10} fill={BLUE} style={{ opacity: tTrunk }}>
        find_files
      </text>
      <text x={296} y={224} fontFamily={MONO} fontSize={10} fill={BLUE} style={{ opacity: tTrunk }}>
        impact
      </text>
      {/* The spine grows both ways from the trunk. */}
      <g transform={`translate(${SPINE[0]![0]} ${TRUNK[0]![1]}) scale(1 ${Math.max(0.001, tSpine)})`}>
        <line x1={0} y1={SPINE[0]![1] - TRUNK[0]![1]} x2={0} y2={SPINE[1]![1] - TRUNK[0]![1]} stroke={BLUE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </g>
      <circle cx={TRUNK[1]![0]} cy={TRUNK[1]![1]} r={3} fill={BLUE} style={{ opacity: tTrunk > 0.98 ? 1 : 0 }} />

      {/* ── 02 THE SLOTS ── */}
      {SLOTS.map((s, i) => {
        const t = stagger(p, T.slots[0], T.slots[1], i, SLOTS.length, 0.55);
        const cy = s.y + CARD.h / 2;
        const branch: Pt[] = [[380, cy], [CARD.x, cy]];
        return (
          <g key={s.name}>
            <Drawn d={poly(branch)} len={polyLen(branch)} t={t} stroke={BLUE} width={1.5} cap="butt" />
            <g transform={`translate(${CARD.x + (1 - t) * 10} ${s.y})`} style={{ opacity: t }}>
              <rect width={CARD.w} height={CARD.h} rx={8} fill={PAPER} stroke={LINE_STRONG} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <rect x={14} y={20} width={24} height={24} rx={6} fill={BLUE_WASH} stroke={BLUE_SOFT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <rect x={22} y={28} width={8} height={8} rx={2} fill={BLUE} />
              <text x={50} y={29} fontFamily={SANS} fontSize={13} fontWeight={600} fill={INK} data-fit={CARD.w - 62}>
                {s.name}
              </text>
              <text x={50} y={46} fontFamily={SANS} fontSize={10.5} fill={MUTED} data-fit={CARD.w - 62}>
                {s.sub}
              </text>
            </g>
          </g>
        );
      })}

      {/* The effort slider. */}
      <g style={{ opacity: 0.4 + 0.6 * tSlider }}>
        <text x={SLIDER.x} y={352} fontFamily={MONO} fontSize={10} letterSpacing="0.1em" fill={MUTED}>
          REASONING EFFORT
        </text>
        <line x1={SLIDER.x} y1={SLIDER.y} x2={SLIDER.x + SLIDER.w} y2={SLIDER.y} stroke={LINE_STRONG} strokeWidth={1.5} strokeLinecap="round" />
        <g transform={`translate(${SLIDER.x} ${SLIDER.y}) scale(${Math.max(0.001, knobX - SLIDER.x)} 1)`}>
          <line x1={0} y1={0} x2={1} y2={0} stroke={BLUE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
        {STOPS.map((s, i) => (
          <g key={s}>
            <line x1={stopX(i)} y1={SLIDER.y - 3} x2={stopX(i)} y2={SLIDER.y + 3} stroke={LINE_STRONG} strokeWidth={1} />
            <text x={stopX(i)} y={SLIDER.y + 18} textAnchor={i === 0 ? 'start' : i === STOPS.length - 1 ? 'end' : 'middle'} fontFamily={MONO} fontSize={9.5} fill={MUTED}>
              {s}
            </text>
          </g>
        ))}
        <circle cx={0} cy={SLIDER.y} r={5.5} fill={PAPER} stroke={BLUE} strokeWidth={1.5} transform={`translate(${knobX} 0)`} />
      </g>
    </svg>
  );
}
