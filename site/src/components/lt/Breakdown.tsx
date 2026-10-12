import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Reveal } from '@/components/lt/hooks';

/**
 * THE BREAKDOWN CHAPTERS' SHARED PARTS (Apple's "breakdown" sections): a short
 * headline and one line, the art slot, one precise figure, then a row of stat
 * cards on one grid. A stat card is the plain label above, the number, and a
 * tiny source line naming the file it was read from. Nothing under the number.
 */

/** True once the element is a quarter on screen; stays true. Drives the one-time bar and line draws. */
export function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          obs.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, seen];
}

export type Stat = {
  label: string;
  /** The other arm, shown in ink before the arrow. */
  from?: string;
  /** Sequence's number, in blue. */
  value: string;
  source: string;
};

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="lt-adv-stats">
      {stats.map((s) => (
        <div key={s.label} className="lt-adv-stat">
          <p className="lt-adv-stat-label">{s.label}</p>
          <p className="lt-adv-stat-num">
            {s.from ? (
              <>
                <span className="is-from">{s.from}</span>
                <span className="is-arrow" aria-label="to">
                  →
                </span>
              </>
            ) : null}
            <span className="is-to">{s.value}</span>
          </p>
          <p className="lt-adv-stat-src">{s.source}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * One advantage chapter. `art` is the illustrator's slot (site/src/components/
 * lt/art/<Name>Art): when it renders nothing the headline stands alone and
 * nothing is reserved for it.
 */
export function AdvChapter({
  id,
  kicker,
  title,
  line,
  art,
  band = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  line: string;
  art?: ReactNode;
  band?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`lt-adv ${band ? 'lt-band' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="lt-wrap-wide">
        <Reveal className="lt-adv-head">
          <p className="lt-kicker">{kicker}</p>
          <h2 id={`${id}-title`} className="lt-h2">
            {title}
          </h2>
          <p className="lt-lede lt-adv-line">{line}</p>
        </Reveal>
        {art ? <div className="lt-adv-art">{art}</div> : null}
        {children}
      </div>
    </section>
  );
}

/** A white figure panel with a small caption row: what is drawn, and against what. */
export function Figure({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <figure className={`lt-adv-fig ${className}`}>
      <figcaption className="lt-adv-fig-cap">
        <span className="lt-adv-fig-title">{title}</span>
        {note ? <span className="lt-adv-fig-note">{note}</span> : null}
      </figcaption>
      {children}
    </figure>
  );
}
