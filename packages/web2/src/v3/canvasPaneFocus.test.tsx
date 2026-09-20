/* ══════════════════════════════════════════════════════════════════════════
   THE AI CANVAS PANE OPENS WHEN IT IS ASKED TO, AND NOT OTHERWISE
   packages/web2/src/v3/canvasPaneFocus.test.tsx

   Owner walk 2026-09-17: "when I click on another chat, the canvas plotting
   kind of takes priority — the AI Canvas pane takes over — I never told it
   to."

   Loading a thread is not a request to look at its canvas. Hydration
   (`session/canvas-hydrated`), a soft open (`session/browse`) and the
   optimistic id flip that precedes it are all the READER's navigation; none of
   them is a reason for the workspace to change which surface is in front.

   WHAT MAY OPEN IT: an explicit request — `requestHostCommand('canvas.ai')`,
   which is what a work row's "open on AI Canvas" and a workflow launch call —
   and a live `canvas:block` / `chart:proposal` in the ACTIVE session's
   in-flight turn, should the shell ever grow that effect. The positive control
   at the bottom fires the explicit door, so the refusals above are the shell
   declining rather than a pane that cannot be opened at all.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestHostCommand } from '../app/hostCommands';
import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from './V3App';

const A = 'session-aaaa';
const B = 'session-bbbb';

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

/** The pane the workspace is currently focused on, by its pill. */
function selectedPill(): string | null {
  const wrap = document.querySelector('.v3-tab-wrap.is-selected .v3-tab-label');
  return wrap?.textContent ?? null;
}

function aiCanvasOpen(): boolean {
  return screen.getByRole('button', { name: 'AI Canvas' }).getAttribute('aria-pressed') === 'true';
}

const CHART = {
  version: 1 as const,
  kind: 'bar' as const,
  title: 'Thread A only',
  items: [{ id: 'i1', label: 'one', value: 1 }],
};

describe('switching threads never brings the AI Canvas to the front', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hydrating a canvas, browsing a thread and the optimistic id flip all leave the front pane alone', async () => {
    const store = freshStore();
    await act(async () => {
      render(<V3App appStore={store} />);
    });

    /* The premise: something OTHER than AI Canvas is in front, so "it did not
       take over" is a statement with a before and an after. */
    const before = selectedPill();
    expect(before).not.toBe('AI Canvas');
    expect(aiCanvasOpen()).toBe(false);

    /* Open thread A and give it a drawing — the shape of the owner's report. */
    await act(async () => {
      store.dispatch({
        type: 'session/index',
        sessions: [
          { id: A, title: 'Thread A', createdAt: 'x', updatedAt: 'x' },
          { id: B, title: 'Thread B', createdAt: 'x', updatedAt: 'x' },
        ],
        activeId: A,
      });
      store.dispatch({ type: 'session/browse', activeId: A, turns: [], browseRepoPath: null });
    });
    await act(async () => {
      store.dispatch({
        type: 'session/canvas-hydrated',
        doc: {
          blocks: [{ id: 'b1', type: 'markdown', payload: '# A', status: 'landed' }],
          charts: [CHART],
        },
        forSession: A,
      });
    });
    expect(selectedPill()).toBe(before);
    expect(aiCanvasOpen()).toBe(false);

    /* Now the switch, in the two steps `optimisticSwitch` + `softLoadSession`
       actually take — the window the pane used to jump in. */
    await act(async () => {
      const prev = store.getState().session;
      store.dispatch({ type: 'session/index', sessions: prev.sessions, activeId: B });
      store.dispatch({ type: 'session/hydrating' });
    });
    expect(selectedPill()).toBe(before);
    expect(aiCanvasOpen()).toBe(false);

    await act(async () => {
      store.dispatch({ type: 'session/browse', activeId: B, turns: [], browseRepoPath: null });
    });
    await act(async () => {
      store.dispatch({
        type: 'session/canvas-hydrated',
        doc: { blocks: [{ id: 'b2', type: 'markdown', payload: '# B', status: 'landed' }] },
        forSession: B,
      });
    });
    expect(selectedPill()).toBe(before);
    expect(aiCanvasOpen()).toBe(false);
  });

  it('an explicit request DOES open it — the refusals above are a choice', async () => {
    /* Each exit needs a case that produces only it. Without this the test
       above would pass against a shell that could not open the pane at all. */
    const store = freshStore();
    await act(async () => {
      render(<V3App appStore={store} />);
    });
    expect(aiCanvasOpen()).toBe(false);

    await act(async () => {
      requestHostCommand('canvas.ai');
    });

    expect(aiCanvasOpen()).toBe(true);
    expect(selectedPill()).toBe('AI Canvas');
  });
});
