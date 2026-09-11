import { describe, expect, it } from 'vitest';

import { sessionsRepoRevision } from './sessionsRepoRevision';

describe('sessionsRepoRevision', () => {
  it('tracks attach, detach, and rescan boundaries', () => {
    expect(sessionsRepoRevision({ phase: 'unattached' })).toBe('unattached:none');
    expect(
      sessionsRepoRevision({
        phase: 'attached',
        repo: { root: '/home/ubuntu/shop' },
      } as Parameters<typeof sessionsRepoRevision>[0]),
    ).toBe('attached:/home/ubuntu/shop');
    expect(
      sessionsRepoRevision({
        phase: 'stale',
        repo: { root: '/home/ubuntu/shop' },
      } as Parameters<typeof sessionsRepoRevision>[0]),
    ).toBe('stale:/home/ubuntu/shop');
    expect(
      sessionsRepoRevision({
        phase: 'scanning',
        root: '/tmp/next',
        repoName: 'next',
        startedAt: 1,
        progress: null,
        previous: null,
      }),
    ).toBe('scanning:/tmp/next');
  });
});
