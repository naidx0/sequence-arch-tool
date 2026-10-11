import { BLUE, Callout, Chip, Drawn, Grid, INK, LINE, MONO, MUTED, PAPER, SANS, clamp, lerp, seg, svgProps, type ArtProps, type Pt } from './shared';

/**
 * THE ROUTE THAT STRAIGHTENS.
 *
 * A grep that follows what it finds makes one lookup per file found: at four
 * hops into scan.ts's importers, 195 of them. Drawn as a route through the
 * repository, one vertex per lookup, it is a tangle. Sequence answers the
 * same question in one call to find_files, a straight line from the question
 * to the answer.
 *
 * Every segment of the tangle is its own group, so the straightening is pure
 * transform: each segment slides, turns and stretches onto its place on the
 * straight line, the vertices ride along, then the tangle fades under the one
 * blue stroke. The numbers are props (DEPTH_MEASURED's last row by default).
 */

const W = 720;
const H = 400;
const A: Pt = [84, 208];
const B: Pt = [636, 208];
const BAND = { top: 76, bottom: 340 };

export type SpeedArtProps = ArtProps & {
  /** Lookups a grep needs: one vertex of the route each. */
  lookups?: number;
  /** Calls Sequence needs for the same depth. */
  calls?: number;
};

/* A seeded lattice walk from A to B that wanders in the band. Deterministic. */
function walk(n: number): Pt[] {
  /* Of a dozen seeded walks, the one that fills the band most evenly above and below the line. */
  let best: { pts: Pt[]; score: number } | null = null;
  for (let seed = 1; seed <= 12; seed += 1) {
    const pts = rawWalk(n, seed);
    const y0 = pts[0]![1];
    const y1 = pts[n - 1]![1];
    const dy = pts.map((q, i) => q[1] - lerp(y0, y1, i / (n - 1)));
    const up = -Math.min(...dy);
    const down = Math.max(...dy);
    const xs = pts.map((q) => q[0]);
    const span = Math.max(1, pts[n - 1]![0] - pts[0]![0]);
    /* Even above and below, and no wandering past either end. */
    const score = Math.abs(up - down) / Math.max(1, up + down) + (2 * (pts[0]![0] - Math.min(...xs) + Math.max(...xs) - pts[n - 1]![0])) / span;
    if (!best || score < best.score) best = { pts, score };
  }
  const pts = best!.pts;
  /* The walk begins at A and ends at B: x is mapped between them (and eased
     toward even spacing along the way, so the tangle fills the width), y is
     detrended so both ends sit on A's line, then scaled into the band. */
  const x0 = pts[0]![0];
  const x1 = pts[n - 1]![0] || 1;
  const y0 = pts[0]![1];
  const y1 = pts[n - 1]![1];
  const dy = pts.map((q, i) => q[1] - lerp(y0, y1, i / (n - 1)));
  const amp = Math.max(1, ...dy.map((v) => Math.abs(v)));
  const half = Math.min(A[1] - BAND.top, BAND.bottom - A[1]);
  return pts.map(([px], i) => [lerp(lerp(A[0], B[0], (px - x0) / (x1 - x0)), lerp(A[0], B[0], i / (n - 1)), 0.35), A[1] + (dy[i]! / amp) * half]);
}

function rawWalk(n: number, seed: number): Pt[] {
  let s = (0x9e3779b1 ^ n) + seed * 0x85ebca6b;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x1b873593) >>> 0;
    return (s >>> 8) / 0x1000000;
  };
  const pts: Pt[] = [[0, 0]];
  let x = 0;
  let y = 0;
  let dir = 0; // 0 right, 1 down, 2 left, 3 up
  for (let i = 1; i < n; i += 1) {
    const r = rnd();
    /* Turn often, in every direction, with a rightward drift that finishes
       the walk and a pull back to the centre line so it fills the band evenly. */
    const pull = Math.max(-0.16, Math.min(0.16, y / 60));
    if (r < 0.3) dir = 0;
    else if (r < 0.52 - pull) dir = 1;
    else if (r < 0.74) dir = 3;
    else if (r < 0.86) dir = 2;
    const step = 1 + Math.floor(rnd() * 2);
    if (dir === 0) x += step;
    else if (dir === 2) x -= step;
    else if (dir === 1) y += step;
    else y -= step;
    pts.push([x, y]);
  }
  return pts;
}

/* The tangle is straight by half way, then holds as one ordered row of
   lookups (owner, second tour: "wait longer and show this organisation");
   the one call draws through the row, which stays under it, faint. */
