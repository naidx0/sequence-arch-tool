import { APP_BLUE, APP_HAIR, APP_MUTED, APP_TEXT, BLUE, BLUE_SOFT, BLUE_WASH, CORAL, CORAL_WASH, Callout, Drawn, Head, INK, LINE, LINE_STRONG, MONO, MUTED, PAPER, Panel, SANS, clamp, lerp, poly, polyLen, route, seg, svgProps, type ArtProps, type Pt } from './shared';

/**
 * A CLAIM, CHECKED AGAINST THE CODE, IN ONE READING.
 *
 * Owner, second tour (17:56): "a little bit too much in the beginning". One
 * clear figure: two claimed edges out of Orders, dashed, and the code they
 * are checked against. A line reads down orders/app/payments_client.py and
 * stops at line 10 (`client.post(f"{PAYMENTS_URL}/charge", …)`, the
 * scanner's evidence for the edge); that edge turns solid blue and is tied to
 * the line. Nothing in orders/ calls Invoices, so that edge stays dashed and
 * turns coral: not found. Solid means found in code; dashed means only
 * claimed.
 */

const W = 720;
const H = 400;

/* The graph, left: big enough to read at a glance. */
const NW = 148;
const NH = 52;
const ORD = { x: 24, y: 168 };
const PAY = { x: 268, y: 72 };
const INV = { x: 268, y: 268 };
const E_PAY: Pt[] = [[ORD.x + NW, ORD.y + 18], [210, ORD.y + 18], [210, PAY.y + NH / 2], [PAY.x, PAY.y + NH / 2]];
const E_INV: Pt[] = [[ORD.x + NW, ORD.y + 34], [210, ORD.y + 34], [210, INV.y + NH / 2], [INV.x, INV.y + NH / 2]];

/* The code, right. */
const CODE = { x: 452, y: 44, w: 244, h: 312 };
const LINE0 = CODE.y + 52;
const LINE_H = 18;
const HIT = 10;
const lineY = (ln: number) => LINE0 + (ln - 1) * LINE_H;
const BARS = [0.42, 0.3, 0, 0.5, 0.66, 0.28, 0, 0.62, 0.72, 0, 0.48, 0.54, 0.3, 0.44];
const HIT_TEXT = 'client.post(…/charge)';

const T = { graph: [0, 0.18], scan: [0.18, 0.5], found: [0.48, 0.58], tie: [0.56, 0.72], solid: [0.66, 0.82], verdict: [0.8, 0.94] } as const;

