import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { PUBLIC_MIRROR } from '@/data/content';
import { RELEASE_URL } from '@/data/release';
import { useReducedMotion } from '@/components/lt/hooks';

/** The five groups, in page order: the sub-nav, the summary and the sections all read this. */
export const GROUPS = [
  { id: 'context', label: 'Context and tokens' },
  { id: 'files', label: 'Finding files' },
  { id: 'accuracy', label: 'Accuracy of answers' },
  { id: 'speed', label: 'Speed' },
  { id: 'mapping', label: 'Mapping' },
] as const;
export type GroupId = (typeof GROUPS)[number]['id'];
/** The in-page link to a group. Built, not written as a literal, because the ids are typed from GROUPS (the link gate reads literal hrefs only). */
export const toGroup = (id: GroupId) => '#'.concat(id);

/** The site nav, as the landing draws it, with links that leave this page for the landing's sections. */
export function BenchNav() {
  return (
    <header className="lt-nav">
      <div className="lt-wrap-wide flex h-14 items-center gap-3">
        <a href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Sequence home">
          <BrandMark className="h-[22px] w-[22px] text-[color:var(--lt-ink)]" />
          <span className="text-[15px] font-semibold tracking-tight">Sequence</span>
        </a>
        <nav className="ml-6 hidden items-center gap-0.5 md:flex" aria-label="Primary">
          <a href="/" className="lt-navlink">
            Product
          </a>
          <a href="benchmarks.html" className="lt-navlink is-current" aria-current="page">
            Benchmarks
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href={PUBLIC_MIRROR} className="lt-navlink hidden sm:inline">
            GitHub
          </a>
          <a href={RELEASE_URL} className="lt-btn lt-btn-ink !min-h-[34px] !px-4 !text-[13.5px]">
            Download
          </a>
        </div>
      </div>
    </header>
  );
}

/** uiarc-style segmented pills under the nav; the pill of the section in view is lit. */
export function SubNav() {
  const [active, setActive] = useState<GroupId>('context');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map<string, boolean>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = GROUPS.find((g) => seen.get(g.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const g of GROUPS) {
      const el = document.getElementById(g.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);
  /* On a phone the pills scroll sideways: keep the lit one in view (scrolls the strip only, never the page). */
  const strip = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const nav = strip.current;
    const on = nav?.querySelector<HTMLElement>('.is-on');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
  }, [active, reduced]);
  return (
    <div className="bn-subnav">
      <nav ref={strip} className="bn-pills" aria-label="Benchmark groups">
        {GROUPS.map((g) => (
          <a key={g.id} href={toGroup(g.id)} className={`bn-pill ${active === g.id ? 'is-on' : ''}`} aria-current={active === g.id ? 'true' : undefined}>
            {g.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

export function Section({
  id,
  band = false,
  title,
  lede,
  children,
}: {
  id: GroupId;
  band?: boolean;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  const label = GROUPS.find((g) => g.id === id)!.label;
  return (
    <section id={id} className={`bn-section ${band ? 'is-band' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="lt-wrap">
        <p className="bn-kicker">
          <span>{label}</span>
          <span className="bn-kicker-dot" aria-hidden="true" />
          <span className="bn-kicker-muted">Measured on internal tests</span>
        </p>
        <h2 id={`${id}-title`} className="lt-h2 bn-h2">
          {title}
        </h2>
        <p className="lt-lede bn-lede">{lede}</p>
        {children}
      </div>
    </section>
  );
}

export type StatProps = { value: string; label: string; sub?: string; recheck?: string };

export function Stats({ items }: { items: readonly StatProps[] }) {
  return (
    <div className={`bn-stats is-${items.length}`}>
      {items.map((s) => (
        <div key={s.label} className="bn-stat">
          <p className="bn-stat-value">{s.value}</p>
          <p className="bn-stat-label">{s.label}</p>
          {s.sub ? <p className="bn-stat-sub">{s.sub}</p> : null}
          {s.recheck ? (
            <p className="bn-recheck">
              <span className="bn-recheck-dot" aria-hidden="true" />
              {s.recheck}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Small secondary facts under the headline stats, as soft pills. */
export function Facts({ items }: { items: readonly string[] }) {
  return (
    <ul className="bn-facts">
      {items.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}

/**
 * The illustration of a group, drawn by scroll as the landing draws it: 0 as
 * its top enters the bottom of the window, 1 once its middle reaches 45% of
 * the window, so it is finished while still in full view. One passive scroll
 * listener while it is near the viewport; React updates only past 0.01.
 * Reduced motion: the finished drawing. Not rendered under 640 px (CSS).
 */
const progressOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  const endTop = 0.45 * vh - r.height / 2;
  return Math.min(1, Math.max(0, (vh - r.top) / Math.max(1, vh - endTop)));
};

export function Art({ ratio, caption, render }: { ratio: readonly [number, number]; caption: string; render: (progress: number) => ReactNode }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof IntersectionObserver === 'undefined') return undefined;
    let last = -1;
    const apply = () => {
      const q = Math.round(progressOf(el) * 1000) / 1000;
      if (Math.abs(q - last) > 0.01 || ((q === 0 || q === 1) && q !== last)) {
        last = q;
        setP(q);
      }
    };
    let raf = 0;
    let on = false;
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          apply();
        });
    };
    const io = new IntersectionObserver(
      (entries) => {
        const near = entries.some((e) => e.isIntersecting);
        if (near && !on) {
          on = true;
          window.addEventListener('scroll', onScroll, { passive: true });
          window.addEventListener('resize', onScroll);
        } else if (!near && on) {
          on = false;
          window.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
        }
        apply();
      },
      { rootMargin: '10% 0px' },
    );
    io.observe(el);
    apply();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);
  return (
    <figure className="bn-art">
      <div className="bn-art-card">
        <div ref={ref} className="bn-art-frame" style={{ aspectRatio: `${ratio[0]} / ${ratio[1]}` }}>
          {render(reduced ? 1 : p)}
        </div>
      </div>
      <figcaption className="bn-art-cap">{caption}</figcaption>
    </figure>
  );
}

export type MethodRow = { k: string; v: ReactNode };

/** The collapsible Method: what was compared, n, noise, re-checks, and the source files (the only place paths appear). */
export function Method({ rows, sources }: { rows: readonly MethodRow[]; sources: readonly string[] }) {
  return (
    <details className="bn-method">
      <summary>
        <span>Method</span>
        <span className="bn-method-hint">What was compared, how many, how noisy, and the files</span>
      </summary>
      <dl className="bn-method-list">
        {rows.map((r) => (
          <div key={r.k}>
            <dt>{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
        <div>
          <dt>Source files</dt>
          <dd>
            <ul className="bn-sources">
              {sources.map((s) => (
                <li key={s}>
                  <code>{s}</code>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </details>
  );
}

export function BenchFooter() {
  return (
    <footer className="lt-footer" aria-label="Links">
      <div className="lt-wrap-wide flex flex-wrap items-center gap-x-8 gap-y-3 py-12">
        <a href="/" className="inline-flex items-center gap-2.5" aria-label="Sequence home">
          <BrandMark className="h-6 w-6 text-[color:var(--lt-ink)]" />
          <span className="text-[15px] font-semibold tracking-tight">Sequence</span>
        </a>
        <ul className="bn-footlinks">
          <li>
            <a href="/">Product</a>
          </li>
          <li>
            <a href={PUBLIC_MIRROR}>GitHub</a>
          </li>
          <li>
            <a href={RELEASE_URL}>Releases</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
