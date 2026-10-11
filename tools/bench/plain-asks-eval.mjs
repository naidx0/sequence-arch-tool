#!/usr/bin/env node
/**
 * THE PLAIN-ASK BENCH — reasoning on against off, on grounding and correctness.
 *
 *   node tools/bench/plain-asks-eval.mjs            # both arms, needs a model
 *   PLAIN_ASKS_DRY=1 node tools/bench/plain-asks-eval.mjs   # canned, no GPU
 *
 * Registered design, prediction and decision rule:
 * `docs/research/reasoning-on-plain-asks.md`. The rule lives in
 * `summarizePlainAsks` so it cannot be re-cut here after a run.
 *
 * WHY: `thinking-on-vs-off.md` measured reasoning on against off and then
 * disqualified its own verdict — its three metrics grade the SHAPE of a teach
 * turn and, in that document's words, "say nothing about whether the explanation
 * was any good". It also measured the cost: 6,100 s on against 297 s off over six
 * paired conversations, 20.5x. So there is a large measured cost against an
 * unmeasured benefit. This measures the benefit, on the two things the product
 * actually claims: is the answer GROUNDED, and is it RIGHT.
 *
 * Paired: the same twenty asks, the same repository, temperature 0, run twice.
 * Every ask is its own control.
 *
 * ── THE DRY RUN IS NOT OPTIONAL ETIQUETTE ─────────────────────────────────
 *
 * `PLAIN_ASKS_DRY=1` replaces the model with a canned answer and a canned judge.
 * It measures nothing about reasoning — it measures whether the harness runs,
 * what the guards say, and what a turn costs in provider calls. Those are the
 * three things a queued card run should never be discovering, and finding them
 * here has already paid four times on this bench family.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { ASKS, failedGuards, summarizePlainAsks } from './plainAsks.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MAKEMORE = path.join(ROOT, 'examples', 'makemore');
const dist = (rel) => url.pathToFileURL(path.join(ROOT, 'packages/analyzer/dist', rel)).href;
const DRY = process.env.PLAIN_ASKS_DRY === '1';

const { runAskPipeline } = await import(dist('server/askPipeline.js'));
const { scanRepo } = await import(dist('scan.js'));
const { buildDigest } = await import(dist('explain/explain.js'));
const { resolveInRepo } = await import(dist('server/jail.js'));

/* ── the guards run BEFORE anything expensive ────────────────────────────── */

const files = Object.fromEntries(
  fs
    .readdirSync(MAKEMORE)
    .filter((f) => fs.statSync(path.join(MAKEMORE, f)).isFile())
    .map((f) => [f, fs.readFileSync(path.join(MAKEMORE, f), 'utf8')]),
);
const graph = await scanRepo(MAKEMORE, { cluster: true });
const digest = buildDigest(graph);

