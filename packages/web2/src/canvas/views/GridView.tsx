/* ══════════════════════════════════════════════════════════════════════════
   GRID — the board as a dependency matrix
   packages/web2/src/canvas/views/GridView.tsx

   Rows depend on columns: a cell holds how many edges the row's line to the
   column stands for. Same boxes and same lines as the Map (viewModel.ts).
   Okoe et al. 2018: for dense clusters a matrix answers adjacency questions
   better than node-link. Whether it does here is the registered A/B.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';

import { displayLabel } from '../displayLabel.js';
import { readingOrder, viewName, type ViewBox, type ViewLine } from './viewModel.js';
import './views.css';

/** Cell size that fills the pane: the room left after the labels, split by
 *  the number of boxes, between 18 and 56 px. Round 7 C.6 (Jaden: the grid
 *  "isn't... big enough for the screen size"): the ceiling was 32, so a
 *  five-box board drew a 160px matrix in a 760px pane. */
export const GRID_CELL_MAX = 56;
export const GRID_CELL_MIN = 18;
export function gridCellSize(width: number, height: number, n: number, rowLabelW = 180, colLabelH = 150): number {
  if (n <= 0 || !(width > 0) || !(height > 0)) return 24;
  const fit = Math.min((width - rowLabelW) / n, (height - colLabelH) / n);
  return Math.max(GRID_CELL_MIN, Math.min(GRID_CELL_MAX, Math.floor(fit)));
}

export function GridView({
  boxes,
  lines,
  onCell,
}: {
  boxes: readonly ViewBox[];
  lines: readonly ViewLine[];
  /** A cell with a count was clicked: list that line's edges (file:line). */
  onCell?: (source: string, target: string, at: { x: number; y: number }) => void;
}) {
  const order = useMemo(() => readingOrder(boxes), [boxes]);
  const root = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState(24);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      /* The glass card's own padding and the caption come off first. */
      setCellPx(gridCellSize(r.width - 40, r.height - 64, order.length));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [order.length]);
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const cell = useMemo(() => new Map(lines.map((l) => [`${l.source}->${l.target}`, l])), [lines]);
  const name = (b: ViewBox) => viewName(b, byId, displayLabel);
  return (
    <div
      ref={root}
      className="board-view gridview"
      data-testid="grid-view"
      role="region"
      aria-label="Dependency grid"
      style={{ ['--gv-cell' as string]: `${cellPx}px` }}
    >
      {order.length === 0 ? (
        <p className="bv-empty">Nothing on the board to tabulate.</p>
      ) : (
        <table className="gv-table">
          <caption className="gv-cap">Each row uses the columns marked. Numbers count code links.</caption>
          <thead>
            <tr>
              <th className="gv-corner" scope="col" />
              {order.map((b) => (
                <th key={b.id} className={`gv-col${b.parentId ? ' is-member' : ''}`} scope="col" data-col={b.id} title={name(b)}>
                  <span className="gv-col-t" data-testid="grid-col-label">
                    {name(b)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((r) => (
              <tr key={r.id}>
                <th className={`gv-row${r.parentId ? ' is-member' : ''}`} scope="row" data-row={r.id} title={name(r)}>
                  <span className="gv-row-t" data-testid="grid-row-label">
                    {name(r)}
                  </span>
                </th>
                {order.map((c) => {
                  const l = r.id === c.id ? undefined : cell.get(`${r.id}->${c.id}`);
                  return (
                    <td
                      key={c.id}
                      className={`gv-cell${r.id === c.id ? ' is-self' : ''}${l ? ' is-on' : ''}`}
                      data-src={r.id}
                      data-dst={c.id}
                      title={l ? `${name(r)} uses ${name(c)}${l.title ? `: ${l.title}` : ''}` : undefined}
                    >
                      {l ? (
                        <button
                          type="button"
                          className="gv-hit"
                          data-testid="grid-cell"
                          aria-label={`${name(r)} uses ${name(c)}: ${l.count} code ${l.count === 1 ? 'link' : 'links'}. Show where.`}
                          onClick={(e) => onCell?.(r.id, c.id, { x: e.clientX, y: e.clientY })}
                        >
                          {l.count}
                        </button>
                      ) : (
                        ''
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default GridView;
