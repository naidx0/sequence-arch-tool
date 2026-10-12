import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sharedGet } from '../api/sharedGet';
import { createSessionsClient, sessionsClient } from './sessionsClient';

/**
 * BOOT READS SHARE ONE REQUEST (measured 2026-10-05, tools/measure/first-board.mjs).
 *
 * `GET /api/sessions` is read at mount by the store's index hydrate and by the
 * rail, in the same tick. `GET /api/sessions/:id` is read at mount by the
 * goal-run hook (through this client) and by the canvas doc channel (through
 * `sharedGet` with the global fetch). Both pairs went out twice.
 */

const realFetch = globalThis.fetch;
let calls: string[];
let release: () => void;

function jsonOnRelease(body: unknown): typeof fetch {
  return vi.fn((input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Promise<Response>((resolve) => {
      release = () =>
        resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
  }) as unknown as typeof fetch;
}

const INDEX = { index: { version: 1, activeId: 's1', sessions: [] } };

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('sessionsClient boot reads', () => {
  it('two concurrent list() calls make one request and both get the answer', async () => {
    const client = createSessionsClient(jsonOnRelease(INDEX));
    const a = client.list();
    const b = client.list();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toEqual(['/api/sessions']);
    expect(ra).toEqual({ outcome: 'ok', body: INDEX });
    expect(rb).toEqual({ outcome: 'ok', body: INDEX });
  });

  it('a list() after the first settled reads the server again (not a cache)', async () => {
    const client = createSessionsClient(jsonOnRelease(INDEX));
    const a = client.list();
    release();
    await a;
    const b = client.list();
    release();
    await b;
    expect(calls).toEqual(['/api/sessions', '/api/sessions']);
  });

  it('the product client and a global-fetch sharedGet of one session share one request', async () => {
    globalThis.fetch = jsonOnRelease({ chat: { version: 1, sessionId: 's1', turns: [] }, meta: {} });
    const viaClient = sessionsClient.readSession('s1');
    const viaShared = sharedGet('/api/sessions/s1');
    release();
    const [rc, rs] = await Promise.all([viaClient, viaShared]);
    expect(calls).toEqual(['/api/sessions/s1']);
    expect(rc.outcome).toBe('ok');
    expect(rs.ok).toBe(true);
  });
});
