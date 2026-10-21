import type { ReactNode } from 'react';
import { AdvChapter, Figure, StatRow, useSeen } from '@/components/lt/Breakdown';
import { Reveal } from '@/components/lt/hooks';
import { DEPTH4, RELEASE_BANK, SCAN } from '@/data/advantages';

/**
 * SPEED, IN TIMES THAT WERE MEASURED. The sealed release bank's mean seconds
 * per answer after each kept change (linear scale, from zero), and three
 * smaller waits side by side: model calls per answer, the map from the cache,
 * and lookups to reach depth four. Bars draw once, by transform.
 */
function Bars({ rows, max, unit }: { rows: { label: string; value: number; text: string; seq?: boolean }[]; max: number; unit?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} className={`lt-hbars ${seen ? 'is-seen' : ''}`}>
      {rows.map((r, i) => (
        <div key={r.label} className="lt-hbar" style={{ ['--i' as string]: i }}>
          <p className="lt-hbar-label">{r.label}</p>
          <div className="lt-hbar-track">
            <span className={`lt-hbar-fill ${r.seq ? 'is-seq' : ''}`} style={{ width: `${Math.max((r.value / max) * 100, 0.8)}%` }} />
          </div>
          <p className={`lt-hbar-val ${r.seq ? 'is-seq' : ''}`}>
            {r.text}
            {unit ? <span>{unit}</span> : null}
          </p>
        </div>
      ))}
    </div>
  );
}

function Pair({ title, a, b, fmt }: { title: string; a: { label: string; v: number }; b: { label: string; v: number }; fmt: (n: number) => string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const max = Math.max(a.v, b.v);
  return (
    <div ref={ref} className={`lt-pair ${seen ? 'is-seen' : ''}`}>
      <p className="lt-pair-title">{title}</p>
      {[a, b].map((r, i) => (
        <div key={r.label} className="lt-pair-row" style={{ ['--i' as string]: i }}>
          <span className="lt-pair-label">{r.label}</span>
          <span className="lt-pair-track">
            <span className={`lt-pair-fill ${i ? 'is-seq' : ''}`} style={{ width: `${Math.max((r.v / max) * 100, 0.8)}%` }} />
          </span>
          <span className={`lt-pair-val ${i ? 'is-seq' : ''}`}>{fmt(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

/* Plain names for the five measurements, in order (RELEASE_BANK.points keeps the lab's). */
const SHORT = ['First measured', 'Knows “this” means the project', 'Knows a bare “it” too', 'Measured again', 'No resend to reword'];
const first = RELEASE_BANK.points[0]!;
const last = RELEASE_BANK.points[RELEASE_BANK.points.length - 1]!;
const s = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 1000).toFixed(2)} s`);

export function AdvSpeed({ art }: { art?: ReactNode }) {
  return (
    <AdvChapter
      id="adv-speed"
      kicker="Speed"
      title="Fewer steps to an answer."
      line="One call where a search takes one lookup per file, a map served from the cache, and answers that are not sent back to be reworded."
      art={art}
      band
    >
      <Reveal className="lt-adv-grid lt-speed-grid" delay={80}>
        <Figure title="Seconds per answer, change by change" note="A local model on an 8 GB GPU. From zero.">
          <Bars
            max={15}
            unit=" s"
            rows={RELEASE_BANK.points.map((p, i) => ({ label: SHORT[i] ?? p.label, value: p.seconds, text: p.seconds.toFixed(1), seq: i === RELEASE_BANK.points.length - 1 }))}
          />
        </Figure>
        <Figure title="Three waits, before and after" note="Grey: before, or grep. Blue: Sequence now.">
          <div className="lt-pairs">
            <Pair title="Model calls per answer" a={{ label: 'Before', v: RELEASE_BANK.callsBefore }} b={{ label: 'Now', v: RELEASE_BANK.callsAfter }} fmt={(n) => n.toFixed(2)} />
            <Pair title="Opening a large project again" a={{ label: 'First scan', v: SCAN.coldMs }} b={{ label: 'From cache', v: SCAN.cachedMs }} fmt={s} />
            <Pair title="Lookups for a four-hop question" a={{ label: 'grep', v: DEPTH4.grepLookups }} b={{ label: 'Sequence', v: DEPTH4.sequenceCalls }} fmt={(n) => String(n)} />
          </div>
        </Figure>
      </Reveal>
      <StatRow
        stats={[
          { label: 'Less time per answer', value: `${Math.round((1 - last.seconds / first.seconds) * 100)}%`, source: 'Measured on internal tests' },
          { label: 'Faster to reopen a large project, from the cache', value: `${Math.round(SCAN.coldMs / SCAN.cachedMs)}×`, source: 'Measured on internal tests' },
          { label: 'Lookups for a four-hop question, grep then Sequence', from: String(DEPTH4.grepLookups), value: String(DEPTH4.sequenceCalls), source: 'Measured on internal tests' },
        ]}
      />
    </AdvChapter>
  );
}
