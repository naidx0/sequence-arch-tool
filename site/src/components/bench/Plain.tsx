import { MODELS, N, PROJECTS, SOURCES, fmt, mean, pct, secs, times, tok } from '@/data/bench';
import { Columns, Dumbbell, HBars } from './Charts';
import { Method, Section, Stats } from './Parts';

/**
 * THE SHORT BENCHMARKS (owner, 2026-10-10: simplify). Five groups kept, each
 * with two or three headline results and at most one chart, every number
 * followed in the same sentence by what it measures. Nothing here types a
 * number: all of them come from N (site-bench.test.mjs checks that). The
 * longer sections in Sections.tsx are no longer used.
 */

const f2 = (n: number) => fmt(n, 2);
const steps = (max: number, n: number) => Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
const W = N.mapWindow;
const plainF1 = mean(N.abPlainF1);
const seqF1 = mean(N.abSeqF1);
const lastBank = N.bankSeconds.length - 1;

/** What F1 means, in words, shown once under the accuracy numbers. */
const SCORE = 'Answer score runs from 0 to 1 and measures how closely the files the agent names match the files a person labelled as correct.';

export function ShortContext() {
  return (
    <Section
      id="context"
      title="A fraction of the text the model has to read."
      lede="An agent usually learns a codebase by reading files into its context window, the amount of text a model can hold at once. Sequence answers from a map of the code instead."
    >
      <Stats
        items={[
          {
            value: times(N.readAllTokens, N.firstTokens),
            label: 'less text than reading every file that matches the question',
            sub: `On our own codebase, ${fmt(N.matchingFiles)} files matched one question. Reading them all is about ${tok(N.readAllTokens)} tokens (a token is roughly three quarters of a word). Sequence’s prompt for the same question is ${fmt(N.firstTokens)}.`,
          },
          {
            value: times(N.depthReadBytes, N.depthAnswerBytes),
            label: 'less text to list everything one change could break',
            sub: `${fmt(N.depthFiles)} files depend on one core file, four steps removed. Opening them all costs about ${tok(Math.round(N.depthReadBytes / 4))} tokens. The answer from the map is ${fmt(Math.round(N.depthAnswerBytes / 4))} tokens.`,
          },
        ]}
      />
      <div className="bn-grid is-2">
        <HBars
          title="Tokens sent to the model for one question"
          sub="Our own codebase. Sequence’s bar is too small to see at this scale, which is the point."
          ticks={steps(5_000_000, 5)}
          unit="Tokens sent to the model"
          tickFmt={(n) => (n === 0 ? '0' : `${fmt(n / 1_000_000)}M`)}
          rows={[
            { label: 'Read every matching file', value: N.readAllTokens, shown: tok(N.readAllTokens) },
            { label: 'grep, then read six files', value: N.grepSixTokens, shown: tok(N.grepSixTokens) },
            { label: 'Sequence', value: N.firstTokens, shown: fmt(N.firstTokens), tone: 'seq' },
          ]}
        />
        <Columns
          title="Bigger windows, same prompt"
          sub="One question on the sample shop. A reader that fills the window sends all of it. Sequence sends the same small slice every time."
          ticks={steps(W, 4)}
          unit="Tokens sent"
          tickFmt={(n) => (n === 0 ? '0' : tok(n))}
          xTitle="Size of the model’s context window, in tokens"
          legend={[
            { tone: 'base', label: 'Fill the window with source' },
            { tone: 'seq', label: 'Sequence' },
          ]}
          groups={N.windowBuckets.map((b) => ({
            label: tok(b),
            bars: [
              { value: b, shown: tok(b), tone: 'base' as const },
              { value: N.windowSeqTokens, shown: tok(N.windowSeqTokens), tone: 'seq' as const },
            ],
          }))}
        />
      </div>
    </Section>
  );
}

