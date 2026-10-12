import { DEPTH_MEASURED, kTokens, tokens } from '@/components/DepthCharts';

/**
 * THE MEASURED BAND: one measurement, already in the repo, drawn for a dark
 * page. Every number is computed from DEPTH_MEASURED (taken with
 * tools/measure/importers-by-depth.py); nothing here is typed by hand. The
 * charts are plain bars on a linear scale, so the Sequence bar is as small
 * as it really is. The light recharts versions stay on DepthCharts.tsx.
 */
const rows = DEPTH_MEASURED.rows;
const last = rows[rows.length - 1]!;
const ratio = Math.round(last.bytesRead / last.bytesAnswer);

function k(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k` : `${(n / 1000).toFixed(1)}k`;
}

function PairBars({
  title,
  what,
  a,
  b,
  fmt,
}: {
  title: string;
  what: string;
  a: { label: string; values: number[] };
  b: { label: string; values: number[] };
  fmt: (n: number) => string;
}) {
  const max = Math.max(...a.values, ...b.values);
  const pct = (v: number) => `${Math.max((v / max) * 100, 0.4)}%`;
  return (
    <figure className="cx-panel m-0 p-5 sm:p-7">
      <figcaption>
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        <p className="cx-note mt-1">{what}</p>
      </figcaption>
      <div className="cx-legend mt-4">
        <span>
          <i />
          {a.label}
        </span>
        <span>
          <i className="is-seq" />
          {b.label}
        </span>
      </div>
      <div className="cx-bars mt-5">
        {rows.map((r, i) => (
          <div key={r.depth} className="cx-bar-row">
            <span className="cx-bar-label">{r.depth}</span>
            <span className="cx-bar-track">
              <span className="cx-bar" style={{ width: pct(a.values[i]!) }} />
              <span className="cx-bar-val">{fmt(a.values[i]!)}</span>
            </span>
            <span className="cx-bar-track">
              <span className="cx-bar is-seq" style={{ width: pct(b.values[i]!) }} />
              <span className="cx-bar-val">{fmt(b.values[i]!)}</span>
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Measured() {
  const stats = [
    { value: kTokens(last.bytesRead), label: 'tokens an agent reads to find every importer, four hops deep' },
    { value: kTokens(last.bytesAnswer), label: `tokens in Sequence's answer: the same ${last.files} files, from one call` },
    { value: `${ratio}×`, label: 'less context for the same answer' },
  ];
  return (
    <section id="measured" className="cx-section cx-rule" aria-labelledby="measured-title">
      <div className="cx-wrap-wide">
        <div className="max-w-[46rem]">
          <p className="cx-kicker">Measured</p>
          <h2 id="measured-title" className="cx-h2">
            What breaks if the scanner changes?
          </h2>
          <p className="cx-lede mt-4">
            The importers of <span className="text-[color:var(--on-dark)]">{DEPTH_MEASURED.file}</span> in this
            repository, up to four hops away. An agent that searches and opens each file it finds, against one Sequence
            call.
          </p>
        </div>

        <div className="mt-12 grid gap-8 border-y border-[color:var(--hairline-dark)] py-10 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.value}>
              <p className={`cx-stat ${s.value.endsWith('×') ? 'text-[color:rgb(var(--accent-dark-rgb))]' : ''}`}>
                {s.value}
              </p>
              <p className="mt-3 max-w-[18rem] text-[14.5px] leading-snug text-[color:var(--on-dark-muted)]">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <PairBars
            title="Tokens to answer each depth"
            what="White: an agent opening every importer it has found. Blue: the file list Sequence returns. Linear scale."
            a={{ label: 'Agent reading files', values: rows.map((r) => tokens(r.bytesRead)) }}
            b={{ label: 'Sequence answer', values: rows.map((r) => tokens(r.bytesAnswer)) }}
            fmt={k}
          />
          <PairBars
            title="Lookups to finish each depth"
            what="A search needs one lookup per file found so far. Sequence answers any depth in one call."
            a={{ label: 'grep lookups', values: rows.map((r) => r.grep) }}
            b={{ label: 'Sequence calls', values: rows.map((r) => r.sequence) }}
            fmt={(n) => String(n)}
          />
        </div>

        <p className="cx-note mt-6 max-w-[52rem]">
          Measured {DEPTH_MEASURED.date} with <code>tools/measure/importers-by-depth.py</code>, every package&apos;s source
          and tests included. Tokens are bytes divided by four. At one hop a search needs one lookup too; the lookups grow with
          each hop.
        </p>
      </div>
    </section>
  );
}
