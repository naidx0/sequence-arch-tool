/* ══════════════════════════════════════════════════════════════════════════
   AGENT TURNS — "Revert to here" and "Undo revert" (S3)
   packages/web2/src/rewind/AgentTurns.tsx

   The section of the Rewind panel for what agents did. Each agent turn is a
   snapshot of the tree taken when it started (analyzer snapshot.ts); Revert to
   here puts every file written in that turn or later back to that snapshot,
   and Undo revert puts them back again. The session shown is the one whose
   turn ran last; a picker appears when there are several.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';

import { wireMessage } from '../review/reviewClient';
import { createTurnsClient, type SnapshotSession, type SnapshotSessionSummary, type TurnsClient } from '../review/turnsClient';
import { revertSentence, turnRows } from './turnsModel';
import { clearReverted, markReverted } from './revertedMarks';
import type { ChatWorktree } from '../worktree/worktreeModel';
/* Loaded when needed, not imported: a static import here would join this
   lazy chunk's preload list in the boot entry and cost boot bytes (perf
   ratchet). */
const worktreeModel = () => import('../worktree/worktreeModel');
/** Why Revert is off for a chat whose worktree was removed (worktreeModel.WORKTREE_REMOVED). */
const WORKTREE_REMOVED = 'Worktree removed';

export interface AgentTurnsProps {
  client?: TurnsClient;
  now?: () => number;
  /** After files changed on disk, so the host can rescan. */
  onChanged?: (paths: string[]) => void;
  /** S7: the chat on screen, to learn whether its worktree was removed. Asked of
   *  the engine (GET /api/sessions, `index.activeId`) when not given. */
  chatId?: string | null;
  /** Injected for tests; the engine on this origin by default. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** The panel below this section lists checkpoints: with no agent turns, this section says nothing instead of "No agent turns yet" above a row that is a turn's checkpoint. */
  quietWhenEmpty?: boolean;
}

