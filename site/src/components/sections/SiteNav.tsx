import { BrandMark } from '@/components/BrandMark';
import { NAV_LINKS } from '@/data/content';

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50">
      <div className="border-b border-black/6 bg-[rgba(250,250,252,0.94)] shadow-[0_1px_0_rgba(255,255,255,0.75)_inset]">
        <div
          className="mx-auto flex h-12 max-w-[1440px] items-center gap-2"
          style={{ paddingInline: 'var(--pad)' }}
        >
          <a
            href="#overview"
            className="flex shrink-0 items-center gap-2 text-[color:var(--ink)]"
            aria-label="Sequence home"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-white shadow-[0_1px_0_rgba(255,255,255,0.95)_inset,0_6px_16px_rgba(0,0,0,0.08)] ring-1 ring-black/8">
              <BrandMark className="h-5 w-5" small />
            </span>
            <span className="hidden text-[13px] font-semibold tracking-tight sm:inline">Sequence</span>
          </a>

          <nav
            className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto lg:flex"
            aria-label="Primary"
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-full px-3 py-1.5 text-[12px] text-[color:var(--ink-muted)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink)]"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="#help"
              className="hidden rounded-full px-3 py-1.5 text-[12px] text-[color:var(--ink-muted)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink)] sm:inline"
            >
              Help
            </a>
            <a
              href="#download"
              style={{ color: 'var(--accent-ink)' }}
              className="rounded-[var(--radius-pill)] border border-black/8 bg-[color:var(--accent)] px-3.5 py-1.5 text-[12px] font-semibold text-[color:var(--accent-ink)] hover:bg-[color:var(--accent-hover)] shadow-[0_1px_0_rgba(255,255,255,0.85)_inset,0_4px_12px_rgba(0,0,0,0.04)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--accent)_78%,white)]"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
