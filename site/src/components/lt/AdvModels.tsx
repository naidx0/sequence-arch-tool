import type { ReactNode } from 'react';
import { AdvChapter, Figure, useSeen } from '@/components/lt/Breakdown';
import { Reveal } from '@/components/lt/hooks';
import { DEPTH4, FIND_FILES, GRADE, RANKER, SHAPE } from '@/data/advantages';

/**
 * OUR MODELS. Owner, 2026-10-10: show how the drawing model, the architecture
 * model and the file-finding model work, with the token saving for search.
 * Three cards, each a small working diagram, what it does in one line, and
 * its measured number:
 *  - the drawing model: the whiteboard's stroke recognizer (packages/ink),
 *    boosted trees trained on the DiDi diagram set, sealed look 93.9%;
 *  - the architecture map: deterministic static analysis, no model guessing,
 *    15 of 15 labelled connections and none invented;
 *  - the file finder: the ranker behind find_files, 84.9% hit@5, named on the
 *    page only as a model we trained for this job (owner, second tour: say we
 *    trained it, nothing about its inside).
 * Then how the file finder ranks, in three plain steps.
 */
const BLUE = 'rgb(31, 79, 224)';
const INK = 'rgb(11, 12, 14)';
const MUTED = 'rgba(11, 12, 14, 0.4)';
const MONO = "ui-monospace, 'SFMono-Regular', Consolas, monospace";

function DrawingDiagram() {
  return (
    <svg viewBox="0 0 260 120" className="lt-model-svg" aria-hidden="true">
      {/* A rough hand-drawn loop… */}
      <path
        d="M22 34 C 40 24, 78 22, 100 30 C 108 46, 104 70, 102 88 C 80 96, 46 98, 24 92 C 18 74, 20 52, 26 30"
        fill="none"
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path d="M118 60 H 142" stroke={BLUE} strokeWidth={1.5} />
      <path d="M136 55 L142 60 L136 65" fill="none" stroke={BLUE} strokeWidth={1.5} />
      {/* …becomes a clean box. */}
      <rect x={156} y={30} width={84} height={60} rx={8} fill="rgba(31, 79, 224, 0.08)" stroke={BLUE} strokeWidth={1.5} />
      <text x={198} y={64} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
        box
      </text>
    </svg>
  );
}

/** Three lines of code, one of them the call, and the edge it becomes: the same light language as the other two cards. */
function MapDiagram() {
  const bars = [96, 0, 70];
  return (
    <svg viewBox="0 0 260 120" className="lt-model-svg" aria-hidden="true">
      <rect x={14} y={28} width={104} height={64} rx={8} fill="rgb(255, 255, 255)" stroke="rgba(11, 12, 14, 0.14)" />
      {bars.map((w, i) => (
        <g key={i}>
          <text x={24} y={50 + i * 15} fontFamily={MONO} fontSize={8.5} fill={i === 1 ? BLUE : MUTED}>
            {9 + i}
          </text>
          {i === 1 ? (
            <rect x={38} y={43 + i * 15} width={70} height={9} rx={3} fill="rgba(31, 79, 224, 0.14)" stroke={BLUE} strokeWidth={1} />
          ) : (
            <rect x={38} y={44.5 + i * 15} width={w * 0.7} height={6} rx={3} fill="rgba(11, 12, 14, 0.12)" />
          )}
        </g>
      ))}
      <path d="M118 62 H 142" stroke={BLUE} strokeWidth={1.5} />
      <path d="M136 57 L142 62 L136 67" fill="none" stroke={BLUE} strokeWidth={1.5} />
      <rect x={154} y={20} width={88} height={28} rx={7} fill="rgba(31, 79, 224, 0.08)" stroke={BLUE} strokeWidth={1.3} />
      <text x={198} y={38} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
        Orders
      </text>
      <rect x={154} y={76} width={88} height={28} rx={7} fill="rgba(31, 79, 224, 0.08)" stroke={BLUE} strokeWidth={1.3} />
      <text x={198} y={94} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
        Payments
      </text>
      <path d="M198 48 V 75" stroke={BLUE} strokeWidth={2} />
      <path d="M193.5 69.5 L198 75 L202.5 69.5" fill="none" stroke={BLUE} strokeWidth={2} />
      <circle cx={198} cy={60} r={3.2} fill="rgb(255, 255, 255)" stroke={BLUE} strokeWidth={1.3} />
    </svg>
  );
}

function RankerDiagram() {
  const dots: ReactNode[] = [];
  const picked = new Set([3, 12, 17, 26, 33]);
  for (let i = 0; i < 40; i += 1) {
    const x = 16 + (i % 8) * 15;
    const y = 18 + Math.floor(i / 8) * 18;
    dots.push(<circle key={i} cx={x} cy={y} r={4} fill={picked.has(i) ? BLUE : 'rgba(11, 12, 14, 0.14)'} />);
  }
  const bars = [92, 80, 66, 54, 44];
  return (
    <svg viewBox="0 0 260 120" className="lt-model-svg" aria-hidden="true">
      {dots}
      <path d="M134 60 H 154" stroke={BLUE} strokeWidth={1.5} />
      <path d="M148 55 L154 60 L148 65" fill="none" stroke={BLUE} strokeWidth={1.5} />
      {bars.map((w, i) => (
        <g key={i} transform={`translate(166 ${16 + i * 19})`}>
          <text x={0} y={9} fontSize={9} fontWeight={600} fill={MUTED}>
            {i + 1}
          </text>
          <rect x={12} y={1} width={w * 0.85} height={10} rx={3} fill={i === 0 ? BLUE : 'rgba(31, 79, 224, 0.45)'} />
        </g>
      ))}
    </svg>
  );
}

