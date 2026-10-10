import { DEPTH_MEASURED, kTokens, tokens } from '@/components/DepthCharts';
import { Reveal } from '@/components/lt/hooks';

/**
 * ONE MEASUREMENT, ALREADY IN THE REPO. Every number is computed from
 * DEPTH_MEASURED (tools/measure/importers-by-depth.py); nothing is typed by
 * hand. Plain bars on a linear scale, so the Sequence bar is as small as it is.
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
    <figure className="lt-panel m-0 p-5 sm:p-7">
      <figcaption>
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        <p className="lt-note mt-1">{what}</p>
      </figcaption>
      <div className="lt-legend mt-4">
        <span>
          <i />
          {a.label}
        </span>
        <span>
          <i className="is-seq" />
          {b.label}
        </span>
      </div>
      <div className="lt-bars mt-5">
        {rows.map((r, i) => (
          <div key={r.depth} className="lt-bar-row">
            <span className="lt-bar-label">{r.depth}</span>
            <span className="lt-bar-track">
              <span className="lt-bar" style={{ width: pct(a.values[i]!) }} />
              <span className="lt-bar-val">{fmt(a.values[i]!)}</span>
            </span>
            <span className="lt-bar-track">
              <span className="lt-bar is-seq" style={{ width: pct(b.values[i]!) }} />
              <span className="lt-bar-val">{fmt(b.values[i]!)}</span>
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Measured() {
  /* MacBook's comparison band: the plain label above, the number under it, nothing below. */
  const metrics = [
    { label: 'Lookups to reach depth 4', a: String(last.grep), b: String(last.sequence) },
    { label: 'Tokens to read', a: kTokens(last.bytesRead), b: kTokens(last.bytesAnswer) },
    { label: 'Importers found', a: String(last.files), b: String(last.files) },
  ];
  return (
    <section id="measured" className="lt-chapter" aria-labelledby="measured-title">
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="lt-kicker">Measured on this repository</p>
          <h2 id="measured-title" className="lt-display">
            The same answer. {ratio}× less to read.
          </h2>
          <p className="lt-lede mx-auto mt-5 max-w-[38rem]">
            The importers of <span className="text-[color:var(--lt-ink)]">{DEPTH_MEASURED.file}</span>, up to four hops away.
          </p>
        </Reveal>

        <Reveal className="lt-cband mt-14">
          <div className="lt-cband-head">
            <p className="lt-cband-name">An agent searching and opening files</p>
            <p className="lt-cband-name is-seq">Sequence</p>
          </div>
          {metrics.map((m) => (
            <div key={m.label} className="lt-cband-row">
              <p className="lt-cband-label">{m.label}</p>
              <p className="lt-stat">{m.a}</p>
              <p className="lt-stat is-seq">{m.b}</p>
            </div>
          ))}
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <PairBars
            title="Tokens to answer each depth"
            what="Grey: an agent opening every importer it has found. Blue: the file list Sequence returns. Linear scale."
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

        <p className="lt-note mx-auto mt-6 max-w-[52rem] text-center">
          Measured {DEPTH_MEASURED.date} with <code>tools/measure/importers-by-depth.py</code>, every package&apos;s source and
          tests included. Tokens are bytes divided by four. At one hop a search needs one lookup too; the lookups grow with
          each hop.
        </p>
      </div>
    </section>
  );
}
