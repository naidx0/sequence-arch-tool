import { describe, expect, it } from 'vitest';

import { deriveScanLiveStatus, scanPercent, scanPhaseLabel } from './scanProgressModel';

describe('scanProgressModel — honest rescan copy', () => {
  it('names elapsed time when the server has not emitted progress yet', () => {
    expect(
      deriveScanLiveStatus({
        startedAt: 0,
        progress: null,
        now: 12_000,
        repoName: 'sequence',
      }),
    ).toBe('Scanning sequence · 12s');
  });

  it('says Rescanning when the previous graph is still on screen', () => {
    expect(
      deriveScanLiveStatus({
        startedAt: 0,
        progress: null,
        now: 4_200,
        repoName: 'shop',
        rescan: true,
      }),
    ).toBe('Rescanning shop · 4.2s');
  });

  it('maps server phase ids to reader-facing labels and percent', () => {
    expect(scanPhaseLabel('analyze')).toBe('Analyzing');
    expect(scanPercent({ done: 1, total: 3, phase: 'analyze' })).toBe(33);
    expect(
      deriveScanLiveStatus({
        startedAt: 1_000,
        progress: { done: 1, total: 3, phase: 'analyze' },
        now: 28_000,
        repoName: 'sequence',
        rescan: true,
      }),
    ).toBe('Rescanning sequence · Analyzing · 33% · 27s');
  });

  it('omits percent once the feed reports the terminal phase', () => {
    expect(
      deriveScanLiveStatus({
        startedAt: 0,
        progress: { done: 3, total: 3, phase: 'done' },
        now: 65_000,
        repoName: 'sequence',
      }),
    ).toBe('Scanning sequence · Finishing · 1m 05s');
  });
});
