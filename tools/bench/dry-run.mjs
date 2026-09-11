#!/usr/bin/env node
/**
 * RUN A BENCH CONDITION WITH A CANNED PROVIDER, BEFORE IT COSTS CARD TIME.
 *
 * This has paid for itself twice already. The repository-less condition crashed
 * on its first turn — `input.design!` with no case for "no digest, no graph, no
 * design" — and cost three provider calls per turn for a visual rule that
 * cannot be satisfied without a graph. Both were found here, for nothing, and
 * would otherwise have surfaced partway through a paid run.
 *
 * The model is replaced by a fixed answer. That means NOTHING here measures the
 * model: it measures whether the harness runs, what the graders bounce, and how
 * many provider calls a turn would cost. Those are the three things a card run
 * should never be discovering.
 *
 *   node tools/bench/dry-run.mjs [repo]      # 'sequence', 'makemore', 'none', …
 *
 * `repo` selects the condition exactly as `TEACH_EVAL_REPO` does for the real
 * bench, including `none` for the repository-less asks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const dist = (rel) => new URL(`../../packages/analyzer/dist/${rel}`, import.meta.url).href;

const { runAskPipeline } = await import(dist('server/askPipeline.js'));
const { scanRepo } = await import(dist('scan.js'));
const { buildDigest } = await import(dist('explain/explain.js'));
const { buildTeachContext, newLesson, advanceLesson, nextConcept } = await import(
  dist('server/lessonState.js')
);
const { gradeCheckIn } = await import(dist('server/checkIn.js'));
const { resolveInRepo } = await import(dist('server/jail.js'));

const REPOS = {
  makemore: path.join(ROOT, 'examples/makemore'),
  shopfront: path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront'),
  sequence: ROOT,
};

/* The bank, read out of the bench so the two cannot drift. */
const src = fs.readFileSync(path.join(ROOT, 'tools/bench/teach-eval.mjs'), 'utf8');
const BANK = [...src.matchAll(/convo\('([a-z0-9-]+)', '([a-z]+)', (?:'([a-z]+)'|null), '([^']+)'/g)].map(
  (m) => ({ id: m[1], domain: m[2], repo: m[3] ?? null, question: m[4] }),
);

const only = process.argv[2] ?? 'sequence';
const pool = BANK.filter((c) => (only === 'none' ? c.repo === null : c.repo === only));
if (pool.length === 0) {
  console.error(`dry-run: no conversations for '${only}'`);
  process.exitCode = 2;
} else {
  /* One canned answer for every turn. Long enough to clear the stub line, and
     it ends WITHOUT a check so the derived check-in path is exercised. */
  const ANSWER =
    'This module is the entry point for the feature. It reads its inputs, validates them against ' +
    'the declared shape, and hands the result to the next stage. The important part is that the ' +
    'validation happens before anything is written, so a bad input cannot reach the store. That is ' +
    'the whole idea of the boundary, and it is why the checks live here rather than downstream.';

  const graphs = {};
  for (const [name, repoPath] of Object.entries(REPOS)) {
    if (!pool.some((c) => c.repo === name)) continue;
    const graph = await scanRepo(repoPath, { cluster: true });
    graphs[name] = { graph, digest: buildDigest(graph) };
    console.log(`scanned ${name}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  }

  let crashed = 0;
  let totalCalls = 0;
  let totalTurns = 0;
  const bounceCounts = {};
  const rows = [];

  for (const convo of pool) {
    const repoPath = convo.repo === null ? null : REPOS[convo.repo];
    const { graph, digest } = convo.repo === null ? { graph: null, digest: '' } : graphs[convo.repo];
    let lesson = newLesson(convo.id, convo.question, graph ?? undefined);
    let calls = 0;
    let charts = 0;
    let error = null;
    const turnsToRun = 2;
    for (let turn = 0; turn < turnsToRun; turn += 1) {
      const events = [];
      try {
        const result = await runAskPipeline(
          {
            question: turn === 0 ? convo.question : 'got it, continue',
            intents: [],
            scopeLines: [],
            surface: undefined,
            deictic: false,
            design: undefined,
            designMode: false,
            askMode: 'research',
            graph,
            digest,
            cfg: { provider: 'openai-compatible', model: 'canned', apiKey: 'none' },
            resolveReadable: repoPath === null ? () => null : (rel) => resolveInRepo(repoPath, rel),
            repoRoot: repoPath,
            permission: 'full',
            teach: true,
            teachContext: buildTeachContext({ lesson, ...(graph ? { graph } : {}) }),
            turnDeadlineMs: 0,
            callProvider: async () => {
              calls += 1;
              return { text: ANSWER, toolRequests: [] };
            },
          },
          (e) => events.push(e),
        );
        totalTurns += 1;
        charts += events.filter((e) => e.type === 'chart:proposal').length;
        for (const line of String(result.text ?? '').split('\n')) void line;
        const taught =
          events.some((e) => e.type === 'chart:proposal') &&
          gradeCheckIn(String(result.text ?? '')).endsWithCheck;
        lesson = advanceLesson(lesson, { passed: taught, turn });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        crashed += 1;
        break;
      }
    }
    totalCalls += calls;
    rows.push({ id: convo.id, calls, charts, concept: nextConcept(lesson)?.title ?? null, error });
    console.log(
      `  ${convo.id.padEnd(12)} calls=${String(calls).padStart(2)} charts=${charts}` +
        (error ? `  CRASHED: ${error}` : ''),
    );
  }

  console.log('');
  console.log(`condition '${only}': ${pool.length} conversations, ${totalTurns} turns completed`);
  console.log(`  crashed:            ${crashed}`);
  console.log(`  provider calls:     ${totalCalls}  (${(totalCalls / Math.max(1, totalTurns)).toFixed(2)} per turn)`);
  console.log(`  turns with a chart: ${rows.reduce((a, r) => a + (r.charts > 0 ? 1 : 0), 0)} of ${pool.length}`);
  void bounceCounts;
}
