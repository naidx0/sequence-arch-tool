/* "Map cache: 46 MB [Clear]" in Settings > Workspace: the regenerable part of the project's .sequence folder (APP-15). */
import { useCallback, useEffect, useState } from 'react';

import { FailureNote } from '../components/FailureNote';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface CacheSize {
  attached?: boolean;
  /** every byte under .sequence */
  bytes: number;
  /** the part Clear frees */
  clearableBytes: number;
}

/** 0 B, 12 KB, 46 MB, 1.5 GB: one decimal only where the number is under 10. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const text = i === 0 || v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  return `${text} ${units[i]}`;
}

async function readSize(r: Response): Promise<CacheSize> {
  if (!r.ok) {
    let said = '';
    try {
      said = ((await r.json()) as { error?: string }).error ?? '';
    } catch {
      /* no body */
    }
    throw new Error(said || `the server answered ${r.status}`);
  }
  return (await r.json()) as CacheSize;
}

export function MapCacheSetting({ fetchImpl = fetch }: { fetchImpl?: Fetch }): JSX.Element {
  const [size, setSize] = useState<CacheSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetchImpl('/api/cache-size', { headers: { accept: 'application/json' } })
      .then(readSize)
      .then((s) => live && setSize(s))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  const clear = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSize(await fetchImpl('/api/cache/clear', { method: 'POST', headers: { accept: 'application/json' } }).then(readSize));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [fetchImpl]);

  const open = size !== null && size.attached !== false;
  const kept = size === null ? 0 : Math.max(0, size.bytes - size.clearableBytes);
  return (
    <section className="sb-group" data-testid="settings-map-cache">
      <h3 className="sb-lab">Map cache</h3>
      <div className="sb-card">
        <div className="sb-row">
          <span className="sb-row-txt">
            <span className="sb-row-t" data-testid="settings-map-cache-size" role="status">
              {size === null ? (error ? 'Map cache' : 'Reading the map cache…') : open ? `Map cache: ${formatBytes(size.clearableBytes)}` : 'Map cache: no project open'}
            </span>
            <span className="sb-row-sub">
              {open
                ? `Sequence rebuilds the map the next time it reads the project. Boards, chats and notes in the .sequence folder (${formatBytes(kept)}) are kept.`
                : 'The map is kept in a .sequence folder inside the project.'}
            </span>
            {error ? <FailureNote message="Could not read or clear the map cache." detail={error} testid="settings-map-cache-error" /> : null}
          </span>
          <span className="sb-acts">
            <button
              type="button"
              className="sb-pill"
              data-testid="settings-map-cache-clear"
              disabled={busy || !open || size.clearableBytes === 0}
              onClick={() => void clear()}
            >
              Clear
            </button>
          </span>
        </div>
      </div>
    </section>
  );
}

export default MapCacheSetting;
