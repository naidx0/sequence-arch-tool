/**
 * ===========================================================================
 * AI-JUDGE TIER — SEAM ONLY. NOT IMPLEMENTED. CALLS NO MODEL.
 * ===========================================================================
 *
 * The deterministic tier answers "did the engine produce a graph, and is it
 * internally sound?". It cannot answer "is this label the right English for
 * this module?" — that needs a judge model, and a judge model needs a key.
 *
 * This file is the seam and nothing else. It is deliberate that it contains no
 * HTTP call, no prompt and no model id: a half-built judge that emitted plausible
 * scores would be exactly the fabrication CLAUDE.md forbids. Until it is built,
 * every repo gets an explicit SKIP row stating why, and no judged number ever
 * appears in a summary.
 *
 * ---------------------------------------------------------------------------
 * WHEN IMPLEMENTING (the contract the rest of the harness already assumes)
 * ---------------------------------------------------------------------------
 *  1. Gate on `process.env.OPENROUTER_API_KEY`. No key ⇒ skip. Never fall back
 *     to another provider, never read a key from a file the user did not point
 *     at, never print the key (HANDOFF: "the key is written to that file and
 *     nowhere else").
 *  2. Sample at most `MAX_JUDGED_CARDS_PER_REPO` cards per repo, chosen
 *     deterministically (stable sort by node id, then take), so two runs judge
 *     the same cards and a diff means a quality change, not a sampling change.
 *  3. Always include the four ground-truthed repos in any judged run — they are
 *     the only rows where a judge's verdict can be cross-checked against a
 *     hand-verified truth.
 *  4. Send the card's own grounded evidence (label, path, member files) and ask
 *     for a bounded verdict + a reason. Store the verbatim model reply next to
 *     the score in the JSONL; a score with no reply is not reviewable.
 *  5. Cost: print the token/$ estimate BEFORE the run and the real number after
 *     (product-principles §8).
 *  6. Return rows of the shape {id, status:'judged', model, cards:[...], costUsd}
 *     so `report.mjs` can table them without special-casing.
 */

/** Bound from the gap plan (G-A): a judged run reads cards, not whole repos. */
export const MAX_JUDGED_CARDS_PER_REPO = 10;

export const JUDGE_SKIP_NO_KEY =
  'skipped — OPENROUTER_API_KEY is not set, so no judge model was called (deterministic tier only)';
export const JUDGE_SKIP_DISABLED = 'skipped — --no-ai was passed, so no judge model was called';
export const JUDGE_SKIP_NOT_IMPLEMENTED =
  'skipped — the AI-judge tier is a documented seam and is not implemented yet; ' +
  'no judge model was called and no judged score exists. See tools/qa-loop/lib/judge.mjs.';

/**
 * Produce one judge row per repo. Today that is always a SKIP.
 *
 * @param {{id: string}[]} rows deterministic result rows
 * @param {{noAi?: boolean, env?: Record<string,string|undefined>}} [opts]
 * @returns {{id: string, status: 'skipped', reason: string}[]}
 */
export function runAiJudgeTier(rows, opts = {}) {
  const env = opts.env ?? process.env;
  const reason = opts.noAi
    ? JUDGE_SKIP_DISABLED
    : env.OPENROUTER_API_KEY
      ? JUDGE_SKIP_NOT_IMPLEMENTED
      : JUDGE_SKIP_NO_KEY;
  return rows.map((r) => ({ id: r.id, status: 'skipped', reason }));
}
