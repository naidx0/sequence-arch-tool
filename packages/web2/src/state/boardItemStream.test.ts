import { describe, expect, it } from 'vitest';

import { createStore } from './store';

describe('board:item SeqDraw stream', () => {
  it('appends agent marks and opens AI Canvas work row', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'draw a campus map' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'board:item',
        items: [
          { kind: 'text', id: 'n1', at: { x: 10, y: 20 }, text: 'Gate' },
          {
            kind: 'shape',
            id: 's1',
            shape: 'rect',
            from: { x: 0, y: 0 },
            to: { x: 80, y: 60 },
          },
        ],
      },
      at: 2,
    });
    const session = store.getState().session;
    expect(session.boardAgentItems).toHaveLength(2);
    expect(session.boardAgentItems[0]).toMatchObject({ kind: 'text', id: 'n1', text: 'Gate' });
    const work = session.inFlight?.work ?? [];
    expect(work.some((w) => w.from === 'board:item' && w.opens === 'ai-canvas')).toBe(true);
  });

  it('does not double-append the same id', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'x' });
    store.dispatch({ type: 'turn/send', at: 1 });
    const item = { kind: 'text' as const, id: 'n1', at: { x: 1, y: 1 }, text: 'A' };
    store.dispatch({ type: 'turn/event', event: { type: 'board:item', items: [item] }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'board:item', items: [item] }, at: 3 });
    expect(store.getState().session.boardAgentItems).toHaveLength(1);
  });
});
