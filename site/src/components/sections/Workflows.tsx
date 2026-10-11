import { DemoVideo } from '@/components/DemoVideo';
import { SAMPLE_NOTE, WORKFLOWS } from '@/data/content';

export function Workflows() {
  return (
    <section id="workflows" className="tile-tight atmosphere-silver" aria-labelledby="workflows-title">
      <div className="tile-wide">
        <p className="eyebrow">Workflows</p>
        <h2 id="workflows-title" className="display-sm max-w-[22ch]">
          Three ways people use it.
        </h2>

        <div className="mt-8 flex flex-col gap-5">
          {WORKFLOWS.map((w, i) => (
            <article
              key={w.id}
              className="grid items-center gap-6 rounded-[var(--radius-card)] border border-[color:var(--hairline)] bg-white/90 p-5 md:p-6 lg:grid-cols-2"
            >
              <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-muted)]">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-1 text-[24px] font-semibold tracking-tight text-[color:var(--ink)]">{w.title}</h3>
                <p className="mt-1 text-[15px] text-[color:var(--ink-muted)]">{w.lede}</p>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-snug text-[color:var(--ink)] marker:text-[color:var(--ink-muted)]">
                  {w.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
              {w.clip ? (
                <DemoVideo id={w.clip} alt={`${w.title}: the steps, recorded in the app.`} className={i % 2 === 1 ? 'lg:order-1' : ''} />
              ) : null}
            </article>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-[color:var(--ink-muted)]">{SAMPLE_NOTE}</p>
      </div>
    </section>
  );
}
