import type { ReactElement } from 'react';

import { DIFFERENCE } from '@/data/content';
import { HARNESS_BRANDS, OPEN_HARNESS_BRANDS } from '@/components/HarnessLogos';
import { DEPTH_MEASURED, FilesReachedBars, LookupsCurve, TokensChart, kTokens } from '@/components/DepthCharts';

/**
 * THE COMPARE SECTION SAYS SPECIFIC THINGS OR NOTHING.
 *
 * Owner, 2026-09-18, on the previous version: "surfaces in one harness is
 * kind of a rough example… easy project attach — Codex can kind of do that…
 * solid versus dashed edges, what is that even… draw on the same canvas —
 * they can make canvases too, we need to be more specific… less of these
 * punchy lines… it can just show in the chart, same table."
 *
 * So: one checklist whose rows name a concrete behaviour and how it is
 * measured or where it is documented; the same rows against the open
 * harnesses with their home-field rows on top, losses in the cells; and two
 * charts of the one thing we measured, with the script that measured it.
 * No "they win / we win" prose, no counts of surfaces, no scores.
 */

export type Cell = boolean | 'partial';

export type Row = {
  label: string;
  hint: string;
  values: Cell[];
};

const d = DEPTH_MEASURED.rows;
const last = d[d.length - 1]!;

/** Columns: Cursor, Claude Code, Codex, Windsurf, Sequence. */
export const ROWS: Row[] = [
  {
    label: 'Every edge opens to a file and a line',
    hint: 'The graph is static analysis of the repository; click an edge and land on the import that made it.',
    values: [false, false, false, 'partial', true],
  },
  {
    label: 'Importers by depth from one lookup',
    hint: 'Everything that depends on a file, four hops out, in one call; a grep needs a lookup for every file it finds.',
    values: [false, false, false, 'partial', true],
  },
  {
    label: 'Questions answer from the graph, not a re-read',
    hint: 'The scan is done once and cached; a question walks the graph and opens a file only to cite it.',
    values: [false, false, false, 'partial', true],
  },
  {
    label: 'A drawn edge stays a claim until code proves it',
    hint: 'Whiteboard ink and model proposals are dashed; the scanner turns one solid when it finds the import.',
    values: [false, false, false, false, true],
  },
  {
    label: 'Board exports for review',
    hint: 'Mermaid, dependency matrix (Markdown or CSV) and an architecture note from the same graph: a handoff that is not a chat log.',
    values: [false, false, false, false, true],
  },
  {
    label: 'Runs with no account and no key',
    hint: 'Scan, board, whiteboard, impact and export are local; a key adds chat. The others need a sign-in, free or not.',
    values: ['partial', 'partial', 'partial', 'partial', true],
  },
];

/** Columns: Pi, OpenCode, T3 Code, Sequence. Their home-field rows first. */
export const OPEN_ROWS: Row[] = [
  {
    label: 'Extensible agent loop',
    hint: 'Open source: rewrite the harness, its packages and tools, not a sealed product.',
    values: [true, 'partial', 'partial', true],
  },
  {
    label: 'Multi-provider control plane',
    hint: 'Drive several agents and providers from one UI: Claude Code, Codex, local models.',
    values: ['partial', 'partial', true, true],
  },
  {
    label: 'Remote and mobile session chrome',
    hint: 'Approvals, diffs and sessions from another device.',
    values: [false, 'partial', true, false],
  },
  {
    label: 'Every edge opens to a file and a line',
    hint: 'A graph from static analysis, each edge traceable to the import that made it.',
    values: [false, false, false, true],
  },
  {
    label: 'Importers by depth from one lookup',
    hint: 'Four hops of dependants in one call; grep needs a lookup per file found.',
    values: [false, false, false, true],
  },
  {
    label: 'A drawn edge stays a claim until code proves it',
    hint: 'Dashed until the scanner finds the import.',
    values: [false, false, false, true],
  },
  {
    label: 'Board exports for review',
    hint: 'Mermaid, matrix and architecture note from the same graph.',
    values: [false, false, false, true],
  },
  {
    label: 'Runs with no account and no key',
    hint: 'Scan, board, whiteboard, impact and export are local.',
    values: ['partial', 'partial', 'partial', true],
  },
];

