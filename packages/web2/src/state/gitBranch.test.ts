import { describe, expect, it } from 'vitest';

import { branchFromStatus } from './gitBranch';

describe('branchFromStatus', () => {
  it('reads the branch of a repo', () => {
    expect(branchFromStatus({ branch: 'master', files: [] })).toBe('master');
  });
  it('is null for a folder that is not a git repository (no empty-string branch)', () => {
    expect(branchFromStatus({ branch: '', files: [], notGit: true })).toBeNull();
    expect(branchFromStatus({ branch: '', files: [] })).toBeNull();
    expect(branchFromStatus(null)).toBeNull();
  });
});
