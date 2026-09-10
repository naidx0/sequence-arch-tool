#!/usr/bin/env node
/**
 * WHAT THE CLIENT PATH GIVES, AND WHAT IT WITHHOLDS.
 *
 *   node tools/bench/provider-boundary.mjs --dry   # capture the prompt, call nothing
 *   node tools/bench/provider-boundary.mjs         # both arms, needs the card
 *
 * Registered design, predictions and decision context:
 * `docs/research/provider-boundary.md`. Read that first; this file only runs it.
 *
 * One identical teach turn, sent two ways to the SAME runtime:
 *
 *   A  the product's path — Ollama's OpenAI-compatible wire, through provider.ts
 *   B  the runtime's own /api/chat, same single user message, same bytes
 *   C  /api/generate with the same string — NOT a control, see below
 *
 * ── HOW THE TWO ARMS ARE MADE IDENTICAL ───────────────────────────────────
 *
 * The prompt is CAPTURED, not rebuilt. `runAskPipeline` is driven once with a
 * provider that records what it was handed and returns a canned string, so no
 * model runs and no card is touched — and the bytes both arms send are then the
 * same object, not two constructions that ought to agree. Two constructions that
 * ought to agree is how a comparison quietly becomes a comparison of something
 * else, which this repository has now done twice.
 *
 * ── WHY /api/chat IS THE CONTROL AND /api/generate IS NOT ─────────────────
 *
 * The product sends `messages: [{ role: 'user', content: prompt }]` and the
 * OpenAI shim applies the model's chat template. `/api/generate` takes a raw
 * prompt and does not. Using it as the control would change the bytes the model
 * sees at the same moment as the wire, confounding the two — the same defect
 * that voided the reasoning-off result earlier this week. `/api/chat` with one
 * user message applies the same template, so the wire is the only difference.
 * Arm C exists to MEASURE the template gap, not to stand in for arm B.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MAKEMORE = path.join(ROOT, 'examples', 'makemore');
const dist = (rel) => url.pathToFileURL(path.join(ROOT, 'packages/analyzer/dist', rel)).href;
const DRY = process.argv.includes('--dry');

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.SEQUENCE_AI_MODEL || 'granite42-hermes';

const { runAskPipeline } = await import(dist('server/askPipeline.js'));
const { scanRepo } = await import(dist('scan.js'));
const { buildDigest } = await import(dist('explain/explain.js'));
const { buildTeachContext, newLesson } = await import(dist('server/lessonState.js'));
const { resolveInRepo } = await import(dist('server/jail.js'));

/* ── capture one teach prompt, with no model ─────────────────────────────── */

const QUESTION = 'Teach me how bigram_counts.py works.';
const graph = await scanRepo(MAKEMORE, { cluster: true });
const digest = buildDigest(graph);
const lesson = newLesson('pb-01', QUESTION, graph);

let captured = null;
await runAskPipeline(
  {
    question: QUESTION,
    intents: [],
    scopeLines: [],
    askMode: 'research',
    deictic: false,
    designMode: false,
    graph,
    digest,
    cfg: { provider: 'openai-compatible', model: MODEL, apiKey: 'capture' },
    resolveReadable: (rel) => resolveInRepo(MAKEMORE, rel),
    repoRoot: MAKEMORE,
    permission: 'full',
    teach: true,
    teachContext: buildTeachContext({ lesson, graph }),
    turnDeadlineMs: 0,
    callProvider: async (_cfg, prompt) => {
      if (captured === null) captured = prompt;
      return { text: 'captured', toolRequests: [] };
    },
  },
  () => {},
);

