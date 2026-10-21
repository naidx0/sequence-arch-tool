/* "Folders you allowed" in Settings > Workspace: the folders outside home that Sequence may read (APP-13). */
import { useCallback, useEffect, useState } from 'react';

import { FailureNote } from '../components/FailureNote';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function readFolders(r: Response): Promise<string[]> {
  if (!r.ok) throw new Error(`the server answered ${r.status}`);
  const body = (await r.json()) as { folders?: unknown };
  return Array.isArray(body.folders) ? body.folders.filter((f): f is string => typeof f === 'string') : [];
}

export function AllowedFoldersSetting({ fetchImpl = fetch }: { fetchImpl?: Fetch }): JSX.Element {
  const [folders, setFolders] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchImpl('/api/allowed-folders', { headers: { accept: 'application/json' } })
      .then(readFolders)
      .then((f) => live && setFolders(f))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  const remove = useCallback(
    async (folder: string) => {
      setBusy(folder);
      setError(null);
      try {
        const next = await fetchImpl('/api/allowed-folders', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ path: folder }),
        }).then(readFolders);
        setFolders(next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [fetchImpl],
  );

  return (
    <section className="sb-group" data-testid="settings-allowed-folders">
      <h3 className="sb-lab">Folders you allowed</h3>
      <div className="sb-card">
        {error ? (
          <div className="sb-row">
            <FailureNote message="Could not read or change the folders you allowed." detail={error} testid="settings-allowed-folders-error" />
          </div>
        ) : null}
        {folders !== null && folders.length === 0 ? (
          <div className="sb-row">
            <span className="sb-row-txt">
              <span className="sb-row-sub" data-testid="settings-allowed-folders-empty">
                Sequence reads your home folder. Folders outside it appear here once you allow them.
              </span>
            </span>
          </div>
        ) : null}
        {(folders ?? []).map((folder) => (
          <div key={folder} className="sb-row" data-testid="settings-allowed-folder">
            <span className="sb-row-txt">
              <span className="sb-row-t" data-testid="settings-allowed-folder-path">{folder}</span>
            </span>
            <span className="sb-acts">
              <button
                type="button"
                className="sb-pill"
                data-testid="settings-allowed-folder-remove"
                aria-label={`Remove ${folder}`}
                disabled={busy !== null}
                onClick={() => void remove(folder)}
              >
                Remove
              </button>
            </span>
          </div>
        ))}
        {folders === null && !error ? (
          <div className="sb-row">
            <span className="sb-row-sub" role="status">Reading the folders you allowed…</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default AllowedFoldersSetting;
