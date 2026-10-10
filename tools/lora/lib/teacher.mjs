/**
 * The teacher seam — `generateProposal(prompt) -> Promise<string>`.
 *
 * ==========================================================================
 * NOTHING IN THIS FILE CALLS A MODEL API UNLESS THE OWNER TURNS IT ON.
 * The round that wrote this file was explicitly scoped to BUILD the pipeline,
 * not run it: Phase 0 is parked until Max is at his desktop. So the default
 * teacher is a fixture, the real teacher refuses to run without a deliberate
 * env var, and the whole test suite exercises fixtures only. Zero requests were
 * made to any inference provider while this was written.
 * ==========================================================================
 *
 * There is exactly one interface, used by the dataset build, the eval harness
 * and the tests alike:
 *
 *     { name: string, generateProposal(prompt: string, opts?): Promise<string> }
 *
 * ── Turning the real one on (the owner's command) ──────────────────────────
 *
 *   export SEQUENCE_LORA_TEACHER_ENABLE=1        # the deliberate switch
 *   export SEQUENCE_LORA_TEACHER_BASE_URL=https://api.openai.com/v1   # or any
 *   export SEQUENCE_LORA_TEACHER_MODEL=<a strong model id>            # openai-
 *   export SEQUENCE_LORA_TEACHER_KEY=sk-...                           # compatible
 *   node tools/lora/run.mjs dataset --teacher api --per-repo 12
 *
 * ── What it costs, honestly ────────────────────────────────────────────────
 *
 * The prompt is a full repo digest and is the dominant term. On the pinned
 * corpus our digests run roughly 6k–20k tokens (measure yours: `node
 * tools/lora/run.mjs dataset --dry-run` prints the real per-repo prompt sizes
 * without generating anything). At 19 training repos × 12 requests = 228 calls,
 * ~12k input + ~400 output tokens each, that is on the order of 2.8M input and
 * 0.1M output tokens. At frontier-model list prices in the low single-digit
 * dollars per million input tokens, **expect roughly $5–25 for one full
 * generation pass**, plus a re-run or two — inside the guide's sub-$100 Phase 0
 * budget with room to spare. Confirm against the provider's current price page
 * before pressing go; this is an estimate, not a quote.
 *
 * Cheaper first move: `--per-repo 2 --repos express,gin` costs cents and proves
 * the whole loop end to end.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * The default teacher for every test and every dry run: it returns canned
 * completions, keyed by request id, from a fixture directory or an in-memory map.
 *
 * @param {Record<string,string>|Function} source map of requestId -> completion,
 *        or a function (request) => completion
 */
export function createFixtureTeacher(source) {
  const fn = typeof source === 'function' ? source : (req) => source[req?.id] ?? source['*'];
  return {
    name: 'fixture',
    async generateProposal(prompt, opts = {}) {
      const out = fn(opts.request, prompt);
      if (typeof out !== 'string') {
        throw new Error(
          `fixture teacher has no completion for request "${opts.request?.id ?? '(none)'}" — ` +
            `add one to the fixture map (key "*" is the fallback)`
        );
      }
      return out;
    },
  };
}

/** Load a fixture teacher from a directory of `<requestId>.txt` files. */
export function createFixtureTeacherFromDir(dir) {
  const map = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.txt')) map[path.basename(f, '.txt')] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return createFixtureTeacher(map);
}

export const TEACHER_ENV = Object.freeze({
  enable: 'SEQUENCE_LORA_TEACHER_ENABLE',
  baseUrl: 'SEQUENCE_LORA_TEACHER_BASE_URL',
  model: 'SEQUENCE_LORA_TEACHER_MODEL',
  key: 'SEQUENCE_LORA_TEACHER_KEY',
});

/**
 * THE REAL TEACHER — costs money, and is never constructed by anything in this
 * repo's tests or by any default code path.
 *
 * Two locks, on purpose:
 *   1. it throws unless `SEQUENCE_LORA_TEACHER_ENABLE=1` is set in the
 *      environment — an agent cannot spend the owner's money by importing a
 *      module;
 *   2. the CLI only reaches it when `--teacher api` is passed explicitly.
 *
 * The request shape is the openai-compatible `/chat/completions` one, matching
 * what `packages/analyzer/src/server/provider.ts` already sends: a SINGLE user
 * message, no system role. That is not a style choice — training data whose
 * message layout differs from what inference sends is precisely the §7 silent
 * failure this pipeline is built to avoid.
 */
export function createApiTeacher(env = process.env, fetchImpl = globalThis.fetch) {
  if (env[TEACHER_ENV.enable] !== '1') {
    throw new Error(
      `the API teacher is OFF. It costs money and Phase 0 is parked until the owner green-lights it.\n` +
        `To enable: set ${TEACHER_ENV.enable}=1 plus ${TEACHER_ENV.baseUrl}, ${TEACHER_ENV.model}, ${TEACHER_ENV.key}.\n` +
        `See tools/lora/README.md § "Turning the teacher on".`
    );
  }
  const baseUrl = env[TEACHER_ENV.baseUrl];
  const model = env[TEACHER_ENV.model];
  const key = env[TEACHER_ENV.key];
  const missing = [
    !baseUrl && TEACHER_ENV.baseUrl,
    !model && TEACHER_ENV.model,
    !key && TEACHER_ENV.key,
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`the API teacher is enabled but unconfigured: ${missing.join(', ')}`);

  return {
    name: `api:${model}`,
    async generateProposal(prompt, opts = {}) {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 1400,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`teacher ${model} returned ${res.status}: ${body.slice(0, 400)}`);
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error(`teacher ${model} returned no message content`);
      return text;
    },
  };
}

/** Pick a teacher by CLI name. `api` is the only one that can spend money. */
export function createTeacher(kind, options = {}) {
  if (kind === 'fixture') return createFixtureTeacher(options.fixtures ?? {});
  if (kind === 'fixture-dir') return createFixtureTeacherFromDir(options.dir);
  if (kind === 'api') return createApiTeacher(options.env ?? process.env, options.fetchImpl);
  throw new Error(`unknown teacher "${kind}" — one of: fixture, fixture-dir, api`);
}
