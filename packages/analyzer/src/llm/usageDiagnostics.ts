/**
 * ADR-013 Phase D — local, secret-free usage/spend diagnostics (no remote telemetry).
 */

import type { ModelUsageRecord } from './modelRoutes.js';
import type { SpendLedgerDiagnostics } from '../server/spendLedger.js';
import { COST_ESTIMATE_VERSION } from './costEstimate.js';

export interface UsageAttemptDiagnostics {
  routeKind: string;
  model: string;
  status: string;
  estimated: boolean;
  costEstimated?: boolean;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheOutcome?: string;
  latencyMs?: number;
  failoverCount?: number;
  reservedCostUsd?: number;
  reconciledCostUsd?: number;
}

export interface UsageDiagnosticsSummary {
  costEstimateVersion: number;
  attempts: UsageAttemptDiagnostics[];
  spend?: SpendLedgerDiagnostics;
  totalCostUsd: number;
  totalEstimatedCostUsd: number;
}

/** Map usage records to a secret-free local diagnostics view. */
export function summarizeUsageDiagnostics(
  records: ModelUsageRecord[],
  spend?: SpendLedgerDiagnostics,
): UsageDiagnosticsSummary {
  let totalCostUsd = 0;
  let totalEstimatedCostUsd = 0;
  const attempts: UsageAttemptDiagnostics[] = records.map((r) => {
    if (r.costUsd !== undefined) {
      totalCostUsd += r.costUsd;
      if (r.costEstimated) totalEstimatedCostUsd += r.costUsd;
    }
    return {
      routeKind: r.routeKind,
      model: r.model,
      status: r.status,
      estimated: r.estimated,
      costEstimated: r.costEstimated,
      costUsd: r.costUsd,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cachedInputTokens: r.cachedInputTokens,
      cacheOutcome: r.cacheOutcome,
      latencyMs: r.latencyMs,
      failoverCount: r.failoverCount,
      reservedCostUsd: r.reservedCostUsd,
      reconciledCostUsd: r.reconciledCostUsd,
    };
  });
  return {
    costEstimateVersion: COST_ESTIMATE_VERSION,
    attempts,
    spend,
    totalCostUsd,
    totalEstimatedCostUsd,
  };
}
