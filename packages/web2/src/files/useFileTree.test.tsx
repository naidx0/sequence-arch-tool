import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildFileTree } from './filesModel';
import { SLICED_TREE_MIN_PATHS, useFileTree } from './useFileTree';

const many = Array.from({ length: SLICED_TREE_MIN_PATHS + 400 }, (_, i) => `pkg${i % 20}/src/f${i}.ts`);

describe('useFileTree', () => {
  it('a small list is built in the same render, as before', () => {
    const paths = ['a/b.ts', 'c.ts'];
    const { result } = renderHook(() => useFileTree(paths, undefined));
    expect(result.current).toEqual(buildFileTree(paths));
  });
  it('a large list is not built in the render: it arrives after the sliced build, equal to the sync tree', async () => {
    const { result } = renderHook(() => useFileTree(many, undefined));
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(result.current).toEqual(buildFileTree(many));
  });
});
