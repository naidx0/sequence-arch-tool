/* ══════════════════════════════════════════════════════════════════════════
   AGENT TURN SNAPSHOTS ON THE WIRE (S3)
   packages/web2/src/review/turnsClient.ts

   The engine snapshots the working tree when each agent turn starts and
   records the paths the turn wrote (analyzer snapshot.ts, /api/snapshots).
   This is the client for the parts a person drives: the turns, what changed
   since one began, Revert to here, Undo revert, and revert one hunk. Same
   four-outcome WireResult and same-origin guard as the rest of the review
   lane (reviewClient.request).
   ══════════════════════════════════════════════════════════════════════════ */

import type { WireResult } from '../boot';
import { request } from './reviewClient';

export interface SnapshotTurn {
  seq: number;
  turnId?: string;
  /** The chat turn (the server's agent turn id) this snapshot was taken for. */
  chatTurnId?: string;
  label?: string;
  at: number;
  files: string[];
  /** A partial undo point: files that could not be read when the turn started. */
  skipped?: string[];
  /** Set when no undo point could be written for this turn, with why. */
  noUndo?: string;
}

export interface SnapshotRevert {
  seq: number;
  files: string[];
  /** Files the revert left alone. */
  skipped?: string[];
}

export interface SnapshotSession {
  sessionId: string;
  turns: SnapshotTurn[];
  revert?: SnapshotRevert;
}

export interface SnapshotSessionSummary {
  sessionId: string;
  turns: number;
  lastAt: number;
  reverted: boolean;
}

export interface TurnFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface TurnsClient {
  sessions(signal?: AbortSignal): Promise<WireResult<{ sessions: SnapshotSessionSummary[] }>>;
  turns(sessionId: string, signal?: AbortSignal): Promise<WireResult<SnapshotSession>>;
  files(sessionId: string, seq: number, signal?: AbortSignal): Promise<WireResult<{ files: TurnFile[] }>>;
  diff(sessionId: string, seq: number, path: string, signal?: AbortSignal): Promise<WireResult<{ diff: string }>>;
  revert(sessionId: string, seq: number): Promise<WireResult<SnapshotRevert>>;
  undo(sessionId: string): Promise<WireResult<{ restored: string[] }>>;
  revertHunk(
    sessionId: string,
    seq: number,
    path: string,
    hunk: number,
    header: string,
  ): Promise<WireResult<{ ok: boolean; path: string; error?: string }>>;
}

export const TURNS_ROUTES = [
  '/api/snapshots/sessions',
  '/api/snapshots',
  '/api/snapshots/files',
  '/api/snapshots/diff',
  '/api/snapshots/revert',
  '/api/snapshots/undo',
  '/api/snapshots/revert-hunk',
] as const;

export function createTurnsClient(fetchImpl: typeof fetch = globalThis.fetch): TurnsClient {
  const q = (o: Record<string, string | number>) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
  return {
    sessions: (signal) => request(fetchImpl, '/api/snapshots/sessions', { method: 'GET', signal }),
    turns: (sessionId, signal) => request(fetchImpl, `/api/snapshots?${q({ sessionId })}`, { method: 'GET', signal }),
    files: (sessionId, seq, signal) => request(fetchImpl, `/api/snapshots/files?${q({ sessionId, seq })}`, { method: 'GET', signal }),
    diff: (sessionId, seq, path, signal) => request(fetchImpl, `/api/snapshots/diff?${q({ sessionId, seq, path })}`, { method: 'GET', signal }),
    revert: (sessionId, seq) => request(fetchImpl, '/api/snapshots/revert', { method: 'POST', body: { sessionId, seq } }),
    undo: (sessionId) => request(fetchImpl, '/api/snapshots/undo', { method: 'POST', body: { sessionId } }),
    revertHunk: (sessionId, seq, path, hunk, header) =>
      request(fetchImpl, '/api/snapshots/revert-hunk', { method: 'POST', body: { sessionId, seq, path, hunk, header } }),
  };
}

/** The session whose turn ran last, and that turn: what "Last turn" means. */
export async function latestTurn(
  client: TurnsClient,
  signal?: AbortSignal,
): Promise<{ sessionId: string; seq: number; files: TurnFile[] } | null> {
  const s = await client.sessions(signal);
  if (s.outcome !== 'ok' || s.body.sessions.length === 0) return null;
  const sessionId = s.body.sessions[0]!.sessionId;
  const t = await client.turns(sessionId, signal);
  if (t.outcome !== 'ok') return null;
  const live = t.body.revert ? t.body.turns.filter((x) => x.seq < t.body.revert!.seq) : t.body.turns;
  const last = live.at(-1);
  if (!last) return null;
  const f = await client.files(sessionId, last.seq, signal);
  return { sessionId, seq: last.seq, files: f.outcome === 'ok' ? f.body.files : [] };
}
