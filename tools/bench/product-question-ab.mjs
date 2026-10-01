#!/usr/bin/env node
/**
 * PRODUCT QUESTIONS, A/B: does SEQUENCE_TEACH_PRODUCT_MODE answer "what is this
 * product" instead of re-sending the file map?
 *
 * The owner's session of 2026-09-24 asked three product questions of the ML
 * Harness repo and got the same services-and-files answer three times. This
 * bench replays those three questions as one conversation, plus the same shape
 * of conversation on the shopfront and makemore fixtures, through the real
 * teach pipeline, with the prior turns as history, once per arm.
 *
 *   SEQUENCE_AI_MODEL=minicpm5-hermes SEQUENCE_AI_BASE_URL=http://127.0.0.1:11434/v1 \
 *   SEQUENCE_AI_API_KEY=ollama node tools/bench/product-question-ab.mjs --arm on --runs 2 --out <file>
 *
 * The arm is the flag, set here for the process. Scored deterministically per turn
 * (see score()): repeat of the previous answer, code tokens, product shape, a
 * concept flow chart, unsupported risk claims. Calls no judge model.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dist = (p) => url.pathToFileURL(path.join(root, 'packages/analyzer/dist', p)).href;
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const ARM = arg('--arm', 'off');
const RUNS = Number(arg('--runs', '1'));
const OUT = arg('--out', path.join(root, 'tools/bench/out', `product-question-${ARM}.json`));
/* Arms: off (neither flag), on (product mode), guard (product mode + repeat guard). */
if (ARM === 'on' || ARM === 'guard' || ARM === 'guard3') process.env.SEQUENCE_TEACH_PRODUCT_MODE = '1';
else process.env.SEQUENCE_TEACH_PRODUCT_MODE = '0';
if (ARM === 'guard' || ARM === 'guard3') process.env.SEQUENCE_TEACH_REPEAT_GUARD = '1';
else process.env.SEQUENCE_TEACH_REPEAT_GUARD = '0';
if (ARM === 'guard3') process.env.SEQUENCE_TEACH_REPEAT_FALLBACK = 'new-only';
else delete process.env.SEQUENCE_TEACH_REPEAT_FALLBACK;
/* 'sections': the defaults (product mode + guard) plus the five-part check. */
if (ARM === 'sections') {
  process.env.SEQUENCE_TEACH_PRODUCT_MODE = '1';
  process.env.SEQUENCE_TEACH_REPEAT_GUARD = '1';
  process.env.SEQUENCE_TEACH_PRODUCT_SECTIONS = '1';
} else delete process.env.SEQUENCE_TEACH_PRODUCT_SECTIONS;
/* 'noquiz': the defaults plus stripping the model's own short closing question. */
if (ARM === 'noquiz') {
  process.env.SEQUENCE_TEACH_PRODUCT_MODE = '1';
  process.env.SEQUENCE_TEACH_REPEAT_GUARD = '1';
  process.env.SEQUENCE_TEACH_PRODUCT_NO_QUIZ = '1';
} else delete process.env.SEQUENCE_TEACH_PRODUCT_NO_QUIZ;
/* --convos <file.json>: [{id, repo, questions}] replaces the built-in set (the blind check). */
const CONVOS_FILE = arg('--convos');
/* --baseline-cache <dir>: a stored answer is reused when its key matches (see cacheKey). */
const CACHE_DIR = arg('--baseline-cache');
/* --seed-cache <results.json>: store that run's rows under this code's keys, and run nothing. */
const SEED_FROM = arg('--seed-cache');
/* --cache-only: a miss is recorded and skipped, never sent to the model. A read pass
   holds no GPU lock, so a miss that fell through to a live call ran on a card another
   lane held (2026-09-25 17:23Z-17:28Z, 18 turns). */
const CACHE_ONLY = process.argv.includes('--cache-only');
if (CACHE_ONLY && !CACHE_DIR) throw new Error('--cache-only needs --baseline-cache');

const { runAskPipeline } = await import(dist('server/askPipeline.js'));
const { scanRepoCached } = await import(dist('index.js'));
const { buildDigest, renderAskHistorySection } = await import(dist('explain/explain.js'));
const { resolveInRepo } = await import(dist('server/jail.js'));
const { newLesson, buildTeachContext } = await import(dist('server/lessonState.js'));
const providerMod = await import(dist('server/provider.js'));
const toolsMod = await import(dist('server/askTools.js'));
const { scoreLesson } = await import('./lesson-quality.mjs');

