import { describe, expect, it } from 'vitest';

import { fromCanvasMemory, toCanvasMemory, worthPersistingCanvas } from './canvasMemory';

describe('canvasMemory', () => {
  it('round-trips blocks and lands live status on persist', () => {
    const doc = {
      blocks: [
        {
          id: 'b1',
          type: 'markdown' as const,
          payload: '# Hi',
          status: 'live' as const,
          title: 'Plan',
        },
      ],
    };
    const raw = toCanvasMemory('sess-1', doc);
    expect(raw.sessionId).toBe('sess-1');
    expect(raw.blocks[0]!.status).toBe('landed');
    const back = fromCanvasMemory(raw);
    expect(back.blocks).toHaveLength(1);
    expect(back.blocks[0]!.payload).toBe('# Hi');
  });

  it('worthPersistingCanvas is false for empty doc', () => {
    expect(worthPersistingCanvas({ blocks: [] })).toBe(false);
    expect(worthPersistingCanvas({ blocks: [{ id: 'x', type: 'html', payload: '<p/>', status: 'landed' }] })).toBe(
      true,
    );
  });

  it('rejects invalid shapes', () => {
    expect(fromCanvasMemory(null).blocks).toEqual([]);
    expect(fromCanvasMemory({ version: 2 }).blocks).toEqual([]);
  });

  it('round-trips storyRoute', () => {
    const doc = {
      blocks: [{ id: 'b1', type: 'markdown' as const, payload: '# Hi', status: 'landed' as const }],
      storyRoute: { title: 'Tour', steps: [{ blockId: 'b1', caption: 'Start' }] },
    };
    const raw = toCanvasMemory('sess-2', doc);
    expect(raw.storyRoute?.title).toBe('Tour');
    const back = fromCanvasMemory(raw);
    expect(back.storyRoute?.steps[0]?.blockId).toBe('b1');
  });

  it('worthPersistingCanvas is true when only storyRoute is set', () => {
    expect(
      worthPersistingCanvas({
        blocks: [],
        storyRoute: { title: 'Empty tour', steps: [{ blockId: 'x', caption: 'Start' }] },
      }),
    ).toBe(true);
  });
});
