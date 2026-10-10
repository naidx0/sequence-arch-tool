import type { ReactNode } from 'react';
import { AdvChapter, Figure, StatRow, useSeen } from '@/components/lt/Breakdown';
import { Reveal } from '@/components/lt/hooks';
import { AGENT_AB, GRANITE, RELEASE_BANK, mean } from '@/data/advantages';

/**
 * ACCURACY, AS A PAIRED A/B. The same bash agent on the same 36 sealed
 * questions, once plain and once with Sequence: F1 of the files it named
 * against labels written from the source. Dumbbells on one linear scale from
 * zero, by kind of question and overall; then the replication on a second
 * model family. The cost is stated under the figure, not hidden.
 */
const SCALE = 0.45;
const pct = (v: number) => `${(v / SCALE) * 100}%`;
const plainAll = mean(AGENT_AB.plainF1);
const seqAll = mean(AGENT_AB.sequenceF1);

function Dumbbells() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const rows = [...AGENT_AB.byType.map((r) => ({ ...r, all: false })), { label: `All ${AGENT_AB.n} questions`, plain: plainAll, sequence: seqAll, all: true }];
  return (
    <div ref={ref} className={`lt-db ${seen ? 'is-seen' : ''}`}>
      <div className="lt-db-axis" aria-hidden="true">
        {[0, 0.1, 0.2, 0.3, 0.4].map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {t.toFixed(1)}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={r.label} className={`lt-db-row ${r.all ? 'is-all' : ''}`} style={{ ['--i' as string]: i }}>
          <p className="lt-db-label">{r.label}</p>
          <div className="lt-db-track">
            {[0.1, 0.2, 0.3, 0.4].map((t) => (
              <i key={t} className="lt-db-grid" style={{ left: pct(t) }} aria-hidden="true" />
            ))}
            <span className="lt-db-bar" style={{ left: pct(r.plain), width: `${((r.sequence - r.plain) / SCALE) * 100}%` }} />
            <span className="lt-db-dot is-plain" style={{ left: pct(r.plain) }} />
            <span className="lt-db-dot is-seq" style={{ left: pct(r.sequence) }} />
          </div>
          <p className="lt-db-val">
            <span>{r.plain.toFixed(2)}</span> → <b>{r.sequence.toFixed(2)}</b>
          </p>
        </div>
      ))}
    </div>
  );
}

function Twin() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} className={`lt-twin ${seen ? 'is-seen' : ''}`}>
      {[
        { label: 'Sequence as a tool', v: GRANITE.toolF1, seq: false },
        { label: 'The map in the prompt too', v: GRANITE.mapF1, seq: true },
      ].map((r, i) => (
        <div key={r.label} className="lt-twin-col" style={{ ['--i' as string]: i }}>
          <div className="lt-twin-track">
            <span className={`lt-twin-fill ${r.seq ? 'is-seq' : ''}`} style={{ height: `${(r.v / SCALE) * 100}%` }} />
            <p className={`lt-twin-val ${r.seq ? 'is-seq' : ''}`} style={{ bottom: `${(r.v / SCALE) * 100}%` }}>
              {r.v.toFixed(2)}
            </p>
          </div>
          <p className="lt-twin-label">{r.label}</p>
        </div>
      ))}
    </div>
  );
}

export function AdvAccuracy({ art }: { art?: ReactNode }) {
  const first = RELEASE_BANK.points[0]!;
  const last = RELEASE_BANK.points[RELEASE_BANK.points.length - 1]!;
  return (
    <AdvChapter
      id="adv-accuracy"
      kicker="Accuracy"
      title="Answers that cite the map."
      line="The same agent, the same model, the same sealed questions. With Sequence attached it names the right files more often, most of all for what breaks."
      art={art}
    >
      <Reveal className="lt-adv-grid lt-acc-grid" delay={80}>
        <Figure title={`Answer F1, without and with Sequence`} note={`The same agent and model on ${AGENT_AB.n} architecture questions. Grey: without. Blue: with.`}>
          <Dumbbells />
        </Figure>
        <Figure title="A second model family" note="The same questions. Answer F1.">
          <Twin />
        </Figure>
      </Reveal>
      <p className="lt-note lt-adv-caveat">With the map, a small model keeps working where it used to stop, so it spends more tokens per question.</p>
      <StatRow
        stats={[
          { label: 'Answer accuracy, the same agent with the map', value: `${(seqAll / plainAll).toFixed(1)}×`, source: 'Measured on internal tests' },
          { label: 'On a second model family, with the map in its prompt', value: `${(GRANITE.mapF1 / GRANITE.toolF1).toFixed(1)}×`, source: 'Measured on internal tests' },
          { label: 'Complete answers about a project', from: `${first.full}%`, value: `${last.full}%`, source: 'Measured on internal tests' },
        ]}
      />
    </AdvChapter>
  );
}