const MODELS = [
  {
    name: 'The drawing model',
    what: 'Turns a rough sketch on the whiteboard into clean boxes and arrows. Trained on thousands of hand-drawn diagrams.',
    value: `${SHAPE.accuracy.toFixed(1)}%`,
    label: `of strokes recognised on a fresh test set, ${SHAPE.wrongSnap.toFixed(1)}% wrong snaps`,
    Diagram: DrawingDiagram,
  },
  {
    name: 'The architecture map',
    what: 'Reads services and calls straight from code. Deterministic: every edge has a file and a line, nothing is guessed.',
    value: `${Math.round((GRADE.edgesFound / GRADE.edgesTruth) * 100)}%`,
    label: 'of hand-labelled connections found, none invented',
    Diagram: MapDiagram,
  },
  {
    name: 'The file finder',
    what: `A model we trained for this job. It ranks the files a question is about, and agents get the top ${FIND_FILES.k} before they search.`,
    value: `${RANKER.hitAt5[RANKER.hitAt5.length - 1]!.value.toFixed(1)}%`,
    label: `right file in the top five (grep ${Math.round(RANKER.hitAt5[0]!.value)}%), ${(((DEPTH4.readTokens - DEPTH4.answerTokens) / DEPTH4.readTokens) * 100).toFixed(1)}% fewer tokens`,
    Diagram: RankerDiagram,
  },
] as const;

/* A picture of the ranking, not its output: the question is the one the recordings hand to agents. */
const FIELD = 75;
const PICKS = [8, 19, 33, 51, 62];
const REASONS = [88, 76, 68, 60, 52];
const HIT_LABEL = ['grep', 'Our earlier picker', 'Our model'];

/**
 * HOW THE FILE FINDER RANKS, IN THREE STEPS (owner, second tour: "could use
 * some work"). A question; every file in the project, ranked by the model,
 * the best five lit; those five, each with a reason, inside the token budget.
 * Under it, how often a right file is in the top five against grep and the
 * picker before it. Draws once when seen; reduced motion shows the end.
 */
function RankFigure() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} className={`lt-rank ${seen ? 'is-seen' : ''}`}>
      <ol className="lt-rank-steps">
        <li className="lt-rank-step">
          <span className="lt-step-n">1</span>
          <p className="lt-rank-title">A question</p>
          <p className="lt-rank-q">“Make payments retry the charge once on a timeout.”</p>
        </li>
        <li className="lt-rank-step">
          <span className="lt-step-n">2</span>
          <p className="lt-rank-title">Every file, ranked by our model</p>
          <div className="lt-rank-field" aria-hidden="true">
            {Array.from({ length: FIELD }, (_, i) => {
              const k = PICKS.indexOf(i);
              return <i key={i} className={k >= 0 ? 'is-pick' : undefined} style={k >= 0 ? { ['--k' as string]: k } : undefined} />;
            })}
          </div>
        </li>
        <li className="lt-rank-step is-out">
          <span className="lt-step-n">3</span>
          <p className="lt-rank-title">The top {FIND_FILES.k}, each with a reason</p>
          <ul className="lt-rank-list" aria-hidden="true">
            {REASONS.map((w, i) => (
              <li key={w} style={{ ['--k' as string]: i }}>
                <b>{i + 1}</b>
                <span>
                  <i style={{ width: `${w}%` }} />
                  <i style={{ width: `${w - 24}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <p className="lt-rank-budget">In under {FIND_FILES.budgetTokens} tokens</p>
        </li>
      </ol>
      <div className="lt-rank-hits">
        <p className="lt-rank-hits-title">A right file in the top five, measured on internal tests</p>
        {RANKER.hitAt5.map((h, i) => (
          <div key={h.label} className={`lt-rank-hit ${i === RANKER.hitAt5.length - 1 ? 'is-seq' : ''}`} style={{ ['--k' as string]: i }}>
            <span className="lt-rank-hit-label">{HIT_LABEL[i] ?? h.label}</span>
            <span className="lt-rank-hit-track">
              <span style={{ width: `${h.value}%` }} />
            </span>
            <span className="lt-rank-hit-val">{h.value.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdvModels({ art }: { art?: ReactNode }) {
  return (
    <AdvChapter
      id="adv-models"
      kicker="Our models"
      title="Models built for this job."
      line="A drawing model, a map read from code and a file finder we trained for this job. Each was measured before it shipped, and all three run on your machine."
      art={art}
      band
    >
      <Reveal className="lt-models" delay={80}>
        {MODELS.map((m) => (
          <article key={m.name} className="lt-model">
            <m.Diagram />
            <h3 className="lt-model-name">{m.name}</h3>
            <p className="lt-model-what">{m.what}</p>
            <p className="lt-model-num">{m.value}</p>
            <p className="lt-model-label">{m.label}</p>
            <p className="lt-adv-stat-src">Measured on internal tests</p>
          </article>
        ))}
      </Reveal>
      <Reveal className="lt-adv-grid" delay={120}>
        <Figure title="How the file finder ranks" note="A model we trained for this job. Agents and the app’s own answers use the same one.">
          <RankFigure />
        </Figure>
      </Reveal>
    </AdvChapter>
  );
}
