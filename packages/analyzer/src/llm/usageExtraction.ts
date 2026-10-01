/**
 * ADR-013 Phase D — extract provider-reported token/cache usage from wire responses.
 *
 * Secret-free: only numeric usage fields; never prompt text or credentials.
 */

import type { ProviderKind } from '../server/provider.js';

export type CacheOutcome = 'hit' | 'miss' | 'write';

/** Normalized usage extracted from a provider response body. */
export interface ExtractedProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheOutcome?: CacheOutcome;
  /** Provider-reported USD when present (rare on most APIs). */
  costUsd?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function anthropicCacheOutcome(usage: Record<string, unknown>): CacheOutcome | undefined {
  const read = num(usage.cache_read_input_tokens);
  const write = num(usage.cache_creation_input_tokens);
  if (read !== undefined && read > 0) return 'hit';
  if (write !== undefined && write > 0) return 'write';
  if (num(usage.input_tokens) !== undefined) return 'miss';
  return undefined;
}

function openAiCacheOutcome(usage: Record<string, unknown>): CacheOutcome | undefined {
  const details = usage.prompt_tokens_details;
  if (details && typeof details === 'object') {
    const cached = num((details as Record<string, unknown>).cached_tokens);
    if (cached !== undefined && cached > 0) return 'hit';
  }
  if (num(usage.prompt_tokens) !== undefined) return 'miss';
  return undefined;
}

/**
 * Parse provider-reported usage from a successful response body.
 * Returns `undefined` when the body carries no recognizable usage block.
 */
export function extractProviderUsage(
  provider: ProviderKind,
  parsed: unknown,
): ExtractedProviderUsage | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const o = parsed as Record<string, unknown>;
  const usage = o.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;

  if (provider === 'anthropic') {
    const inputTokens = num(u.input_tokens);
    const outputTokens = num(u.output_tokens);
    if (inputTokens === undefined && outputTokens === undefined) return undefined;
    const cachedInputTokens = num(u.cache_read_input_tokens);
    return {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      cachedInputTokens: cachedInputTokens && cachedInputTokens > 0 ? cachedInputTokens : undefined,
      cacheOutcome: anthropicCacheOutcome(u),
      costUsd: num(u.cost_usd),
    };
  }

  const inputTokens = num(u.prompt_tokens);
  const outputTokens = num(u.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const details = u.prompt_tokens_details;
  let cachedInputTokens: number | undefined;
  if (details && typeof details === 'object') {
    cachedInputTokens = num((details as Record<string, unknown>).cached_tokens);
  }
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cachedInputTokens: cachedInputTokens && cachedInputTokens > 0 ? cachedInputTokens : undefined,
    cacheOutcome: openAiCacheOutcome(u),
    costUsd: num(u.cost_usd) ?? num(u.total_cost),
  };
}