const T = { straight: [0.02, 0.5], fade: [0.74, 0.88], line: [0.72, 0.88], label: [0.84, 0.96] } as const;

export function SpeedArt({ progress = 1, className, style, lookups = 195, calls = 1 }: SpeedArtProps) {
  const p = clamp(progress, 0, 1);
  const n = Math.max(2, Math.round(lookups));
  const crooked = walk(n);
  /* Ease-in: the tangle keeps its shape for most of the scroll, then snaps straight. */
  const tS = Math.pow(clamp((p - T.straight[0]) / (T.straight[1] - T.straight[0]), 0, 1), 2.2);
  const tFade = 1 - 0.7 * seg(p, T.fade[0], T.fade[1]);
  const tLine = seg(p, T.line[0], T.line[1]);
  const tLabel = seg(p, T.label[0], T.label[1]);
  const straightAt = (i: number): Pt => [lerp(A[0], B[0], i / (n - 1)), A[1]];
  const lineLen = B[0] - A[0];

  return (
    <svg {...svgProps([W, H], className, style, `A route of ${n} lookups, one per file a grep found, straightening into Sequence's ${calls} call from the question to the answer.`)}>
      <Callout x={24} y={24} n="01" label={`${n} LOOKUPS, ONE PER FILE FOUND`} t={0.4 + 0.6 * tFade} />
      <Callout x={696} y={24} n="02" label={`${calls} CALL`} anchor="end" t={0.35 + 0.65 * tLine} />
      <line x1={24} y1={32} x2={696} y2={32} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <Grid w={W} h={H - 40} step={32} inset={24} />

      {/* The tangle: one group per segment, slid and turned onto the straight line. */}
      <g style={{ opacity: tFade }}>
        {crooked.slice(0, -1).map((a, i) => {
          const b = crooked[i + 1]!;
          const qa = straightAt(i);
          const qb = straightAt(i + 1);
          /* Both ends of the segment slide toward their place on the line; the
             unit line is mapped exactly onto them (a similarity transform), so
             the chain never breaks apart on the way. */
          const x1 = lerp(a[0], qa[0], tS);
          const y1 = lerp(a[1], qa[1], tS);
          const dx = lerp(b[0], qb[0], tS) - x1;
          const dy = lerp(b[1], qb[1], tS) - y1;
          return (
            <g key={i} transform={`matrix(${dx.toFixed(3)} ${dy.toFixed(3)} ${(-dy).toFixed(3)} ${dx.toFixed(3)} ${x1.toFixed(2)} ${y1.toFixed(2)})`}>
              <line x1={0} y1={0} x2={1} y2={0} stroke={INK} strokeWidth={1} strokeOpacity={0.55} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {crooked.map((a, i) => {
          const q = straightAt(i);
          return <circle key={i} r={1.7} fill={INK} fillOpacity={0.75} transform={`translate(${lerp(a[0], q[0], tS).toFixed(2)} ${lerp(a[1], q[1], tS).toFixed(2)})`} />;
        })}
      </g>

      {/* The one call. */}
      <Drawn d={`M${A[0]} ${A[1]} L${B[0]} ${B[1]}`} len={lineLen} t={tLine} stroke={BLUE} width={2} />
      <Chip cx={(A[0] + B[0]) / 2} cy={A[1] - 20} text={`find_files · ${calls} call`} t={tLabel} />

      {/* The two ends. */}
      <circle cx={A[0]} cy={A[1]} r={5} fill={PAPER} stroke={INK} strokeWidth={1.5} />
      <circle cx={B[0]} cy={B[1]} r={5} fill={tLine > 0.98 ? BLUE : PAPER} stroke={tLine > 0.98 ? BLUE : INK} strokeWidth={1.5} />
      <text x={A[0] - 14} y={A[1] + 3.5} textAnchor="end" fontFamily={MONO} fontSize={10} letterSpacing="0.08em" fill={MUTED}>
        ASK
      </text>
      <text x={B[0] + 14} y={B[1] + 3.5} fontFamily={MONO} fontSize={10} letterSpacing="0.08em" fill={MUTED}>
        ANSWER
      </text>

      {/* The reading. */}
      <text x={24} y={H - 6} fontFamily={SANS} fontSize={11.5} fill={MUTED} data-fit={330}>
        grep: a lookup for every file it finds, then the next.
      </text>
      <text x={696} y={H - 6} textAnchor="end" fontFamily={SANS} fontSize={11.5} fill={BLUE} style={{ opacity: tLabel }} data-fit={330}>
        Sequence: one call to a model we trained for this.
      </text>
    </svg>
  );
}
