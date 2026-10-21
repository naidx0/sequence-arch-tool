/* "Memory" in Settings: what persists across chats, counted live (GET /api/memory/summary). */
import { useEffect, useState } from 'react';

import { FailureNote } from '../components/FailureNote';
import { memoryDetail, type MemorySummary } from './memorySummary';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function MemorySetting({ fetchImpl = fetch }: { fetchImpl?: Fetch }): JSX.Element {
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchImpl('/api/memory/summary', { headers: { accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`the server answered ${r.status}`);
        const v = (await r.json()) as MemorySummary;
        if (live) setSummary(v);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [fetchImpl]);
  return (
    <section className="sb-group" data-testid="settings-memory">
      <h3 className="sb-lab">Memory</h3>
      <div className="sb-card">
        <div className="sb-row">
          <span className="sb-row-txt">
            <span>What Sequence remembers across chats</span>
            <span className="sb-row-sub" data-testid="settings-memory-detail" role="status">
              {error ? <FailureNote message="Could not read what is remembered." detail={error} testid="settings-memory-error" /> : summary ? memoryDetail(summary) : 'Reading what is remembered…'}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

export default MemorySetting;
