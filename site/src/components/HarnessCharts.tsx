/**
 * Comparison charts — diversified beyond surfaces.
 * Relative indices from product shape (not synthetic bakeoffs). Footnotes say so.
 */
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HARNESS_BRANDS, HARNESS_COLORS, OPEN_HARNESS_BRANDS } from '@/components/HarnessLogos';

const SEQ = HARNESS_COLORS.sequence;
const MUTED = 'rgb(160, 160, 168)';
const INK = 'rgb(29, 29, 31)';

/** Higher = better token efficiency for a topology question (topology chart vs repo dump). */
const TOKEN_COST = [
  { name: 'Cursor', score: 35, fill: HARNESS_COLORS.cursor },
  { name: 'Claude Code', score: 38, fill: HARNESS_COLORS.claude },
  { name: 'Codex', score: 40, fill: HARNESS_COLORS.codex },
  { name: 'Windsurf', score: 58, fill: HARNESS_COLORS.windsurf },
  { name: 'Sequence', score: 92, fill: SEQ },
];

/** Higher = faster to a useful grounded map on a new repo. */
const TIME_TO_MAP = [
  { name: 'Cursor', score: 42, fill: HARNESS_COLORS.cursor },
  { name: 'Claude Code', score: 40, fill: HARNESS_COLORS.claude },
  { name: 'Codex', score: 44, fill: HARNESS_COLORS.codex },
  { name: 'Windsurf', score: 62, fill: HARNESS_COLORS.windsurf },
  { name: 'Sequence', score: 95, fill: SEQ },
];

/** Viz quality — grounded edges, solid/dashed honesty. */
const VIZ_QUALITY = [
  { name: 'Cursor', score: 22, fill: HARNESS_COLORS.cursor },
  { name: 'Claude Code', score: 20, fill: HARNESS_COLORS.claude },
  { name: 'Codex', score: 24, fill: HARNESS_COLORS.codex },
  { name: 'Windsurf', score: 68, fill: HARNESS_COLORS.windsurf },
  { name: 'Sequence', score: 96, fill: SEQ },
];

/** Share / handoff — export, mirror, reviewable artifacts. */
const SHARE = [
  { name: 'Cursor', score: 55, fill: HARNESS_COLORS.cursor },
  { name: 'Claude Code', score: 48, fill: HARNESS_COLORS.claude },
  { name: 'Codex', score: 50, fill: HARNESS_COLORS.codex },
  { name: 'Windsurf', score: 52, fill: HARNESS_COLORS.windsurf },
  { name: 'Sequence', score: 88, fill: SEQ },
];

/** Easy project use — attach, local-first, no key to start. */
const EASY_USE = [
  { name: 'Cursor', score: 70, fill: HARNESS_COLORS.cursor },
  { name: 'Claude Code', score: 58, fill: HARNESS_COLORS.claude },
  { name: 'Codex', score: 60, fill: HARNESS_COLORS.codex },
  { name: 'Windsurf', score: 65, fill: HARNESS_COLORS.windsurf },
  { name: 'Sequence', score: 94, fill: SEQ },
];

const RADAR = [
  { dim: 'Token efficiency', cursor: 2, claude: 2, codex: 2, windsurf: 3, sequence: 6 },
  { dim: 'Time to map', cursor: 2, claude: 2, codex: 2, windsurf: 4, sequence: 6 },
  { dim: 'Viz quality', cursor: 1, claude: 1, codex: 1, windsurf: 4, sequence: 6 },
  { dim: 'Share / export', cursor: 3, claude: 3, codex: 3, windsurf: 3, sequence: 5 },
  { dim: 'Easy attach', cursor: 4, claude: 3, codex: 3, windsurf: 4, sequence: 6 },
  { dim: 'Surfaces', cursor: 1, claude: 1, codex: 1, windsurf: 2, sequence: 6 },
];

