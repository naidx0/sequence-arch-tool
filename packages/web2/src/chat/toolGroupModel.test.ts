import { describe, expect, it } from 'vitest';

import { groupConsecutive, summarizeCalls, toolKindOfName } from './toolGroupModel';

describe('summarizeCalls: counts by tool kind', () => {
  it('reads like the Claude Code row', () => {
    expect(
      summarizeCalls([{ toolKind: 'read' }, { toolKind: 'read' }, { toolKind: 'read' }, { toolKind: 'execute' }, { toolKind: 'execute' }, { toolKind: 'edit', files: 1 }]),
    ).toBe('Read 3 files, ran 2 commands, edited 1 file');
  });
  it('maps Sequence tool names onto the same kinds', () => {
    expect(summarizeCalls(['read_file', 'read_file', 'run_command', 'search_files'].map((n) => ({ toolKind: toolKindOfName(n) })))).toBe('Read 2 files, ran 1 command, 1 search');
    expect(toolKindOfName('something_new')).toBeNull();
  });
});

describe('groupConsecutive', () => {
  const items = ['a', 'b', 'X', 'c', 'd', 'e'];
  const canFold = (s: string): boolean => s !== 'X';
  it('Focused folds each run and leaves the failed item alone, in order', () => {
    expect(groupConsecutive(items, 'focused', canFold)).toEqual([['a', 'b'], ['X'], ['c', 'd', 'e']]);
  });
  it('Detailed folds nothing', () => {
    expect(groupConsecutive(items, 'detailed', canFold)).toEqual(items.map((i) => [i]));
  });
  it('keeps every item exactly once, whatever the mode', () => {
    for (const mode of ['focused', 'detailed'] as const) expect(groupConsecutive(items, mode, canFold).flat()).toEqual(items);
  });
  it('an empty list is no runs', () => {
    expect(groupConsecutive([], 'focused', canFold)).toEqual([]);
  });
});
