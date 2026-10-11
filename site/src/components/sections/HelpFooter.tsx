import { HELP_LINKS, PUBLIC_MIRROR } from '@/data/content';
import { BrandMark } from '@/components/BrandMark';

export function Help() {
  return (
    <section id="help" className="tile atmosphere-warm" aria-labelledby="help-title">
      <div className="tile-wide">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">Support</p>
          <h2 id="help-title" className="display-sm">
            Docs, help, and the public mirror.
          </h2>
          <p className="lede mx-auto mt-4">
            Each card opens the page in the public mirror that answers it.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HELP_LINKS.map((h) => (
            <a
              key={h.href}
              href={h.href}
              className="store-card group block bg-[color:var(--canvas-muted)] p-7 transition-colors hover:bg-white"
            >
              <h3 className="text-[19px] font-semibold tracking-tight group-hover:text-[color:var(--accent)]">
                {h.title}
              </h3>
              <p className="mt-2 text-[15px] leading-snug text-[color:var(--ink-muted)]">{h.body}</p>
              <span className="mt-5 inline-flex text-[13px] font-medium text-[color:var(--accent)]">
                Open →
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[color:var(--hairline)] bg-[color:var(--canvas-muted)]">
      <div
        className="mx-auto flex max-w-[1120px] flex-col gap-8 py-12 sm:flex-row sm:items-start sm:justify-between"
        style={{ paddingInline: 'var(--pad)' }}
      >
        <div className="flex items-center gap-2 text-[color:var(--ink)]">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_8px_18px_rgba(0,0,0,0.08)] ring-1 ring-black/5">
            <BrandMark className="h-4 w-4" small />
          </span>
          <span className="text-[14px] font-semibold">Sequence</span>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-[12px] text-[color:var(--ink-muted)]">
          <a href="#overview" className="hover:text-[color:var(--ink)]">
            Overview
          </a>
          <a href="#difference" className="hover:text-[color:var(--ink)]">
            Difference
          </a>
          <a href="#download" className="hover:text-[color:var(--ink)]">
            Download
          </a>
          <a href="benchmarks.html" className="hover:text-[color:var(--ink)]">
            Measured
          </a>
          <a href={PUBLIC_MIRROR} className="hover:text-[color:var(--ink)]">
            GitHub
          </a>
        </div>
      </div>
      <div
        className="mx-auto max-w-[1120px] pb-10 text-[11px] text-[color:var(--ink-muted)]"
        style={{ paddingInline: 'var(--pad)' }}
      >
        Sequence reads your repository locally and maps its architecture.
      </div>
    </footer>
  );
}
