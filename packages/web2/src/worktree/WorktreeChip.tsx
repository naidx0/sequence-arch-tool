/* S7 — the chat header's worktree chip: the branch the chat works on, and
   whether its work has been merged back. Presentational only; the chat header
   (v3 shell) decides where it goes and what a click opens. */
import { branchLabel } from './worktreeGroups';
import type { ChatWorktree } from './worktreeModel';

export function WorktreeChip({ worktree, onOpen }: { worktree: ChatWorktree; onOpen?: () => void }): JSX.Element {
  const label = branchLabel(worktree.branch);
  const merged = worktree.merged ? `merged into ${worktree.merged.into}` : null;
  const title = merged ? `Worktree on ${worktree.branch}, ${merged}` : `Worktree on ${worktree.branch}`;
  return (
    <button
      type="button"
      className="wt-chip"
      data-testid="worktree-chip"
      data-merged={worktree.merged ? 'true' : undefined}
      title={title}
      aria-label={title}
      onClick={onOpen}
    >
      <svg className="i i-12" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M6 8.5v7M18 10.5c0 4-6 3-11 6" />
      </svg>
      <span className="wt-chip-name">{label}</span>
      {merged ? <span className="wt-chip-state">merged</span> : null}
    </button>
  );
}
