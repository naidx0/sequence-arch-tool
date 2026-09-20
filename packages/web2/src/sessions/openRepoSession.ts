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