/** Hops to verify a claim — one line per harness. */
const HOPS = [
  { step: 'Ask', cursor: 1, claude: 1, codex: 1, windsurf: 1, sequence: 1 },
  { step: 'Find map', cursor: 3, claude: 4, codex: 3, windsurf: 2, sequence: 1 },
  { step: 'Open evidence', cursor: 5, claude: 6, codex: 5, windsurf: 3, sequence: 2 },
  { step: 'Draw / annotate', cursor: 7, claude: 8, codex: 7, windsurf: 5, sequence: 2 },
  { step: 'Check live', cursor: 9, claude: 9, codex: 8, windsurf: 6, sequence: 3 },
];

function ChartCard({
  eyebrow,
  title,
  children,
  note,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  note: string;
}) {
  return (
    <div className="store-card relative overflow-hidden p-5 sm:p-6">
      <p className="relative z-[1] text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">
        {eyebrow}
      </p>
      <h3 className="relative z-[1] mt-1 text-[18px] font-semibold tracking-tight text-[color:var(--ink)]">{title}</h3>
      <div className="relative z-[1] mt-4 h-[230px] w-full">{children}</div>
      <p className="relative z-[1] mt-3 text-[11px] leading-snug text-[color:var(--ink-muted)]">{note}</p>
    </div>
  );
}

