import { AccuracyArt, ModelsArt, SpeedArt, SystemDesignArt, TokensArt } from '@/components/lt/art';
import {
  BANK_STEPS,
  MODELS,
  N,
  PROJECTS,
  RECHECK,
  SOURCES,
  bytesToTokens,
  fmt,
  mean,
  pct,
  secs,
  sum,
  times,
  tok,
} from '@/data/bench';
import { Columns, DotStrip, Dumbbell, HBars } from './Charts';
import { Art, Facts, GROUPS, Method, Section, Stats, toGroup } from './Parts';

/* Everything on this page is computed from N; nothing below types a number. */
const RE_DATE = new Date(`${RECHECK.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const reChecked = (s: string) => `Re-checked ${RE_DATE}: ${s}`;
const f2 = (n: number) => fmt(n, 2);
const f3 = (n: number) => fmt(n, 3);
const se = (delta: number, err: number) => fmt(delta / err, 1);
const range = (xs: readonly number[]) => Math.max(...xs) - Math.min(...xs);
const steps = (max: number, n: number) => Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
const W = N.mapWindow;

const plainF1 = mean(N.abPlainF1);
const seqF1 = mean(N.abSeqF1);
const gridMap = sum(N.gridMapCorrect);
const gridView = sum(N.gridCorrect);
const gridN = sum(N.gridQuestions);
const ownFiles = N.scanFiles[2]!;

/* ── THE SUMMARY UNDER THE HERO: each group's lead number ───────────────── */
export const LEADS = [
  { id: 'context', value: times(N.readAllTokens, N.firstTokens), label: 'fewer tokens than reading every matching file' },
  { id: 'files', value: `${fmt(N.hitRanker, 1)}%`, label: 'of questions get a right file in the top five' },
  { id: 'accuracy', value: times(seqF1, plainF1), label: 'answer accuracy for the same small agent' },
  { id: 'speed', value: times(N.bankSeconds[0]!, N.bankSeconds[N.bankSeconds.length - 1]!), label: 'faster answers from a local model' },
  { id: 'mapping', value: `${N.edgesFound}/${N.edgesTruth}`, label: 'hand-labelled connections found, none invented' },
] as const;

export function Summary() {
  return (
    <div className="bn-summary" role="list">
      {LEADS.map((l) => (
        <a key={l.id} href={toGroup(l.id)} className="bn-lead" role="listitem">
          <span className="bn-lead-group">{GROUPS.find((g) => g.id === l.id)!.label}</span>
          <span className="bn-lead-value">{l.value}</span>
          <span className="bn-lead-label">{l.label}</span>
        </a>
      ))}
    </div>
  );
}

/* ── 1. CONTEXT AND TOKENS ──────────────────────────────────────────────── */
export function ContextSection() {
  const depthRead = bytesToTokens(N.depthReadBytes);
  const depthAns = bytesToTokens(N.depthAnswerBytes);
  const small = N.windowBuckets[0]!;
  return (
    <Section
      id="context"
      title="A fraction of the context."
      lede="An agent usually learns a codebase by reading files into its context window. Sequence answers from a map of the code instead, so the prompt stays small however large the repository is."
    >
      <Stats
        items={[
          {
            value: times(N.readAllTokens, N.firstTokens),
            label: 'fewer tokens than reading every file that matches the question',
            sub: `On our own codebase, ${fmt(N.matchingFiles)} of ${fmt(N.filesSearched)} files matched one question: ${tok(N.readAllTokens)} tokens to read, against ${fmt(N.firstTokens)} for Sequence’s prompt.`,
            recheck: reChecked(`${times(N.rrReadAllTokens, N.rrFirstTokens)} on a clean ${fmt(N.rrFilesListed)}-file checkout.`),
          },
          {
            value: times(N.depthReadBytes, N.depthAnswerBytes),
            label: 'fewer tokens to list everything one change could break',
            sub: `${fmt(N.depthFiles)} files depend on one core file, four levels deep. Opening them costs ${tok(depthRead)} tokens; the answer from the map is ${fmt(depthAns)}.`,
            recheck: reChecked(`${times(N.rrDepthReadBytes, N.rrDepthAnswerBytes)} on today’s larger tree, ${fmt(N.rrDepthFiles)} files.`),
          },
          {
            value: pct(N.windowSeqTokens / W),
            label: `of a ${tok(W)} context window, at every window size`,
            sub: `${fmt(N.windowSeqTokens)} tokens for one question whether the window holds ${tok(small)} or ${tok(W)}. Filling the window instead sends ${times(small, N.windowSeqTokens)} to ${times(W, N.windowSeqTokens)} as much.`,
            recheck: reChecked(`${fmt(N.rrWindowSeqTokens)} tokens.`),
          },
        ]}
      />
      <Facts
        items={[
          `${times(N.grepSixTokens, N.firstTokens)} fewer tokens than grep plus reading its top six files`,
          `A follow-up question costs ${pct(1 - N.followTokens / N.firstTokens, 0)} less than the first`,
          `The whole map of a ${fmt(ownFiles)}-file codebase is ${pct(N.wholeMapTokens / W)} of a window; one question’s slice is ${pct(N.scopedPromptTokens / W)}`,
        ]}
      />
      <div className="bn-grid is-2">
        <HBars
          title="Tokens to answer one question"
          sub={`Our own codebase, linear scale. Sequence’s bar is ${pct(N.firstTokens / N.readAllTokens, 2)} of the first one: a hairline.`}
          ticks={steps(5_000_000, 5)}
          unit="Tokens sent to the model"
          tickFmt={(n) => (n === 0 ? '0' : `${fmt(n / 1_000_000)}M`)}
          rows={[
            { label: 'Read every matching file', value: N.readAllTokens, shown: tok(N.readAllTokens) },
            { label: 'grep, then read six files', value: N.grepSixTokens, shown: tok(N.grepSixTokens) },
            { label: 'Sequence', value: N.firstTokens, shown: fmt(N.firstTokens), tone: 'seq' },
          ]}
        />
        <HBars
          title="The same question, zoomed in"
          sub={`The two smallest bars from the left, on an axis ${times(5_000_000, 20_000)} shorter, with a follow-up added.`}
          ticks={steps(20_000, 4)}
          unit="Tokens sent to the model"
          tickFmt={(n) => (n === 0 ? '0' : `${fmt(n / 1000)}k`)}
          rows={[
            { label: 'grep, then read six files', value: N.grepSixTokens, shown: fmt(N.grepSixTokens) },
            { label: 'Sequence, first question', value: N.firstTokens, shown: fmt(N.firstTokens), tone: 'seq' },
            { label: 'Sequence, follow-up', value: N.followTokens, shown: fmt(N.followTokens), tone: 'seq' },
          ]}
        />
      </div>
      <div className="bn-grid is-2">
        <Columns
          title="Bigger windows, same prompt"
          sub="One question on the sample shop. A reader that fills the window sends all of it; Sequence sends the same slice of the map every time."
          ticks={steps(W, 4)}
          unit="Tokens sent"
          tickFmt={(n) => (n === 0 ? '0' : tok(n))}
          xTitle="Context window size"
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
        <HBars
          title="How much of the window"
          sub={`Share of a ${tok(W)} context window, our own codebase. A reader that fills the window uses all of it.`}
          ticks={steps(100, 4)}
          unit="Share of the context window (%)"
          tickFmt={(n) => fmt(n)}
          rows={[
            { label: 'Fill the window with source', value: 100, shown: pct(1, 0) },
            { label: 'The whole map', note: `${fmt(N.mapNodes)} boxes, ${fmt(N.mapEdges)} connections`, value: (N.wholeMapTokens / W) * 100, shown: pct(N.wholeMapTokens / W), tone: 'soft' },
            { label: 'One question’s slice of it', note: `${fmt(N.scopedPromptTokens)} tokens`, value: (N.scopedPromptTokens / W) * 100, shown: pct(N.scopedPromptTokens / W), tone: 'seq' },
          ]}
        />
      </div>
      <div className="bn-grid is-art-only">
        <Art
          ratio={[720, 420]}
          caption="Left, every file an agent opened to answer the depth question; right, the five the map sends it to instead. The meter under both is that measurement."
          render={(p) => (
            <TokensArt
              progress={p}
              readTokens={depthRead}
              answerTokens={depthAns}
              filesRead={N.depthFiles}
              sent={['command line', 'health check', 'entry point', 'grader', 'diagram command']}
            />
          )}
        />
      </div>
      <Method
        sources={SOURCES.context}
        rows={[
          { k: 'Compared', v: 'Tokens a model would be sent to answer, counted as characters divided by four. No model was called; the count is the prompt itself.' },
          {
            k: 'Questions',
            v: `One architecture question over our own codebase (the walk stops at ${fmt(N.filesSearched)} files); one question over the sample shop at ${N.windowBuckets.length} window sizes; one depth question: every file that imports a core file, ${fmt(N.depthFiles)} files at four levels.`,
          },
          { k: 'Noise', v: 'None run to run: the counts are deterministic for a given checkout. They move when the code moves, which is what the re-check shows.' },
          {
            k: 'Re-check',
            v: `${RE_DATE}, clean checkout, $0: read-all ${fmt(N.rrReadAllTokens)}, grep plus six files ${fmt(N.rrGrepSixTokens)}, first question ${fmt(N.rrFirstTokens)}, follow-up ${fmt(N.rrFollowTokens)} tokens (${fmt(N.rrMatchingFiles)} of ${fmt(N.rrFilesListed)} files matched); flat prompt ${fmt(N.rrWindowSeqTokens)}; depth four ${fmt(N.rrDepthFiles)} files, ${fmt(N.rrDepthLookups)} lookups.`,
          },
        ]}
      />
    </Section>
  );
}

/* ── 2. FINDING FILES ───────────────────────────────────────────────────── */
export function FilesSection() {
  return (
    <Section
      id="files"
      band
      title="The right file in the top five."
      lede="Before an agent can change code it has to find it. A trained ranker picks which files to open, and hands the agent only those."
    >
      <Stats
        items={[
          {
            value: `${fmt(N.hitRanker, 1)}%`,
            label: 'of questions had a file the real fix edited in the top five',
            sub: `Measured on ${N.sealedRepos} sealed repositories the ranker never trained on.`,
          },
          {
            value: times(N.hitRanker, N.hitGrep),
            label: 'the hit rate of grep over file contents',
            sub: `grep finds one in the top five ${fmt(N.hitGrep, 1)}% of the time: ${fmt(N.hitRanker - N.hitGrep, 1)} points behind.`,
          },
          {
            value: `+${fmt(N.hitRanker - N.hitBefore, 1)}`,
            label: 'points over the picker it replaced',
            sub: `The hand-tuned picker before it reached ${fmt(N.hitBefore, 1)}%.`,
          },
        ]}
      />
      <Facts
        items={[
          `Answers in at most ${fmt(N.findBudget)} tokens: the top ${N.findK} files, each with a reason and a snippet`,
          `Re-ranks about ${N.rankerCandidates} candidate files per question`,
          'Learns from your own edits on top',
        ]}
      />
      <div className="bn-grid is-2">
        <HBars
          title="A right file in the top five"
          sub={`Share of questions, ${N.sealedRepos} sealed repositories.`}
          ticks={steps(100, 4)}
          unit="Questions with a right file in the top five (%)"
          tickFmt={(n) => fmt(n)}
          rows={[
            { label: 'grep over file contents', value: N.hitGrep, shown: `${fmt(N.hitGrep, 1)}%` },
            { label: 'The picker before', value: N.hitBefore, shown: `${fmt(N.hitBefore, 1)}%`, tone: 'soft' },
            { label: 'Trained ranker', value: N.hitRanker, shown: `${fmt(N.hitRanker, 1)}%`, tone: 'seq' },
          ]}
        />
        <HBars
          title="What we got wrong first"
          sub={`Replaying real history (${fmt(N.fixCommits[0]!)} and ${fmt(N.fixCommits[1]!)} commits): the commit message was the question, the files it changed the answer. Our first picker read only file names and lost to grep, which is why the trained ranker exists.`}
          ticks={steps(100, 4)}
          unit="Commits with a changed file in the top five (%)"
          tickFmt={(n) => fmt(n)}
          rows={[
            { label: 'grep', note: PROJECTS.own, value: N.fixGrep[0]!, shown: `${N.fixGrep[0]}%` },
            { label: 'First picker', note: PROJECTS.own, value: N.fixFirstPicker[0]!, shown: `${N.fixFirstPicker[0]}%`, tone: 'soft' },
            { label: 'grep', note: PROJECTS.ml, value: N.fixGrep[1]!, shown: `${N.fixGrep[1]}%` },
            { label: 'First picker', note: PROJECTS.ml, value: N.fixFirstPicker[1]!, shown: `${N.fixFirstPicker[1]}%`, tone: 'soft' },
          ]}
        />
      </div>
      <div className="bn-grid is-art-only">
        <Art
          ratio={[720, 400]}
          caption="One map, any agent: Claude Code, Codex or a local model asks the same tools for its files."
          render={(p) => <ModelsArt progress={p} />}
        />
      </div>
      <Method
        sources={SOURCES.files}
        rows={[
          { k: 'Compared', v: 'Which five files each picker ranks first for a question; a hit is a file the real fix edited among them (hit@5).' },
          { k: 'Set', v: `${N.sealedRepos} sealed repositories, held out from training. The ranker is a gradient-boosted model over about ${N.rankerCandidates} candidates per question from text search, path words, recent changes and similar past commits.` },
          { k: 'History replay', v: `${fmt(N.fixCommits[0]!)} commits of our own codebase and ${fmt(N.fixCommits[1]!)} of an ML research project; every picker saw only the code from before those commits, and the test was registered in the lab log before it ran.` },
          { k: 'Not re-checked', v: 'The ranker study is frozen (it needs the sealed repositories); its figures are quoted from the ranker’s own source.' },
        ]}
      />
    </Section>
  );
}

/* ── 3. ACCURACY OF ANSWERS ─────────────────────────────────────────────── */
export function AccuracySection() {
  const strip = [
    { label: 'Small model, no Sequence', runs: N.abPlainF1, tone: 'base' as const },
    { label: 'Small model, with Sequence', runs: N.abSeqF1, tone: 'seq' as const },
    { label: 'Small model, Sequence tools', runs: N.qwenToolRuns, tone: 'soft' as const },
    { label: 'Small model, tools and map', runs: N.qwenMapRuns, tone: 'seq' as const },
    { label: 'Other model, Sequence tools', runs: N.graniteToolRuns, tone: 'soft' as const },
    { label: 'Other model, tools and map', runs: N.graniteMapRuns, tone: 'seq' as const },
  ].map((r) => ({ ...r, mean: mean(r.runs), meanShown: f3(mean(r.runs)) }));
  const spread = Math.max(...strip.map((r) => range(r.runs)));
  const last = N.bankFull.length - 1;
  return (
    <Section
      id="accuracy"
      title="Better answers from the same model."
      lede={`We gave the same small agent ${N.abN} hand-labelled architecture questions, once on its own and once with Sequence. Nothing else changed.`}
    >
      <Stats
        items={[
          {
            value: times(seqF1, plainF1),
            label: 'answer accuracy for the same agent with Sequence',
            sub: `F1 ${f3(plainF1)} → ${f3(seqF1)}: +${f3(N.abDelta)}, ${se(N.abDelta, N.abSE)} standard errors over ${N.abN} paired questions.`,
          },
          {
            value: times(N.typeBreaks[1], N.typeBreaks[0]),
            label: 'on “what breaks if I change this?”',
            sub: `F1 ${f2(N.typeBreaks[0])} → ${f2(N.typeBreaks[1])}: the question plain search answers worst.`,
          },
          {
            value: times(N.graniteMapF1, N.graniteToolF1),
            label: 'again on a second model family',
            sub: `With the map in the prompt: F1 ${f3(N.graniteToolF1)} → ${f3(N.graniteMapF1)}, ${fmt(N.graniteSeRatio, 1)} standard errors, three runs a side.`,
          },
          {
            value: times(N.bankFull[last]!, N.bankFull[0]!),
            label: 'complete answers to product questions',
            sub: `${N.bankFull[0]}% → ${N.bankFull[last]}% across ${N.bankTurns} sealed conversation turns.`,
          },
        ]}
      />
      <Facts
        items={[
          `It costs more: with Sequence the agent used ${times(mean(N.abSeqTokens), mean(N.abPlainTokens))} the tokens per question, because the plain agent mostly stopped after one command`,
          `No gain on the sample shop (F1 ${f2(N.abShopF1[0])} → ${f2(N.abShopF1[1])}); the gain came from the larger projects`,
        ]}
      />
      <div className="bn-grid is-2">
        <Dumbbell
          title="By kind of question, and by project"
          sub="Same agent, same questions; mean of two runs each side. The smallest project gained nothing."
          legend={['Same agent, no Sequence', 'With Sequence']}
          ticks={steps(0.4, 4)}
          unit="Answer accuracy (F1, 0 to 1)"
          tickFmt={(n) => fmt(n, 1)}
          rows={[
            { label: 'Who calls it?', note: 'Question', from: N.typeWhoCalls[0], to: N.typeWhoCalls[1], fromShown: f2(N.typeWhoCalls[0]), toShown: f2(N.typeWhoCalls[1]) },
            { label: 'What breaks if it changes?', note: 'Question', from: N.typeBreaks[0], to: N.typeBreaks[1], fromShown: f2(N.typeBreaks[0]), toShown: f2(N.typeBreaks[1]) },
            { label: 'How does a request get there?', note: 'Question', from: N.typePath[0], to: N.typePath[1], fromShown: f2(N.typePath[0]), toShown: f2(N.typePath[1]) },
            { label: PROJECTS.shop, note: 'Project', from: N.abShopF1[0], to: N.abShopF1[1], fromShown: f2(N.abShopF1[0]), toShown: f2(N.abShopF1[1]) },
            { label: PROJECTS.site, note: 'Project', from: N.abSiteF1[0], to: N.abSiteF1[1], fromShown: f2(N.abSiteF1[0]), toShown: f2(N.abSiteF1[1]) },
            { label: PROJECTS.ml, note: 'Project', from: N.abMlF1[0], to: N.abMlF1[1], fromShown: f2(N.abMlF1[0]), toShown: f2(N.abMlF1[1]) },
          ]}
        />
        <DotStrip
          title="Every run, not just the average"
          sub={`Each dot is one full pass over the ${N.abN} questions; the tick is the mean. Runs of one setup differ by up to ${f2(spread)} F1, so every result is paired and repeated.`}
          ticks={steps(0.5, 5)}
          unit="Answer accuracy (F1, 0 to 1)"
          tickFmt={(n) => fmt(n, 1)}
          rows={strip}
        />
      </div>
      <div className="bn-grid is-2">
        <HBars
          title="Complete answers, one kept change at a time"
          sub={`Share of ${N.bankTurns} sealed turns whose answer covers what the product is, who it is for, how it works, what it needs and its limits. Scored by rule.`}
          ticks={steps(100, 4)}
          unit="Complete answers (%)"
          tickFmt={(n) => fmt(n)}
          rows={BANK_STEPS.map((s, i) => ({ label: s, value: N.bankFull[i]!, shown: `${N.bankFull[i]}%`, tone: i === last ? ('seq' as const) : ('soft' as const) }))}
        />
        <HBars
          title="What the better answers cost"
          sub="Tokens per question, each run. The plain agent mostly gave up after one command; with the map it kept working, and spent more."
          ticks={steps(10_000, 4)}
          unit="Tokens per question"
          tickFmt={(n) => (n === 0 ? '0' : `${fmt(n / 1000, n % 1000 ? 1 : 0)}k`)}
          rows={[
            ...N.abPlainTokens.map((t, i) => ({ label: 'No Sequence', note: `Run ${i + 1}`, value: t, shown: fmt(t) })),
            ...N.abSeqTokens.map((t, i) => ({ label: 'With Sequence', note: `Run ${i + 1}`, value: t, shown: fmt(t), tone: 'seq' as const })),
          ]}
        />
      </div>
      <div className="bn-grid is-art-only">
        <Art
          ratio={[720, 400]}
          caption="A claim checked against the code: the call that is found turns solid with its file and line; the one that is not stays dashed."
          render={(p) => <AccuracyArt progress={p} />}
        />
      </div>
      <Method
        sources={SOURCES.accuracy}
        rows={[
          { k: 'Compared', v: 'One minimal command-line agent, read-only, on the same questions with the same prompt; the Sequence side adds one command that queries the map (who calls, what breaks, the path between).' },
          { k: 'Score', v: 'F1 of the files the agent names against hand labels, per question, paired. A change counts only if it wins by more than two standard errors (two and a half for the map-in-prompt runs).' },
          { k: 'Set', v: `${N.abN} questions over three projects, ${MODELS.set}.` },
          { k: 'Models', v: `${MODELS.small}; replication on ${MODELS.other}; ${MODELS.gpu}.` },
          { k: 'Runs', v: `Two runs a side for the first comparison; three a side, same day, interleaved, for the map-in-prompt runs (+${f3(N.qwenMapDelta)} at ${fmt(N.qwenMapSeRatio, 2)} standard errors on the small model; +${f3(N.graniteDelta)} at ${fmt(N.graniteSeRatio, 2)} on the other).` },
          { k: 'Not re-checked', v: 'These need hours on the GPU; the figures are from the logged runs.' },
        ]}
      />
    </Section>
  );
}

/* ── 4. SPEED ───────────────────────────────────────────────────────────── */
export function SpeedSection() {
  const lastI = N.bankSeconds.length - 1;
  const sizes = [PROJECTS.shop, PROJECTS.site, PROJECTS.own, PROJECTS.ml];
  const coldMax = Math.ceil(Math.max(...N.scanColdMs) / 2000) * 2000;
  const ownRuns = N.rrOwnPlainMs;
  return (
    <Section
      id="speed"
      band
      title="Faster where it counts."
      lede="Answers got faster by making fewer model calls, not faster ones. The map itself builds in seconds, and the board is up before you look for it."
    >
      <Stats
        items={[
          {
            value: times(N.bankSeconds[0]!, N.bankSeconds[lastI]!),
            label: 'faster answers from a local model',
            sub: `${fmt(N.bankSeconds[0]!, 1)} s → ${fmt(N.bankSeconds[lastI]!, 1)} s per answer, mean of ${N.bankTurns} turns on a consumer graphics card.`,
          },
          {
            value: pct(1 - N.callsAfter / N.callsBefore, 0),
            label: 'fewer model calls per answer',
            sub: `${fmt(N.callsBefore, 2)} → ${fmt(N.callsAfter, 2)}: finished answers are no longer sent back to be reshaped.`,
          },
          {
            value: times(N.depthLookups, 1),
            label: `fewer round trips: one call instead of ${fmt(N.depthLookups)} lookups`,
            sub: 'A search that follows imports four levels deep makes one lookup per file it finds. Sequence answers from the map in one call.',
            recheck: reChecked(`${fmt(N.rrDepthLookups)} lookups on today’s larger tree.`),
          },
          {
            value: secs(N.scanColdMs[2]!),
            label: `to map a ${fmt(ownFiles)}-file codebase from scratch`,
            sub: `${times(N.scanColdMs[2]!, N.ownCachedMs)} faster from the cache: ${secs(N.ownCachedMs)}.`,
            recheck: reChecked(`the sample shop maps in ${secs(N.rrShopColdMs)} cold, ${secs(N.rrShopCachedMs)} cached.`),
          },
        ]}
      />
      <Facts
        items={[
          `The board is on screen ${secs(N.firstBoardMs[0]!)} after the app is up on the sample shop (${N.firstBoardLo[0]}–${N.firstBoardHi[0]} ms) and ${secs(N.firstBoardMs[1]!)} on our own codebase (${N.firstBoardLo[1]}–${N.firstBoardHi[1]} ms)`,
          `About ${fmt(Math.round(ownFiles / (N.scanColdMs[2]! / 1000)), 0)} files a second on a cold scan`,
        ]}
      />
      <div className="bn-grid is-2">
        <HBars
          title="Seconds per answer, one kept change at a time"
          sub={`Mean over the same ${N.bankTurns} sealed turns after each change.`}
          ticks={steps(15, 3)}
          unit="Seconds per answer"
          tickFmt={(n) => fmt(n)}
          rows={BANK_STEPS.map((s, i) => ({ label: s, value: N.bankSeconds[i]!, shown: `${fmt(N.bankSeconds[i]!, 1)} s`, tone: i === lastI ? ('seq' as const) : ('soft' as const) }))}
        />
        <HBars
          title="Mapping a codebase from scratch"
          sub="Median of three runs with the cache off."
          ticks={steps(coldMax, 4)}
          unit="Seconds to map, cold"
          tickFmt={(n) => fmt(n / 1000)}
          rows={N.scanColdMs.map((ms, i) => ({ label: sizes[i]!, note: `${fmt(N.scanFiles[i]!)} files`, value: ms, shown: secs(ms), tone: 'seq' as const }))}
        />
      </div>
      <div className="bn-grid is-art-only">
        <Art
          ratio={[720, 400]}
          caption="One lookup per file found, drawn as a route through the repository, straightening into one call from the question to the answer."
          render={(p) => <SpeedArt progress={p} lookups={N.depthLookups} calls={1} />}
        />
      </div>
      <Method
        sources={SOURCES.speed}
        rows={[
          { k: 'Answers', v: `The release bank: ${N.bankTurns} sealed turns (${N.bankTurns / 2} conversations of two turns) on ${MODELS.small}, ${MODELS.gpu}. Each step is a change that was kept because it beat the one before by more than two standard errors.` },
          { k: 'Mapping', v: 'Wall clock for a full scan; cold is the median of three runs with the cache off, cached is the third plain run.' },
          {
            k: 'Cache',
            v: `Repeat scans of large codebases do not always hit the cache: ${N.mlCacheHits[0]} of ${N.mlCacheHits[1]} on the ML research project, and ${ownRuns.filter((ms) => ms < N.ownCachedMs * 4).length} of ${ownRuns.length} on our own codebase in the re-check (${ownRuns.map((ms) => secs(ms)).join(', ')}). That is open work.`,
          },
          { k: 'Board', v: 'Time from the app being up to the first box drawn, five runs on the sample shop and three on our own codebase; range in brackets.' },
        ]}
      />
    </Section>
  );
}

/* ── 5. MAPPING ─────────────────────────────────────────────────────────── */
export function MappingSection() {
  const gridRows = [PROJECTS.shop, PROJECTS.own, PROJECTS.ml].map((p, i) => ({
    label: p,
    note: `${N.gridQuestions[i]} questions`,
    from: (N.gridMapCorrect[i]! / N.gridQuestions[i]!) * 100,
    to: (N.gridCorrect[i]! / N.gridQuestions[i]!) * 100,
    fromShown: pct(N.gridMapCorrect[i]! / N.gridQuestions[i]!, 0),
    toShown: pct(N.gridCorrect[i]! / N.gridQuestions[i]!, 0),
  }));
  const hotRows = [PROJECTS.shop, PROJECTS.own, PROJECTS.ml].map((p, i) => ({
    label: p,
    note: `${N.hotQuestions[i]} questions`,
    from: (N.hotMapCorrect[i]! / N.hotQuestions[i]!) * 100,
    to: (N.hotCorrect[i]! / N.hotQuestions[i]!) * 100,
    fromShown: pct(N.hotMapCorrect[i]! / N.hotQuestions[i]!, 0),
    toShown: pct(N.hotCorrect[i]! / N.hotQuestions[i]!, 0),
  }));
  const pairs = N.chartWins + N.chartLosses + N.chartTies;
  return (
    <Section
      id="mapping"
      title="A map you can check."
      lede="Every connection on the map comes from a line of code. We grade it against connections labelled by hand, and we test whether people can read it."
    >
      <Stats
        items={[
          {
            value: `${N.edgesFound}/${N.edgesTruth}`,
            label: 'hand-labelled connections found, none invented',
            sub: `${N.edgePrecision}% precision, ${N.edgeRecall}% recall across HTTP, gRPC, queues and databases, with the planted traps avoided.`,
            recheck: reChecked(`${N.edgePrecision}% and ${N.edgeRecall}% again.`),
          },
          {
            value: `${N.fixtures}/${N.fixtures}`,
            label: 'sample projects mapped in full',
            sub: `Microservices, a single-page app, React Native, Flutter, a command-line tool, Kubernetes and Helm, at ${N.fixtureCoverage}% coverage.`,
            recheck: reChecked(`${N.rrGradeOk} of ${N.fixtures} again.`),
          },
          {
            value: `+${pct(gridView / gridMap - 1, 0)}`,
            label: 'more questions answered right from the Grid view',
            sub: `${gridView} against ${gridMap} of ${gridN} questions read off the screen, at the dense zoom where a map’s labels shrink.`,
          },
          {
            value: `${N.chartWins}–${N.chartLosses}`,
            label: 'for charts that name each hop',
            sub: `Judged on screenshots: ${N.chartWins} wins, ${N.chartLosses} losses and ${N.chartTies} ties over ${pairs} pairs.`,
          },
        ]}
      />
      <Facts
        items={[
          `Our own codebase: ${fmt(ownFiles)} files become ${fmt(N.mapNodes)} boxes and ${fmt(N.mapEdges)} connections`,
          `Every solid line carries the file and line it was found on`,
        ]}
      />
      <div className="bn-grid is-2">
        <Dumbbell
          title="Reading the board: Map against Grid"
          sub="Who depends on what, read off the screen by a scripted reader that sees only what is legible."
          legend={['Map view', 'Grid view']}
          ticks={steps(100, 4)}
          unit="Questions answered right (%)"
          tickFmt={(n) => fmt(n)}
          rows={gridRows}
        />
        <Dumbbell
          title="Finding the riskiest parts"
          sub="Which box is riskiest to edit: guessing from the lines drawn on the map, against the Hotspots view."
          legend={['Guess from the map', 'Hotspots view']}
          ticks={steps(100, 4)}
          unit="Questions answered right (%)"
          tickFmt={(n) => fmt(n)}
          rows={hotRows}
        />
      </div>
      <div className="bn-grid is-art-only">
        <Art
          ratio={[720, 420]}
          caption="Source files, the connections found in them with a file and line on each, and what breaks around one service when it changes."
          render={(p) => <SystemDesignArt progress={p} />}
        />
      </div>
      <Method
        sources={SOURCES.mapping}
        rows={[
          { k: 'Connections', v: `The sample shop's ${N.edgesTruth} service-to-service connections were labelled by hand from the source. The scan is graded against them; a found connection must match exactly, and the traps (a declared but unused dependency, an outside payment API, health routes that must not cross-match) must not appear.` },
          { k: 'Coverage', v: `${N.fixtures} small sample projects of different kinds; coverage is the share of each project's parts the map places.` },
          { k: 'Reading', v: 'A fixed parser reads the rendered page: a box counts only if its name is painted and not cut, a line only if both ends are on screen and it is not bundled with another. Questions are generated from the scan, not written by hand. Exact two-sided McNemar test per project; every project significant.' },
          { k: 'Projects', v: MODELS.projects },
        ]}
      />
    </Section>
  );
}

