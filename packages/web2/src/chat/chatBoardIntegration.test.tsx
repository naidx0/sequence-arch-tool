import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { GetArchGraphResponse } from '@sequence/api-types';

import { App } from '../app/App';
import { seqdFromGraph } from '../canvas';
import { summarizeGraph } from '../boot';
import { loadRealRepoScan } from '../rail/realRepoScan.testSupport';
import { createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';

const REPO = resolve(__dirname, '..', '..', '..', '..');
const { graph: GRAPH } = await loadRealRepoScan(REPO);

function storeWithGraph(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: 'sequence',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: new Date().toISOString(),
    },
    at: 0,
  } as never);
  return store;
}

describe('chat proposals reach the right surface', () => {
  it('topology:proposal auto-opens Architecture without clicking the opens row', () => {
    const store = storeWithGraph(GRAPH);
    store.dispatch({ type: 'composer/draft', text: 'add cache' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'topology:proposal',
        title: 'Add cache layer',
        rationale: 'Reduce postgres reads',
        nodes: [{ id: 'svc:cache', label: 'cache', kind: 'service' }],
        edges: [{ id: 'e1', from: 'svc:gateway', to: 'svc:cache', family: 'http' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Proposed.' }, at: 3 });

    render(<App appStore={store} />);

    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('board-proposal').textContent).toMatch(/Add cache layer/);
  });

  it('canvas:block auto-opens AI Canvas when a live block lands', () => {
    const store = storeWithGraph(GRAPH);
    store.dispatch({ type: 'composer/draft', text: 'draw plan' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 2 });
    store.dispatch({
      type: 'turn/event',
      at: 3,
      event: {
        type: 'canvas:block',
        id: 'blk-1',
        blockType: 'markdown',
        title: 'Plan',
        payload: '# Step 1',
        status: 'live',
      },
    });

    render(<App appStore={store} />);

    expect(screen.getByTestId('workspace-tab-ai-canvas').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('ai-canvas')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-block-markdown').textContent).toMatch(/Step 1/);
  });

  it('topology opens row switches to architecture with a ghost proposal', () => {
    const store = storeWithGraph(GRAPH);
    store.dispatch({ type: 'composer/draft', text: 'add cache' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'topology:proposal',
        title: 'Add cache layer',
        rationale: 'Reduce postgres reads',
        nodes: [{ id: 'svc:cache', label: 'cache', kind: 'service' }],
        edges: [{ id: 'e1', from: 'svc:gateway', to: 'svc:cache', family: 'http' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Proposed.' }, at: 3 });

    render(<App appStore={store} />);
    fireEvent.click(screen.getByTestId('chat-opens-row'));

    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('board-proposal').textContent).toMatch(/Add cache layer/);
  });

  it('file proposal opens review on last turn with listed files', async () => {
    const store = storeWithGraph(GRAPH);
    store.dispatch({ type: 'composer/draft', text: 'propose helper' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'Seat4 health helper',
        files: [{ path: 'gateway/src/lib/seat4-health.ts', content: 'export const ok = 1;\n' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Proposed.' }, at: 3 });

    render(<App appStore={store} />);
    fireEvent.click(screen.getByTestId('chat-opens-row'));

    const pane = await screen.findByTestId('review');
    expect(pane.getAttribute('data-scope')).toBe('last-turn');
    expect((await screen.findByTestId('review-totals')).textContent).toMatch(/1 file/);
    expect(screen.getAllByText('gateway/src/lib/seat4-health.ts').length).toBeGreaterThan(0);
  });
});
