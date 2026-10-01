import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { GetArchGraphResponse } from '@sequence/api-types';

import { openPane, paneIsFocused, paneIsOpen } from '../../test/support/v3';
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

    /* OPEN AND FOCUSED ARE TWO FACTS IN V3 and this case is about both: the
       pane has to be mounted for the proposal to be drawn at all, and it has
       to be the focused one or the reader is looking at something else. See
       `test/support/v3.ts` for why a rename would have hidden the difference. */
    expect(paneIsOpen('architecture')).toBe(true);
    expect(paneIsFocused('architecture')).toBe(true);
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

    expect(paneIsOpen('ai-canvas')).toBe(true);
    expect(paneIsFocused('ai-canvas')).toBe(true);
    expect(screen.getByTestId('ai-canvas')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-block-markdown').textContent).toMatch(/Step 1/);
  });

  it('the board is reachable from the bar when a proposal is on it', () => {
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

    /*
     * ── THE OPENS ROW IS NOT IN V3, AND THE WAY IN IS ──────────────────────
     *
     * This clicked `chat-opens-row` — a line in the v2 transcript that said
     * which surface a work row opened, and switched to it. `WorkRowLine` still
     * exists and `Transcript` still draws it; V3's own transcript does not.
     *
     * That row was a SECOND door to the architecture pane, and the pane now
     * opens itself when a proposal lands (V3Shell), so the first door is
     * automatic. What is left to check is that the reader is not trapped:
     * closing the pane and re-opening it from the bar puts them back on the
     * proposal, which is the property the opens row existed to provide.
     *
     * Whether V3's transcript should ALSO carry a per-row door is a design
     * question and not this test's to decide — it is in the owner's list.
     */
    render(<App appStore={store} />);

    fireEvent.click(screen.getByTestId('v3-tab-close-architecture'));
    expect(paneIsOpen('architecture')).toBe(false);

    openPane('architecture');
    expect(paneIsOpen('architecture')).toBe(true);
    expect(screen.getByTestId('board-proposal').textContent).toMatch(/Add cache layer/);
  });

  it('file proposal sets filesFocus for the Files IDE panel', () => {
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

    expect(store.getState().session.filesFocus?.path).toBe('gateway/src/lib/seat4-health.ts');
    expect(store.getState().session.filesFocus?.view).toBe('diff');
    const turn = store.getState().session.turns.find((t) => t.role === 'assistant');
    expect(turn && turn.role === 'assistant' && turn.work.some((w) => w.opens === 'files')).toBe(true);
  });
});
