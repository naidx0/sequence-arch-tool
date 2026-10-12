import { describe, expect, it } from 'vitest';

import { createStore } from '../state/store';

describe('edit:proposal → Files chat lock', () => {
  it('sets filesFocus and opens=files on the work row', () => {
    const store = createStore({});
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
    const session = store.getState().session;
    expect(session.filesFocus).toEqual({
      path: 'gateway/src/lib/seat4-health.ts',
      view: 'diff',
      proposedContent: 'export const ok = 1;\n',
    });
    const work = session.inFlight?.work ?? [];
    expect(work.some((w) => w.from === 'edit:proposal' && w.opens === 'files')).toBe(true);
  });
});