/* CANONICAL paths: resolveInRepo compares against the real path, so a root spelled with
   forward slashes on Windows refused every read_file (run 1 of this bench, discarded). */
const REPOS = Object.fromEntries(
  Object.entries({
    'ml-harness': arg('--ml-harness', path.join(os.homedir(), 'Projects/mlh-adapter')),
    shopfront: path.join(root, 'packages/analyzer/test/fixtures/shopfront'),
    makemore: path.join(root, 'examples/makemore'),
    sequence: arg('--sequence', root),
  }).map(([k, v]) => [k, fs.realpathSync(v)]),
);
const GENERIC = [
  'what is this app, what does it do, who is it for?',
  'why does it exist and what are the advantages of it?',
  'i still dont get it, whats the actual product flow, show me on the canvas',
];
const BUILTIN_CONVOS = [
  {
    id: 'owner-ml-harness',
    repo: 'ml-harness',
    questions: [
      'tell me about the app how it works and the advtanges on the ai canvas please',
      'move away from the actual files and code and show me flow charts of the advtnage of the actual app and why it exits the conext behind it, and everything around that and move that way please go dive deep show me how this works internally with a rpoert on the canvas',
      'i dont get what is ml harness, what does it do, what is the product, whats the actual product flow',
    ],
  },
  { id: 'generic-shopfront', repo: 'shopfront', questions: GENERIC },
  { id: 'generic-makemore', repo: 'makemore', questions: GENERIC },
];

const CONVOS = CONVOS_FILE ? JSON.parse(fs.readFileSync(CONVOS_FILE, 'utf8')) : BUILTIN_CONVOS;
for (const c of CONVOS) if (!REPOS[c.repo]) throw new Error(`unknown repo ${c.repo} (have ${Object.keys(REPOS).join(', ')})`);

const cfg = {
  provider: 'openai-compat',
  model: process.env.SEQUENCE_AI_MODEL || 'minicpm5-hermes',
  apiKey: process.env.SEQUENCE_AI_API_KEY || 'ollama',
  baseUrl: process.env.SEQUENCE_AI_BASE_URL || 'http://127.0.0.1:11434/v1',
  params: { maxRetries: 2, reasoningEffort: 'none', timeoutMs: 180000 },
};
const TOOLS = toolsMod.openaiAskToolDefinitions(toolsMod.askToolsForJobMode('code', 'full'));
/* Provider calls this turn: 1 is one generation; more is a tool round or a teach-contract bounce. */
let providerCalls = 0;
let tokensIn = 0;
let tokensOut = 0;
/* Why a call past the first was made: the last harness line its prompt carries. */
let resendReasons = [];
const callProvider = async (c, prompt, _onDelta, opts) => {
  providerCalls += 1;
  if (providerCalls > 1) {
    const lines = prompt.split(String.fromCharCode(10)).filter((l) => l.startsWith('### harness'));
    resendReasons.push((lines.at(-1) ?? '(no harness line: a tool round or a side call)').slice(0, 400));
  }
  const { text, providerUsage, toolRequests } = await providerMod.generateTextWithUsage(c, prompt, {
    tools: TOOLS,
    ...(opts?.cacheBreakpointChars !== undefined ? { cacheBreakpointChars: opts.cacheBreakpointChars } : {}),
  });
  tokensIn += providerUsage?.inputTokens ?? 0;
  tokensOut += providerUsage?.outputTokens ?? 0;
  return {
    text,
    ...(toolRequests?.length ? { toolRequests } : {}),
    usage: providerUsage
      ? { inputTokens: providerUsage.inputTokens, outputTokens: providerUsage.outputTokens, estimated: false }
      : { inputTokens: Math.round(prompt.length / 4), outputTokens: Math.round(text.length / 4), estimated: true },
  };
};

/* ---------------------------------------------------------- answer cache -- */