export function ShortFiles() {
  return (
    <Section
      id="files"
      band
      title="The right file, found quickly."
      lede="Before an agent can change code it has to find it. A small model we trained picks which files to open and hands the agent only those."
    >
      <Stats
        items={[
          {
            value: `${fmt(N.hitRanker, 1)}%`,
            label: 'of questions had a file the real fix changed among the top five picks',
            sub: `Tested on ${N.sealedRepos} repositories the model never saw while training.`,
          },
          {
            value: `${fmt(N.hitGrep, 1)}%`,
            label: 'for plain grep search on the same questions',
            sub: `The trained model finds a right file in the top five ${fmt(N.hitRanker - N.hitGrep, 1)} percentage points more often.`,
          },
        ]}
      />
      <div className="bn-grid is-2">
        <HBars
          title="A right file among the top five picks"
          sub={`Share of questions, across ${N.sealedRepos} repositories held out from training.`}
          ticks={steps(100, 4)}
          unit="Questions with a right file in the top five (%)"
          tickFmt={(n) => fmt(n)}
          rows={[
            { label: 'grep over file contents', value: N.hitGrep, shown: `${fmt(N.hitGrep, 1)}%` },
            { label: 'The simpler picker before', value: N.hitBefore, shown: `${fmt(N.hitBefore, 1)}%`, tone: 'soft' },
            { label: 'Trained model', value: N.hitRanker, shown: `${fmt(N.hitRanker, 1)}%`, tone: 'seq' },
          ]}
        />
      </div>
    </Section>
  );
}

export function ShortAccuracy() {
  const last = N.bankFull.length - 1;
  return (
    <Section
      id="accuracy"
      title="Better answers from the same model."
      lede={`We gave the same small local model ${N.abN} architecture questions that people had answered by hand, once on its own and once with Sequence. Nothing else changed.`}
    >
      <Stats
        items={[
          {
            value: times(seqF1, plainF1),
            label: 'higher answer score with Sequence',
            sub: `The average score went from ${fmt(plainF1, 2)} to ${fmt(seqF1, 2)}. ${SCORE}`,
          },
          {
            value: times(N.typeBreaks[1], N.typeBreaks[0]),
            label: 'higher score on “what breaks if I change this?”',
            sub: `From ${f2(N.typeBreaks[0])} to ${f2(N.typeBreaks[1])}. This is the question plain search answers worst.`,
          },
          {
            value: `${N.bankFull[last]}%`,
            label: 'of product questions answered completely, up from the starting point',
            sub: `${N.bankFull[0]}% at the start, measured over ${N.bankTurns} fixed conversation turns. A complete answer covers what the product is, who it is for, how it works, what it needs and its limits.`,
          },
        ]}
      />
      <div className="bn-grid is-2">
        <Dumbbell
          title="Answer score by kind of question"
          sub="Same model, same questions, average of two runs each side."
          legend={['Without Sequence', 'With Sequence']}
          ticks={steps(0.4, 4)}
          unit="Answer score (0 to 1)"
          tickFmt={(n) => fmt(n, 1)}
          rows={[
            { label: 'Who calls it?', from: N.typeWhoCalls[0], to: N.typeWhoCalls[1], fromShown: f2(N.typeWhoCalls[0]), toShown: f2(N.typeWhoCalls[1]) },
            { label: 'What breaks if it changes?', from: N.typeBreaks[0], to: N.typeBreaks[1], fromShown: f2(N.typeBreaks[0]), toShown: f2(N.typeBreaks[1]) },
            { label: 'How does a request get there?', from: N.typePath[0], to: N.typePath[1], fromShown: f2(N.typePath[0]), toShown: f2(N.typePath[1]) },
          ]}
        />
      </div>
    </Section>
  );
}

export function ShortSpeed() {
  return (
    <Section
      id="speed"
      band
      title="Faster where it counts."
      lede="Answers got faster mostly by making fewer model calls, not by making each call faster."
    >
      <Stats
        items={[
          {
            value: times(N.bankSeconds[0]!, N.bankSeconds[lastBank]!),
            label: 'faster answers from a local model',
            sub: `From ${fmt(N.bankSeconds[0]!, 1)} seconds to ${fmt(N.bankSeconds[lastBank]!, 1)} seconds per answer, averaged over ${N.bankTurns} fixed conversation turns on one consumer graphics card.`,
          },
          {
            value: `${fmt(N.depthLookups)} → 1`,
            label: 'lookups for the deep dependency question',
            sub: `A search that follows imports four steps deep makes one lookup per file it finds, ${fmt(N.depthLookups)} in all here. Sequence answers from the map in one call. On a one-step lookup, grep is just as cheap.`,
          },
          {
            value: secs(N.scanColdMs[2]!),
            label: `to map a ${fmt(N.scanFiles[2]!)}-file codebase from scratch`,
            sub: `${secs(N.ownCachedMs)} when the map is already cached.`,
          },
        ]}
      />
      <div className="bn-grid is-2">
        <HBars
          title="Seconds per answer, after each change we kept"
          sub={`Average over the same ${N.bankTurns} conversation turns.`}
          ticks={steps(15, 3)}
          unit="Seconds per answer"
          tickFmt={(n) => fmt(n)}
          rows={[
            { label: 'Starting point', value: N.bankSeconds[0]!, shown: `${fmt(N.bankSeconds[0]!, 1)} s`, tone: 'soft' },
            { label: 'After five kept changes', value: N.bankSeconds[lastBank]!, shown: `${fmt(N.bankSeconds[lastBank]!, 1)} s`, tone: 'seq' },
          ]}
        />
      </div>
    </Section>
  );
}

