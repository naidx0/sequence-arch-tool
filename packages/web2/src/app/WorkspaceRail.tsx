import { Icon } from '../chat/Icon';
import { SessionsPanel } from '../sessions/SessionsPanel';
import { createSessionsClient } from '../sessions/sessionsClient';
import { reloadAfterSessionChange } from '../sessions/sessionPersist';
import type { OpenRepoSessionResult } from '../sessions/openRepoSession';
import type { ShellOverlay } from '../state/types';

const SESSIONS_CLIENT = createSessionsClient();

export interface WorkspaceRailProps {
  /** Bumps when attach/detach changes which sessions root the server reads. */
  repoRevision: string;
  onOverlay: (overlay: ShellOverlay) => void;
  onOpenRepoSession?: (
    repoPath: string,
    sessionId: string,
  ) => void | Promise<void | OpenRepoSessionResult>;
}

/**
 * C+B left rail — Workspace / sessions list / Tools / Settings, always visible.
 * Settings lives here (Decision 5), not in the chat column corner.
 */
export function WorkspaceRail({ repoRevision, onOverlay, onOpenRepoSession }: WorkspaceRailProps) {
  return (
    <aside className="shell-cb-rail shell-scope" data-testid="workspace-rail">
      <div className="shell-rail-group">
        <div className="shell-rail-group-lbl">Workspace</div>
        <button
          type="button"
          className="shell-rail-act shell-rail-act-sel"
          data-testid="workspace-rail-sessions"
        >
          <Icon name="thread" size={14} />
          Sessions
        </button>
        <button
          type="button"
          className="shell-rail-act"
          data-testid="workspace-rail-search"
          onClick={() => onOverlay({ kind: 'search' })}
        >
          <Icon name="search" size={14} />
          Search
        </button>
      </div>
      <div className="shell-rail-scroll sessions-scope">
        <SessionsPanel
          client={SESSIONS_CLIENT}
          repoRevision={repoRevision}
          onSwitched={() => {
            /* Panel already flushed the *previous* active session before the
               create/activate call — reload only so we never write the old
               transcript into the new blank session. */
            reloadAfterSessionChange();
          }}
          onOpenRepoSession={onOpenRepoSession}
        />
      </div>
      <div className="shell-rail-group shell-rail-tools">
        <div className="shell-rail-group-lbl">Tools</div>
        <button type="button" className="shell-rail-act" data-testid="workspace-rail-layout" disabled>
          <Icon name="spark" size={14} />
          Customize layout
        </button>
      </div>
      <footer className="sessions-side-foot shell-rail-settings-foot">
        <button
          type="button"
          className="shell-btn sessions-gear"
          data-testid="shell-settings-gear"
          title="Provider, notifications, hooks and this workspace"
          onClick={() => onOverlay({ kind: 'settings', pane: 'provider' })}
        >
          <Icon name="gear" size={14} />
          Settings
        </button>
      </footer>
    </aside>
  );
}
