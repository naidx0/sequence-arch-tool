import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_ROUTES,
  assertSameOrigin,
  createActivityClient,
  isRunId,
  wireMessage,
} from './activityClient';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE TRANSPORT'S LOCKS
   packages/web2/src/activity/activityClient.test.ts

   Tier 1 with a fake `fetch`. What is asserted is the REQUEST — the exact path,
   the method, and what the client refuses to send at all — because a surface
   that reads the right shape off the wrong route is a surface reading somebody
   else's data.
   ══════════════════════════════════════════════════════════════════════════ */

function recorder(response: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const calls: { path: string; method: string | undefined }[] = [];
  const fetchImpl = (async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => JSON.stringify(response.body ?? { runs: [] }),
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, client: createActivityClient(fetchImpl) };
}

describe('the client asks the routes the engine actually serves', () => {
  it('reads the run list from GET /api/program/runs', async () => {
    const { calls, client } = recorder();
    await client.runs();
    expect(calls).toEqual([{ path: '/api/program/runs', method: 'GET' }]);
    // The inventory and the call site are the same string, not two copies.
    expect(ACTIVITY_ROUTES).toContain(calls[0].path);
  });

  it('reads ACP available and agents for author preflight', async () => {
    const { calls, client } = recorder({ body: { available: true } });
    await client.acpAvailable();
    expect(calls).toEqual([{ path: '/api/acp/available', method: 'GET' }]);
    expect(ACTIVITY_ROUTES).toContain('/api/acp/available');

    const agents = recorder({ body: { agents: [] } });
    await agents.client.acpAgents();
    expect(agents.calls).toEqual([{ path: '/api/acp/agents', method: 'GET' }]);
    expect(ACTIVITY_ROUTES).toContain('/api/acp/agents');
  });

  it('reads one run from GET /api/program/runs/:runId', async () => {
    const { calls, client } = recorder({ body: { run: {}, events: [] } });
    await client.run('run-mn0p1q-0123abcd');
    expect(calls[0].path).toBe('/api/program/runs/run-mn0p1q-0123abcd');
  });

  it('cancels one run through POST /api/program/runs/:runId/cancel', async () => {
    const { calls, client } = recorder({ body: { cancelled: true, status: 'running' } });
    await client.cancel('run-mn0p1q-0123abcd');
    expect(calls).toEqual([
      { path: '/api/program/runs/run-mn0p1q-0123abcd/cancel', method: 'POST' },
    ]);
  });

  it('refuses a run id the engine could not have minted, without asking', async () => {
    /*
     * A run id becomes a URL PATH SEGMENT, and `programRunStore.isRunId` is the
     * whitelist that stops `../../etc` reaching `path.join` on the server. This
     * is the same whitelist one hop earlier: a malformed id never leaves the
     * browser at all.
     */
    const { calls, client } = recorder();
    const answer = await client.run('../../../etc/passwd');
    expect(calls).toEqual([]);
    expect(answer.outcome).toBe('error');
    expect(wireMessage(answer)).toContain('not a run id');
  });

  it('accepts exactly the alphabet the engine mints', () => {
    expect(isRunId('run-mn0p1q-0123abcd')).toBe(true);
    expect(isRunId('run-mn0p1q-0123ABCD')).toBe(false); // the suffix is lowercase hex
    expect(isRunId('run-../x-0123abcd')).toBe(false);
    expect(isRunId('runs')).toBe(false);
    expect(isRunId('')).toBe(false);
  });

  it('refuses an absolute or protocol-relative URL rather than fetching it', () => {
    /* The way a third-party host gets into a local-first client is one
       convenient absolute URL added months later by somebody who has not read
       the file. The guard runs BEFORE the fetch, so such a request never
       happens rather than happening and failing. All four of these are shapes
       a browser resolves off this origin. */
    for (const path of [
      'https://evil.example/api/program/runs',
      '//evil.example/api/program/runs',
      '/\\evil.example/api/program/runs',
      'api/program/runs',
    ]) {
      expect(() => assertSameOrigin(path), path).toThrow(/same-origin/);
    }
    // And it lets the real routes through unchanged.
    for (const route of ACTIVITY_ROUTES) expect(assertSameOrigin(route)).toBe(route);
  });
});

describe('the four outcomes stay four', () => {
  it('renders a refusal in the engine’s own words', async () => {
    const { client } = recorder({ ok: false, status: 400, body: { error: 'no repository attached' } });
    const answer = await client.runs();
    expect(answer.outcome).toBe('error');
    expect(wireMessage(answer)).toBe('no repository attached');
  });

  it('names an origin that answered with something that is not JSON', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      text: async () => '<!doctype html><title>a static host</title>',
    })) as unknown as typeof fetch;
    const answer = await createActivityClient(fetchImpl).runs();
    expect(answer.outcome).toBe('not-json');
    expect(wireMessage(answer)).toContain('not a Sequence engine');
  });

  it('names an origin that answered nothing at all', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const answer = await createActivityClient(fetchImpl).runs();
    expect(answer.outcome).toBe('unreachable');
    expect(wireMessage(answer)).toContain('socket hang up');
  });

  it('falls back to the status only when the refusal named no reason', async () => {
    const { client } = recorder({ ok: false, status: 403, body: {} });
    expect(wireMessage(await client.runs())).toBe('the engine refused with HTTP 403');
  });
});