export function ShortMapping() {
  return (
    <Section
      id="mapping"
      title="A map you can check."
      lede="Every connection on the map comes from a line of code. We grade it against connections that people labelled by hand."
    >
      <Stats
        items={[
          {
            value: `${N.edgesFound} of ${N.edgesTruth}`,
            label: 'hand-labelled connections between services found, and none invented',
            sub: `On the sample shop: ${N.edgePrecision}% of what the scan drew was real, and it found ${N.edgeRecall}% of the real ones, across web calls, queues and databases.`,
          },
          {
            value: `${N.fixtures} of ${N.fixtures}`,
            label: 'sample projects mapped in full',
            sub: 'Microservices, a single-page app, React Native, Flutter, a command-line tool, and Kubernetes and Helm setups.',
          },
        ]}
      />
    </Section>
  );
}

export function ShortHonest() {
  const own = N.fixGrep[0]!;
  const tokenRatio = times(mean(N.abSeqTokens), mean(N.abPlainTokens));
  return (
    <section className="bn-section" aria-labelledby="honest-title">
      <div className="lt-wrap">
        <p className="bn-kicker">
          <span>Where plain search still wins</span>
        </p>
        <h2 id="honest-title" className="lt-h2 bn-h2">
          Where Sequence does not win.
        </h2>
        <div className="bn-wins lt-glass">
          <ul>
            <li>{`On a simple one-step lookup, plain grep uses no more tokens than Sequence. The saving is on deep questions.`}</li>
            <li>{`Our first file picker lost to grep: when we replayed real history on ${PROJECTS.own.toLowerCase()}, grep found a changed file in the top five ${own}% of the time and the first picker ${N.fixFirstPicker[0]}%. The trained model replaced it.`}</li>
            <li>{`With Sequence the agent used ${tokenRatio} the tokens per question, because it kept working where the plain agent stopped after one command.`}</li>
            <li>{`On the smallest project, the sample shop, the agent’s answer score did not improve (${f2(N.abShopF1[0])} before, ${f2(N.abShopF1[1])} after).`}</li>
          </ul>
        </div>
        <p className="lt-note bn-note-pad">
          Every figure comes from internal tests: sealed question sets that were frozen before scoring, before-and-after runs on the
          same questions, and a small model running locally on one graphics card. Change one thing, measure it twice.
        </p>
        <Method
          sources={[...SOURCES.context, ...SOURCES.files, ...SOURCES.accuracy, ...SOURCES.speed, ...SOURCES.mapping]}
          rows={[
            { k: 'Compared', v: 'Tokens are counted as characters divided by four; no model was called for the token tests. File picking is scored as whether a file the real fix edited is in the top five. Answer score is the F1 of the files an agent names against hand labels.' },
            { k: 'Set', v: `${MODELS.set}.` },
            { k: 'Models', v: `${MODELS.small}; replication on ${MODELS.other}; ${MODELS.gpu}.` },
            { k: 'Projects', v: MODELS.projects },
            { k: 'Keep rule', v: 'A change stays only if it wins by more than two standard errors and costs nothing elsewhere.' },
            { k: 'Share of the window', v: `One question’s slice of the map is ${pct(N.scopedPromptTokens / W)} of a ${tok(W)}-token window.` },
          ]}
        />
      </div>
    </section>
  );
}
