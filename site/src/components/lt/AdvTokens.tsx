import type { ReactNode } from 'react';
import { AdvChapter, Figure, StatRow } from '@/components/lt/Breakdown';
import { Reveal } from '@/components/lt/hooks';
import { BIG_REPO, DEPTH4, fmt, kTok } from '@/data/advantages';

/**
 * WHERE THE MODELS SAVE TOKENS. Owner, 2026-10-10: "I like the 327… we saved
 * 900,000 tokens… big numbers", and no repository paths. One figure, to
 * scale: one deep dependency question as square AREAS, reading every related
 * file against Sequence's answer, with the corner enlarged eight times so the
 * answer can be seen at all. (The four-window-sizes figure went on the second
 * tour, 17:56.) The numbers are DEPTH_MEASURED's depth-4 row and the
 * big-repository bench.
 */
const READ = DEPTH4.readTokens;
const ANSWER = DEPTH4.answerTokens;
const SAVED = READ - ANSWER;
const GREP_BIG = BIG_REPO.rows.find((r) => r.id === 'grep')!.tokens;
const SEQ_BIG = BIG_REPO.rows.find((r) => r.id === 'seq')!.tokens;
const SWATCH = ['rgba(11, 12, 14, 0.06)', 'rgb(31, 79, 224)'];

function Squares() {
  const S = 280;
  const Y1 = 296;
  const Z = 8;
  const corner = 34;
  const IS = corner * Z;
  const IX = 340;
  const sd = S * Math.sqrt(ANSWER / READ);
  return (
    <svg className="lt-sq-svg" viewBox="0 0 620 300" role="img" aria-label={`Square areas to scale: reading every related file, ${fmt(READ)} tokens; Sequence's answer, ${fmt(ANSWER)} tokens.`}>
      <defs>
        <pattern id="adv-grid" width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M14 0H0V14" fill="none" stroke="rgba(11, 12, 14, 0.06)" />
        </pattern>
      </defs>
      <rect x={1} y={Y1 - S} width={S} height={S} rx={8} fill={SWATCH[0]} stroke="rgba(11, 12, 14, 0.2)" />
      <rect x={1} y={Y1 - S} width={S} height={S} rx={8} fill="url(#adv-grid)" />
      <text x={20} y={Y1 - S + 40} className="lt-svg-big">
        {kTok(READ)}
      </text>
      <text x={20} y={Y1 - S + 62} className="lt-svg-small">
        tokens, every related file
      </text>
      <rect x={1} y={Y1 - sd} width={sd} height={sd} fill={SWATCH[1]} />
      <rect x={1} y={Y1 - corner} width={corner} height={corner} fill="none" stroke="rgb(31, 79, 224)" strokeWidth={1.2} strokeDasharray="3 3" />
      <path d={`M${1 + corner} ${Y1 - corner} L${IX} ${Y1 - IS} M${1 + corner} ${Y1} L${IX} ${Y1}`} stroke="rgba(31, 79, 224, 0.4)" strokeWidth={1} fill="none" />
      <rect x={IX} y={Y1 - IS} width={IS} height={IS} rx={10} fill="rgb(255, 255, 255)" stroke="rgba(31, 79, 224, 0.5)" />
      <rect x={IX} y={Y1 - sd * Z} width={sd * Z} height={sd * Z} rx={3} fill={SWATCH[1]} />
      <text x={IX + sd * Z + 16} y={Y1 - 34} className="lt-svg-big is-seq">
        {`${(ANSWER / 1000).toFixed(1)}k`}
      </text>
      <text x={IX + sd * Z + 16} y={Y1 - 14} className="lt-svg-small">
        tokens, Sequence
      </text>
      <rect x={IX + IS - 52} y={Y1 - IS + 12} width={40} height={22} rx={11} fill="rgba(31, 79, 224, 0.08)" stroke="rgba(31, 79, 224, 0.4)" />
      <text x={IX + IS - 32} y={Y1 - IS + 27.5} textAnchor="middle" className="lt-svg-badge">
        {Z}×
      </text>
    </svg>
  );
}

export function AdvTokens({ art }: { art?: ReactNode }) {
  return (
    <AdvChapter
      id="adv-tokens"
      kicker="Where models save tokens"
      title={`${DEPTH4.ratio}× less context.`}
      line="The agent reads the map, not the tree. It asks Sequence first, then opens only the few files it is given, so the window stays free for the work."
      art={art}
    >
      <Reveal className="lt-adv-grid lt-tok-one" delay={80}>
        <Figure title="One deep dependency question" note="Every file it reaches, four hops out. Areas to scale.">
          <div className="lt-sq-fig">
            <Squares />
          </div>
        </Figure>
      </Reveal>
      <StatRow
        stats={[
          { label: 'Tokens saved on that one question', value: `${Math.round(SAVED / 1000)}k`, source: 'Measured on internal tests' },
          { label: 'Fewer tokens than reading every related file', value: `${((SAVED / READ) * 100).toFixed(1)}%`, source: 'Measured on internal tests' },
          { label: `Tokens for one question across ${fmt(BIG_REPO.filesSearched)} files, grep then Sequence`, from: kTok(GREP_BIG), value: fmt(SEQ_BIG), source: 'Measured on internal tests' },
        ]}
      />
    </AdvChapter>
  );
}
