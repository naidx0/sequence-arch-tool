import { BrandMark } from '@/components/BrandMark';
import { PUBLIC_MIRROR } from '@/data/content';

const ROWS = [
  {
    claim: 'Find a service edge from a symbol',
    sequence: 'Architecture re-sorts to the grounded path',
    search: 'Grep + open files until the path appears',
  },
  {
    claim: 'Tell found from claimed',
    sequence: 'Solid vs dashed on the canvas',
    search: 'Reader memory; no durable mark',
  },
  {
    claim: 'Teach one concept without writing',
    sequence: 'Teach flag refuses mutating tools',
    search: 'Prompt discipline alone',
  },
] as const;

export function BenchmarksPage() {
  return (
    <div className="min-h-screen bg-[color:var(--canvas)] text-[color:var(--ink)]">
      <header className="border-b border-[color:var(--hairline)]">
        <div
          className="mx-auto flex h-12 max-w-[980px] items-center justify-between"
          style={{ paddingInline: 'var(--pad)' }}
        >
          <a href="/" className="flex items-center gap-2" aria-label="Sequence home">
            <BrandMark className="h-5 w-5" small />
            <span className="text-[15px] font-semibold">Sequence</span>
          </a>
          <a href="/#download" className="text-[12px] text-[color:var(--accent)]">
            Download
          </a>
        </div>
      </header>
      <main className="tile">
        <div className="tile-inner">
          <p className="eyebrow">Measured</p>
          <h1 className="display-sm max-w-[16ch]">Where Sequence wins — and where search still wins.</h1>
          <p className="lede mt-4">
            Honest comparisons. No invented benchmarks. When plain search is faster, we say so.
          </p>
          <div className="mt-12 overflow-x-auto rounded-3xl border border-[color:var(--hairline)] bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
              <thead>
                <tr className="border-b border-[color:var(--hairline)] bg-[color:var(--canvas-muted)]">
                  <th className="px-5 py-4 font-semibold">Job</th>
                  <th className="px-5 py-4 font-semibold">Sequence</th>
                  <th className="px-5 py-4 font-semibold">Search</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.claim} className="border-b border-[color:var(--hairline)] last:border-0">
                    <td className="px-5 py-4 font-medium">{r.claim}</td>
                    <td className="px-5 py-4 text-[color:var(--ink-muted)]">{r.sequence}</td>
                    <td className="px-5 py-4 text-[color:var(--ink-muted)]">{r.search}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-10 text-[14px] text-[color:var(--ink-muted)]">
            Source notes live with the public mirror:{' '}
            <a href={PUBLIC_MIRROR} className="text-[color:var(--accent)] underline-offset-4 hover:underline">
              GitHub
            </a>
            .
          </p>
          <p className="mt-6">
            <a href="/" className="text-[15px] font-medium text-[color:var(--accent)] underline-offset-4 hover:underline">
              Back to Sequence
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