/* ── HOW WE MEASURE, AND WHERE SEARCH STILL WINS ────────────────────────── */
export function HowWeMeasure() {
  const cards = [
    { t: 'Sealed sets', d: 'Questions are written by a separate worker, frozen with a hash and scored once. A set that has been tuned on is spent.' },
    { t: 'Paired runs', d: 'Before and after run on the same questions. We report both values, the difference, the standard error and n.' },
    { t: 'A keep rule', d: 'A change stays only if it wins by more than two standard errors and costs nothing elsewhere. Losses are logged too.' },
    { t: 'Local and free', d: 'Answer tests run on a small local model on one consumer graphics card. The token and mapping tests make no model calls at all.' },
  ];
  const own = N.fixGrep[0]!;
  return (
    <section className="bn-section is-band" aria-labelledby="how-title">
      <div className="lt-wrap">
        <p className="bn-kicker">
          <span>How we measure</span>
        </p>
        <h2 id="how-title" className="lt-h2 bn-h2">
          Change one thing. Measure it twice.
        </h2>
        <div className="bn-how">
          {cards.map((c) => (
            <div key={c.t} className="bn-how-card lt-glass">
              <p className="bn-how-t">{c.t}</p>
              <p className="bn-how-d">{c.d}</p>
            </div>
          ))}
        </div>
        <div className="bn-wins lt-glass">
          <p className="bn-how-t">Where Sequence does not win</p>
          <ul>
            <li>{`On replayed history, grep found a changed file ${own}% of the time and our first picker ${N.fixFirstPicker[0]}%. The trained ranker replaced it.`}</li>
            <li>{`The agent with Sequence spends ${times(mean(N.abSeqTokens), mean(N.abPlainTokens))} the tokens per question. It keeps working where the plain agent gives up.`}</li>
            <li>{`On the smallest project the agent gained nothing (F1 ${f2(N.abShopF1[0])} → ${f2(N.abShopF1[1])}), even though the map is perfect there.`}</li>
            <li>{`Repeat scans of large codebases often miss the cache: ${N.mlCacheHits[0]} of ${N.mlCacheHits[1]} hit on the ML research project, and ${N.rrOwnPlainMs.filter((ms) => ms < N.ownCachedMs * 4).length} of ${N.rrOwnPlainMs.length} on our own codebase in the re-check. The cause is not found yet.`}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
