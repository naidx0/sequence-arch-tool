import { DemoVideo } from '@/components/DemoVideo';
import { ALSO_014, FEATURES_014, SAMPLE_NOTE } from '@/data/content';
import { NEXT_VERSION } from '@/data/release';

export function WhatsNew() {
  return (
    <section id="whats-new" className="tile-tight atmosphere-warm" aria-labelledby="whats-new-title">
      <div className="tile-wide">
        <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow">What is new in {NEXT_VERSION}</p>
            <h2 id="whats-new-title" className="display-sm max-w-[22ch]">
              Point at it. Ask about it. Draw it.
            </h2>
          </div>
          <p className="lede md:max-w-[26rem]">
            Each clip below is the app as built, not a mock-up.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES_014.map((f) => (
            <li
              key={f.id}
              className="flex flex-col rounded-[var(--radius-tile)] border border-[color:var(--hairline)] bg-white/90 p-4"
            >
              <DemoVideo id={f.id} alt={f.title} />
              <h3 className="mt-4 text-[19px] font-semibold tracking-tight text-[color:var(--ink)]">{f.title}</h3>
              <p className="mt-1.5 text-[14px] leading-snug text-[color:var(--ink-muted)]">{f.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-[color:var(--ink-muted)]">{SAMPLE_NOTE}</p>

        <h3 className="mt-12 text-[22px] font-semibold tracking-tight text-[color:var(--ink)]">Also in {NEXT_VERSION}</h3>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALSO_014.map((a) => (
            <li key={a.title} className="store-card p-5">
              <p className="relative z-[1] text-[16px] font-semibold tracking-tight">{a.title}</p>
              <p className="relative z-[1] mt-1.5 text-[14px] leading-snug text-[color:var(--ink-muted)]">{a.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
