import { describe, expect, it } from 'vitest';

import type { FileEditProposal } from '../state/types';
import { summarizeEditLedger } from './editLedgerModel';

describe('summarizeEditLedger', () => {
  it('aggregates proposal file diffs', () => {
    const proposal: FileEditProposal = {
      id: 'p1',
      turnId: 'a1',
      title: 'Fix auth',
      rationale: null,
      status: 'pending',
      verify: null,
      files: [
        { path: 'src/a.ts', content: 'line1\nline2\n', decision: 'pending', diff: null, comments: [] },
        { path: 'src/b.ts', content: 'x\n', decision: 'pending', diff: null, comments: [] },
      ],
    };
    const summary = summarizeEditLedger(['p1'], { p1: proposal });
    expect(summary).not.toBeNull();
    expect(summary!.fileCount).toBe(2);
    expect(summary!.added).toBeGreaterThan(0);
    expect(summary!.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns null when no proposals resolve', () => {
    expect(summarizeEditLedger(['missing'], {})).toBeNull();
    expect(summarizeEditLedger([], {})).toBeNull();
  });
});
