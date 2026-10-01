import { describe, expect, it } from 'vitest';

import { canvasBlockChip } from './canvasBlockChip';

describe('canvasBlockChip', () => {
  it('builds a grounded canvas-block chip from block metadata', () => {
    const chip = canvasBlockChip({ id: 'blk-1', type: 'markdown', title: 'Plan' });
    expect(chip.kind).toBe('canvas-block');
    expect(chip.ref).toBe('blk-1');
    expect(chip.id).toBe('canvas-block:blk-1');
    expect(chip.label).toBe('Markdown · Plan');
  });
});
