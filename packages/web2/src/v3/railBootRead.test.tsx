import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import type { SessionsClient, WireResult } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

/**
 * THE RAIL READS `GET /api/sessions` ONCE AT BOOT.
 *
 * Measured 2026-10-05: it read at mount, then again in the render where boot
 * settled, because `attachedRepoPath` and boot arrive together. The read made
 * before boot was already the server's answer for its root (app/bootRead.ts).
 * A root that changes AFTER boot is a different answer and is read again.
 */

const GRAPH = {
  repoName: 'shop',
  scannedAt: '2026-10-05T09:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function draft(root: string) {
  return {
    root,
    repoName: 'shop',
    graph: GRAPH,
    summary: summarizeGraph(GRAPH),
    scannedAt: '2026-10-05T09:00:00.000Z',
  };
}

function countingClient() {
  const lists = { n: 0 };
  const client = {
    list: (): Promise<WireResult<unknown>> => {
      lists.n += 1;
      return Promise.resolve({ outcome: 'ok', body: { index: { version: 1, activeId: 's1', sessions: [] }, repos: [] } });
    },
  } as unknown as SessionsClient;
  return { client, lists };
}

describe('the sessions rail at boot', () => {
  it('does not read again when boot settles with the root, and does when the root changes after boot', async () => {
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    const { client, lists } = countingClient();
    render(
      <StoreProvider store={store}>
        <V3SessionsRail client={client} />
      </StoreProvider>,
    );
    await waitFor(() => expect(lists.n).toBe(1));

    act(() => {
      store.dispatch({
        type: 'boot/settled',
        outcome: {
          kind: 'attached',
          repo: draft('/home/max/shop'),
          platform: { reachable: true, detail: 'the engine answered', at: 1 },
        },
      });
    });
    expect(store.getState().net.reachable).toBe(true);
    expect(store.getState().repo.phase).toBe('attached');
    await new Promise((r) => setTimeout(r, 20));
    expect(lists.n).toBe(1);

    /* Negative control: a root that changes after boot is a new answer. */
    act(() => {
      store.dispatch({
        type: 'repo/loaded',
        draft: draft('/home/max/other'),
        at: 2,
      });
    });
    await waitFor(() => expect(lists.n).toBe(2));
  });
});
