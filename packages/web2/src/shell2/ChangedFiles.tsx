/* ══════════════════════════════════════════════════════════════════════════
   THE CHANGED-FILES LINE (Decision 49) — DeepSeek's turn-end card, quieter
   packages/web2/src/shell2/ChangedFiles.tsx

   One compact line at the end of an agent turn ("2 files changed +38 −3"),
   drawn as Mix.dc.html's `.cf`. Diffs only when expanded (Jaden: "I like the
   diffs, but only when expanded"): a click opens the files with their counts
   and two actions, Review (the dock) and Revert turn (a confirmation, then
   the S3 snapshot revert). Reads the engine's own turn snapshots, which are
   keyed by the chat (run-node), so it names only what this chat's agent wrote.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';

import { wireMessage } from '../review/reviewClient';
import { parseUnifiedDiff } from '../review/diffModel';
import { createTurnsClient, type TurnFile, type TurnsClient } from '../review/turnsClient';
import { ConfirmDialog } from './ConfirmDialog';
import { S2Icon } from './icons';
import { reviewDock } from './reviewDockStore';

export interface ChangedFileRow extends TurnFile {
  added: number;
  removed: number;
}

export interface ChangedTurn {
  seq: number;
  files: ChangedFileRow[];
  reverted: boolean;
}

/** The last turn of `sessionId` that wrote files, with a count per file. */
export async function readChangedTurn(client: TurnsClient, sessionId: string, signal?: AbortSignal): Promise<ChangedTurn | null> {
  const t = await client.turns(sessionId, signal);
  if (t.outcome !== 'ok') return null;
  const withFiles = t.body.turns.filter((x) => x.files.length > 0);
  const last = withFiles.at(-1);
  if (!last) return null;
  const reverted = t.body.revert !== undefined && last.seq >= t.body.revert.seq;
  const f = await client.files(sessionId, last.seq, signal);
  const files = f.outcome === 'ok' ? f.body.files : last.files.map((path) => ({ path, status: 'modified' as const }));
  const rows = await Promise.all(
    files.slice(0, 24).map(async (file): Promise<ChangedFileRow> => {
      const d = await client.diff(sessionId, last.seq, file.path, signal);
      const parsed = d.outcome === 'ok' ? parseUnifiedDiff(d.body.diff)[0] : undefined;
      return { ...file, added: parsed?.added ?? 0, removed: parsed?.removed ?? 0 };
    }),
  );
  return { seq: last.seq, files: rows, reverted };
}

export function ChangedFiles({ sessionId, client: given, refreshKey = 0 }: { sessionId: string; client?: TurnsClient; refreshKey?: number }) {
  const [client] = useState(() => given ?? createTurnsClient());
  const [turn, setTurn] = useState<ChangedTurn | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const next = await readChangedTurn(client, sessionId, signal);
      if (!signal?.aborted) setTurn(next);
    },
    [client, sessionId],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load, refreshKey]);

  if (!turn || turn.files.length === 0) return null;
  const added = turn.files.reduce((n, f) => n + f.added, 0);
  const removed = turn.files.reduce((n, f) => n + f.removed, 0);
  const label = turn.files.length === 1 ? '1 file changed' : `${turn.files.length} files changed`;

  async function revertTurn() {
    setBusy(true);
    const r = await client.revert(sessionId, turn!.seq);
    setBusy(false);
    setConfirm(false);
    setNote(r.outcome === 'ok' ? `Reverted ${r.body.files.length === 1 ? '1 file' : `${r.body.files.length} files`} to the start of the turn.` : wireMessage(r));
    await load();
  }

  async function undo() {
    setBusy(true);
    const r = await client.undo(sessionId);
    setBusy(false);
    setNote(r.outcome === 'ok' ? 'The revert is undone.' : wireMessage(r));
    await load();
  }

  return (
    <div className={`s2-cf-wrap${open ? ' is-open' : ''}`} data-testid="s2-changed" data-reverted={turn.reverted || undefined}>
      <button type="button" className="s2-cf" aria-expanded={open} data-testid="s2-changed-line" onClick={() => setOpen((v) => !v)}>
        <S2Icon name="file" small />
        <span className="s2-grow">{turn.reverted ? `${label}, reverted` : label}</span>
        {added > 0 ? <span className="s2-mono s2-ok">+{added}</span> : null}
        {removed > 0 ? <span className="s2-mono s2-del">−{removed}</span> : null}
        <S2Icon name={open ? 'chev' : 'chevr'} small className="s2-cf-chev" />
      </button>
      {open ? (
        <div className="s2-cf-body">
          {turn.files.map((f) => (
            <button
              key={f.path}
              type="button"
              className="s2-cf-row"
              data-testid="s2-changed-file"
              title={`Review ${f.path}`}
              onClick={() => reviewDock.open({ sessionId, seq: turn.seq, path: f.path })}
            >
              <S2Icon name="file" small />
              <span className="s2-t s2-mono">{f.path}</span>
              {f.status === 'added' ? <span className="s2-mono s2-ok">new</span> : f.status === 'deleted' ? <span className="s2-mono s2-del">deleted</span> : null}
              {f.status !== 'added' && f.added > 0 ? <span className="s2-mono s2-ok">+{f.added}</span> : null}
              {f.status !== 'deleted' && f.removed > 0 ? <span className="s2-mono s2-del">−{f.removed}</span> : null}
            </button>
          ))}
          <div className="s2-cf-acts">
            <button type="button" className="s2-pill" data-testid="s2-changed-review" onClick={() => reviewDock.open({ sessionId, seq: turn.seq })}>
              <S2Icon name="split" small />
              Review
            </button>
            <span className="s2-grow" />
            {turn.reverted ? (
              <button type="button" className="s2-pill" data-testid="s2-changed-undo" disabled={busy} onClick={() => void undo()}>
                <S2Icon name="undo" small />
                Undo revert
              </button>
            ) : (
              <button type="button" className="s2-pill" data-testid="s2-changed-revert" disabled={busy} onClick={() => setConfirm(true)}>
                <S2Icon name="undo" small />
                Revert turn
              </button>
            )}
          </div>
          {note ? (
            <p className="s2-cf-note" role="status">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          icon="undo"
          danger
          title={`Revert ${label.replace(' changed', '')}?`}
          body="Each file goes back to how it was when this turn started. Undo revert puts them back."
          items={turn.files.map((f) => ({ label: f.path }))}
          confirmLabel="Revert turn"
          busy={busy}
          testId="s2-confirm-revert"
          onConfirm={() => void revertTurn()}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </div>
  );
}

export default ChangedFiles;
