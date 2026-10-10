#!/usr/bin/env node
/**
 * Phase 0 pipeline CLI.
 *
 *   node tools/lora/run.mjs dataset [--teacher fixture|api] [--per-repo N] [--repos a,b]
 *                                   [--dry-run] [--seed S] [--out DIR] [--max-files N]
 *   node tools/lora/run.mjs evaluate --untuned <model> --tuned <model> [--base-url URL]
 *                                   [--per-repo N] [--dry-run] [--min-improvement 0.15]
 *   node tools/lora/run.mjs splits   — print the train / held-out split and check it
 *
 * SPENDING MONEY IS OPT-IN AND EXPLICIT. `--teacher fixture` is the default and
 * touches no network; `--teacher api` additionally requires
 * SEQUENCE_LORA_TEACHER_ENABLE=1 in the environment. `eval` against a live
 * endpoint requires SEQUENCE_LORA_EVAL_ENABLE=1. `--dry-run` does everything
 * except generate: it scans, synthesizes requests, assembles prompts, and prints
 * their real sizes — which is how you learn what a generation pass will cost
 * before you pay for one.
 *
 * Scanning is the slow part (minutes on a large repo). Nothing here parallelises
 * it: `tools/qa-loop` learned the hard way that scans in one process share a
 * WASM heap, and this tool has no reason to relearn that.
 */
import fs from 'node:fs';
import path from 'node:path';

import { RUNS_DIR } from './lib/paths.mjs';
import {
  ensureRepoAtSha,
  groundTruthIds,
  loadManifest,
  loadSplits,
  repoDir,
  resolveSplits,
} from './lib/corpus.mjs';
import { loadEngine } from './lib/engine.mjs';
import { PROPOSAL_CONTRACT_VERSION, buildProposalPrompt } from './lib/prompt.mjs';
import { loadRecipes, synthesizeRequests } from './lib/requests.mjs';
import { createTeacher } from './lib/teacher.mjs';
import { filterCandidates } from './lib/filter.mjs';
import { renderVerifyTemplate, toChatSample, validateChatSample, writeJsonl } from './lib/dataset.mjs';
import { compareArms, createOpenAICompatibleClient, createStubClient, runEvalArm } from './lib/evaluate.mjs';
import * as FIXTURES from './fixtures/candidates.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const log = (...a) => console.log(...a);

/** Scan one corpus repo into a graph + digest, or explain why it could not. */
async function prepareRepo(row, engine, args) {
  const dir = repoDir(row);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    if (args['no-clone']) return { ok: false, reason: `not cloned at ${dir} (and --no-clone was passed)` };
    log(`  cloning ${row.id} @ ${row.sha.slice(0, 8)} ...`);
    const cloned = await ensureRepoAtSha(row);
    if (!cloned.ok) return { ok: false, reason: cloned.reason };
  }
  const scanOpts = { cluster: true, llm: false };
  if (args['max-files']) scanOpts.maxFiles = Number(args['max-files']);
  const graph = await engine.scanRepo(dir, scanOpts);
  const digest = engine.buildDigest(graph);
  return { ok: true, graph, digest };
}

