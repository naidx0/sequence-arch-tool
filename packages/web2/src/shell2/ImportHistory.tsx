/* ══════════════════════════════════════════════════════════════════════════
   IMPORT CHATS FROM THE CLAUDE CODE AND CODEX CLIs (T3 gap G11)
   packages/web2/src/shell2/ImportHistory.tsx

   Opened from the Chats header's import button, so the sidebar asks the
   server nothing at boot. Lists the CLI sessions that ran in the opened
   project (`GET /api/import/sessions`, newest first). One click imports one
   as a chat (`POST /api/import/session`): its history is there to read, and
   the next message rejoins the CLI's own session. The CLIs' folders are only
   ever read.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import { sessionWhenLabel } from '../sessions/sessionWhen';
import { S2Icon } from './icons';

export interface ImportableSession {
  source: 'claude' | 'codex';
  providerSessionId: string;
  title: string;
  updatedAt: string;
  imported: boolean;
  chatId?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const NAME: Record<ImportableSession['source'], string> = { claude: 'Claude Code', codex: 'Codex' };
/** How many show before "Show more". */
const FIRST = 6;

export function ImportHistory({
  onOpened,
  fetchImpl = (u, i) => fetch(u, i),
  now = Date.now(),
}: {
  /** A chat now exists for the session (new or already imported): the panel opens it. */
  onOpened: (chatId: string) => void | Promise<void>;
  fetchImpl?: Fetch;
  now?: number;
}) {
  const [rows, setRows] = useState<readonly ImportableSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchImpl('/api/import/sessions')
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { sessions?: ImportableSession[] };
        if (live) setRows(Array.isArray(body.sessions) ? body.sessions : []);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  const open = async (s: ImportableSession): Promise<void> => {
    if (busy) return;
    setBusy(s.providerSessionId);
    setNote(null);
    try {
      if (s.imported && s.chatId) return void (await onOpened(s.chatId));
      const r = await fetchImpl('/api/import/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: s.source, providerSessionId: s.providerSessionId }) });
      const body = (await r.json().catch(() => ({}))) as { chatId?: string; error?: string };
      if (!r.ok || !body.chatId) setNote(body.error ?? 'Could not import that chat.');
      else {
        setRows((prev) => prev?.map((x) => (x.providerSessionId === s.providerSessionId ? { ...x, imported: true, chatId: body.chatId } : x)) ?? prev);
        await onOpened(body.chatId);
      }
    } catch {
      setNote('Could not import that chat.');
    } finally {
      setBusy(null);
    }
  };

  const shown = rows ? (all ? rows : rows.slice(0, FIRST)) : [];
  return (
    <div className="s2-grp" data-testid="s2-import" role="group" aria-label="Import chats">
      <div className="s2-gh">
        <span className="s2-grow">From Claude Code and Codex</span>
      </div>
      {rows === null && !failed ? <p className="s2-empty" role="status">Looking for chats…</p> : null}
      {failed ? <p className="s2-empty" role="alert" data-testid="s2-import-failed">Could not look for chats.</p> : null}
      {rows && rows.length === 0 ? <p className="s2-empty" data-testid="s2-import-empty">No Claude Code or Codex chats found for this project.</p> : null}
      {shown.map((s) => (
        <div key={`${s.source}:${s.providerSessionId}`} className="s2-it" data-testid="s2-import-row" data-source={s.source} data-imported={s.imported ? 'true' : undefined}>
          <button type="button" className="s2-it-hit s2-rail-hit" disabled={busy !== null} title={`${s.imported ? 'Open' : 'Import'} “${s.title}” from ${NAME[s.source]}`} aria-label={`${s.imported ? 'Open' : 'Import'} ${s.title}, from ${NAME[s.source]}`} onClick={() => void open(s)}>
            <S2Icon name="import" small />
            <span className="s2-t">{s.title}</span>
            <span className="s2-meta s2-mono">{s.imported ? 'Imported' : `${NAME[s.source]} ${sessionWhenLabel(s.updatedAt, now)}`.trim()}</span>
          </button>
        </div>
      ))}
      {rows && rows.length > FIRST && !all ? (
        <button type="button" className="s2-it s2-it-foot" data-testid="s2-import-more" onClick={() => setAll(true)}>
          <span className="s2-t">Show {rows.length - FIRST} more</span>
        </button>
      ) : null}
      {note ? <p className="s2-empty" role="alert" data-testid="s2-import-note">{note}</p> : null}
    </div>
  );
}

export default ImportHistory;
