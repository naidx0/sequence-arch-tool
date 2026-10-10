import { Reveal } from '@/components/lt/hooks';
import { AGENT_AB, DEPTH4, GRADE, RANKER, RELEASE_BANK, mean } from '@/data/advantages';

/**
 * THE BREAKDOWN, AT A GLANCE: five cards on one grid, one per advantage, each
 * a measured number with what it was measured against in its label. Each card
 * opens its chapter below.
 */
const first = RELEASE_BANK.points[0]!;
const last = RELEASE_BANK.points[RELEASE_BANK.points.length - 1]!;
const f1Ratio = mean(AGENT_AB.sequenceF1) / mean(AGENT_AB.plainF1);
const trained = RANKER.hitAt5[RANKER.hitAt5.length - 1]!;
const grep = RANKER.hitAt5[0]!;
const INTERNAL = 'Measured on internal tests';

/* Owner, 2026-10-10: big numbers (multiples, percentages, tokens saved), not raw counts from repositories a reader has never seen. */
const CARDS = [
  {
    href: '#adv-system',
    area: 'System design',
    label: 'Of hand-labelled service connections found in code, none invented',
    value: `${Math.round((GRADE.edgesFound / GRADE.edgesTruth) * 100)}%`,
  },
  {
    href: '#adv-tokens',
    area: 'Tokens',
    label: `Less context: ${Math.round((DEPTH4.readTokens - DEPTH4.answerTokens) / 1000)}k tokens saved on one deep question`,
    value: `${DEPTH4.ratio}×`,
  },
  {
    href: '#adv-speed',
    area: 'Speed',
    label: 'Less time per answer on a local model',
    value: `${Math.round((1 - last.seconds / first.seconds) * 100)}%`,
  },
  {
    href: '#adv-accuracy',
    area: 'Accuracy',
    label: 'Answer accuracy, the same agent with the map',
    value: `${f1Ratio.toFixed(1)}×`,
  },
  {
    href: '#adv-models',
    area: 'Our models',
    label: `The right file in the top five, against ${Math.round(grep.value)}% for grep`,
    value: `${trained.value.toFixed(1)}%`,
  },
] as const;

export function AdvIndex() {
  return (
    <section id="breakdown" className="lt-adv lt-adv-index" aria-labelledby="breakdown-title">
      <div className="lt-wrap-wide">
        <Reveal className="lt-adv-head">
          <p className="lt-kicker">The breakdown</p>
          <h2 id="breakdown-title" className="lt-h2">
            Where Sequence stands out.
          </h2>
          <p className="lt-lede lt-adv-line">Five advantages, each one measured.</p>
        </Reveal>
        <Reveal className="lt-adv-cards" delay={100}>
          {CARDS.map((c) => (
            <a key={c.href} href={c.href} className="lt-adv-card">
              <p className="lt-adv-card-area">{c.area}</p>
              <p className="lt-adv-card-label">{c.label}</p>
              <p className="lt-adv-card-num">{c.value}</p>
              <p className="lt-adv-card-src">{INTERNAL}</p>
              <span className="lt-adv-card-go" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3.5v9M3.5 8 8 12.5 12.5 8" />
                </svg>
              </span>
            </a>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
