import type { RepoSlice } from '../state/types';

/** Stable key for when the sessions API root changes (attach, detach, rescan). */
export function sessionsRepoRevision(repo: RepoSlice): string {
  switch (repo.phase) {
    case 'attached':
    case 'stale':
      return `${repo.phase}:${repo.repo.root}`;
    case 'scanning':
      return `${repo.phase}:${repo.root}`;
    case 'failed':
      return `${repo.phase}:${repo.attempted ?? 'none'}`;
    case 'unattached':
    default:
      return 'unattached:none';
  }
}
