/**
 * The eval harness.
 *
 * The metric is the guide's, and it is deliberately blunt (§5): *of N held-out
 * requests, how many produced a proposal our parser accepted with every id
 * grounded* — tuned model vs the same base model untuned, **same sampling
 * settings**. Nothing else is scored. There is no partial credit, no judge
 * model, no human read. That bluntness is the point: it is the one number that
 * cannot be argued with, and if the tuned model does not clearly win it, Phase 0
 * failed and we say so.
 *
 * The grader here is the same `filterCandidates` the dataset build uses, on
 * purpose: the eval must measure exactly the thing training optimised for.
 *
 * NOTHING HERE CALLS A MODEL unless the caller hands it a live client, and
 * `createOpenAICompatibleClient` refuses to be constructed without a deliberate
 * env var. The tests use a stub client. No inference endpoint was contacted
 * while this was written.
 */
import { filterCandidates } from './filter.mjs';

export const EVAL_ENV = Object.freeze({
  enable: 'SEQUENCE_LORA_EVAL_ENABLE',
});

/**
 * A client for any openai-compatible `/chat/completions` endpoint — which
 * includes Ollama at `http://127.0.0.1:11434/v1`, the exact endpoint
 * `packages/web/src/panels/localModelRecommend.ts` already points Sequence at.
 * So the tuned model is evaluated through the same door the product uses.
 *
 * Guarded like the teacher: an agent cannot start a run by importing a module.
 */
export function createOpenAICompatibleClient({ baseUrl, model, apiKey, env = process.env, fetchImpl = globalThis.fetch }) {
  if (env[EVAL_ENV.enable] !== '1') {
    throw new Error(
      `the eval client is OFF. Set ${EVAL_ENV.enable}=1 to run against a live endpoint ` +
        `(local Ollama is free; a hosted endpoint is not). See tools/lora/README.md.`
    );
  }
  if (!baseUrl || !model) throw new Error('createOpenAICompatibleClient: baseUrl and model are required');
  return {
    name: model,
    async complete(prompt, { temperature = 0.2, maxTokens = 1400, seed } = {}) {
      const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
          ...(seed === undefined ? {} : { seed }),
        }),
      });
      if (!res.ok) throw new Error(`${model} returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error(`${model} returned no message content`);
      return text;
    },
  };
}

/**
 * Run one model over the held-out set.
 *
 * @param {object} args
 * @param {{id:string, repoId:string, prompt:string, graph:object, request:string}[]} args.items
 * @param {{name:string, complete:Function}} args.client
 * @param {Function} args.validate the real extractArchProposalFromAnswer
 * @param {object} [args.sampling] passed verbatim to the client — the SAME object
 *        must be used for both arms of the comparison, which `compareArms` checks.
 */
export async function runEvalArm({ items, client, validate, sampling = {} }) {
  const candidates = [];
  const errors = [];
  for (const item of items) {
    let text = '';
    try {
      text = await client.complete(item.prompt, sampling);
    } catch (e) {
      // A transport failure is NOT a format failure. It is counted separately so
      // a flaky endpoint cannot masquerade as a model that lost the format.
      errors.push({ id: item.id, error: String(e.message ?? e) });
      continue;
    }
    candidates.push({ id: item.id, repoId: item.repoId, request: item.request, text, graph: item.graph });
  }
  const graded = filterCandidates(candidates, validate);
  return {
    model: client.name,
    sampling,
    attempted: items.length,
    completed: candidates.length,
    transportErrors: errors,
    passed: graded.accepted.length,
    /** The metric. Denominator is ATTEMPTED, not completed — an unanswered request is a failed request. */
    passRate: items.length === 0 ? 0 : graded.accepted.length / items.length,
    reasonCounts: graded.reasonCounts,
    perRepo: perRepoPassRate(items, graded.accepted),
  };
}

function perRepoPassRate(items, accepted) {
  const total = new Map();
  const pass = new Map();
  for (const i of items) total.set(i.repoId, (total.get(i.repoId) ?? 0) + 1);
  for (const a of accepted) pass.set(a.repoId, (pass.get(a.repoId) ?? 0) + 1);
  const out = {};
  for (const [repoId, n] of total) out[repoId] = { attempted: n, passed: pass.get(repoId) ?? 0, passRate: (pass.get(repoId) ?? 0) / n };
  return out;
}

/**
 * The comparison, plus the stop rule.
 *
 * §7: "Decide *before* the run what pass-rate improvement justifies continuing
 * to Phase 1. Deciding afterwards is how projects talk themselves into sunk
 * cost." So the threshold is an argument to this function and is printed in the
 * report next to the result, whichever way it went.
 */
export function compareArms({ untuned, tuned, minImprovement = 0.15 }) {
  const sameSampling = JSON.stringify(untuned.sampling ?? {}) === JSON.stringify(tuned.sampling ?? {});
  const delta = tuned.passRate - untuned.passRate;
  return {
    untuned: { model: untuned.model, passRate: untuned.passRate, passed: untuned.passed, attempted: untuned.attempted },
    tuned: { model: tuned.model, passRate: tuned.passRate, passed: tuned.passed, attempted: tuned.attempted },
    delta,
    minImprovement,
    sameSampling,
    // A comparison across different sampling settings is not a comparison. It is
    // reported as inconclusive rather than quietly scored.
    verdict: !sameSampling
      ? 'INVALID: the two arms used different sampling settings — rerun with one identical settings object'
      : delta >= minImprovement
        ? `PASS: +${(delta * 100).toFixed(1)} pts, at or above the ${(minImprovement * 100).toFixed(0)}-pt stop rule`
        : `FAIL: +${(delta * 100).toFixed(1)} pts, below the ${(minImprovement * 100).toFixed(0)}-pt stop rule agreed before the run`,
  };
}

/** A deterministic offline client for the tests and for `--dry-run`. */
export function createStubClient(name, respond) {
  return {
    name,
    async complete(prompt, sampling) {
      return respond(prompt, sampling);
    },
  };
}
