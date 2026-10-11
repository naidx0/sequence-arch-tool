/**
 * ADR-013 Phase D — versioned token→USD estimates when providers omit cost.
 *
 * Rates mirror docs/AI_CONNECT_RESEARCH.md / freeTierLimit.ts (DeepSeek-class pricing).
 * Estimates are always marked `costEstimated: true` on usage records.
 */

export const COST_ESTIMATE_VERSION = 1;

/** USD per 1M input tokens (uncached). */
export const INPUT_USD_PER_M = 0.27;
/** USD per 1M cached-input tokens. */
export const CACHED_INPUT_USD_PER_M = 0.07;
/** USD per 1M output tokens. */
export const OUTPUT_USD_PER_M = 1.1;

/** Flat per-call estimate when token counts are unavailable (gateway soft meter). */
export const FLAT_ESTIMATE_USD = 0.0018;

/**
 * Estimate USD from token counts. Always an estimate — never a provider bill.
 */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
  const uncached = Math.max(0, inputTokens - cached);
  return (
    (uncached * INPUT_USD_PER_M + cached * CACHED_INPUT_USD_PER_M + outputTokens * OUTPUT_USD_PER_M) /
    1_000_000
  );
}

/** Conservative pre-request reservation for gateway admission (generous upper bound). */
export function reserveEstimateUsd(inputTokens: number, maxOutputTokens = 8192): number {
  return estimateCostUsd(inputTokens, maxOutputTokens);
}
