import { BrandMark } from '@/components/BrandMark';
import { HELP_LINKS, PUBLIC_MIRROR } from '@/data/content';
import { RELEASE_URL } from '@/data/release';

const LINKS = [
  { href: '#features', label: 'Product', footer: 'Features' },
  { href: '#measured', label: 'Measured' },
  { href: '#compare', label: 'Compare' },
  { href: '#help', label: 'Support' },
] as const;

export function Nav() {
  return (
    <header className="cx-nav">
      <div className="cx-wrap-wide flex h-14 items-center gap-3">
        <a href="#overview" className="flex shrink-0 items-center gap-2.5" aria-label="Sequence home">
          <BrandMark className="h-[22px] w-[22px] text-[color:var(--on-dark)]" />
          <span className="text-[15px] font-semibold tracking-tight">Sequence</span>
        </a>
        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="cx-navlink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href={PUBLIC_MIRROR} className="cx-navlink hidden sm:inline">
            GitHub
          </a>
          <a href="#download" className="cx-btn cx-btn-primary !min-h-[34px] !px-4 !text-[13.5px]">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer id="help" className="cx-rule" aria-label="Support and links">
      <div className="cx-wrap-wide grid gap-10 py-16 md:grid-cols-[1.2fr_2fr]">
        <div>
          <a href="#overview" className="inline-flex items-center gap-2.5" aria-label="Sequence home">
            <BrandMark className="h-6 w-6 text-[color:var(--on-dark)]" />
            <span className="text-[15px] font-semibold tracking-tight">Sequence</span>
          </a>
          <p className="cx-note mt-4 max-w-[22rem]">Sequence reads your repository locally and maps its architecture.</p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="text-[13px] font-semibold">Product</p>
            <ul className="mt-3 grid gap-2 text-[13.5px] text-[color:var(--on-dark-muted)]">
              {LINKS.slice(0, 3).map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="hover:text-[color:var(--on-dark)]">
                    {'footer' in l ? l.footer : l.label}
                  </a>
                </li>
              ))}
              <li>
                <a href="#download" className="hover:text-[color:var(--on-dark)]">
                  Download
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold">Support</p>
            <ul className="mt-3 grid gap-2 text-[13.5px] text-[color:var(--on-dark-muted)]">
              {HELP_LINKS.map((h) => (
                <li key={h.href}>
                  <a href={h.href} className="hover:text-[color:var(--on-dark)]">
                    {h.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold">Source</p>
            <ul className="mt-3 grid gap-2 text-[13.5px] text-[color:var(--on-dark-muted)]">
              <li>
                <a href={PUBLIC_MIRROR} className="hover:text-[color:var(--on-dark)]">
                  GitHub
                </a>
              </li>
              <li>
                <a href={RELEASE_URL} className="hover:text-[color:var(--on-dark)]">
                  Releases
                </a>
              </li>
              <li>
                <a href="benchmarks.html" className="hover:text-[color:var(--on-dark)]">
                  Search comparison
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