if (captured === null) throw new Error('no prompt was captured — the pipeline called no provider');
console.log(`captured one teach prompt: ${captured.length} chars, ~${Math.round(captured.length / 4)} tokens`);
console.log(`  repo ${path.relative(ROOT, MAKEMORE)} — ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

/* ── the arms ────────────────────────────────────────────────────────────── */

/** Nanoseconds to milliseconds, or null when the field is absent. */
const ms = (ns) => (typeof ns === 'number' ? Number((ns / 1e6).toFixed(1)) : null);

async function armA() {
  const providerMod = await import(dist('server/provider.js'));
  const cfg = {
    provider: 'openai-compatible',
    model: MODEL,
    baseUrl: `${HOST}/v1`,
    apiKey: 'local',
    temperature: 0,
    maxRetries: 1,
    timeoutMs: 600_000,
    /* num_ctx CANNOT be set here — it is accepted and ignored on this wire, a
       fact already measured and recorded in provider.ts. Its absence is one of
       the columns. */
  };
  const t0 = Date.now();
  const { text, providerUsage } = await providerMod.generateTextWithUsage(cfg, captured, {});
  return {
    arm: 'A — product path (/v1/chat/completions via provider.ts)',
    wallMs: Date.now() - t0,
    chars: (text ?? '').length,
    promptTokens: providerUsage?.inputTokens ?? null,
    genTokens: providerUsage?.outputTokens ?? null,
    loadMs: null,
    promptEvalMs: null,
    genMs: null,
    totalMs: null,
    reasoningText: null,
    numCtxApplied: null,
  };
}

async function armNative(endpoint, body, label) {
  const t0 = Date.now();
  const res = await fetch(`${HOST}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const wallMs = Date.now() - t0;
  const content = j.message?.content ?? j.response ?? '';
  return {
    arm: label,
    wallMs,
    chars: content.length,
    promptTokens: j.prompt_eval_count ?? null,
    genTokens: j.eval_count ?? null,
    loadMs: ms(j.load_duration),
    promptEvalMs: ms(j.prompt_eval_duration),
    genMs: ms(j.eval_duration),
    totalMs: ms(j.total_duration),
    /* The thing the product cannot see at all today. */
    reasoningText: typeof j.message?.thinking === 'string' ? j.message.thinking.length : null,
    /* Ollama does NOT echo the applied window, so this records what we SET, and
       the registration says so: being able to set it and not be told it is a
       weaker win than being told, and the table must not blur the two. */
    numCtxApplied: body.options?.num_ctx ?? null,
  };
}

if (DRY) {
  console.log('\nDRY — no call made. The two arms would send these bytes:');
  console.log(`  A  POST ${HOST}/v1/chat/completions  messages[0].content = ${captured.length} chars`);
  console.log(`  B  POST ${HOST}/api/chat             messages[0].content = ${captured.length} chars`);
  console.log(`  C  POST ${HOST}/api/generate         prompt              = ${captured.length} chars`);
  console.log('\nColumns arm A structurally cannot fill: loadMs, promptEvalMs, genMs, totalMs,');
  console.log('reasoningText, numCtxApplied — ExtractedProviderUsage has no timing field.');
} else {
  const NUM_CTX = Number(process.env.PB_NUM_CTX || 8192);
  const rows = [];
  rows.push(await armA());
  rows.push(
    await armNative(
      '/api/chat',
      {
        model: MODEL,
        messages: [{ role: 'user', content: captured }],
        stream: false,
        think: false,
        options: { temperature: 0, num_ctx: NUM_CTX },
      },
      'B — runtime /api/chat (same message, same template)',
    ),
  );
  rows.push(
    await armNative(
      '/api/generate',
      {
        model: MODEL,
        prompt: captured,
        stream: false,
        options: { temperature: 0, num_ctx: NUM_CTX },
      },
      'C — runtime /api/generate (NO chat template — measures the gap, not a control)',
    ),
  );

  const cell = (v) => (v === null ? '—' : String(v));
  console.log('');
  for (const r of rows) {
    console.log(r.arm);
    console.log(
      `   wall ${r.wallMs} ms · load ${cell(r.loadMs)} · promptEval ${cell(r.promptEvalMs)} · gen ${cell(r.genMs)} · total ${cell(r.totalMs)}`,
    );
    console.log(
      `   tokens in ${cell(r.promptTokens)} out ${cell(r.genTokens)} · reasoning chars ${cell(r.reasoningText)} · num_ctx set ${cell(r.numCtxApplied)} · reply ${r.chars} chars`,
    );
  }

  const out = path.join(HERE, 'out', 'provider-boundary.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify({ model: MODEL, host: HOST, promptChars: captured.length, numCtx: NUM_CTX, rows }, null, 2)}\n`,
  );
  console.log(`\nwritten: ${path.relative(ROOT, out)}`);
}
