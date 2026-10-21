import { describe, expect, it } from 'vitest';

import { materializeCanvasArtifacts } from './materializeCanvasArtifacts';

describe('materializeCanvasArtifacts', () => {
  it('places charts then blocks as artifact frames with stable ids', () => {
    const items = materializeCanvasArtifacts({
      blocks: [
        { id: 'b1', type: 'markdown', title: 'Note', payload: '# Hi', status: 'landed' },
      ],
      charts: [
        {
          version: 1,
          kind: 'line',
          title: 'y',
          items: [{ id: 'p0', label: '0', value: 0, group: 'y' }],
        },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['artifact:chart:0', 'artifact:block:b1']);
    expect(items.every((i) => i.kind === 'artifact')).toBe(true);
    expect(items[0]!.at.y).toBeLessThan(items[1]!.at.y);
  });

  it('skips pending blocks', () => {
    const items = materializeCanvasArtifacts({
      blocks: [{ id: 'p', type: 'svg', payload: '', status: 'pending' }],
      charts: [],
    });
    expect(items).toEqual([]);
  });

  it('uses content-kind starting sizes (not a universal 300 cage)', () => {
    const items = materializeCanvasArtifacts({
      blocks: [{ id: 'm', type: 'markdown', title: 'Note', payload: '# Hi', status: 'landed' }],
      charts: [
        {
          version: 1,
          kind: 'line',
          title: 'y',
          items: [{ id: 'p0', label: '0', value: 0, group: 'y' }],
        },
      ],
    });
    expect(items[0]!.size.h).toBeGreaterThanOrEqual(340);
    expect(items[1]!.size.h).toBeGreaterThanOrEqual(280);
  });
});
