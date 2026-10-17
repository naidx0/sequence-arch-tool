import { DEPTH_MEASURED, kTokens } from '@/components/DepthCharts';
import { Reveal } from '@/components/lt/hooks';

/**
 * THE MEASURED BREAKTHROUGH, AS ITS OWN CHAPTER. Two squares whose AREAS are
 * the two token counts at depth 4 (from DEPTH_MEASURED, nothing typed by
 * hand): what an agent reads opening every importer it finds, and the file
 * list Sequence returns for the same question.
 */
const rows = DEPTH_MEASURED.rows;
const last = rows[rows.length - 1]!;
const ratio = Math.round(last.bytesRead / last.bytesAnswer);
const BIG = 300;
const SMALL = BIG / Math.sqrt(last.bytesRead / last.bytesAnswer);

export function Tokens() {
  return (
    <section id="context" className="lt-chapter" aria-labelledby="context-title">
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="lt-kicker">Measured</p>
          <h2 id="context-title" className="lt-display">
            {ratio}× less context.
          </h2>
          <p className="lt-lede mx-auto mt-5 max-w-[38rem]">
            Every importer of {DEPTH_MEASURED.file}, four hops deep: {last.files} files. An agent that opens each one reads{' '}
            {kTokens(last.bytesRead)} tokens. Sequence answers with {kTokens(last.bytesAnswer)}.
          </p>
        </Reveal>
        <Reveal className="lt-squares" delay={120}>
          <figure className="m-0">
            <p className="lt-sq-label">An agent opening each file</p>
            <p className="lt-sq-num">{kTokens(last.bytesRead)} tokens</p>
            <svg viewBox={`0 0 ${BIG + 2} ${BIG + 2}`} className="lt-sq-big" role="img" aria-label={`A square whose area is ${kTokens(last.bytesRead)} tokens`}>
              <defs>
                <pattern id="lt-grid" width="15" height="15" patternUnits="userSpaceOnUse">
                  <path d="M15 0H0V15" fill="none" stroke="rgba(11,12,14,0.07)" />
                </pattern>
              </defs>
              <rect x="1" y="1" width={BIG} height={BIG} rx="10" fill="rgba(11,12,14,0.06)" stroke="rgba(11,12,14,0.22)" />
              <rect x="1" y="1" width={BIG} height={BIG} rx="10" fill="url(#lt-grid)" />
            </svg>
          </figure>
          <figure className="m-0">
            <p className="lt-sq-label">Sequence, one call</p>
            <p className="lt-sq-num text-[color:var(--lt-blue)]">{kTokens(last.bytesAnswer)} tokens</p>
            <svg viewBox={`0 0 ${BIG + 2} ${BIG + 2}`} className="lt-sq-big" role="img" aria-label={`A square whose area is ${kTokens(last.bytesAnswer)} tokens`}>
              <rect x="1" y="1" width={BIG} height={BIG} rx="10" fill="none" stroke="rgba(11,12,14,0.1)" strokeDasharray="4 6" />
              <rect x="1" y={1 + BIG - SMALL} width={SMALL} height={SMALL} rx="3" fill="rgb(31, 79, 224)" />
            </svg>
          </figure>
        </Reveal>
        <p className="lt-note mx-auto mt-8 max-w-[44rem] text-center">
          Square areas are to scale. Measured {DEPTH_MEASURED.date} on this repository with{' '}
          <code>tools/measure/importers-by-depth.py</code>; tokens are bytes divided by four.
        </p>
      </div>
    </section>
  );
}
