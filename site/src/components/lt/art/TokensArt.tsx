import { APP_BLUE, APP_MUTED, BLUE, BLUE_SOFT, Callout, Drawn, INK, LINE, LINE_STRONG, MONO, MUTED, PAPER, Panel, SANS, clamp, poly, polyLen, seg, stagger, svgProps, type ArtProps, type Pt } from './shared';

/**
 * WHERE THE TOKENS GO.
 *
 * Left, the repository as a field of file tiles: what an agent that opens every
 * file it found has pulled into context. Right, the handful the graph sends it
 * to instead: find_files answers with a ranked file list. Under both, the
 * meter: tokens read, against tokens in the answer, for the same question.
 *
 * The numbers are props. The default values are DEPTH_MEASURED's last row
 * (packages/analyzer/src/scan.ts, four hops deep, in Sequence's own
 * repository): 224 files, 3 657 040 bytes read, 11 186 bytes answered, at
 * four bytes a token. The five file names are real importers of scan.ts
 * under packages/analyzer/src (cli.ts, doctor.ts, index.ts, eval/grade.ts,
 * diagramCli.ts), not a ranking the model produced.
 */

const W = 720;
const H = 420;

export type TokensArtProps = ArtProps & {
  /** Tokens an agent reads when it opens every file it found. */
  readTokens?: number;
  /** Tokens in Sequence's answer for the same question. */
  answerTokens?: number;
  /** Files that agent opened: one tile each. */
  filesRead?: number;
  /** The files the graph sends the model to. */
  sent?: readonly string[];
};

const k = (t: number) => `${Math.round(t / 1000)}k`;

/* The field. */
const PANEL = { x: 24, y: 44, w: 432, h: 280 };
const COLS = 16;
const GAP = 4;
const FIELD = { x: 16, y: 16, w: PANEL.w - 32, h: PANEL.h - 52 };

/* The answer card. */
const CARD = { x: 488, y: 44, w: 208, h: 280 };
const ROW0 = 62;
const ROW_H = 34;

/* The meter. */
const METER = { x: 24, y: 366, w: 672, h: 12 };

const T = { field: [0, 0.26], dim: [0.3, 0.52], lines: [0.5, 0.72], rows: [0.56, 0.78], meter: [0.74, 1] } as const;