export function AgentTurns({ client, now = Date.now, onChanged, chatId: givenChatId, fetchImpl, quietWhenEmpty = false }: AgentTurnsProps) {
  const [chatId, setChatId] = useState<string | null>(givenChatId ?? null);
  useEffect(() => {
    if (givenChatId !== undefined) {
      setChatId(givenChatId);
      return undefined;
    }
    let live = true;
    void (fetchImpl ?? ((i: string, init?: RequestInit) => fetch(i, init)))('/api/sessions')
      .then((r) => (r.ok ? (r.json() as Promise<{ index?: { activeId?: unknown } }>) : null))
      .then((b) => {
        const id = b?.index?.activeId;
        if (live && typeof id === 'string' && id !== '') setChatId(id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [givenChatId, fetchImpl]);
  /* S7: a chat whose worktree was removed has no snapshots left to revert to
     (the history went with the worktree), so Revert is off and says why. */
  const [removedWorktree, setRemovedWorktree] = useState<ChatWorktree | null>(null);
  useEffect(() => {
    let live = true;
    setRemovedWorktree(null);
    if (!chatId) return undefined;
    void worktreeModel()
      .then((m) => m.worktreeApi.get(chatId, fetchImpl ?? ((i, init) => fetch(i, init))))
      .then((r) => {
        if (live && r.ok && r.body.worktree?.removedAt) setRemovedWorktree(r.body.worktree);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chatId, fetchImpl]);
  const [api] = useState(() => client ?? createTurnsClient());
  const [sessions, setSessions] = useState<SnapshotSessionSummary[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SnapshotSession | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (pick?: string) => {
      const s = await api.sessions();
      if (s.outcome !== 'ok') {
        setSessions([]);
        return;
      }
      setSessions(s.body.sessions);
      const id = pick ?? s.body.sessions[0]?.sessionId ?? null;
      setSessionId(id);
      if (!id) return setSession(null);
      const t = await api.turns(id);
      setSession(t.outcome === 'ok' ? t.body : null);
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function act(run: () => Promise<{ ok: boolean; message: string; paths: string[] }>) {
    setBusy(true);
    const r = await run();
    setBusy(false);
    setNote(r.message);
    if (r.ok) onChanged?.(r.paths);
    await load(sessionId ?? undefined);
  }

  const revert = (seq: number) =>
    act(async () => {
      const startedAt = session?.turns.find((t) => t.seq === seq)?.at;
      const r = await api.revert(sessionId!, seq);
      /* The chat says so under the turns this undid (revertedMarks.ts). */
      if (r.outcome === 'ok' && sessionId && typeof startedAt === 'number') markReverted(sessionId, startedAt);
      return r.outcome === 'ok'
        ? { ok: true, message: `Reverted to the start of turn ${seq}.`, paths: r.body.files }
        : { ok: false, message: wireMessage(r), paths: [] };
    });

  const undo = () =>
    act(async () => {
      const from = session?.revert ? session.turns.find((t) => t.seq === session.revert!.seq)?.at : undefined;
      const r = await api.undo(sessionId!);
      if (r.outcome === 'ok' && sessionId && typeof from === 'number') clearReverted(sessionId, from);
      return r.outcome === 'ok'
        ? { ok: true, message: `Undid the revert: ${r.body.restored.length} ${r.body.restored.length === 1 ? 'file' : 'files'} back.`, paths: r.body.restored }
        : { ok: false, message: wireMessage(r), paths: [] };
    });

  if (sessions === null) return null;
  /* Revert is off for this chat's own turns once its worktree is gone. */
  const blocked = removedWorktree !== null && (sessionId === chatId || !sessions.some((s) => s.sessionId === chatId));
  const rows = turnRows(session, now());
  const banner = revertSentence(session);

  /* Nothing to say here, and the checkpoints below already say what there is: no heading over an empty section. */
  if (quietWhenEmpty && sessions.length === 0 && !removedWorktree && !note) return null;
  return (
    <section className="rewind-section" data-testid="agent-turns" aria-label="Agent turns">
      <h3 className="rewind-subtitle">Agent turns</h3>
      {removedWorktree ? (
        <div className="rewind-banner" data-testid="agent-turns-worktree-removed" role="status">
          <span>This chat ran in a worktree on {removedWorktree.branch}, which was removed with its Rewind history.</span>
          <button type="button" className="rewind-turn-btn" data-testid="agent-turn-revert-removed" disabled title={WORKTREE_REMOVED}>
            Revert to here
          </button>
          <span className="rewind-note" data-testid="agent-turns-revert-reason">
            {WORKTREE_REMOVED}
          </span>
        </div>
      ) : null}
      {sessions.length === 0 && !removedWorktree ? (
        <p className="rewind-note" data-testid="agent-turns-empty">
          No agent turns yet. The files are snapshotted when an agent turn starts, and each turn can be reverted here.
        </p>
      ) : null}
      {sessions.length > 1 ? (
        <label className="rewind-note">
          Session{' '}
          <select
            data-testid="agent-turns-session"
            value={sessionId ?? ''}
            onChange={(e) => void load(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId} ({s.turns} {s.turns === 1 ? 'turn' : 'turns'})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {banner ? (
        <div className="rewind-banner" data-testid="agent-turns-reverted" role="status">
          <span>{banner}</span>
          <button type="button" className="rewind-turn-btn" data-testid="agent-turns-undo" disabled={busy} onClick={() => void undo()}>
            Undo revert
          </button>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="rewind-list" data-testid="agent-turns-list">
          {rows.map((row) => (
            <li key={row.seq} className="rewind-turn" data-testid="agent-turn" data-seq={row.seq} data-reverted={row.reverted ? 'true' : undefined}>
              <span className="rewind-row-label">{row.title}</span>
              <span className="rewind-row-meta">
                {row.when}, {row.files.length === 0 ? 'no files' : `${row.files.length} ${row.files.length === 1 ? 'file' : 'files'}`}
                {row.reverted ? ', reverted' : ''}
              </span>
              {row.files.length > 0 ? (
                <span className="rewind-turn-files mono" title={row.files.join('\n')}>
                  {row.files.slice(0, 3).join(', ')}
                  {row.files.length > 3 ? ` and ${row.files.length - 3} more` : ''}
                </span>
              ) : null}
              {row.undoNote ? (
                <span className="rewind-note" data-testid="agent-turn-undo-note" title={row.skipped.join('\n') || undefined}>
                  {row.undoNote}
                  {row.skipped.length ? `: ${row.skipped.join(', ')}. ${row.skipped.length === 1 ? 'It stays as it is' : 'They stay as they are'} on revert.` : '.'}
                </span>
              ) : null}
              {row.canRevert ? (
                <button
                  type="button"
                  className="rewind-turn-btn"
                  data-testid="agent-turn-revert"
                  disabled={busy || (blocked && sessionId === chatId)}
                  title={blocked && sessionId === chatId ? WORKTREE_REMOVED : undefined}
                  onClick={() => void revert(row.seq)}
                >
                  Revert to here
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {note ? (
        <p className="rewind-note" data-testid="agent-turns-note" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