async function cmdDataset(args) {
  const manifest = loadManifest();
  const splits = resolveSplits(manifest, loadSplits());
  const recipes = loadRecipes();
  const engine = await loadEngine();
  const validate = engine.extractArchProposalFromAnswer;

  const only = args.repos ? new Set(String(args.repos).split(',')) : null;
  const rows = splits.train.filter((r) => !only || only.has(r.id));
  if (only) {
    const heldOutHit = splits.heldOut.filter((r) => only.has(r.id)).map((r) => r.id);
    if (heldOutHit.length > 0) {
      throw new Error(
        `--repos names held-out repos (${heldOutHit.join(', ')}). Held-out repos are never trained on ` +
          `— that is what makes the Phase 0 number mean anything. Edit tools/lora/splits.json if you really mean to move them.`
      );
    }
  }
  const perRepo = Number(args['per-repo'] ?? 12);
  const seed = String(args.seed ?? 'phase0');
  const dryRun = Boolean(args['dry-run']);
  // The default fixture teacher is graph-aware (see fixtures/candidates.mjs), so
  // `--teacher fixture` rehearses the ENTIRE pipeline on real repos for nothing.
  const teacher = dryRun
    ? null
    : createTeacher(String(args.teacher ?? 'fixture'), { fixtures: FIXTURES.groundedFixtureCompletion });

  log(`corpus: ${rows.length} training repos (${splits.heldOut.length} held out), ${perRepo} requests each`);
  log(`teacher: ${dryRun ? '(dry run — nothing is generated)' : teacher.name}`);
  log(`contract: ${PROPOSAL_CONTRACT_VERSION}   seed: ${seed}`);
  log('');

  const candidates = [];
  const skipped = [];
  const promptSizes = [];

  for (const row of rows) {
    const prepared = await prepareRepo(row, engine, args);
    if (!prepared.ok) {
      skipped.push({ id: row.id, reason: prepared.reason });
      log(`  ${row.id}: SKIPPED — ${prepared.reason}`);
      continue;
    }
    const requests = synthesizeRequests({ graph: prepared.graph, repoId: row.id, recipes, count: perRepo, seed });
    log(`  ${row.id}: ${prepared.graph.nodes.length} nodes → ${requests.length} requests`);
    for (const request of requests) {
      const prompt = buildProposalPrompt({ digest: prepared.digest, request: request.text, buildAskPrompt: engine.buildAskPrompt });
      promptSizes.push({ repoId: row.id, chars: prompt.length });
      if (dryRun) continue;
      const text = await teacher.generateProposal(prompt, { request });
      candidates.push({ id: request.id, repoId: row.id, request: request.text, recipeId: request.recipeId, prompt, text, graph: prepared.graph });
    }
  }

  if (promptSizes.length > 0) {
    const chars = promptSizes.map((p) => p.chars).sort((a, b) => a - b);
    const median = chars[Math.floor(chars.length / 2)];
    log('');
    log(`prompts: ${chars.length}   median ${median} chars (~${Math.round(median / 4)} tokens)   max ${chars.at(-1)} chars`);
    log('  (~chars/4 is a rough token estimate; the real tokenizer is the authority)');
  }
  if (dryRun) {
    log('');
    log('dry run: no generation, no spend. Re-run without --dry-run to build the dataset.');
    return 0;
  }

  const graded = filterCandidates(candidates, validate);
  const outDir = String(args.out ?? path.join(RUNS_DIR, new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(outDir, { recursive: true });

  const samples = graded.accepted.map((c) =>
    toChatSample({
      prompt: c.prompt,
      completion: c.text,
      meta: { repoId: c.repoId, recipeId: c.recipeId, request: c.request, contract: PROPOSAL_CONTRACT_VERSION },
    })
  );
  for (const s of samples) {
    const problems = validateChatSample(s);
    if (problems.length > 0) throw new Error(`refusing to write a malformed training row: ${problems.join('; ')}`);
  }
  const jsonl = writeJsonl(path.join(outDir, 'train.jsonl'), samples);

  // The §7 artifact. Written even when the dataset is empty is not possible —
  // but when it IS possible it is never optional.
  let verifyPath = null;
  if (samples.length > 0) {
    const artifact = renderVerifyTemplate({
      trainingSample: samples[0],
      // The SAME prompt string that went into that training row, sent the way
      // the eval harness sends it (`runEvalArm` passes `item.prompt` straight
      // through as the single user message). The string being identical is the
      // point, not a cheat: what section C actually checks is that the RENDER
      // path — toChatSample plus the chat template — does not alter it on one
      // side and not the other. That is the §7 failure, and it is invisible
      // anywhere except here.
      inferencePrompt: graded.accepted[0].prompt,
      context: {
        repo: samples[0].meta?.repoId ?? '?',
        contract: PROPOSAL_CONTRACT_VERSION,
        samples: samples.length,
        generated: new Date().toISOString(),
      },
    });
    verifyPath = path.join(outDir, 'verify-template.txt');
    fs.writeFileSync(verifyPath, artifact, 'utf8');
  }

  const report = {
    contract: PROPOSAL_CONTRACT_VERSION,
    seed,
    perRepo,
    teacher: teacher.name,
    trainRepos: rows.map((r) => r.id),
    heldOutRepos: splits.heldOut.map((r) => r.id),
    groundTruthRepos: groundTruthIds(manifest),
    skipped,
    candidates: graded.total,
    accepted: graded.accepted.length,
    passRate: graded.passRate,
    rejectionReasons: graded.reasonCounts,
    rejected: graded.rejected,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  log('');
  log(`filter: ${graded.accepted.length}/${graded.total} accepted (${(graded.passRate * 100).toFixed(1)}%)`);
  for (const [reason, n] of Object.entries(graded.reasonCounts).sort((a, b) => b[1] - a[1])) {
    log(`  rejected ${String(n).padStart(4)}  ${reason}`);
  }
  log('');
  log(`  ${jsonl}`);
  if (verifyPath) log(`  ${verifyPath}   <-- READ THIS BEFORE TRAINING (guide §7)`);
  log(`  ${path.join(outDir, 'report.json')}`);
  if (samples.length < 500) {
    log('');
    log(`note: ${samples.length} samples. The guide's working range for a format-adherence LoRA is 500-2,000;`);
    log('      raise --per-repo (and check the rejection reasons above before assuming more calls will help).');
  }
  return 0;
}

async function cmdEval(args) {
  const manifest = loadManifest();
  const splits = resolveSplits(manifest, loadSplits());
  const recipes = loadRecipes();
  const engine = await loadEngine();
  const validate = engine.extractArchProposalFromAnswer;
  const perRepo = Number(args['per-repo'] ?? 8);
  const seed = String(args.seed ?? 'phase0-eval');
  const dryRun = Boolean(args['dry-run']);

  const only = args.repos ? new Set(String(args.repos).split(',')) : null;
  const rows = splits.heldOut.filter((r) => !only || only.has(r.id));

  const items = [];
  for (const row of rows) {
    const prepared = await prepareRepo(row, engine, args);
    if (!prepared.ok) {
      log(`  ${row.id}: SKIPPED — ${prepared.reason}`);
      continue;
    }
    // A DIFFERENT seed from the dataset build, so the eval asks different
    // questions of the same recipes even where a repo could appear in both.
    for (const request of synthesizeRequests({ graph: prepared.graph, repoId: row.id, recipes, count: perRepo, seed })) {
      items.push({
        id: request.id,
        repoId: row.id,
        request: request.text,
        citedIds: request.citedIds,
        graph: prepared.graph,
        prompt: buildProposalPrompt({ digest: prepared.digest, request: request.text, buildAskPrompt: engine.buildAskPrompt }),
      });
    }
  }
  log(`held-out set: ${rows.length} repos, ${items.length} requests`);

  const sampling = { temperature: Number(args.temperature ?? 0.2), maxTokens: Number(args['max-tokens'] ?? 1400) };
  // In a dry run the two arms are STUBS, and they are deliberately different:
  // the "untuned" stub answers in prose (no fence at all — the commonest way a
  // base model fails this task) and the "tuned" stub emits a grounded proposal
  // for the item it was given. That is enough to prove the harness discriminates
  // and reports, without any endpoint existing. It is a rehearsal, not a result,
  // and the model names are printed with "(stub)" so no run log can be mistaken
  // for a real measurement.
  const byPrompt = new Map(items.map((i) => [i.prompt, i]));
  const mkClient = (model, arm) =>
    dryRun
      ? createStubClient(`${model} (stub)`, async (prompt) =>
          arm === 'tuned' ? FIXTURES.groundedFixtureCompletion(itemRequest(byPrompt.get(prompt))) : FIXTURES.NO_FENCE
        )
      : createOpenAICompatibleClient({
          baseUrl: String(args['base-url'] ?? 'http://127.0.0.1:11434/v1'),
          model,
          apiKey: process.env.SEQUENCE_LORA_EVAL_KEY,
        });

  const untunedModel = String(args.untuned ?? 'qwen2.5-coder:7b');
  const tunedModel = String(args.tuned ?? 'sequence-qwen2.5-coder:7b');
  const untuned = await runEvalArm({ items, client: mkClient(untunedModel, 'untuned'), validate, sampling });
  const tuned = await runEvalArm({ items, client: mkClient(tunedModel, 'tuned'), validate, sampling });
  const cmp = compareArms({ untuned, tuned, minImprovement: Number(args['min-improvement'] ?? 0.15) });

  log('');
  log(`untuned ${untuned.model}: ${untuned.passed}/${untuned.attempted} = ${(untuned.passRate * 100).toFixed(1)}%`);
  log(`tuned   ${tuned.model}: ${tuned.passed}/${tuned.attempted} = ${(tuned.passRate * 100).toFixed(1)}%`);
  log(`verdict: ${cmp.verdict}`);
  const outDir = String(args.out ?? path.join(RUNS_DIR, 'eval-' + new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'eval.json'), JSON.stringify({ untuned, tuned, comparison: cmp }, null, 2), 'utf8');
  log(`  ${path.join(outDir, 'eval.json')}`);
  return cmp.verdict.startsWith('PASS') ? 0 : 1;
}

/** The citedIds the stub teacher needs, recovered from an eval item. */
function itemRequest(item) {
  return item ? { citedIds: item.citedIds } : null;
}

function cmdSplits() {
  const manifest = loadManifest();
  const splits = resolveSplits(manifest, loadSplits());
  log(`train (${splits.train.length}):`);
  for (const r of splits.train) log(`  ${r.id}`);
  log(`held out (${splits.heldOut.length}) — never trained on:`);
  for (const r of splits.heldOut) log(`  ${r.id}${r.groundTruth ? '  * ground truth' : ''}`);
  log('');
  log('split is valid: every manifest row placed exactly once, all ground truth held out.');
  return 0;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  let code = 0;
  if (cmd === 'dataset') code = await cmdDataset(args);
  else if (cmd === 'evaluate' || cmd === 'eval') code = await cmdEval(args);
  else if (cmd === 'splits') code = cmdSplits();
  else {
    console.error('usage: node tools/lora/run.mjs <dataset|evaluate|splits> [options] — see tools/lora/README.md');
    code = 2;
  }
  process.exit(code);
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
