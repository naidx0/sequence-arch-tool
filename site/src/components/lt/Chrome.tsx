import { BrandMark } from '@/components/BrandMark';
import { HELP_LINKS, PUBLIC_MIRROR } from '@/data/content';
import { RELEASE_URL } from '@/data/release';

const LINKS = [
  { href: '#choose', label: 'Models & agents' },
  { href: '#draw', label: 'Draw' },
  { href: '#long-tasks', label: 'Long tasks' },
  { href: '#small-models', label: 'Small helpers' },
] as const;

/** The nav: a frosted bar, the links centred in their own glass pill (Tesla), one dark pill to download. */
export function Nav() {
  return (
    <header className="lt-nav">
      <div className="lt-wrap-wide lt-nav-row">
        <a href="#overview" className="flex shrink-0 items-center gap-2.5" aria-label="Sequence home">
          <BrandMark className="h-[22px] w-[22px] text-[color:var(--lt-ink)]" />
          <span className="text-[15px] font-semibold tracking-tight">Sequence</span>
        </a>
        <nav className="lt-nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="lt-navlink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-2">
          <a href={PUBLIC_MIRROR} className="lt-navlink hidden sm:inline">
            GitHub
          </a>
          <a href="#download" className="lt-btn lt-btn-ink !min-h-[34px] !px-4 !text-[13.5px]">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer id="help" className="lt-footer" aria-label="Support and links">
      <div className="lt-wrap-wide grid gap-10 py-16 md:grid-cols-[1.2fr_2fr]">
        <div>
          <a href="#overview" className="inline-flex items-center gap-2.5" aria-label="Sequence home">
            <BrandMark className="h-6 w-6 text-[color:var(--lt-ink)]" />
            <span className="text-[15px] font-semibold tracking-tight">Sequence</span>
          </a>
          <p className="lt-note mt-4 max-w-[22rem]">Sequence is a desktop app that runs on your computer and maps your repository locally.</p>
          <p className="lt-note mt-3 max-w-[22rem]">
            Clips are recorded in the app on a sample project; some replies and figures in them are samples. Numbers are
            measured on internal tests.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="text-[13px] font-semibold">Product</p>
            <ul className="lt-footlist">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
              <li>
                <a href="#download">Download</a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold">Support</p>
            <ul className="lt-footlist">
              {HELP_LINKS.map((h) => (
                <li key={h.href}>
                  <a href={h.href}>{h.title}</a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold">Source</p>
            <ul className="lt-footlist">
              <li>
                <a href={PUBLIC_MIRROR}>GitHub</a>
              </li>
              <li>
                <a href={RELEASE_URL}>Releases</a>
              </li>
              <li>
                <a href="benchmarks.html">Search comparison</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