const stale = failedGuards({ files, graph });
if (stale.length > 0) {
  console.error(
    `plain-asks: ${stale.length} reference(s) no longer describe examples/makemore: ${stale.join(', ')}\n` +
      '  These are hand-written facts, and the repository has moved past them. Grading twenty\n' +
      '  answers against a fact that stopped being true still prints a percentage, so this stops.\n' +
      '  Fix the reference in tools/bench/plainAsks.mjs — do NOT relax the guard.',
  );
  process.exitCode = 2;
} else {
  console.log(`plain-asks: ${ASKS.length} references check out against examples/makemore`);
  console.log(`  scanned: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  /* ── the provider ────────────────────────────────────────────────────────── */

  const apiKey =
    process.env.SEQUENCE_AI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    (fs.existsSync(path.join(process.env.HOME || process.env.USERPROFILE, '.sequence/openrouter-key'))
      ? fs
          .readFileSync(path.join(process.env.HOME || process.env.USERPROFILE, '.sequence/openrouter-key'), 'utf8')
          .trim()
      : '');
  if (!DRY && !apiKey) {
    console.error('plain-asks: no API key, and PLAIN_ASKS_DRY is not set — refusing to report zeros');
    process.exit(2);
  }

  const baseCfg = {
    provider: process.env.SEQUENCE_AI_PROVIDER || 'openai-compatible',
    model: process.env.SEQUENCE_AI_MODEL || 'granite42-hermes',
    baseUrl: process.env.SEQUENCE_AI_BASE_URL || 'http://127.0.0.1:11434/v1',
    apiKey: apiKey || 'dry',
    temperature: 0,
    maxRetries: 3,
    timeoutMs: Number(process.env.SEQUENCE_AI_TIMEOUT_MS || 600_000),
  };

  let providerMod = null;
  let TOOLS = [];
  if (!DRY) {
    providerMod = await import(dist('server/provider.js'));
    const toolsMod = await import(dist('server/askTools.js'));
    TOOLS = toolsMod.openaiAskToolDefinitions(toolsMod.askToolsForJobMode('code', 'full'));
  }

  /* One canned answer for the dry run. Deliberately WRONG on some asks so the
     judge path is exercised in both directions rather than only on agreement. */
  const CANNED = 'build_counts lives in bigram_counts.py and returns the counts matrix with stoi and itos.';

  let calls = 0;
  const callProvider = async (c, prompt, _onDelta, opts) => {
    calls += 1;
    if (DRY) return { text: CANNED, toolRequests: [] };
    const { text, providerUsage, toolRequests } = await providerMod.generateTextWithUsage(c, prompt, {
      tools: TOOLS,
      ...(opts?.cacheBreakpointChars !== undefined
        ? { cacheBreakpointChars: opts.cacheBreakpointChars }
        : {}),
    });
    return {
      text,
      ...(toolRequests?.length ? { toolRequests } : {}),
      usage: providerUsage
        ? { inputTokens: providerUsage.inputTokens, outputTokens: providerUsage.outputTokens, estimated: false }
        : { inputTokens: Math.round(prompt.length / 4), outputTokens: Math.round(text.length / 4), estimated: true },
    };
  };

  /**
   * The judge, kept deliberately narrow: does the answer CONVEY the reference.
   *
   * Both arms are judged by the same judge from the same reference, so a merely
   * mediocre judge still supports the comparison. A judge that is wrong in a
   * DIRECTION would move both arms together and neither would show it — which is
   * why every answer and its reference are written to the report for a human to
   * check rather than trust.
   */
  const judge = async ({ question, answer, reference }) => {
    if (DRY) return answer.includes('bigram_counts') && reference.includes('bigram_counts');
    const verdict = await providerMod.generateTextWithUsage(
      { ...baseCfg, reasoningEffort: 'none' },
      `You are grading one answer. Reply with exactly YES or NO and nothing else.\n\n` +
        `Question: ${question}\n\nReference (the correct answer): ${reference}\n\n` +
        `Answer to grade: ${answer}\n\n` +
        `Does the answer convey what the reference says? Ignore wording, length and extra detail. ` +
        `Reply NO if it contradicts the reference or omits its substance.`,
      {},
    );
    return /^\s*yes\b/i.test(verdict.text ?? '');
  };

  /* ── the two arms ────────────────────────────────────────────────────────── */

  async function runArm(effort) {
    const out = {};
    for (const ask of ASKS) {
      const started = Date.now();
      let text = '';
      let coverage;
      let error = null;
      try {
        const result = await runAskPipeline(
          {
            question: ask.question,
            intents: [],
            scopeLines: [],
            askMode: 'research',
            deictic: false,
            designMode: false,
            graph,
            digest,
            cfg: { ...baseCfg, reasoningEffort: effort },
            resolveReadable: (rel) => resolveInRepo(MAKEMORE, rel),
            repoRoot: MAKEMORE,
            permission: 'full',
            callProvider,
          },
          () => {},
        );
        text = String(result.text ?? '');
        coverage = result.coverage;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      out[ask.id] = {
        text,
        error,
        ms: Date.now() - started,
        coverage: coverage
          ? {
              edgesSeen: coverage.edgesSeen,
              edgesTotal: coverage.edgesTotal,
              packagesMissed: coverage.packagesMissed,
              /* The registered prediction is about exactly this flag. */
              full: coverage.edgesSeen === coverage.edgesTotal && coverage.packagesMissed.length === 0,
            }
          : null,
      };
      console.log(`  ${effort.padEnd(4)} ${ask.id} ${out[ask.id].ms}ms${error ? `  ERROR ${error}` : ''}`);
    }
    return out;
  }

  console.log(`\narm: reasoning off (reasoningEffort 'none')`);
  const off = await runArm('none');
  console.log(`\narm: reasoning on (reasoningEffort 'medium')`);
  const on = await runArm('medium');

  console.log('\njudging...');
  const rows = [];
  for (const ask of ASKS) {
    rows.push({
      id: ask.id,
      kind: ask.kind,
      question: ask.question,
      reference: ask.reference,
      onText: on[ask.id].text,
      offText: off[ask.id].text,
      onMs: on[ask.id].ms,
      offMs: off[ask.id].ms,
      onCoverage: on[ask.id].coverage,
      offCoverage: off[ask.id].coverage,
      onCorrect: await judge({ question: ask.question, answer: on[ask.id].text, reference: ask.reference }),
      offCorrect: await judge({ question: ask.question, answer: off[ask.id].text, reference: ask.reference }),
    });
  }

  const summary = summarizePlainAsks(rows);
  const wallOn = rows.reduce((a, r) => a + r.onMs, 0);
  const wallOff = rows.reduce((a, r) => a + r.offMs, 0);

  const outPath = path.join(HERE, 'out', DRY ? 'plain-asks-dry.json' : 'plain-asks-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ dry: DRY, model: baseCfg.model, wallOn, wallOff, providerCalls: calls, summary, rows }, null, 2),
  );

  console.log('');
  console.log(`  correct  on ${summary.on}/${summary.n}   off ${summary.off}/${summary.n}`);
  console.log(`    retrieval (14)  on ${summary.retrieval.on}  off ${summary.retrieval.off}`);
  console.log(`    reasoned  (6)   on ${summary.reasoned.on}  off ${summary.reasoned.off}`);
  console.log(`  answered-from saturated on every ask, both arms: ${summary.coverageSaturated}`);
  console.log(`  wall clock  on ${(wallOn / 1000).toFixed(1)}s   off ${(wallOff / 1000).toFixed(1)}s`);
  console.log(`  provider calls: ${calls}`);
  console.log(`  VERDICT (registered rule): ${summary.verdict}`);
  console.log(`  written: ${path.relative(ROOT, outPath)}`);
  if (DRY) console.log('\n  DRY RUN — the model was canned. Nothing here measures reasoning.');
}