function Node({ x, y, name, tone, t }: { x: number; y: number; name: string; tone: 'plain' | 'found' | 'none'; t: number }) {
  const stroke = tone === 'found' ? BLUE : tone === 'none' ? CORAL : LINE_STRONG;
  const fill = tone === 'found' ? BLUE_WASH : tone === 'none' ? CORAL_WASH : PAPER;
  return (
    <g transform={`translate(${x} ${y})`} style={{ opacity: t }}>
      <rect width={NW} height={NH} rx={12} fill={PAPER} stroke={LINE_STRONG} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect width={NW} height={NH} rx={12} fill={fill} stroke={stroke} strokeWidth={1.2} vectorEffect="non-scaling-stroke" style={{ opacity: tone === 'plain' ? 0 : 1, transition: 'opacity 200ms' }} />
      <rect x={14} y={NH / 2 - 10} width={20} height={20} rx={5} fill={BLUE_WASH} stroke={BLUE_SOFT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={46} y={NH / 2 + 5.5} fontFamily={SANS} fontSize={16} fontWeight={600} fill={INK}>
        {name}
      </text>
    </g>
  );
}

export function AccuracyArt({ progress = 1, className, style }: ArtProps) {
  const p = clamp(progress, 0, 1);
  const tGraph = seg(p, T.graph[0], T.graph[1]);
  const tScan = seg(p, T.scan[0], T.scan[1]);
  const tFound = seg(p, T.found[0], T.found[1]);
  const tTie = seg(p, T.tie[0], T.tie[1]);
  const tSolid = seg(p, T.solid[0], T.solid[1]);
  const tVerdict = seg(p, T.verdict[0], T.verdict[1]);
  const scanY = lerp(LINE0 - 14, lineY(HIT), tScan);
  const scanOn = tScan > 0 && tScan < 1 ? 1 : tScan >= 1 ? 1 - tFound : 0;

  /* From line 10 in the code to the middle of the Payments edge. */
  const TIE: Pt[] = [[CODE.x + 8, lineY(HIT)], [430, lineY(HIT)], [430, PAY.y + NH / 2], [PAY.x + NW, PAY.y + NH / 2]];

  return (
    <svg {...svgProps([W, H], className, style, 'Two claimed edges out of Orders checked against the code: the call to Payments is found on payments_client.py line 10 and turns solid; the call to Invoices is not found and stays dashed.')}>
      <Callout x={24} y={24} n="01" label="TWO CLAIMS" />
      <Callout x={696} y={24} n="02" label="CHECKED IN THE CODE" anchor="end" t={0.35 + 0.65 * tScan} />
      <line x1={24} y1={32} x2={696} y2={32} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />

      {/* Claimed: dashed. */}
      <g style={{ opacity: tGraph }}>
        <path d={route(E_PAY)} fill="none" stroke={LINE_STRONG} strokeWidth={1.6} strokeDasharray="5 5" style={{ opacity: 1 - tSolid }} />
        <Head d={E_PAY} color={LINE_STRONG} t={1 - tSolid} />
        <path d={route(E_INV)} fill="none" stroke={tVerdict > 0 ? CORAL : LINE_STRONG} strokeOpacity={tVerdict > 0 ? 0.35 + 0.65 * tVerdict : 1} strokeWidth={1.6} strokeDasharray="5 5" />
        <Head d={E_INV} color={tVerdict > 0 ? CORAL : LINE_STRONG} />
      </g>
      {/* Found: solid, drawn over. */}
      <Drawn d={route(E_PAY)} len={polyLen(E_PAY)} t={tSolid} stroke={BLUE} width={2} />
      <Head d={E_PAY} color={BLUE} t={tSolid > 0.96 ? 1 : 0} />

      <Node x={ORD.x} y={ORD.y} name="Orders" tone="plain" t={tGraph} />
      <Node x={PAY.x} y={PAY.y} name="Payments" tone={tSolid > 0.5 ? 'found' : 'plain'} t={tGraph} />
      <Node x={INV.x} y={INV.y} name="Invoices" tone={tVerdict > 0.5 ? 'none' : 'plain'} t={tGraph} />

      {/* The verdicts, under each claimed node. */}
      <text x={PAY.x + 2} y={PAY.y + NH + 22} fontFamily={SANS} fontSize={13} fontWeight={600} fill={BLUE} style={{ opacity: tSolid }}>
        Found in code, line {HIT}
      </text>
      <text x={INV.x + 2} y={INV.y + NH + 22} fontFamily={SANS} fontSize={13} fontWeight={600} fill={CORAL} style={{ opacity: tVerdict }}>
        Not found: stays a claim
      </text>

      {/* ── 02 THE CODE ── */}
      <Panel x={CODE.x} y={CODE.y} w={CODE.w} h={CODE.h}>
        <text x={16} y={26} fontFamily={MONO} fontSize={10.5} fill={APP_MUTED}>
          payments_client.py
        </text>
        <rect x={8} y={lineY(HIT) - CODE.y - 10} width={CODE.w - 16} height={LINE_H + 2} rx={4} fill={APP_BLUE} style={{ opacity: 0.16 * tFound }} />
        {BARS.map((w, i) => {
          const ln = i + 1;
          const y = lineY(ln) - CODE.y;
          const hit = ln === HIT;
          return (
            <g key={ln}>
              <text x={34} y={y + 3.5} textAnchor="end" fontFamily={MONO} fontSize={9.5} fill={hit ? APP_BLUE : APP_MUTED} style={{ opacity: hit ? 0.6 + 0.4 * tFound : 0.55 }}>
                {ln}
              </text>
              {hit ? (
                <text x={44} y={y + 3.5} fontFamily={MONO} fontSize={10.5} fill={APP_TEXT} style={{ opacity: 0.45 + 0.55 * tFound }}>
                  {HIT_TEXT}
                </text>
              ) : (
                <rect x={44} y={y - 1.5} width={Math.max(6, (CODE.w - 60) * w)} height={3} rx={1.5} fill={APP_HAIR} style={{ opacity: w === 0 ? 0 : 1 }} />
              )}
            </g>
          );
        })}
        <line x1={8} y1={scanY - CODE.y} x2={CODE.w - 8} y2={scanY - CODE.y} stroke={APP_BLUE} strokeWidth={1.2} style={{ opacity: 0.85 * scanOn }} />
      </Panel>

      {/* The tie from line 10 to the edge it proves. */}
      <Drawn d={poly(TIE)} len={polyLen(TIE)} t={tTie} stroke={BLUE_SOFT} width={1} cap="butt" />
      <circle cx={TIE[0]![0]} cy={TIE[0]![1]} r={3} fill={APP_BLUE} style={{ opacity: tFound }} />

      {/* Legend. */}
      <g transform={`translate(24 ${H - 8})`} fontFamily={SANS} fontSize={12} fill={MUTED}>
        <line x1={0} y1={-4} x2={24} y2={-4} stroke={BLUE} strokeWidth={2} />
        <text x={32} y={0}>
          found in code
        </text>
        <line x1={150} y1={-4} x2={174} y2={-4} stroke={LINE_STRONG} strokeWidth={1.6} strokeDasharray="5 5" />
        <text x={182} y={0}>
          only claimed
        </text>
      </g>
    </svg>
  );
}