/*
 * THE CACHED BASELINE ARM (fast verification kit, step 2). A single-question turn's
 * stored row is reused when all of these match: the first prompt the pipeline sends
 * (which carries the question, the repo's digest and README, and every rule and flag
 * that shapes the prompt), the tool definitions, the model tag and its Ollama digest,
 * the provider params, the run index and this bench file (the scorer). The first prompt
 * is taken from a dry pass whose provider stops before any model call, so the check
 * costs no GPU. What the key cannot see: code that acts only after the first answer
 * (the grader and its resends). An arm whose flag is off keeps those paths byte for
 * byte, which is the rule every flag here follows; a change to them without a flag
 * must not reuse the cache (delete the directory).
 */
const crypto = await import('node:crypto');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const BENCH_HASH = sha(fs.readFileSync(url.fileURLToPath(import.meta.url)));
let modelDigest = null;
if (CACHE_DIR) {
  const tags = await fetch(`${cfg.baseUrl.replace(/\/v1\/?$/, '')}/api/tags`).then((r) => r.json()).catch(() => ({ models: [] }));
  modelDigest = (tags.models ?? []).find((m) => m.name === cfg.model || m.name === `${cfg.model}:latest`)?.digest ?? null;
  if (!modelDigest) throw new Error(`--baseline-cache: no Ollama digest for ${cfg.model}`);
}
const DRY = Symbol('dry');
const firstPrompt = async (input) => {
  let captured = null;
  const stop = async (_c, prompt) => {
    captured = prompt;
    throw DRY;
  };
  try {
    await runAskPipeline({ ...input, callProvider: stop }, () => {});
  } catch (e) {
    if (e !== DRY && captured === null) throw e;
  }
  return captured;
};
const cacheKey = (prompt, run) =>
  sha(JSON.stringify({ prompt, tools: TOOLS, model: cfg.model, modelDigest, params: cfg.params, run, bench: BENCH_HASH }));
const cachePath = (key) => path.join(CACHE_DIR, `${key}.json`);
const seedRows = SEED_FROM ? JSON.parse(fs.readFileSync(SEED_FROM, 'utf8')).results : null;
let cacheHits = 0;
let cacheStores = 0;
const cacheMisses = [];

/* ---------------------------------------------------------------- score -- */

