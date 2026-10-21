/* The edge evidence popover (split from BoardControls.tsx so it loads on the
   first click on a line, not at boot). */

import { BoardIcon } from './BoardIcon.js';


export interface EdgeEvidenceProps {
  title: string;
  /** Scanned edges under the connector. */
  total: number;
  /** file:line pairs in all, of which `lines` are the first. */
  lineTotal: number;
  lines: ReadonlyArray<{ file: string; line: number }>;
  at: { x: number; y: number };
  onClose: () => void;
}

/** What a connector stands for: every scanned edge under it, file:line. */
export function EdgeEvidence({ title, total, lineTotal, lines, at, onClose }: EdgeEvidenceProps) {
  return (
    <div
      className="edge-evidence"
      role="dialog"
      aria-label="Edge evidence"
      data-testid="board-edge-evidence"
      style={{ left: at.x, top: at.y }}
    >
      <div className="ee-hd">
        <span className="ee-t">{title}</span>
        <span className="ee-n" data-testid="board-edge-evidence-count">
          {total === 1 ? '1 edge' : `${total} edges`}
        </span>
        <button type="button" className="bbtn" aria-label="Close" title="Close" data-testid="board-edge-evidence-close" onClick={onClose}>
          <BoardIcon name="b-x" size={14} />
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="bm-note">The scan recorded no file and line for this connector.</p>
      ) : (
        <ul className="ee-list">
          {lines.map((l, i) => (
            <li key={`${l.file}:${l.line}:${i}`} className="ee-row" data-testid="board-edge-evidence-row">
              {l.file}:{l.line}
            </li>
          ))}
        </ul>
      )}
      {lineTotal > lines.length ? <p className="bm-note">{`${lineTotal - lines.length} more lines not listed.`}</p> : null}
    </div>
  );
}
