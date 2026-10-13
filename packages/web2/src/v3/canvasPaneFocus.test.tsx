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
   and a live `canvas:block` in the ACTIVE session's in-flight turn. The shell
   HAS grown that effect now (2026-09-20), and this file is what kept it
   honest: the first version watched `canvasDoc.blocks` and re-broke the
   owner's report above, because from the document a block the model just wrote
   and a block an opened thread brought with it look the same. It reads
   `session.surfaceFocus` instead, which only the producing reducer arms set
   and which `session/browse` clears.

   THE POSITIVE CONTROL FOR THAT EFFECT IS IN `chat/chatBoardIntegration.test.tsx`
   ("canvas:block auto-opens AI Canvas when a live block lands"), and the one
   at the bottom of this file fires the explicit door. Between them the
   refusals above are the shell DECLINING rather than a pane that cannot be
   opened at all — each exit with a case that produces only it.

   AI CANVAS IS HIDDEN (2026-10-05, `SHIPPED_SURFACES` in app/chromeTabModel.ts).
   While it is, no door opens it and the positive controls cannot fire; the last
   case below proves the explicit door still works by opening a shipped surface
   through it, and that the same door refuses AI Canvas.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, render } from '@testing-library/react';
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
  /* Decision 49: the focused surface's pill carries is-focused. */
  const pill = document.querySelector('nav[aria-label="Workspace"] button.is-focused');
  return pill?.textContent ?? null;
}

/** Open by its pill when it has one, or by a mounted pane (hidden surfaces have no pill). */
function aiCanvasOpen(): boolean {
  /* By attribute and text, not `queryByRole`: a role query computes every
     button's accessible name and visibility through jsdom's style cascade, and
     on the whole shell that was ~200 ms a call (a CPU profile put 817 of this
     test's 1,047 ms in here), which is what timed the file out under
     full-suite load. Hidden buttons count too, so this is no looser. */
  const pill =
    [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'AI Canvas' || (b.textContent ?? '').trim() === 'AI Canvas',
    ) ?? null;
  if (pill?.getAttribute('aria-pressed') === 'true') return true;
  return document.querySelector('[data-surface="ai-canvas"]') !== null;
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

  it('the explicit door opens a shipped surface, and refuses AI Canvas while it is hidden', async () => {
    /* Each exit needs a case that produces only it. The same door
       (`requestHostCommand`) opens Whiteboard, so the refusal is the
       SHIPPED_SURFACES gate and not a door that does nothing. */
    const store = freshStore();
    await act(async () => {
      render(<V3App appStore={store} />);
    });
    expect(aiCanvasOpen()).toBe(false);
    const before = selectedPill();

    await act(async () => {
      requestHostCommand('canvas.ai');
    });
    expect(aiCanvasOpen()).toBe(false);
    expect(selectedPill()).toBe(before);

    await act(async () => {
      requestHostCommand('canvas.whiteboard');
    });
    expect(selectedPill()).toBe('Spaces');
  });
});
