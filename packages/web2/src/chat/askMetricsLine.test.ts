import { describe, expect, it } from 'vitest';

import { formatAskMetricsDiagnosis } from './askMetricsLine';

describe('formatAskMetricsDiagnosis', () => {
  it('names provider calls and throughput for slow single-call turns', () => {
    const line = formatAskMetricsDiagnosis({
      wallMs: 480_000,
      rounds: 1,
      stopReason: 'complete',
      designMode: true,
      intent: 'draw',
      outputTokens: 23_085,
      providerCallMs: [472_000],
    });
    expect(line).toMatch(/8m 00s wall/);
    expect(line).toMatch(/1 provider call/);
    expect(line).toMatch(/1 tool round/);
    expect(line).toMatch(/tok\/s out/);
    expect(line).toMatch(/intent draw/);
  });
});
