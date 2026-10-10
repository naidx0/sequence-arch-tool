import { CHART_FAMILIES } from '@/data/content';

export function Proof() {
  return (
    <section id="proof" className="tile bg-[color:var(--canvas)]" aria-labelledby="proof-title">
      <div className="tile-inner">
        <div className="grid items-start gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow">Proof</p>
            <h2 id="proof-title" className="display-sm">
              Solid edges were found in the code, and dashed edges are only claimed.
            </h2>
            <p className="lede mt-4">
              Sequence does not invent topology. When the agent draws, it uses charts with a job: showing a path,
              lighting impact, or counting what the scan found, always grounded in the scan.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CHART_FAMILIES.map((c) => (
              <li
                key={c.id}
                className="rounded-[18px] border border-[color:var(--hairline)] bg-[color:var(--canvas-muted)] px-5 py-4 shadow-[0_8px_24px_rgba(0,0,0,0.04)]"
              >
                <p className="text-[14px] font-semibold tracking-tight text-[color:var(--ink)]">{c.label}</p>
                <p className="mt-1 text-[14px] text-[color:var(--ink-muted)]">{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
