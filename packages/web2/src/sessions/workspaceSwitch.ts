/* ══════════════════════════════════════════════════════════════════════════
   SWITCH WORKSPACES WITHOUT RELOADING THE PAGE (claims: the workspace-switch known issue; plan P14, stage 2)
   packages/web2/src/sessions/workspaceSwitch.ts

   Opening a chat in another workspace used to end in `flushAndReload()`: write the chat being left, attach, reload
   the page. The reload is most of the 0.5 to 0.7 s, and it drops every page-held run stream.

   This does the same hand-over in place:
     1. write the chat being left to ITS root (it cannot be written once the engine has moved on);
     2. attach the destination (or detach, for the home workspace) and activate the chat;
     3. `workspace/switch`: reset the repo-scoped slices of the store, keep the shell, the composer and the page-held
        agent run store (so runs in other chats keep streaming);
     4. boot again: the same ladder as a fresh page (`runBoot`), then the thread list, then the chat's own read;
     5. tell the page-held things that point at a workspace (`onWorkspaceSwitched`) to re-read.

   ON BY DEFAULT since the browser check passed (two real repos, four switches, no navigation entry added, rail,
   footer, status and branch each on the new repo). It is switched off with localStorage `seq.inPlaceSwitch` = '0' (or
   `?inplace=0` on the page URL). ANY failure after the destination is attached falls back to the reload, so the worst
   case is the old behaviour. A refusal BEFORE that (the folder will not attach) is
   returned as a message, exactly as it was.
   ══════════════════════════════════════════════════════════════════════════ */

import { runBoot, type BootOutcome, type BootTransport } from '../boot/bootSequence';
import type { Store } from '../state';
import { listAndHydrateSessions, softLoadSession } from '../v3/sessionActions';
import { clearSnapshots } from '../v3/sessionSnapshots';
import { agentRuns } from '../agents/agentRuns';
import { announceWorkspaceSwitched, onWorkspaceSwitched, workspaceKeyOf } from './workspaceEvents';
import { openRepoSession, openWorkspaceSession } from './openRepoSession';
import type { SessionsClient } from './sessionsClient';

export const IN_PLACE_FLAG = 'seq.inPlaceSwitch';

/** Whether this page switches workspaces in place. On unless turned off. */
export function inPlaceSwitchEnabled(): boolean {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('inplace') === '0') return false;
    return !(typeof localStorage !== 'undefined' && localStorage.getItem(IN_PLACE_FLAG) === '0');
  } catch {
    return true;
  }
}

export { onWorkspaceSwitched };

/* ── the switch ─────────────────────────────────────────────────────────── */

export interface WorkspaceSwitchDeps {
  store: Store;
  transport: BootTransport;
  sessions: SessionsClient;
  /** Write the chat being left, to the root it lives in. */
  leave: () => Promise<void>;
  /** Test seam: the boot ladder. */
  boot?: (transport: BootTransport) => Promise<BootOutcome>;
  now?: () => number;
}

export type WorkspaceSwitchResult =
  /** In place; the page was not reloaded. */
  | { outcome: 'ok' }
  /** The destination would not open (nothing changed). `message` is for the person. */
  | { outcome: 'refused'; message: string }
  /** The destination is open on the engine but the page could not follow: reload to finish the job. */
  | { outcome: 'reload' };

/**
 * Move to `repoPath` (null: the home workspace, attached to nothing) and open `sessionId` there.
 * Never throws: the caller reloads on `reload`.
 */
export async function switchWorkspaceInPlace(deps: WorkspaceSwitchDeps, repoPath: string | null, sessionId: string): Promise<WorkspaceSwitchResult> {
  const { store, transport, sessions } = deps;
  const now = deps.now ?? Date.now;
  const opened = repoPath === null
    ? await openWorkspaceSession(transport, sessions, sessionId, deps.leave)
    : await openRepoSession(transport, sessions, repoPath, sessionId, deps.leave);
  if (opened.outcome !== 'ok') return { outcome: 'refused', message: opened.message };
  try {
    clearSnapshots();
    /* Runs of every workspace keep streaming; only this one's are shown (chat ids are unique per workspace only). */
    const was = store.getState().repo;
    const from = workspaceKeyOf(was.phase === 'attached' || was.phase === 'stale' ? was.repo.root : was.phase === 'scanning' ? was.root : null);
    agentRuns.setWorkspace(workspaceKeyOf(repoPath), from);
    store.dispatch({ type: 'workspace/switch', root: repoPath, at: now() });
    const outcome = await (deps.boot ?? runBoot)(transport);
    store.dispatch({ type: 'boot/settled', outcome });
    /* The thread list of the NEW root, with the chat just activated as the open one. */
    const listed = await listAndHydrateSessions(store, sessions);
    if (listed.outcome !== 'ok') return { outcome: 'reload' };
    store.dispatch({ type: 'session/index', sessions: store.getState().session.sessions, activeId: sessionId });
    const loaded = await softLoadSession(store, sessionId, undefined, sessions);
    if (loaded.outcome !== 'ok') return { outcome: 'reload' };
    announceWorkspaceSwitched({ root: repoPath, sessionId });
    return { outcome: 'ok' };
  } catch {
    return { outcome: 'reload' };
  }
}
