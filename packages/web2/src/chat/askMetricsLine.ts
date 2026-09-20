import type { AskMetrics } from '@sequence/api-types';

import { formatElapsed } from './workRowModel';

/** Harness diagnosis — where the time went (provider vs tool rounds), not a guess. */
export function formatAskMetricsDiagnosis(metrics: AskMetrics): string | null {
  const parts: string[] = [];

  if (typeof metrics.wallMs === 'number' && metrics.wallMs > 0) {
    parts.push(`${formatElapsed(metrics.wallMs)} wall`);
  }

  const calls = metrics.providerCallMs?.length ?? 0;
  if (calls > 0) {
    const sum = metrics.providerCallMs!.reduce((acc, ms) => acc + ms, 0);
    parts.push(
      `${calls} provider call${calls === 1 ? '' : 's'} (${formatElapsed(sum)})`,
    );
  }

  if (metrics.rounds > 0) {
    parts.push(`${metrics.rounds} tool round${metrics.rounds === 1 ? '' : 's'}`);
  }

  if (typeof metrics.outputTokens === 'number' && metrics.outputTokens > 0) {
    const wall = metrics.wallMs ?? 0;
    if (wall > 0) {
      const tps = Math.round((metrics.outputTokens / wall) * 1000);
      if (tps > 0) parts.push(`~${tps} tok/s out`);
    }
  }

  if (metrics.intent) parts.push(`intent ${metrics.intent}`);

  if (metrics.stopReason !== 'complete') {
    parts.push(`stop ${metrics.stopReason}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
