#!/usr/bin/env node
/**
 * THE SKIPPER BENCH — the runner.
 *
 * Pure logic in `skipperModel.mjs`; this is the shell that reads a teach-bench
 * report, extracts its questions, and (when a model is configured) answers each
 * one under two conditions to see whether having FOLLOWED the lesson was worth
 * anything.
 *
 * Design and the three corrections it is built on:
 * `docs/research/claim-audit-resolver.md` is a different instrument — this one's
 * notes live in the commit that added it and in the spec's own file.
 *
 * ── IT REFUSES RATHER THAN MEASURING NOTHING ────────────────────────────
 *
 * The report this reads did not record its questions until 2026-09-05: turns
 * carried `words`, `endsWithQuestion`, `visual`, `contractProblems` and no text.
 * So the obvious first move — "take the existing report and extract every
 * question" — is not executable against any report written before that, and the
 * 54-conversation / 117-turn run at `aeb1fdc6` is one of them.
 *
 * A bench that silently found zero questions there would print a share over an
 * empty denominator and look like a result. This refuses, names the report, and
 * says which field is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
  classifyQuestion,
  parrotMarkers,
  scorableRows,
  scoreQuestions,
  summarize,
  verdictFor,
} from './skipperModel.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const reportPath = process.env.SKIPPER_REPORT || path.join(here, 'out', 'teach-eval-report.json');

if (!fs.existsSync(reportPath)) {
  console.error(`skipper-eval: no report at ${reportPath}`);
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const turns = (report.results ?? []).flatMap((c) =>
  (c.turns ?? []).map((t) => ({ convo: c.id, ...t })),
);

/*
 * THE REFUSAL. `questions` absent on every turn means this report predates the
 * field — not that the lesson asked none. Those are opposite findings and a
 * denominator of zero would report the second while meaning the first.
 */
const withField = turns.filter((t) => Array.isArray(t.questions));
if (withField.length === 0) {
  console.error(
    `skipper-eval: ${path.basename(reportPath)} records no \`questions\` field on any of its ` +
      `${turns.length} turns (model ${report.model ?? 'unknown'}, ${report.results?.length ?? 0} ` +
      'conversations).\n' +
      '  That report predates question recording — it stored endsWithQuestion, a COUNT, and ' +
      'discarded the questions themselves.\n' +
      '  Re-run tools/bench/teach-eval.mjs to produce a report this can read. Measuring the ' +
      'absent field as "no questions" would print a share over an empty denominator.',
  );
  process.exit(3);
}

const rows = withField.flatMap((t) =>
  t.questions.map((q) => ({
    convo: t.convo,
    turn: t.turn,
    question: q,
    type: classifyQuestion(q),
    parrot: parrotMarkers(q),
  })),
);

const byType = rows.reduce((acc, r) => ({ ...acc, [r.type]: (acc[r.type] ?? 0) + 1 }), {});

console.log(`skipper-eval: ${path.basename(reportPath)} — model ${report.model ?? 'unknown'}`);
console.log(
  `turns with the field: ${withField.length} of ${turns.length}; questions: ${rows.length}`,
);
console.log('by type:', JSON.stringify(byType));

/*
 * PARROTING gets its own line with its own denominator. It is a defect in the
 * CONTRACT rather than in any answer, so it does not belong inside the type
 * histogram — and a share without the count underneath it would be exactly the
 * THIRD LAW violation this bench exists to avoid.
 */
const parroted = rows.filter((r) => r.parrot.length > 0);
const markerCounts = parroted.reduce(
  (acc, r) => r.parrot.reduce((a, m) => ({ ...a, [m]: (a[m] ?? 0) + 1 }), acc),
  {},
);
console.log(
  `parroted the contract's example: ${parroted.length} of ${rows.length} questions ` +
    `${JSON.stringify(markerCounts)}`,
);
for (const r of parroted) console.log(`  ${r.convo} t${r.turn}: ${r.question}`);

/*
 * THE INVENTORY IS THE FIRST DELIVERABLE, and it needs no GPU. If the contract's
 * preferred question type is rare, that is a finding before a single model call
 * is spent — and the model calls are the expensive half on a shared card.
 */
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const inventoryPath = path.join(outDir, 'skipper-inventory.json');
fs.writeFileSync(
  inventoryPath,
  JSON.stringify(
    {
      report: path.basename(reportPath),
      model: report.model ?? null,
      turnsWithField: withField.length,
      turnsTotal: turns.length,
      questions: rows.length,
      byType,
      parroted: parroted.length,
      parrotMarkers: markerCounts,
      rows,
    },
    null,
    2,
  ),
);
console.log(`wrote ${inventoryPath}`);

/*
 * Scoring needs a model under the two conditions, and the card is one lane at a
 * time. Until that runs, the honest output is the inventory plus an empty
 * summary that says its denominator is zero rather than pretending to a share.
 */
/*
 * THE SCORED HALF. It runs only when a model is configured, and says which of
 * the two states it is in rather than printing a zero either way.
 */
const cfg = {
  provider: process.env.SEQUENCE_AI_PROVIDER || 'local-openai',
  model: process.env.SEQUENCE_AI_MODEL,
  apiKey: process.env.SEQUENCE_AI_API_KEY,
  baseUrl: process.env.SEQUENCE_AI_BASE_URL,
  params: { temperature: 0, maxRetries: 2, timeoutMs: 300_000, reasoningEffort: 'none' },
};

