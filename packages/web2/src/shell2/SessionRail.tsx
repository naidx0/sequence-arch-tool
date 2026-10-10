/* ══════════════════════════════════════════════════════════════════════════
   THE SIDEBAR'S ICON RAIL (round 11, UX audit 5)
   packages/web2/src/shell2/SessionRail.tsx

   Opening a second surface at 1440 folds the sidebar for room, and New chat
   and Settings went with it, silently. A folded sidebar now leaves a 48 px
   rail: Show sidebar (it peeks over the content, Esc closes it), New chat and
   Settings, each with its name. The reader's stored choice is untouched, and
   the rail goes the moment the room comes back.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';

import { sessionsClient } from '../sessions/sessionsClient';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import { createNewChat } from '../v3/sessionActions';
import { AsciiSpinner } from './AsciiSpinner';
import { S2Icon } from './icons';

export function SessionRail({ onExpand, onOpenSettings, covered = false }: { onExpand: () => void; onOpenSettings?: () => void; /** The sidebar is peeking over it: it keeps its room but leaves the tab order and the accessibility tree. */ covered?: boolean }) {
  const store = useStore();
  const state = useAppState();
  const [creating, setCreating] = useState(false);
  const repoPath = groundedRepoRoot(state);
  const newChat = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createNewChat(store, sessionsClient, repoPath ? 'code' : 'work');
    } finally {
      setCreating(false);
    }
  };
  return (
    <nav className={`s2-iconrail${covered ? ' is-covered' : ''}`} aria-label="Sidebar, folded" data-testid="s2-iconrail" aria-hidden={covered ? 'true' : undefined} {...(covered ? { inert: '' } : {})}>
      <button type="button" className="s2-ibtn" aria-label="Show sidebar" title="Show sidebar" data-testid="s2-iconrail-expand" onClick={onExpand}>
        <S2Icon name="sidebar" />
      </button>
      <button type="button" className="s2-btn s2-solid s2-iconrail-new" aria-label="New chat" title="New chat" data-testid="s2-iconrail-new-chat" disabled={creating} onClick={() => void newChat()}>
        {creating ? <AsciiSpinner /> : <S2Icon name="plus" />}
      </button>
      <span className="s2-grow" />
      <button type="button" className="s2-ibtn" aria-label="Settings" title="Settings" data-testid="s2-iconrail-settings" onClick={onOpenSettings}>
        <S2Icon name="sliders" />
      </button>
    </nav>
  );
}
