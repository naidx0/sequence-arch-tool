import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * THE ONLY CHARTS ON THE PAGE ARE MEASURED ONES.
 *
 * Owner, 2026-09-18: "I liked the graphs in the showcase — charts showing
 * where we take off… like one turn, no data loss, read the whole repository,
 * specific things." The charts this page used to carry scored every harness
 * from "product shape", which docs/CANON.md names as the mistake. These two
 * draw one measurement, taken on this repository with a script anyone can
 * re-run: tools/measure/importers-by-depth.py.
 *
 * What was measured: the importers of packages/analyzer/src/scan.ts, walked
 * in reverse through relative and workspace imports across every package's
 * source (tests included — a change to the scanner breaks them too). A grep
 * has to look up each file it has found so far before it can see the next
 * depth, so "lookups to finish depth d" is one plus every file found through
 * depth d-1. Sequence answers any depth from the graph in one call.
 */
export const DEPTH_MEASURED = {
  date: '2026-09-18',
  file: 'packages/analyzer/src/scan.ts',
  /* bytesRead: what an agent that must open each file it found has pulled
     into context by the end of that depth. bytesAnswer: Sequence's answer
     for the same depth, the repo-relative file list. Tokens are bytes / 4. */
  rows: [
    { depth: 'depth 1', files: 97, grep: 1, sequence: 1, bytesRead: 1719181, bytesAnswer: 4937 },
    { depth: 'depth 2', files: 167, grep: 98, sequence: 1, bytesRead: 2744013, bytesAnswer: 8331 },
    { depth: 'depth 3', files: 194, grep: 168, sequence: 1, bytesRead: 3469779, bytesAnswer: 9633 },
    { depth: 'depth 4', files: 224, grep: 195, sequence: 1, bytesRead: 3657040, bytesAnswer: 11186 },
  ],
} as const;

export const tokens = (bytes: number): number => Math.round(bytes / 4);
export const kTokens = (bytes: number): string => `${Math.round(tokens(bytes) / 1000)}k`;

const INK = 'rgb(29, 29, 31)';
const INK_MUTED = 'rgba(29, 29, 31, 0.55)';
const GRID = 'rgba(29, 29, 31, 0.14)';
const ACCENT = 'var(--accent-text)';

const axisTick = { fontSize: 11, fill: INK_MUTED } as const;

function ChartFrame({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <figure className="m-0 min-w-0">
      <figcaption>
        <p className="text-[14px] font-semibold tracking-tight text-[color:var(--ink)]">{title}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-[color:var(--ink-muted)]">{note}</p>
      </figcaption>
      <div className="mt-3 h-[190px] w-full">{children}</div>
    </figure>
  );
}

/** Lookups a grep needs to finish each depth, against Sequence's one call. */
export function LookupsCurve() {
  return (
    <ChartFrame title="Lookups to finish each depth" note="grep: one per file found so far. Sequence: one call at any depth.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...DEPTH_MEASURED.rows]} margin={{ left: 0, right: 18, top: 22, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="depth" tick={axisTick} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={34} />
          <Tooltip
            cursor={{ stroke: GRID }}
            contentStyle={{ borderRadius: 10, border: `1px solid ${GRID}`, fontSize: 12 }}
            formatter={(v, name) => [`${String(v)} lookups`, String(name) === 'grep' ? 'grep' : 'Sequence']}
          />
          <Line
            type="monotone"
            dataKey="grep"
            name="grep"
            stroke={INK}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={{ r: 3.5, fill: 'white', stroke: INK, strokeWidth: 1.5 }}
            activeDot={{ r: 4.5 }}
            isAnimationActive={false}
          >
            <LabelList dataKey="grep" position="top" offset={8} style={{ fontSize: 11, fill: INK }} />
          </Line>
          <Line
            type="monotone"
            dataKey="sequence"
            name="Sequence"
            stroke={ACCENT}
            strokeWidth={2.25}
            dot={{ r: 3.5, fill: ACCENT, stroke: ACCENT }}
            activeDot={{ r: 4.5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Tokens an agent reads to finish each depth, against the answer Sequence
 *  returns for it. Log scale, because the two differ by two and a half
 *  orders of magnitude and a linear axis would hide the second bar. */
export function TokensChart() {
  const data = DEPTH_MEASURED.rows.map((r) => ({
    depth: r.depth,
    read: tokens(r.bytesRead),
    answer: tokens(r.bytesAnswer),
  }));
  return (
    <ChartFrame
      title="Tokens to finish each depth"
      note="Dark: an agent opening every importer it has found. Blue: the file list Sequence answers the same question with. Log scale — the two differ by more than two orders of magnitude, and a linear axis would draw the blue bar as nothing."
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 14, top: 14, bottom: 0 }} barCategoryGap="30%" barGap={3}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="depth" tick={axisTick} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis
            scale="log"
            domain={[1000, 2000000]}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
          />
          <Tooltip
            cursor={{ fill: 'rgba(29,29,31,0.04)' }}
            contentStyle={{ borderRadius: 10, border: `1px solid ${GRID}`, fontSize: 12 }}
            formatter={(v, name) => [`${Number(v).toLocaleString()} tokens`, String(name) === 'read' ? 'reading files' : 'Sequence answer']}
          />
          <Bar dataKey="read" name="read" fill={INK} radius={[6, 6, 2, 2]} isAnimationActive={false}>
            <LabelList dataKey="read" position="top" offset={6} formatter={(v: unknown) => `${Math.round(Number(v) / 1000)}k`} style={{ fontSize: 11, fill: INK }} />
          </Bar>
          <Bar dataKey="answer" name="answer" fill={ACCENT} radius={[6, 6, 2, 2]} isAnimationActive={false}>
            <LabelList dataKey="answer" position="top" offset={6} formatter={(v: unknown) => `${(Number(v) / 1000).toFixed(1)}k`} style={{ fontSize: 11, fill: INK }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Files reached at each depth — the size of the blast radius one call returns. */
export function FilesReachedBars() {
  return (
    <ChartFrame title="Files reached at each depth" note="Importers of scan.ts, cumulative. The whole set comes back from one call.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...DEPTH_MEASURED.rows]} margin={{ left: 0, right: 14, top: 14, bottom: 0 }} barCategoryGap="34%">
          <CartesianGrid stroke={GRID} strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="depth" tick={axisTick} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={34} />
          <Tooltip
            cursor={{ fill: 'rgba(29,29,31,0.04)' }}
            contentStyle={{ borderRadius: 10, border: `1px solid ${GRID}`, fontSize: 12 }}
            formatter={(v) => [`${String(v)} files`, 'reached']}
          />
          <Bar dataKey="files" fill={ACCENT} radius={[6, 6, 2, 2]} isAnimationActive={false}>
            <LabelList dataKey="files" position="top" offset={6} style={{ fontSize: 11, fill: INK }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
