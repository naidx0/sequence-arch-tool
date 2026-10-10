/* ══════════════════════════════════════════════════════════════════════════
   HOTSPOTS — where change is risky: central code that changes often
   packages/web2/src/canvas/views/HotspotsView.tsx

   Reads GET /api/git/churn?days=90 and ranks the Map's boxes by heat =
   sum of pageRank(file) x commits(file) over the files under each box
   (historyModel.ts). Rank 1 is the riskiest to edit. Whether this ships is
   the registered A/B (lab/log.md).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';

import type { ArchGraph } from '@sequence/schema';

import { displayLabel } from '../displayLabel.js';
import { heatModel } from './historyModel.js';
import { viewName, type ViewBox } from './viewModel.js';
import './views.css';
import { AsciiSpinner } from '../../shell2/AsciiSpinner';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function HotspotsView({
  boxes,
  graph,
  fetchImpl,
  days = 90,
}: {
  boxes: readonly ViewBox[];
  graph: ArchGraph | null;
  fetchImpl?: Fetch;
  days?: number;
}) {
  const [churn, setChurn] = useState<{ files: Record<string, number>; until: string; commits: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const f = fetchImpl ?? ((i: string, init?: RequestInit) => fetch(i, init));
    void (async () => {
      try {
        const r = await f(`/api/git/churn?days=${days}`);
        const j = (await r.json().catch(() => ({}))) as { files?: Record<string, number>; until?: string; commits?: number; error?: string };
        if (!live) return;
        if (!r.ok) setError(j.error ?? `The history could not be read (${r.status}).`);
        else setChurn({ files: j.files ?? {}, until: j.until ?? '', commits: j.commits ?? 0 });
      } catch (e) {
        if (live) setError(`The history could not be read: ${(e as Error).message}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [days, fetchImpl]);

  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const name = (id: string) => {
    const b = byId.get(id);
    return b ? viewName(b, byId, displayLabel) : id;
  };
  const ranked = useMemo(() => (graph && churn ? heatModel(graph, boxes, churn.files) : null), [graph, churn, boxes]);
  const top = ranked && ranked.length > 0 ? ranked[0]!.heat : 0;

  return (
    <div className="board-view hotview" data-testid="hotspots-view" role="region" aria-label="Hotspots">
      {error ? (
        <p className="bv-empty" role="alert" data-testid="hotspots-error">
          {error}
        </p>
      ) : !ranked ? (
        <p className="bv-empty"><AsciiSpinner /> Reading the history…</p>
      ) : ranked.length === 0 ? (
        <p className="bv-empty" data-testid="hotspots-none">
          No box on this board changed in the {days} days before the last commit.
        </p>
      ) : (
        <>
          <p className="dv-sum">
            Riskiest to edit first: central code (PageRank) that changed often in the {days} days before the last commit. {churn!.commits}{' '}
            {churn!.commits === 1 ? 'commit' : 'commits'}.
          </p>
          <p className="hv-key" data-testid="hot-key">
            Bar: changes × centrality. Centrality is how central the changed files are (PageRank), 1 for the most central box here.
          </p>
          <ol className="hv-list">
            {ranked.map((b) => (
              <li key={b.id} className="hv-row" data-testid="hot-box" data-id={b.id} data-rank={b.rank}>
                <span className="hv-rank" data-testid="hot-rank">
                  {b.rank}
                </span>
                <span className="dv-name" data-testid="hot-name" title={name(b.id)}>
                  {name(b.id)}
                </span>
                <span className="hv-bar" aria-hidden="true">
                  <span className="hv-fill" style={{ width: `${Math.max(2, Math.round((b.heat / top) * 100))}%` }} />
                </span>
                <span className="dv-n" data-testid="hot-measure">
                  {b.commits === 1 ? '1 change' : `${b.commits} changes`}, centrality {b.centrality.toFixed(2)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export default HotspotsView;
