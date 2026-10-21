import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   THE BRANCH CONTROLS THE FILES PANEL DRAWS WHEN THE ENGINE CAN ANSWER THEM
   packages/web2/src/files/branchUi.tsx

   A context rather than props: FilesPanel stays fully controlled for the
   things it already owns, and the branch layer (a scope toggle and a branch
   switcher) arrives only from ConnectedFilesPanel, only when the engine serves
   /api/git/branch-changes. No provider, no controls: today's panel exactly.
   ══════════════════════════════════════════════════════════════════════════ */

export type FilesScope = 'worktree' | 'branch';

export interface BranchUi {
  /** The scope toggle is drawn only when the engine serves branch-changes. */
  showScope: boolean;
  scope: FilesScope;
  onScope: (scope: FilesScope) => void;
  /** Renamed path -> where it came from (This branch scope only). */
  renamedFrom?: ReadonlyMap<string, string>;
  /** Files this branch changed against its base. */
  changed: number;
  base: string;
  /** Opens the Diff board. */
  onViewDiff?: () => void;
  /** The branch switcher, drawn in the header in place of the static chip. */
  switcher?: ReactNode;
}

export const BranchUiContext = createContext<BranchUi | null>(null);

export function useBranchUi(): BranchUi | null {
  return useContext(BranchUiContext);
}

export function ScopeToggle({ ui }: { ui: BranchUi }) {
  if (!ui.showScope) return null;
  const options: { id: FilesScope; label: string; title: string }[] = [
    { id: 'worktree', label: 'Working tree', title: 'Marks for uncommitted changes' },
    { id: 'branch', label: 'This branch', title: `Marks for what this branch changed against ${ui.base}` },
  ];
  return (
    <div className="files-scope-row">
      <div className="s2-seg files-seg files-scope-seg" role="group" aria-label="Status marks" data-testid="files-scope">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={ui.scope === o.id ? 'is-on' : ''}
            aria-pressed={ui.scope === o.id}
            title={o.title}
            data-scope={o.id}
            onClick={() => ui.onScope(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {ui.scope === 'branch' ? (
        <span className="files-scope-note" data-testid="files-scope-note">
          {`${ui.changed} changed against ${ui.base}`}
          {ui.onViewDiff ? (
            <>
              {' '}
              <button type="button" className="files-retry" data-testid="files-view-diff" onClick={ui.onViewDiff}>
                View diff
              </button>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
