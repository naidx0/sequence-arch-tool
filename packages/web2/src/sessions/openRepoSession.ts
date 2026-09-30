import type { BootTransport, WireResult } from '../boot';
import type { SessionsClient } from './sessionsClient';

export type OpenRepoSessionResult =
  | { outcome: 'ok' }
  | { outcome: 'error'; message: string };

function wireMessage(answer: WireResult<unknown>): string {
  if (answer.outcome === 'unreachable') return answer.message;
  if (answer.outcome === 'not-json') return 'the server did not answer with JSON';
  if (answer.outcome === 'error') {
    const body = answer.body as { error?: unknown } | null;
    if (typeof body?.error === 'string') return body.error;
    return `request failed (${answer.status})`;
  }
  return 'request failed';
}

/**
 * Attach a repository and activate one of its sessions.
 * The host reloads afterward so chat/board hydrate against the repo thread.
 */
/**
 * OPEN A CHAT THAT BELONGS TO NO REPOSITORY.
 *
 * The home workspace is where chats started from scratch live — owner,
 * 2026-09-21: "either started from scratch (project folder workspace made at
 * runtime there) or started in a project folder in path from somewhere else".
 * It is a project in the rail and it is NOT a repository, and the difference
 * is the whole of this function.
 *
 * ── THE BUG THIS EXISTS BECAUSE OF ─────────────────────────────────────────
 *
 * When the Workspace section joined the catalogue, its rows went through
 * {@link openRepoSession} like every other section's — which begins by
 * ATTACHING the row's path. The workspace's path is the reader's home
 * directory, and the browse jail refuses exactly that:
 *
 *   POST /api/attach -> 400
 *   "Pick a project folder inside your home directory, not the home directory
 *    itself."
 *
 * So every Workspace chat was unclickable: the console said why and the rail
 * said nothing at all. Measured in a browser, where a layout probe's positive
 * control caught it — the chat had not changed, which is also what a working
 * switch of a chat that happened to look identical would have printed.
 *
 * DETACH IS THE RIGHT VERB. Being in the workspace IS being attached to
 * nothing; there is no folder to open, and the engine must stop answering as
 * the previous repository before the reader's next question goes to it.
 */
export async function openWorkspaceSession(
  transport: BootTransport,
  sessions: SessionsClient,
  sessionId: string,
): Promise<OpenRepoSessionResult> {
  const detached = await transport.detach();
  if (detached.outcome !== 'ok') {
    return { outcome: 'error', message: wireMessage(detached) };
  }

  const activated = await sessions.activate(sessionId);
  if (activated.outcome !== 'ok') {
    /* NOT ROLLED BACK, and the asymmetry with `openRepoSession` is deliberate:
       there is nothing to roll back TO. Re-attaching the repository the reader
       just left would put them somewhere they did not ask to be, to recover
       from a failure that has already left them in a valid state. */
    return { outcome: 'error', message: activated.message };
  }

  return { outcome: 'ok' };
}

export async function openRepoSession(
  transport: BootTransport,
  sessions: SessionsClient,
  repoPath: string,
  sessionId: string,
): Promise<OpenRepoSessionResult> {
  const attached = await transport.attach(repoPath);
  if (attached.outcome !== 'ok') {
    return { outcome: 'error', message: wireMessage(attached) };
  }

  const activated = await sessions.activate(sessionId);
  if (activated.outcome !== 'ok') {
    /* Roll back attach so the engine does not stay on a repo the client never opened. */
    await transport.detach();
    return { outcome: 'error', message: activated.message };
  }

  return { outcome: 'ok' };
}