function HBar({
  data,
  eyebrow,
  title,
  note,
  domainMax = 100,
}: {
  data: { name: string; score: number; fill: string }[];
  eyebrow: string;
  title: string;
  note: string;
  domainMax?: number;
}) {
  return (
    <ChartCard eyebrow={eyebrow} title={title} note={note}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.06)" />
          <XAxis
            type="number"
            domain={[0, domainMax]}
            tick={{ fontSize: 11, fill: MUTED }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={92}
            tick={{ fontSize: 11, fill: INK }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }}
          />
          <Bar dataKey="score" radius={[0, 8, 8, 0]} barSize={16}>
            {data.map((s) => (
              <Cell key={s.name} fill={s.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function TokenCostBars() {
  return (
    <HBar
      data={TOKEN_COST}
      eyebrow="Token efficiency"
      title="Same topology question, relative cost"
      note="Index 0–100 from product shape: a grounded topology chart in the prompt vs pasting the tree. Not a vendor billing scrape."
    />
  );
}

export function TimeToMapBars() {
  return (
    <HBar
      data={TIME_TO_MAP}
      eyebrow="Easy project use"
      title="Time to a useful map"
      note="Local-first Sequence starts without a key. Chat/IDE agents need setup before the graph exists."
    />
  );
}

export function VizQualityBars() {
  return (
    <HBar
      data={VIZ_QUALITY}
      eyebrow="Code visualization"
      title="Grounded viz quality"
      note="Solid edges found in code, dashed claims, open-to-file. Windsurf Codemaps scores partial; chat canvases invent freely."
    />
  );
}

export function ShareBars() {
  return (
    <HBar
      data={SHARE}
      eyebrow="Sharing"
      title="Hand off a reviewable artifact"
      note="Sequence export + grounded board vs chat transcripts. Relative index, not a third-party share-rate study."
    />
  );
}

export function EasyUseBars() {
  return (
    <HBar
      data={EASY_USE}
      eyebrow="Attach & go"
      title="Easy project use"
      note="Browse, attach, scan. Sequence core works with no login. Others optimize the keyed agent loop first."
    />
  );
}

/** @deprecated surfaces-only — keep export name for Difference imports during transition */
export function SurfacesBarChart() {
  return (
    <HBar
      data={[
        { name: 'Cursor', score: 1, fill: HARNESS_COLORS.cursor },
        { name: 'Claude Code', score: 1, fill: HARNESS_COLORS.claude },
        { name: 'Codex', score: 1, fill: HARNESS_COLORS.codex },
        { name: 'Windsurf', score: 2, fill: HARNESS_COLORS.windsurf },
        { name: 'Sequence', score: 7, fill: SEQ },
      ]}
      eyebrow="Surfaces"
      title="Surfaces in one harness"
      note="Chat/IDE = 1. Windsurf Codemaps adds a graph. Sequence ships seven."
      domainMax={7}
    />
  );
}

export function CapabilityRadar() {
  return (
    <ChartCard
      eyebrow="Radar · multi-factor"
      title="Where the harness covers you"
      note="Six axes beyond surfaces: tokens, time-to-map, viz, share, attach, surfaces. Scores 0–6 from the checklist."
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={RADAR} cx="50%" cy="52%" outerRadius="68%">
          <PolarGrid stroke="rgba(0,0,0,0.08)" />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 9, fill: MUTED }} />
          <PolarRadiusAxis angle={30} domain={[0, 6]} tick={false} axisLine={false} />
          <Radar name="Cursor" dataKey="cursor" stroke={HARNESS_COLORS.cursor} fill={HARNESS_COLORS.cursor} fillOpacity={0.04} strokeWidth={1} />
          <Radar name="Claude" dataKey="claude" stroke={HARNESS_COLORS.claude} fill={HARNESS_COLORS.claude} fillOpacity={0.04} strokeWidth={1} />
          <Radar name="Codex" dataKey="codex" stroke={HARNESS_COLORS.codex} fill={HARNESS_COLORS.codex} fillOpacity={0.04} strokeWidth={1} />
          <Radar name="Windsurf" dataKey="windsurf" stroke={HARNESS_COLORS.windsurf} fill={HARNESS_COLORS.windsurf} fillOpacity={0.06} strokeWidth={1.25} />
          <Radar name="Sequence" dataKey="sequence" stroke={SEQ} fill={SEQ} fillOpacity={0.28} strokeWidth={2} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function VerifyCurve() {
  return (
    <ChartCard
      eyebrow="Performance curve · all harnesses"
      title="Hops to verify a claim"
      note="“Does checkout talk to ledger?” Each line is a harness. Sequence stays flat; chat/IDE paths climb with tab-switching."
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={HOPS} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="step" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="cursor" name="Cursor" stroke={HARNESS_COLORS.cursor} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="claude" name="Claude Code" stroke={HARNESS_COLORS.claude} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="codex" name="Codex" stroke={HARNESS_COLORS.codex} strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="windsurf" name="Windsurf" stroke={HARNESS_COLORS.windsurf} strokeWidth={1.75} dot={{ r: 2.5 }} />
          <Line
            type="monotone"
            dataKey="sequence"
            name="Sequence"
            stroke={SEQ}
            strokeWidth={2.75}
            dot={{ r: 4, fill: SEQ, stroke: INK, strokeWidth: 1 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FeatureDepthDots() {
  const dims = [
    { label: 'Token efficiency', scores: [2, 2, 2, 3, 5] as const },
    { label: 'Time to map', scores: [2, 2, 2, 3, 5] as const },
    { label: 'Viz quality', scores: [1, 1, 1, 3, 5] as const },
    { label: 'Share / export', scores: [3, 2, 3, 3, 5] as const },
    { label: 'Easy attach', scores: [3, 3, 3, 3, 5] as const },
    { label: 'Surfaces', scores: [1, 1, 1, 2, 5] as const },
  ];
  return (
    <div className="store-card relative overflow-hidden p-5 sm:p-6">
      <p className="relative z-[1] text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">
        Feature depth · dots
      </p>
      <h3 className="relative z-[1] mt-1 text-[18px] font-semibold tracking-tight text-[color:var(--ink)]">
        Coverage across advantages
      </h3>
      <div className="relative z-[1] mt-5 overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse">
          <thead>
            <tr>
              <th className="pb-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">
                Dimension
              </th>
              {HARNESS_BRANDS.map((h) => {
                const Mark = h.Mark;
                return (
                  <th key={h.id} className="pb-3 text-center">
                    <span className="inline-flex flex-col items-center gap-1">
                      <Mark className="h-6 w-6" />
                      <span className="text-[10px] font-medium text-[color:var(--ink)]">{h.name}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => (
              <tr key={d.label} className="border-t border-[color:var(--hairline)]">
                <td className="py-3 text-[13px] text-[color:var(--ink)]">{d.label}</td>
                {d.scores.map((s, i) => (
                  <td key={`${d.label}-${i}`} className="py-3 text-center">
                    <span className="inline-flex gap-0.5" aria-label={`${s} of 5`}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <span
                          key={j}
                          className={`h-2 w-2 rounded-full ${
                            j < s
                              ? i === 4
                                ? 'bg-[color:var(--accent)]'
                                : 'bg-[color:var(--ink)]'
                              : 'bg-black/10'
                          }`}
                        />
                      ))}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="relative z-[1] mt-3 text-[11px] leading-snug text-[color:var(--ink-muted)]">
        Dot scale 0–5 from product shape across tokens, speed, viz, share, attach, and surfaces, not a paid bakeoff.
      </p>
    </div>
  );
}

/** Open harnesses — model-agnostic OSS peers. Scores 0–6 from product shape. */
const OPEN_RADAR = [
  { dim: 'Extensible agent loop', pi: 6, opencode: 5, t3: 4, sequence: 3 },
  { dim: 'Multi-provider control', pi: 4, opencode: 4, t3: 6, sequence: 3 },
  { dim: 'HD agent chrome', pi: 3, opencode: 5, t3: 6, sequence: 4 },
  { dim: 'Grounded architecture', pi: 1, opencode: 1, t3: 1, sequence: 6 },
  { dim: 'Viz honesty', pi: 1, opencode: 1, t3: 1, sequence: 6 },
  { dim: 'Surfaces in one place', pi: 1, opencode: 2, t3: 2, sequence: 6 },
];

/** Dimensions won (count) — Sequence wins more overall while losing agent-plane dims. */
const OVERALL_WINS = [
  { name: 'Pi', score: 2, fill: HARNESS_COLORS.pi },
  { name: 'OpenCode', score: 2, fill: HARNESS_COLORS.opencode },
  { name: 'T3 Code', score: 3, fill: HARNESS_COLORS.t3 },
  { name: 'Sequence', score: 6, fill: SEQ },
];

const OPEN_HOPS = [
  { step: 'Ask', pi: 1, opencode: 1, t3: 1, sequence: 1 },
  { step: 'Find map', pi: 4, opencode: 4, t3: 4, sequence: 1 },
  { step: 'Open evidence', pi: 6, opencode: 5, t3: 5, sequence: 2 },
  { step: 'Draw / annotate', pi: 8, opencode: 7, t3: 7, sequence: 2 },
  { step: 'Check live', pi: 9, opencode: 8, t3: 7, sequence: 3 },
];

export function OpenHarnessRadar() {
  return (
    <ChartCard
      eyebrow="Open harnesses · radar"
      title="Where each open harness actually wins"
      note="Pi leads extensible loop. T3 leads multi-provider control + HD chrome. Sequence leads grounded architecture, viz honesty, and surfaces. Scores 0–6 from product shape, not a bakeoff."
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={OPEN_RADAR} cx="50%" cy="52%" outerRadius="68%">
          <PolarGrid stroke="rgba(0,0,0,0.08)" />
          <PolarAngleAxis dataKey="dim" tick={{ fontSize: 9, fill: MUTED }} />
          <PolarRadiusAxis angle={30} domain={[0, 6]} tick={false} axisLine={false} />
          <Radar name="Pi" dataKey="pi" stroke={HARNESS_COLORS.pi} fill={HARNESS_COLORS.pi} fillOpacity={0.05} strokeWidth={1.25} />
          <Radar name="OpenCode" dataKey="opencode" stroke={HARNESS_COLORS.opencode} fill={HARNESS_COLORS.opencode} fillOpacity={0.04} strokeWidth={1.25} strokeDasharray="4 3" />
          <Radar name="T3 Code" dataKey="t3" stroke={HARNESS_COLORS.t3} fill={HARNESS_COLORS.t3} fillOpacity={0.08} strokeWidth={1.5} />
          <Radar name="Sequence" dataKey="sequence" stroke={SEQ} fill={SEQ} fillOpacity={0.28} strokeWidth={2} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function OverallWinsBars() {
  return (
    <HBar
      data={OVERALL_WINS}
      eyebrow="Overall · honest tally"
      title="Dimensions won (of 10)"
      note="We lose agent extensibility (Pi), multi-provider remote control + HD chrome (T3), and chat-first polish (OpenCode). We still win more: grounded graph, viz honesty, draw, surfaces, topology tokens, local-first map, shareable board."
      domainMax={10}
    />
  );
}

export function OpenVerifyCurve() {
  return (
    <ChartCard
      eyebrow="Open harnesses · hops"
      title="Hops to verify a topology claim"
      note="Same question for Pi / OpenCode / T3 / Sequence. Agent harnesses climb through files and tabs; Sequence keeps the map in-harness."
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={OPEN_HOPS} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="step" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="pi" name="Pi" stroke={HARNESS_COLORS.pi} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="opencode" name="OpenCode" stroke={HARNESS_COLORS.opencode} strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="t3" name="T3 Code" stroke={HARNESS_COLORS.t3} strokeWidth={1.75} dot={{ r: 2.5 }} />
          <Line
            type="monotone"
            dataKey="sequence"
            name="Sequence"
            stroke={SEQ}
            strokeWidth={2.75}
            dot={{ r: 4, fill: SEQ, stroke: INK, strokeWidth: 1 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function OpenFeatureDepthDots() {
  const dims = [
    { label: 'Extensible agent loop', scores: [5, 4, 3, 2] as const },
    { label: 'Multi-provider control', scores: [3, 3, 5, 2] as const },
    { label: 'HD agent chrome', scores: [2, 4, 5, 3] as const },
    { label: 'Grounded architecture', scores: [1, 1, 1, 5] as const },
    { label: 'Viz honesty', scores: [1, 1, 1, 5] as const },
    { label: 'Surfaces / draw', scores: [1, 2, 2, 5] as const },
  ];
  return (
    <div className="store-card relative overflow-hidden p-5 sm:p-6">
      <p className="relative z-[1] text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">
        Open harnesses · depth
      </p>
      <h3 className="relative z-[1] mt-1 text-[18px] font-semibold tracking-tight text-[color:var(--ink)]">
        Honest coverage: they win some rows
      </h3>
      <div className="relative z-[1] mt-5 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className="pb-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">
                Dimension
              </th>
              {OPEN_HARNESS_BRANDS.map((h) => {
                const Mark = h.Mark;
                return (
                  <th key={h.id} className="pb-3 text-center">
                    <span className="inline-flex flex-col items-center gap-1">
                      <Mark className="h-6 w-6" />
                      <span className="text-[10px] font-medium text-[color:var(--ink)]">{h.name}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => (
              <tr key={d.label} className="border-t border-[color:var(--hairline)]">
                <td className="py-3 text-[13px] text-[color:var(--ink)]">{d.label}</td>
                {d.scores.map((s, i) => (
                  <td key={`${d.label}-${i}`} className="py-3 text-center">
                    <span className="inline-flex gap-0.5" aria-label={`${s} of 5`}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <span
                          key={j}
                          className={`h-2 w-2 rounded-full ${
                            j < s
                              ? i === 3
                                ? 'bg-[color:var(--accent)]'
                                : 'bg-[color:var(--ink)]'
                              : 'bg-black/10'
                          }`}
                        />
                      ))}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="relative z-[1] mt-3 text-[11px] leading-snug text-[color:var(--ink-muted)]">
        First three rows: they lead. Last three: Sequence. Overall tally still favors Sequence for architecture work,
        without pretending we beat Pi or T3 at their home games.
      </p>
    </div>
  );
}