if (!cfg.model || !cfg.baseUrl) {
  console.log(
    'scoring NOT run: no SEQUENCE_AI_MODEL / SEQUENCE_AI_BASE_URL. The inventory above is ' +
      'complete and is the input a scored run consumes. This is the only honest output without ' +
      'a model — a zero here would be a share over an empty denominator.',
  );
  /*
   * AND THE EMPTY SUMMARY, which had gone missing while the comment above it and
   * the test below still described it. `summarize([])` reports `goodShare: null`
   * — the distinction this whole runner is built on: a share over an empty
   * denominator is NULL, not 0%. Printing the message without it left the one
   * machine-readable statement of "nothing was scored" out of the output.
   */
  console.log(JSON.stringify(summarize([])));
} else {
  const url = await import('node:url');
  const distPath = path.resolve(here, '..', '..', 'packages/analyzer/dist/server/provider.js');
  const { generateText } = await import(url.pathToFileURL(distPath).href);

  const ask = async (prompt) => {
    try {
      return String(await generateText(cfg, prompt)).trim();
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  };

  const deps = {
    /*
     * W sees the lesson; G sees the repository and NOT the lesson. Both are told
     * to answer from what they were given and to say so when they cannot, so a
     * confident guess is distinguishable from an answer.
     */
    answer: ({ condition, question, context }) =>
      ask(
        `${condition === 'W' ? 'Here is a lesson you just read:' : 'Here is the structure of a repository:'}
` +
          `${context}

` +
          `Answer this question in one sentence, using ONLY what is above. ` +
          `If what is above does not contain the answer, reply exactly: I DO NOT KNOW.

` +
          `Question: ${question}`,
      ),
    /*
     * The judge compares against the lesson's OWN answer, and is told to be
     * strict about "I DO NOT KNOW" — otherwise an abstention scores as a match
     * whenever the reference happens to contain the words.
     */
    judge: async ({ question, answer, reference }) => {
      if (/^I DO NOT KNOW/i.test(answer) || answer.startsWith('ERROR:')) return false;
      const v = await ask(
        `REFERENCE (what the lesson actually said):
${reference}

` +
          `QUESTION: ${question}
ANSWER GIVEN: ${answer}

` +
          `Does the ANSWER agree with the REFERENCE on the substance of the question? ` +
          `Reply with exactly one word: YES or NO.`,
      );
      return /^YES/i.test(v);
    },
  };

  const attempts = Number(process.env.SKIPPER_ATTEMPTS || 1);
  /* The shape comes from the analyzer's own classifier — one definition, in the
     place that owns it — so `menu` is a claim the grader makes rather than a
     word-overlap heuristic guessing. */
  const url2 = await import('node:url');
  const distOf = (rel) =>
    url2.pathToFileURL(path.resolve(here, '..', '..', 'packages/analyzer/dist', rel)).href;
  const { gradeCheckIn } = await import(distOf('server/checkIn.js'));

  /*
   * THE GRAPH-ONLY CONDITION NEEDS A GRAPH.
   *
   * The first scored run passed `scorableRows(report, {})` — an empty map — so
   * every G answer was produced from an empty string. That measured "the lesson
   * beat NOTHING", which is a far weaker claim than "the lesson beat the code",
   * and it showed: `too-easy` was 0 of 31 because G never answered anything.
   *
   * A skipper is someone who did not read the lesson and CAN still look at the
   * repository. Giving them nothing makes the bench flatter every lesson.
   */
  const { scanRepoCached } = await import(distOf('index.js'));
  const REPOS = {
    makemore: path.resolve(here, '..', '..', 'examples/makemore'),
    shopfront: path.resolve(here, '..', '..', 'packages/analyzer/test/fixtures/shopfront'),
    sequence: path.resolve(here, '..', '..'),
  };
  const graphContext = {};
  for (const key of new Set((report.results ?? []).map((c) => c.repo).filter(Boolean))) {
    if (!REPOS[key]) continue;
    const g = await scanRepoCached(REPOS[key]);
    const nodes = (g.nodes ?? []).map((n) => `${n.label}${n.path ? ` (${n.path})` : ''}`);
    const edges = (g.edges ?? []).map((e) => `${e.srcId} -> ${e.dstId} [${e.kind}]`);
    graphContext[key] =
      `Files and components:\n${nodes.join('\n')}\n\nHow they connect:\n${edges.join('\n')}`;
  }
  console.log(
    `graph context built for: ${Object.keys(graphContext).join(', ') || '(none)'} — ` +
      'the G condition reads this, not an empty string',
  );

  const withContext = scorableRows(report, graphContext).map((r) => ({
    ...r,
    shape: gradeCheckIn(r.question).shape,
  }));
  const byKey = new Map(withContext.map((r) => [`${r.convo}#${r.turn}#${r.question}`, r]));
  const toScore = rows.map((r) => byKey.get(`${r.convo}#${r.turn}#${r.question}`)).filter(Boolean);

  console.log('');
  console.log(`scoring ${toScore.length} questions, ${attempts} attempt(s) each, model ${cfg.model}…`);
  const scored = await scoreQuestions(toScore, deps, { attempts });
  const gradable = scored.filter((r) => r.correctW !== undefined);
  const summary = summarize(gradable);

  console.log('');
  console.log(`gradable: ${gradable.length} of ${scored.length} (the rest: the turn never answered its own question)`);
  console.log('scored:', JSON.stringify(summary));
  for (const verdict of ['good', 'defect', 'pulse-check']) {
    const hit = gradable.find((r) => verdictFor(r) === verdict);
    console.log(
      `  ${verdict.padEnd(11)} ${gradable.filter((r) => verdictFor(r) === verdict).length}` +
        (hit ? `   e.g. ${hit.convo} t${hit.turn}: ${hit.question.slice(0, 70)}` : '   (none)'),
    );
  }
  fs.writeFileSync(
    path.join(outDir, 'skipper-scored.json'),
    JSON.stringify({ model: cfg.model, attempts, summary, rows: scored }, null, 2),
  );
  console.log(`wrote ${path.join(outDir, 'skipper-scored.json')}`);
}
