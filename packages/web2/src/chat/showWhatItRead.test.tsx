import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { readNodeIds } from '../agents/readPathsLit';
import { CanvasProvider, useCanvas, type CanvasChannel } from '../canvas/canvasChannel';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { summarizeGraph } from '../boot';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { RunFoot } from './AgentRunThread';
import type { AgentRun } from '../agents/agentRuns';
import type { GetArchGraphResponse } from '@sequence/api-types';

afterEach(cleanup);

const NODES = [
  { id: 'repo', label: 'r', kind: 'repo' },
  { id: 'svc:gateway', label: 'gateway', kind: 'service', parentId: 'repo' },
  { id: 'svc:orders', label: 'orders', kind: 'service', parentId: 'repo' },
  { id: 'svc:mail', label: 'mail', kind: 'service', parentId: 'repo' },
  { id: 'mod:orders/api', label: 'api', kind: 'module', parentId: 'svc:orders', path: 'orders/api' },
  { id: 'file:orders/api/h.ts', label: 'h.ts', kind: 'file', parentId: 'mod:orders/api', path: 'orders/api/h.ts' },
  { id: 'file:gateway/r.ts', label: 'r.ts', kind: 'file', parentId: 'svc:gateway', path: 'gateway/r.ts' },
  { id: 'file:mail/m.ts', label: 'm.ts', kind: 'file', parentId: 'svc:mail', path: 'mail/m.ts' },
];

let channel: CanvasChannel | null = null;
function Probe() {
  channel = useCanvas();
  return null;
}

function mount(readPaths: string[] | undefined) {
  const g = { repoName: 'r', scannedAt: '2026-10-05T00:00:00.000Z', nodes: NODES, edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
  const store = createStore({ project: (x) => seqdFromGraph(x, x.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
  store.dispatch({ type: 'repo/loaded', draft: { root: '/tmp/r', repoName: 'r', graph: g, summary: summarizeGraph(g), scannedAt: g.scannedAt }, at: 0 });
  const run = { id: 'r1', status: 'done', items: [], approvals: [], error: null, prompt: 'q', readPaths } as unknown as AgentRun;
  return render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <Probe />
        <RunFoot run={run} />
      </CanvasProvider>
    </StoreProvider>,
  );
}

describe('answer path on the map (I10)', () => {
  it('maps read files to the services that hold them, once each', () => {
    expect(readNodeIds(['orders/api/h.ts', 'gateway/r.ts', './gateway/r.ts', 'nope.ts'], NODES).sort()).toEqual(['svc:gateway', 'svc:orders']);
    expect(readNodeIds([], NODES)).toEqual([]);
  });

  it('a run that read files in two services lights exactly those two, and clears', () => {
    mount(['orders/api/h.ts', 'gateway/r.ts']);
    fireEvent.click(screen.getByTestId('run-show-read'));
    expect(channel!.canvas.dim?.litNodeIds.slice().sort()).toEqual(['svc:gateway', 'svc:orders']);
    expect(channel!.canvas.dim?.litEdgeIds).toEqual([]);
    fireEvent.click(screen.getByTestId('run-show-read'));
    expect(channel!.canvas.dim).toBeNull();
    act(() => {});
  });

  it('an empty or absent readPaths lights nothing and hides the action', () => {
    mount([]);
    expect(screen.queryByTestId('run-show-read')).toBeNull();
    cleanup();
    mount(undefined);
    expect(screen.queryByTestId('run-show-read')).toBeNull();
    expect(channel!.canvas.dim).toBeNull();
  });
});
