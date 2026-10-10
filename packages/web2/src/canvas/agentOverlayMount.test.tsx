import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { agentStore } from '../agents/agentStream.js';
import type { AgentEvent } from '../agents/agentTypes.js';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore } from '../state';
import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { installResizeObserver } from './testResizeObserver';
import { STREAM_DELAY_MS } from './AgentOverlay';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/* STREAM 3b: stream 2's AgentOverlay is mounted where the board renders, so a
   hook event about a file in a service lights that service's card on the real
   board (not a hand-built DOM). */

const GRAPH = {
  repoName: 'mount',
  scannedAt: '2026-10-05T00:00:00.000Z',
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', file: 'gateway', line: 1 },
    { id: 'svc:orders', label: 'orders', kind: 'service', file: 'orders', line: 1 },
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function edit(): AgentEvent {
  return {
    id: 'ev-mount-1',
    at: Date.now(),
    source: 'claude-hook',
    sessionId: 'mount',
    kind: 'tool_end',
    tool: 'Edit',
    toolKind: 'edit',
    paths: ['gateway/src/index.ts'],
    status: 'done',
    toolUseId: 'u1',
    title: 'Edit gateway/src/index.ts',
    board: [
      {
        path: 'gateway/src/index.ts',
        fileNodeId: 'file:gateway/src/index.ts',
        moduleId: null,
        serviceId: 'svc:gateway',
        serviceLabel: 'gateway',
        touchedEdgeIds: [],
        liftedEdges: [],
      },
    ],
  } as AgentEvent;
}

describe('the agent overlay on the board', () => {
  it('lights the card of the service an agent just edited, with a chip naming the agent and its action', async () => {
    const store = createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    store.dispatch({
      type: 'repo/loaded',
      draft: { root: '/tmp/mount', repoName: 'mount', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: GRAPH.scannedAt! },
      at: 0,
    });
    render(
      <StoreProvider store={store}>
        <CanvasProvider>
          <DocProvider>
            <ConnectedBoard />
          </DocProvider>
        </CanvasProvider>
      </StoreProvider>,
    );
    const card = () => screen.getAllByTestId('board-node').find((el) => el.getAttribute('data-node-id') === 'svc:gateway')!;
    expect(card().hasAttribute('data-agent-here')).toBe(false);
    /* The page's stream opens STREAM_DELAY_MS after the board (out of boot). */
    await act(async () => {
      await new Promise((r) => setTimeout(r, STREAM_DELAY_MS + 100));
    });
    act(() => agentStore.apply(edit()));
    expect(card().getAttribute('data-agent-here')).toBe('live');
    /* The chip names the agent and what it is doing. */
    expect(card().getAttribute('data-agent-chip')).toBe('Main agent: editing index.ts');
    expect(card().getAttribute('data-agent-pulse')).toBe('a');
    const other = screen.getAllByTestId('board-node').find((el) => el.getAttribute('data-node-id') === 'svc:orders')!;
    expect(other.hasAttribute('data-agent-here')).toBe(false);
  });
});
