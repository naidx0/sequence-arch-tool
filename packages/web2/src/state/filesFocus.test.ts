import { describe, expect, it } from 'vitest';

import { createStore } from './store';

describe('edit:proposal → Files focus', () => {
  it('sets filesFocus and opens Files work row', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'fix the guard' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'edit:proposal',
        title: 'Guard fix',
        files: [{ path: 'src/auth.ts', content: 'export const ok = true;\n' }],
      },
      at: 2,
    });
    const session = store.getState().session;
    expect(session.filesFocus).toEqual({
      path: 'src/auth.ts',
      view: 'diff',
      proposedContent: 'export const ok = true;\n',
    });
    const work = session.inFlight?.work ?? [];
    expect(work.some((w) => w.from === 'edit:proposal' && w.opens === 'files')).toBe(true);
  });
});
