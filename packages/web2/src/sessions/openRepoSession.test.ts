import { describe, expect, it, vi } from 'vitest';

import { openRepoSession } from './openRepoSession';
import type { BootTransport } from '../boot';
import type { SessionsClient } from './sessionsClient';

describe('openRepoSession', () => {
  it('attaches then activates the session', async () => {
    const attach = vi.fn(async () => ({
      outcome: 'ok' as const,
      body: {
        attached: true as const,
        repoName: 'shopfront',
        root: '/home/ubuntu/shopfront',
        graphSummary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
      },
    }));
    const activate = vi.fn(async () => ({
      outcome: 'ok' as const,
      body: { index: { version: 1 as const, activeId: 's1', sessions: [] } },
    }));

    const transport = { attach } as unknown as BootTransport;
    const sessions = { activate } as unknown as SessionsClient;

    const result = await openRepoSession(transport, sessions, '/home/ubuntu/shopfront', 's1');

    expect(result).toEqual({ outcome: 'ok' });
    expect(attach).toHaveBeenCalledWith('/home/ubuntu/shopfront');
    expect(activate).toHaveBeenCalledWith('s1');
  });

  it('returns attach errors without activating', async () => {
    const attach = vi.fn(async () => ({
      outcome: 'error' as const,
      status: 403,
      body: { error: 'path escapes the browse root' },
    }));
    const activate = vi.fn();

    const result = await openRepoSession(
      { attach } as unknown as BootTransport,
      { activate } as unknown as SessionsClient,
      '/etc',
      's1',
    );

    expect(result.outcome).toBe('error');
    expect(activate).not.toHaveBeenCalled();
  });

  it('detaches when activate fails after attach', async () => {
    const attach = vi.fn(async () => ({
      outcome: 'ok' as const,
      body: {
        attached: true as const,
        repoName: 'shopfront',
        root: '/home/ubuntu/shopfront',
        graphSummary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
      },
    }));
    const detach = vi.fn(async () => ({ outcome: 'ok' as const, body: { attached: false } }));
    const activate = vi.fn(async () => ({
      outcome: 'error' as const,
      message: 'session not found',
    }));

    const result = await openRepoSession(
      { attach, detach } as unknown as BootTransport,
      { activate } as unknown as SessionsClient,
      '/home/ubuntu/shopfront',
      'missing',
    );

    expect(result).toEqual({ outcome: 'error', message: 'session not found' });
    expect(detach).toHaveBeenCalled();
  });
});