const grams = (t) => {
  const s = t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const g = new Set();
  for (let i = 0; i + 5 <= s.length; i += 1) g.add(s.slice(i, i + 5));
  return g;
};
export const similarity = (a, b) => {
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n += 1;
  return n / (A.size + B.size - n);
};
const CODE_TOKEN = /`[^`]+`|\b(?:svc|ds|mod|file|topic):[\w./-]+|\b[\w-]+\.(?:py|ts|tsx|js|go|java|rs|json|toml|md)\b|\b\d+ (?:HTTP )?edges\b/g;
const RISK_CLAIM = /\b(?:single points? of failure|circular dependency|failure points?|risk)\b/i;

function score(text, prev, charts) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const code = (text.match(CODE_TOKEN) ?? []).length;
  const steps = (text.match(/^\s*(?:\d+[.)]|step \d)/gim) ?? []).length;
  return {
    words,
    repeat: prev ? Number(similarity(text, prev).toFixed(3)) : null,
    codePer100: words ? Number(((100 * code) / words).toFixed(2)) : 0,
    productShape: steps >= 3 && /\b(?:for|who)\b/i.test(text) && /\badvantage|benefit|why\b/i.test(text),
    conceptFlowChart: charts.some((c) => (c.items ?? []).length >= 3 && (c.items ?? []).every((i) => !i.nodeId)),
    fileChart: charts.some((c) => (c.items ?? []).some((i) => i.nodeId)),
    riskClaim: RISK_CLAIM.test(text),
    quality: scoreLesson(text, { chart: charts[0] ?? null, drew: charts.length > 0, product: true })?.overall ?? null,
    endsOnQuestion: /\?\s*\**\s*$/.test(text.trim().split(/\n+/).filter(Boolean).pop() ?? ''),
  };
}

/* ------------------------------------------------------------------ run -- */

const graphs = {};
for (const [name, repoPath] of Object.entries(REPOS)) {
  const graph = await scanRepoCached(repoPath, { cluster: true });
  graphs[name] = { graph, digest: buildDigest(graph) };
}
const results = [];
for (let run = 1; run <= RUNS; run += 1) {
  for (const c of CONVOS) {
    const repoPath = REPOS[c.repo];
    const { graph, digest } = graphs[c.repo];
    const lesson = newLesson(c.id, c.questions[0], graph);
    const history = [];
    let prev = null;
    for (let t = 0; t < c.questions.length; t += 1) {
      const events = [];
      const started = Date.now();
      providerCalls = 0;
      tokensIn = 0;
      tokensOut = 0;
      resendReasons = [];
      let text = '';
      let error = null;
      const input = {
            question: c.questions[t],
            intents: [],
            scopeLines: [],
            surface: undefined,
            deictic: false,
            design: undefined,
            designMode: false,
            askMode: 'implementation',
            graph,
            digest,
            cfg,
            resolveReadable: (rel) => resolveInRepo(repoPath, rel),
            repoRoot: repoPath,
            permission: 'full',
            teach: true,
            teachContext: buildTeachContext({ lesson, graph }),
            historyLines: renderAskHistorySection(history, 20),
            callProvider,
            turnDeadlineMs: 0,
      };
      let key = null;
      if (CACHE_DIR && c.questions.length === 1) {
        const dryInput = { ...input, teachContext: buildTeachContext({ lesson: newLesson(c.id, c.questions[0], graph), graph }) };
        const prompt = await firstPrompt(dryInput);
        if (prompt !== null) key = cacheKey(prompt, run);
      }
      if (key && seedRows) {
        const row = seedRows.find((r) => r.convo === c.id && r.run === run && r.turn === t);
        if (row && !row.error) {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
          fs.writeFileSync(cachePath(key), JSON.stringify(row));
          cacheStores += 1;
        }
        continue;
      }
      if (key && fs.existsSync(cachePath(key))) {
        const row = { ...JSON.parse(fs.readFileSync(cachePath(key), 'utf8')), arm: ARM, cached: true };
        results.push(row);
        cacheHits += 1;
        console.log(`[${ARM}] r${run} ${c.id} t${t}: cached (${key.slice(0, 12)})`);
        prev = row.text;
        history.push({ role: 'user', text: c.questions[t] }, { role: 'assistant', text: row.text.slice(0, 2000) });
        continue;
      }
      if (CACHE_ONLY) {
        cacheMisses.push(`${c.id}/r${run}/t${t}`);
        console.log(`[${ARM}] r${run} ${c.id} t${t}: cache miss (not run)`);
        continue;
      }
      try {
        const r = await runAskPipeline(input, (e) => events.push(e));
        text = r.text ?? '';
      } catch (e) {
        error = String(e?.message ?? e);
      }
      const charts = events.filter((e) => e.type === 'chart:proposal').map((e) => e.chart);
      const modelCharts = events.filter((e) => e.type === 'tool:start' && e.name === 'propose_chart').length;
      const reads = events.filter((e) => e.type === 'file:read').map((e) => e.path);
      const s = score(text, prev, charts);
      const row = { arm: ARM, run, convo: c.id, turn: t, ms: Date.now() - started, providerCalls, tokensIn, tokensOut, resendReasons, error, modelCharts, reads, ...s, text };
      results.push(row);
      if (key && !error) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cachePath(key), JSON.stringify(row));
        cacheStores += 1;
      }
      console.log(
        `[${ARM}] r${run} ${c.id} t${t}: ${s.words}w repeat=${s.repeat} code/100=${s.codePer100} shape=${s.productShape} ` +
          `flowChart=${s.conceptFlowChart} fileChart=${s.fileChart} risk=${s.riskClaim} q=${s.quality} calls=${providerCalls} ${Date.now() - started}ms`,
      );
      history.push({ role: 'user', text: c.questions[t] }, { role: 'assistant', text: text.slice(0, 2000) });
      prev = text;
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, `${JSON.stringify({ arm: ARM, model: cfg.model, results }, null, 1)}\n`);
    }
  }
}
if (!SEED_FROM) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify({ arm: ARM, model: cfg.model, results }, null, 1)}\n`);
}
console.log(`wrote ${OUT}`);
if (CACHE_DIR) console.log(`baseline cache: ${cacheHits} reused, ${cacheStores} stored, ${cacheMisses.length} missed${cacheMisses.length ? ` (${cacheMisses.join(' ')})` : ''}, model digest ${String(modelDigest).slice(0, 12)}`);
if (cacheMisses.length > 0) process.exitCode = 4;
