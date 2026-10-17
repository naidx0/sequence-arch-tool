/* ══════════════════════════════════════════════════════════════════════════
   FLOW — a sequence diagram along a picked path
   packages/web2/src/canvas/views/FlowView.tsx

   Pick a start and an end; the view walks the shortest directed path over
   the lines the Map draws (viewModel.ts) and draws it as lifelines with one
   message per hop, in order, each labelled with what the line stands for.
   Whether this answers path questions better than the Map is the registered
   A/B (lab/log.md, 2026-10-05).
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';

import { displayLabel } from '../displayLabel.js';
import { readingOrder, shortestPath, viewName, type ViewBox, type ViewLine } from './viewModel.js';
import './views.css';

export function FlowView({
  boxes,
  lines,
  initialFrom = null,
  initialTo = null,
}: {
  boxes: readonly ViewBox[];
  lines: readonly ViewLine[];
  initialFrom?: string | null;
  initialTo?: string | null;
}) {
  const order = useMemo(() => readingOrder(boxes), [boxes]);
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const name = (id: string) => {
    const b = byId.get(id);
    return b ? viewName(b, byId, displayLabel) : id;
  };
  const [from, setFrom] = useState<string>(initialFrom ?? '');
  const [to, setTo] = useState<string>(initialTo ?? '');
  const path = useMemo(() => (from && to ? shortestPath(lines, from, to) : undefined), [lines, from, to]);
  const actors = useMemo(() => {
    if (!path || path.length === 0) return from ? [from] : [];
    return [path[0]!.source, ...path.map((l) => l.target)];
  }, [path, from]);

  return (
    <div className="board-view flowview" data-testid="flow-view" role="region" aria-label="Flow along a path">
      <div className="fv-pick">
        <label className="fv-field">
          <span>From</span>
          <select data-testid="flow-start" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Pick a start</option>
            {order.map((b) => (
              <option key={b.id} value={b.id}>
                {name(b.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="fv-field">
          <span>To</span>
          <select data-testid="flow-end" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Pick an end</option>
            {order.map((b) => (
              <option key={b.id} value={b.id}>
                {name(b.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!from || !to ? (
        <p className="bv-empty" data-testid="flow-hint">
          Pick a start and an end to draw the path between them.
        </p>
      ) : path === null ? (
        <p className="bv-empty" data-testid="flow-nopath">
          No path from {name(from)} to {name(to)} on this board.
        </p>
      ) : (
        <div className="fv-seq" data-testid="flow-seq" style={{ ['--fv-n' as string]: String(actors.length) }}>
          <div className="fv-heads">
            {actors.map((id) => (
              <div key={id} className="fv-head" data-testid="flow-lifeline" data-id={id} title={name(id)}>
                {name(id)}
              </div>
            ))}
          </div>
          <ol className="fv-msgs">
            {path!.map((l, i) => (
              <li
                key={`${l.source}->${l.target}`}
                className="fv-msg"
                data-testid="flow-message"
                data-from={l.source}
                data-to={l.target}
                style={{ ['--fv-at' as string]: String(i) }}
              >
                <span className="fv-arrow" aria-hidden="true" />
                <span className="fv-label">
                  {i + 1}. {name(l.source)} to {name(l.target)}
                  {l.title ? `: ${l.title}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <p className="fv-note" data-testid="flow-count">
            {path!.length === 1 ? '1 hop' : `${path!.length} hops`}
          </p>
        </div>
      )}
    </div>
  );
}

export default FlowView;