function CellView({ value, emphasize }: { value: Cell; emphasize?: boolean }) {
  if (value === true) {
    return (
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${
          emphasize ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]' : 'bg-black/8 text-[color:var(--ink)]'
        }`}
        aria-label="Yes"
      >
        ✓
      </span>
    );
  }
  if (value === 'partial') {
    return (
      <span
        className="inline-flex h-6 items-center rounded-full bg-black/6 px-2 text-[11px] font-medium text-[color:var(--ink-muted)]"
        aria-label="Partial"
      >
        some
      </span>
    );
  }
  return (
    <span className="text-[14px] text-black/25" aria-label="No">
      —
    </span>
  );
}

type Brand = { id: string; name: string; Mark: (p: { className?: string }) => ReactElement };

function Checklist({
  eyebrow,
  title,
  intro,
  brands,
  rows,
  footnote,
  testId,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  brands: readonly Brand[];
  rows: Row[];
  footnote: string;
  testId: string;
}) {
  return (
    <div className="store-card relative mt-8 overflow-hidden p-0" data-testid={testId}>
      <div className="relative z-[1] border-b border-[color:var(--hairline)] px-5 py-5 sm:px-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">{eyebrow}</p>
        <h3 className="mt-1 text-[22px] font-semibold tracking-tight text-[color:var(--ink)]">{title}</h3>
        <p className="mt-2 max-w-2xl text-[14px] leading-snug text-[color:var(--ink-muted)]">{intro}</p>
      </div>

      <div className="relative z-[1] overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--hairline)] bg-[color:var(--canvas-muted)]">
              <th
                scope="col"
                className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)] sm:px-7"
              >
                Capability
              </th>
              {brands.map((h) => {
                const Mark = h.Mark;
                const isSeq = h.id === 'sequence';
                return (
                  <th
                    key={h.id}
                    scope="col"
                    className={`px-3 py-3 text-center ${isSeq ? 'bg-[color:color-mix(in_srgb,var(--accent)_9%,transparent)]' : ''}`}
                  >
                    <span className="inline-flex flex-col items-center gap-1.5">
                      <Mark className="h-8 w-8" />
                      <span className={`text-[11px] font-semibold ${isSeq ? 'text-[color:var(--accent-text)]' : 'text-[color:var(--ink)]'}`}>
                        {h.name}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-[color:var(--hairline)] last:border-b-0">
                <th scope="row" className="max-w-[34rem] px-5 py-3.5 align-middle sm:px-7">
                  <p className="text-[13px] font-medium text-[color:var(--ink)]">{row.label}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-[color:var(--ink-muted)]">{row.hint}</p>
                </th>
                {row.values.map((v, i) => {
                  const isSeq = brands[i]!.id === 'sequence';
                  return (
                    <td
                      key={`${row.label}-${brands[i]!.id}`}
                      className={`px-3 py-3.5 text-center align-middle ${
                        isSeq ? 'bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)]' : ''
                      }`}
                    >
                      <CellView value={v} emphasize={isSeq} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="relative z-[1] border-t border-[color:var(--hairline)] px-5 py-4 text-[12px] leading-snug text-[color:var(--ink-muted)] sm:px-7">
        {footnote}
      </p>
    </div>
  );
}

/**
 * WHAT THE GRAPH SAVES, in the reader's own terms. Owner, 2026-09-18: the
 * dated "measured on this repository" panel read as a status symbol, and
 * "the numbers don't mean much" to someone who works on real repositories.
 * So the panel now says what the measurement means for them: the tokens an
 * agent does not have to read, and therefore the size of model and the
 * length of task the harness can carry. Every number still comes from
 * DEPTH_MEASURED and tools/measure/importers-by-depth.py, so it can be
 * re-run; the date is in the script, not on the page.
 */
function Measured() {
  /*
   * ── HOW THE NUMBERS ARE PORTRAYED (owner, 2026-09-19) ────────────────────
   *
   * "Zero keys to start, don't like that. 195 trips to get there, or to one,
   * don't like that either. I like the stat. I don't like how it's getting
   * portrayed."
   *
   * Both readings were right, and for different reasons. "0" as a display
   * numeral is not a measurement — it is a slogan wearing a measurement's
   * clothes, and it sat beside three real ones. It moves into the prose
   * below, where a claim belongs. And "195 → 1" is a number a reader has to
   * decode before it says anything; the same fact drawn as a curve says it
   * before it is read, which is why `LookupsCurve` now appears on the page
   * it was written for.
   *
   * What replaces them is the one figure the whole section is actually
   * about: the RATIO between what an agent reads and what the graph answers
   * with. It is computed here rather than typed, so it cannot drift from the
   * rows it comes from.
   */
  const ratio = Math.round(last.bytesRead / last.bytesAnswer);
  const figures = [
    { value: kTokens(last.bytesRead), label: 'tokens an agent reads to map depth 4', note: 'opening each importer it finds, one hop at a time' },
    { value: kTokens(last.bytesAnswer), label: 'tokens Sequence answers with', note: 'the same 224 files, as a list from the graph, in one call' },
    { value: `${ratio}×`, label: 'less context for the same answer', note: `and ${last.grep} lookups become one call — the curve below` },
  ];
  const means = [
    {
      title: 'Small and local models keep up.',
      body: 'A 2.5B model answered the walkthrough above. It never had to hold 900k tokens of source; it read a list and opened the files it cited.',
    },
    {
      title: 'Long tasks stay inside the window.',
      body: 'A goal run works one step per turn against the graph, so the context is spent on the change, not on rediscovering the repository each turn.',
    },
    {
      title: 'Nothing here needs a key.',
      body: 'The scan, the board, the whiteboard, impact and export all run on your machine. A local model answers, or bring your own — the graph is the same either way.',
    },
  ];
  return (
    <div className="mt-6 rounded-[var(--radius-tile)] border border-[color:var(--hairline)] bg-white/90 px-5 py-5 sm:px-6" data-testid="measured">
      <p className="text-[12px] font-medium text-[color:var(--accent-text)]">What the graph saves</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {figures.map((r) => (
          <div key={r.label}>
            <p className="font-[var(--font-display)] text-[34px] font-semibold leading-none tracking-tight text-[color:var(--ink)]">{r.value}</p>
            <p className="mt-2 text-[14px] font-medium text-[color:var(--ink)]">{r.label}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-[color:var(--ink-muted)]">{r.note}</p>
          </div>
        ))}
      </div>
      {/*
        THREE READINGS OF ONE MEASUREMENT, and the curve is the one the owner
        asked for. `LookupsCurve` was written with the other two and never
        placed on a page, so the round-trip fact had only the bare "195 → 1"
        to carry it. A line that climbs against a flat one says "this grows
        with depth and that does not" without a caption.
      */}
      <div className="mt-6 grid gap-6 border-t border-[color:var(--hairline)] pt-5 md:grid-cols-2 xl:grid-cols-3">
        <TokensChart />
        <LookupsCurve />
        <FilesReachedBars />
      </div>
      <div className="mt-6 grid gap-4 border-t border-[color:var(--hairline)] pt-5 md:grid-cols-3">
        {means.map((m) => (
          <div key={m.title}>
            <p className="text-[14px] font-semibold text-[color:var(--ink)]">{m.title}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-[color:var(--ink-muted)]">{m.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] leading-snug text-[color:var(--ink-muted)]">
        Importers of <code className="font-mono text-[11.5px]">{DEPTH_MEASURED.file}</code> across every package of this
        repository, tests included. Tokens are bytes divided by four. Re-run{' '}
        <code className="font-mono text-[11.5px]">tools/measure/importers-by-depth.py</code> before quoting it. On a
        one-hop lookup the saving is small; it is the depth that costs an agent, and the graph answers any depth from
        one call.
      </p>
    </div>
  );
}

export function Difference() {
  return (
    <section id="difference" className="tile-tight atmosphere-silver" aria-labelledby="difference-title">
      <div className="tile-wide">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Why Sequence</p>
          <h2 id="difference-title" className="display-sm">
            Not another chat harness.
          </h2>
          <p className="lede mx-auto mt-3">
            Your current tools talk. Sequence shows what the code actually connects, then holds the work in one place.
          </p>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {DIFFERENCE.map((row) => (
            <article
              key={row.id}
              className="rounded-[var(--radius-tile)] border border-[color:var(--hairline)] bg-white/90 px-5 py-5"
            >
              <h3 className="text-[17px] font-semibold tracking-tight text-[color:var(--ink)]">{row.title}</h3>
              <p className="mt-3 text-[13px] leading-snug text-[color:var(--ink-muted)]">
                <span className="font-medium text-[color:var(--ink-muted)]">Typical · </span>
                {row.yours}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-[color:var(--ink)]">
                <span className="font-medium text-[color:var(--accent-text)]">Sequence · </span>
                {row.ours}
              </p>
            </article>
          ))}
        </div>

        <Checklist
          testId="compare-closed"
          eyebrow="Checklist"
          title="Real harnesses. Same checklist."
          intro="Cursor, Claude Code, Codex and Windsurf, row by row. Each row names one behaviour and how it is measured or where it is documented."
          brands={HARNESS_BRANDS}
          rows={ROWS}
          footnote="Logos: Cursor, Claude Code, OpenAI (Codex), Windsurf via Simple Icons; Sequence mark from this repo. Cells are have / some / none from each product's own documentation, no scores. Windsurf Codemaps is the closest graph ship."
        />

        <Measured />

        <Checklist
          testId="compare-open"
          eyebrow="Open checklist"
          title="The same rows against other open harnesses."
          intro="Pi, OpenCode and T3 Code are open harnesses too. Sequence is open source and drives several agents; T3 Code leads on remote and mobile chrome. The rows below are where the graph makes the difference."
          brands={OPEN_HARNESS_BRANDS}
          rows={OPEN_ROWS}
          footnote="Marks: Pi from pi.dev, OpenCode via Simple Icons, T3 Code from pingdotgg/t3code, Sequence mark from this repo. Cells from each product's own documentation, no scores."
        />
      </div>
    </section>
  );
}
