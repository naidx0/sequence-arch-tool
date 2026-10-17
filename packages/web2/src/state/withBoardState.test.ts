import { describe, expect, it } from 'vitest';

import { createStore, withBoardState } from './store';
import type { AskSurfaceContext } from '@sequence/api-types';

describe('withBoardState', () => {
  it('attaches whiteboard items so the agent can revise by id', () => {
    const surface: AskSurfaceContext = { id: 'ai-canvas', title: 'AI Canvas' };
    const next = withBoardState(surface, [
      { kind: 'text', id: 'sb-node-a', at: { x: 10.4, y: 20.6 }, text: 'API' },
      {
        kind: 'noderef',
        id: 'sb-node-b',
        at: { x: 100, y: 40 },
        nodeId: 'svc:api',
        label: 'API svc',
      },
    ]);
    expect(next?.board?.items).toHaveLength(2);
    expect(next?.board?.items[0]).toMatchObject({
      id: 'sb-node-a',
      kind: 'text',
      at: { x: 10, y: 21 },
    });
    expect(next?.board?.items[1]).toMatchObject({
      id: 'sb-node-b',
      kind: 'noderef',
      nodeId: 'svc:api',
    });
  });
});

describe('board:item removeIds + pin', () => {
  it('removeIds drops prior marks and pin records a ghost', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'draw' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'board:item',
        items: [{ kind: 'text', id: 'sb-node-a', at: { x: 0, y: 0 }, text: 'A' }],
      },
      at: 2,
    });
    expect(store.getState().session.boardAgentItems.map((i) => i.id)).toEqual(['sb-node-a']);

    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'board:item',
        items: [{ kind: 'text', id: 'sb-node-b', at: { x: 5, y: 5 }, text: 'B' }],
        removeIds: ['sb-node-a'],
      },
      at: 3,
    });
    expect(store.getState().session.boardAgentItems.map((i) => i.id)).toEqual(['sb-node-b']);

    store.dispatch({
      type: 'board/pin',
      id: 'sb-node-b',
      ghostAt: { x: 5, y: 5 },
      at: { x: 50, y: 60 },
    });
    expect(store.getState().session.boardPinnedIds).toContain('sb-node-b');
    expect(store.getState().session.boardIntentGhosts[0]).toEqual({
      id: 'sb-node-b',
      at: { x: 5, y: 5 },
    });
    expect(store.getState().session.boardAgentItems[0]).toMatchObject({
      id: 'sb-node-b',
      at: { x: 50, y: 60 },
    });
  });
});
