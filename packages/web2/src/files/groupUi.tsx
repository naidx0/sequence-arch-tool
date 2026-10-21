import { createContext, useContext } from 'react';

import type { ServiceGroup } from './serviceGroups';

/* ═══════════════════════════════════════════════════════════════════════════
   THE GROUP-BY-SERVICE VIEW (owner ruling 2026-10-14, piece 4)
   packages/web2/src/files/groupUi.tsx

   Off by default: the tree is the repository's own layout and stays that way
   until the reader asks to see it through the scan's services. A context, like
   `branchUi` and `symbolsUi`, so FilesPanel and FileTree keep their props. No
   provider, or no services in the scan, and there is no toggle at all.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GroupUi {
  on: boolean;
  onToggle: () => void;
  groups: readonly ServiceGroup[];
  /** "N source files outside every service were not read ..." - null when the scan has nothing to disclose. */
  unread: string | null;
  /** The reader's say on which groups list their files; a group not in the map is open only if everything fits the cap. */
  open: ReadonlyMap<string, boolean>;
  /** Groups whose per-group cap the reader lifted with "+N more in <service>". */
  showAll: ReadonlySet<string>;
  onToggleGroup: (id: string, wasOpen: boolean) => void;
  onShowAll: (id: string) => void;
  /** The group a board card click was revealed to; its head wears the selected fill and is scrolled to. */
  revealed: string | null;
}

export const GroupUiContext = createContext<GroupUi | null>(null);

export function useGroupUi(): GroupUi | null {
  return useContext(GroupUiContext);
}

/** The tree's layout as a segment with both states drawn: Folders (the repository's own) or Services (grouped by what the scan found). */
export function GroupToggle({ ui }: { ui: GroupUi }) {
  if (ui.groups.length === 0) return null;
  const choose = (on: boolean) => {
    if (on !== ui.on) ui.onToggle();
  };
  return (
    <div className="s2-seg files-seg" role="group" aria-label="Tree layout" data-testid="files-group">
      <button type="button" className={ui.on ? '' : 'is-on'} aria-pressed={!ui.on} title="The repository's own folders" data-testid="files-group-folders" onClick={() => choose(false)}>
        Folders
      </button>
      <button type="button" className={ui.on ? 'is-on' : ''} aria-pressed={ui.on} title="Group files under the services the scan found" data-testid="files-group-toggle" onClick={() => choose(true)}>
        Services
      </button>
    </div>
  );
}