export function TokensArt({ progress = 1, className, style, readTokens = 914260, answerTokens = 2797, filesRead = 224, sent = ['cli.ts', 'doctor.ts', 'index.ts', 'eval/grade.ts', 'diagramCli.ts'] }: TokensArtProps) {
  const p = clamp(progress, 0, 1);
  const n = Math.max(1, Math.round(filesRead));
  const rows = Math.ceil(n / COLS);
  const tw = (FIELD.w - (COLS - 1) * GAP) / COLS;
  const th = Math.min(tw * 0.62, (FIELD.h - (rows - 1) * GAP) / rows);
  /* The tiles the graph sends the model to, spread through the field. */
  const picks = sent.map((_, i) => Math.min(n - 1, Math.floor(((i + 0.5) / sent.length) * n) + ((i * 7) % 5) - 2));
  const tileAt = (idx: number): Pt => [PANEL.x + FIELD.x + (idx % COLS) * (tw + GAP), PANEL.y + FIELD.y + Math.floor(idx / COLS) * (th + GAP)];

  const tDim = seg(p, T.dim[0], T.dim[1]);
  const tMeter = seg(p, T.meter[0], T.meter[1]);
  const ratio = clamp(answerTokens / Math.max(1, readTokens), 0, 1);
  /* The answer is a sliver of the bar (3k of 914k is two pixels of 672); it is kept visible at three. */
  const sx = Math.max(ratio, 3 / METER.w);
  const fold = Math.round(readTokens / Math.max(1, answerTokens));

  return (
    <svg {...svgProps([W, H], className, style, `The repository as ${n} file tiles an agent opened, the ${sent.length} files the graph sends the model to instead, and a meter from ${k(readTokens)} tokens read to ${k(answerTokens)} answered.`)}>
      <Callout x={24} y={24} n="01" label="EVERY FILE IT FOUND, OPENED" />
      <Callout x={488} y={24} n="02" label={`THE ${sent.length} IT NEEDS`} t={0.35 + 0.65 * seg(p, T.rows[0], T.rows[1])} />
      <line x1={24} y1={32} x2={696} y2={32} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />

      {/* ── 01 THE FIELD ── */}
      <Panel x={PANEL.x} y={PANEL.y} w={PANEL.w} h={PANEL.h} label="REPOSITORY">
        {Array.from({ length: n }, (_, i) => {
          const r = Math.floor(i / COLS);
          const c = i % COLS;
          const t = stagger(p, T.field[0], T.field[1], r, rows, 0.45);
          const sentIdx = picks.indexOf(i);
          const isSent = sentIdx >= 0;
          const x = FIELD.x + c * (tw + GAP);
          const y = FIELD.y + r * (th + GAP);
          return (
            <g key={i} transform={`translate(${x} ${y})`} style={{ opacity: t }}>
              <rect width={tw} height={th} rx={2.5} fill="rgba(255, 255, 255, 0.16)" style={{ opacity: isSent ? 1 - tDim : 1 - 0.78 * tDim }} />
              {isSent ? <rect width={tw} height={th} rx={2.5} fill={APP_BLUE} style={{ opacity: tDim }} /> : null}
            </g>
          );
        })}
        <text x={16} y={PANEL.h - 12} fontFamily={MONO} fontSize={10.5} fill={APP_MUTED} data-fit={220}>
          {`${n} files, read in full`}
        </text>
      </Panel>

      {/* ── 02 THE ANSWER ── */}
      <g transform={`translate(${CARD.x} ${CARD.y})`}>
        <rect width={CARD.w} height={CARD.h} rx={12} fill={PAPER} stroke={LINE_STRONG} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <text x={14} y={24} fontFamily={MONO} fontSize={10.5} fill={MUTED} data-fit={CARD.w - 28}>
          <tspan fill={BLUE}>find_files</tspan>
          {`  ${sent.length} files`}
        </text>
        <line x1={14} y1={34} x2={CARD.w - 14} y2={34} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {sent.map((name, i) => {
          const t = stagger(p, T.rows[0], T.rows[1], i, sent.length);
          const y = ROW0 + i * ROW_H;
          return (
            <g key={name} transform={`translate(${14 + (1 - t) * 6} ${y})`} style={{ opacity: t }}>
              <rect y={-th / 2} width={tw} height={th} rx={2.5} fill={BLUE} />
              <text x={tw + 12} y={4} fontFamily={MONO} fontSize={11} fill={INK} data-fit={CARD.w - 28 - tw - 12}>
                {name}
              </text>
            </g>
          );
        })}
        <text x={14} y={CARD.h - 26} fontFamily={MONO} fontSize={9.5} fill={MUTED} data-fit={CARD.w - 28}>
          ranked by a model we
        </text>
        <text x={14} y={CARD.h - 12} fontFamily={MONO} fontSize={9.5} fill={MUTED} data-fit={CARD.w - 28}>
          trained for this job
        </text>
      </g>

      {/* The threads from the tiles to the rows. */}
      {picks.map((idx, i) => {
        const [tx, ty] = tileAt(idx);
        const a: Pt = [tx + tw, ty + th / 2];
        const b: Pt = [PANEL.x + PANEL.w + 10, a[1]];
        const c: Pt = [CARD.x - 8, CARD.y + ROW0 + i * ROW_H];
        const d: Pt = [CARD.x + 14, c[1]];
        const pts: Pt[] = [a, b, c, d];
        return <Drawn key={idx} d={poly(pts)} len={polyLen(pts)} t={stagger(p, T.lines[0], T.lines[1], i, picks.length)} stroke={BLUE_SOFT} width={1} cap="butt" />;
      })}

      {/* ── THE METER ── */}
      <text x={24} y={352} fontFamily={MONO} fontSize={10} letterSpacing="0.1em" fill={MUTED}>
        TOKENS INTO THE MODEL
      </text>
      <rect x={METER.x} y={METER.y} width={METER.w} height={METER.h} rx={METER.h / 2} fill={LINE} />
      <g transform={`translate(${METER.x} ${METER.y}) scale(${1 - (1 - sx) * tMeter} 1)`}>
        <rect width={METER.w} height={METER.h} rx={METER.h / 2} fill={BLUE} />
      </g>
      {/* The two readings, crossfaded in place. */}
      <text x={24} y={400} fontFamily={SANS} fontSize={12} fill={INK} style={{ opacity: 1 - tMeter }} data-fit={320}>
        <tspan fontFamily={MONO} fontWeight={600}>{k(readTokens)}</tspan>
        {' tokens, every file opened'}
      </text>
      <text x={24} y={400} fontFamily={SANS} fontSize={12} fill={BLUE} style={{ opacity: tMeter }} data-fit={320}>
        <tspan fontFamily={MONO} fontWeight={600}>{k(answerTokens)}</tspan>
        {' tokens, the answer'}
      </text>
      <text x={696} y={400} textAnchor="end" fontFamily={SANS} fontSize={12} fill={BLUE} style={{ opacity: tMeter }} data-fit={200}>
        <tspan fontFamily={MONO} fontWeight={600}>{`${fold}×`}</tspan>
        {' less to read'}
      </text>
    </svg>
  );
}
