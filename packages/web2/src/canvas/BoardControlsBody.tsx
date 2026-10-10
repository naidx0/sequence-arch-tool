/* The board controls' More body (split from BoardControls.tsx so it loads
   when the panel is first opened, not at boot). */

import type { BoardControlsProps } from './BoardControls.js';
import { BOARD_KEYS } from './boardKeysHint.js';

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onPick,
  testid,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; text: string }>;
  onPick: (v: T) => void;
  testid: string;
}) {
  return (
    <div className="bseg" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`bseg-b${o.value === value ? ' on' : ''}`}
          data-value={String(o.value)}
          onClick={() => onPick(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function BoardControlsBody(props: BoardControlsProps) {
  const sel = props.selectedLabel;
  return (
    <div className="bmenu bc-body" role="group" aria-label="Board controls">
      <div className="bm-row">
        <span className="bm-cap">Path</span>
        <button type="button" className="bpill" data-testid="board-path-start" disabled={!sel} onClick={props.onPathStart}>
          Start
        </button>
        <button type="button" className="bpill" data-testid="board-path-end" disabled={!sel || !props.pathStart} onClick={props.onPathEnd}>
          End
        </button>
        {props.pathStart ? (
          <button type="button" className="bpill" data-testid="board-path-clear" onClick={props.onPathClear}>
            Clear
          </button>
        ) : null}
      </div>
      <p className="bm-note" data-testid="board-path-note">
        {props.pathNote ??
          (props.pathStart
            ? `From ${props.pathStart}. Select the end card, then End.`
            : 'Select a card, then Start.')}
      </p>
      <div className="bm-row">
        <span className="bm-cap">Neighbours</span>
        {props.focusLabel ? (
          <button type="button" className="bpill" data-testid="board-focus-clear" onClick={props.onFocusClear}>
            Show all
          </button>
        ) : (
          <button type="button" className="bpill" data-testid="board-focus-selected" disabled={!sel} onClick={props.onFocusSelected}>
            Only near selected
          </button>
        )}
        <Segmented
          label="Hops"
          testid="board-proximity"
          value={props.proximity}
          options={[
            { value: 1 as const, text: '1' },
            { value: 2 as const, text: '2' },
            { value: 3 as const, text: '3' },
          ]}
          onPick={props.onProximity}
        />
      </div>
      <div className="bm-row">
        <span className="bm-cap">Layout</span>
        <Segmented
          label="Direction"
          testid="board-direction"
          value={props.direction}
          options={[
            { value: 'auto' as const, text: 'Auto' },
            { value: 'LR' as const, text: 'Across' },
            { value: 'TB' as const, text: 'Down' },
          ]}
          onPick={props.onDirection}
        />
        {props.onResetLayout ? (
          /* Round 7 C.1: put every hand-placed card back where the layout
             puts it. Disabled, and says why, when nothing was moved. */
          <button
            type="button"
            className="bpill"
            data-testid="board-reset-layout"
            disabled={!props.moved}
            title={
              props.moved
                ? `Put the ${props.moved === 1 ? 'card' : `${props.moved} cards`} you moved back where the layout puts ${props.moved === 1 ? 'it' : 'them'}`
                : 'Nothing has been moved. Drag a card to place it.'
            }
            onClick={props.onResetLayout}
          >
            Reset layout
          </button>
        ) : null}
      </div>
      <div className="bm-row">
        <span className="bm-cap">Groups</span>
        <Segmented
          label="Groups"
          testid="board-grouping"
          value={props.flat ? 'flat' : 'composite'}
          options={[
            { value: 'composite' as const, text: 'Framed' },
            { value: 'flat' as const, text: 'Flat' },
          ]}
          onPick={(v) => props.onFlat(v === 'flat')}
        />
        {props.onExpandAll ? (
          <button type="button" className="bpill" data-testid="board-expand-all" onClick={props.onExpandAll}>
            Expand all
          </button>
        ) : null}
        {props.onCollapseAll ? (
          <button type="button" className="bpill" data-testid="board-collapse-all" onClick={props.onCollapseAll}>
            Collapse all
          </button>
        ) : null}
      </div>
      {/* Round 7 C.5: the board's keys, from the same list the handler reads. */}
      <div className="bm-keys" data-testid="board-keys-hint" aria-label="Board keys">
        <span className="bm-cap">Keys</span>
        <dl className="bm-keylist">
          {BOARD_KEYS.map((row) => (
            <div className="bm-key" key={row.keys}>
              <dt>
                <kbd className="mono">{row.keys}</kbd>
              </dt>
              <dd>{row.does}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="bm-row">
        <button type="button" className="bpill" data-testid="board-export-png" onClick={props.onExport}>
          Save as PNG
        </button>
        {props.exportNote ? (
          <span className="bm-note" data-testid="board-export-note">
            {props.exportNote}
          </span>
        ) : null}
      </div>
    </div>
  );
}
