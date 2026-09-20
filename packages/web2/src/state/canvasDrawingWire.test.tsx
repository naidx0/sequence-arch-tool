import { describe, expect, it } from 'vitest';

import type { PostAskStreamRequest } from '@sequence/api-types';
import type { ArchGraph } from '@sequence/schema';

import type { AskTransport } from '../chat/askClient';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import type { WhiteboardDoc } from '../whiteboard/whiteboardModel';
import { composerPropsFrom } from './connect';
import { createStore } from './store';

/**
 * THE READER'S OWN MARKS REACH THE MODEL.
 *
 * The canvas moat audit (docs/research/ai-canvas-moat-audit.md, 2026-09-18)
 * measured that nothing a person drew on the AI Canvas — a note, a shape, a
 * stroke — ever reached the prompt: only the agent's own blocks did. The pure
 * layer (`withDrawingState`, `boardItemsForAsk`) landed with that audit; this
 * is the wire: the surface reports its document into `session.canvasDrawing`,
 * and the send folds it into the ask surface's `board`.
 */

const GRAPH: ArchGraph = {
  version: 1,
  scannedAt: '2026-08-22T00:00:00.000Z',
  root: 'C:/repos/sequence',
  nodes: [{ id: 'svc:api', kind: 'service', label: 'api', path: 'packages/api' }],
  edges: [],
} as unknown as ArchGraph;

function attachedStore() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), persisted: null });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: 'C:/repos/sequence',
      repoName: 'sequence',
      graph: GRAPH,
      summary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  } as never);
  return store;
}

function capturing() {
  const sent: PostAskStreamRequest[] = [];
  const transport: AskTransport = {
    stream: async (request, _handlers) => {
      sent.push(request);
      return { outcome: 'ok', status: 200, body: null };
    },
  };
  return { sent, transport };
}

const DRAWING: WhiteboardDoc = {
  version: 1,
  items: [
    { id: 't1', kind: 'text', at: { x: 40, y: 40 }, text: 'cache goes here' },
  ],
} as unknown as WhiteboardDoc;

describe('the AI Canvas drawing reaches the send', () => {
  it('a note the reader typed on the plane is in the ask surface board', () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({ type: 'composer/ask-surface', surface: { surface: 'ai-canvas' } } as never);
    store.dispatch({ type: 'session/canvas-drawing', doc: DRAWING });
    store.dispatch({ type: 'composer/draft', text: 'what do you make of my note' });
    composerPropsFrom(store.getState(), store, transport).onSend();

    expect(sent).toHaveLength(1);
    const surface = sent[0]!.surface as { board?: { items?: { label?: string }[] } } | undefined;
    const texts = (surface?.board?.items ?? []).map((i) => i.label);
    expect(texts).toContain('cache goes here');
  });

  it('a session switch forgets the previous thread\'s drawing', () => {
    const store = attachedStore();
    store.dispatch({ type: 'session/canvas-drawing', doc: DRAWING });
    expect(store.getState().session.canvasDrawing).toBe(DRAWING);
    store.dispatch({ type: 'session/browse', activeId: 'session-b', turns: [], browseRepoPath: null });
    expect(store.getState().session.canvasDrawing).toBeNull();
  });
});

/**
 * WAVE B2 — the same wire carries WHERE things sit, into the document.
 *
 * The pad owns the live geometry; this is the dispatch that makes it part of
 * `canvasDoc`, which is what the settled PUT writes to `canvas.json`. Without
 * it the arrangement stays in this origin's localStorage and a canvas opened
 * anywhere else re-cascades every artifact down the left edge.
 */
function drawingWith(frame: { x: number; y: number; w: number; h: number }): WhiteboardDoc {
  return {
    version: 1,
    items: [
      { id: 't1', kind: 'text', at: { x: 40, y: 40 }, text: 'cache goes here' },
      {
        id: 'artifact:block:b1',
        kind: 'artifact',
        at: { x: frame.x, y: frame.y },
        size: { w: frame.w, h: frame.h },
        ref: { type: 'block', blockId: 'b1' },
      },
    ],
  } as unknown as WhiteboardDoc;
}

function storeOwningACanvas() {
  const store = attachedStore();
  store.dispatch({ type: 'session/browse', activeId: 'session-a', turns: [], browseRepoPath: null });
  store.dispatch({
    type: 'session/canvas-hydrated',
    forSession: 'session-a',
    doc: {
      blocks: [{ id: 'b1', type: 'markdown', title: 'Note', payload: '# Hi', status: 'landed' }],
    },
  } as never);
  return store;
}

describe('where the reader put things becomes part of the canvas document', () => {
  it('a moved artifact is recorded as a frame on this thread\'s canvas', () => {
    const store = storeOwningACanvas();
    store.dispatch({ type: 'session/canvas-drawing', doc: drawingWith({ x: 900, y: 1200, w: 640, h: 400 }) });
    expect(store.getState().session.canvasDoc.frames).toEqual({
      'artifact:block:b1': { x: 900, y: 1200, w: 640, h: 400 },
    });
  });

  it('a drawing that moved nothing leaves the document object untouched', () => {
    const store = storeOwningACanvas();
    store.dispatch({ type: 'session/canvas-drawing', doc: drawingWith({ x: 10, y: 20, w: 30, h: 40 }) });
    const first = store.getState().session.canvasDoc;
    /* A new stroke, same arrangement: the canvas must not be rewritten, or the
       settled PUT wakes on every pen-up. */
    store.dispatch({ type: 'session/canvas-drawing', doc: drawingWith({ x: 10, y: 20, w: 30, h: 40 }) });
    expect(store.getState().session.canvasDoc).toBe(first);
  });

  it('a drawing with no artifacts records nothing at all', () => {
    const store = storeOwningACanvas();
    store.dispatch({ type: 'session/canvas-drawing', doc: DRAWING });
    expect(store.getState().session.canvasDoc.frames).toBeUndefined();
  });

  it('the PREVIOUS thread’s artifacts are never written onto the new one’s canvas', () => {
    const store = storeOwningACanvas();
    /* The switch stamps a FRESH EMPTY canvas with the new id in the same
       dispatch, so an identity check (forSession === activeId) is true here
       and cannot see the pad still reporting thread A's artifacts. What
       stops it is that B's canvas owns no artifact by that id. */
    store.dispatch({ type: 'session/browse', activeId: 'session-b', turns: [], browseRepoPath: null });
    expect(store.getState().session.canvasDoc.forSession).toBe('session-b');
    store.dispatch({ type: 'session/canvas-drawing', doc: drawingWith({ x: 900, y: 1200, w: 640, h: 400 }) });
    expect(store.getState().session.canvasDoc.frames).toBeUndefined();
  });
});
