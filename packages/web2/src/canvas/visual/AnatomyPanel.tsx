/* ══════════════════════════════════════════════════════════════════════════
   THE ANATOMY WALL — one node's children, drawn inside that node
   packages/web2/src/canvas/visual/AnatomyPanel.tsx

   docs/brand/graphite/pages/07-modules-and-containment.html §07.2 and §07.3.
   The arithmetic and the model are `../anatomy.ts`; this file only paints.

   IT IS SHEET 07's WALL AND NOT A NEW OBJECT. §07.2: "A module with drawn
   members is not a card. It is a .nest — a wall with a header and its members
   laid out inside it. The wall keeps the module's icon and the module's dashed
   --w-struct border, so a reader who saw the collapsed card recognises the open
   one as the same object rather than a second one." §07.3 hands over the
   disclosure behaviour verbatim: "The disclosure control is the header itself,
   not a button parked on it", which is why the header is a button and nothing
   is parked on it.

   §07.3 ALSO STATES THE LEADER-LINE RULE, in the sheet's own words about a
   different picture: "Each crossing edge lands on the member it actually
   connects to." That is the whole of what Anatomy adds to an edge — an edge
   leaving this container starts at the CELL of the file it actually leaves
   from, and only falls back to the wall when the evidence names a file that is
   not in here.

   THIS FILE IS A LAZY CHUNK, for the reason `Board.tsx` gives about
   `VisualMetaStrip`: a reader who never opens an anatomy never downloads it.
   The arithmetic that `cardBox` needs BEFORE the panel renders lives in
   `../anatomy.ts` on the main path, so an edge never terminates in mid-air
   waiting for a dynamic import.

   NO HUE IS SPENT HERE. Cells take the substrate's nesting greys, which already
   mean depth and mean nothing else; the shade question is answered in
   `../anatomy.ts`'s header, with the three reasons page rank and churn were
   both declined, so that nobody adds a heat ramp to this file later.
   ══════════════════════════════════════════════════════════════════════════ */

import type { NodeKind } from '@sequence/schema';

import {
  ANATOMY_MAP,
  anatomyEmptyCopy,
  anatomyLabelFits,
  isAnatomyBucket,
  ANATOMY_LABEL_INSET,
  ANATOMY_LABEL_MIN_H,
  leaderWeightStep,
  type AnatomyCell,
  type AnatomyPanel as AnatomyPanelModel,
  type AnatomyRect,
} from '../anatomy.js';

export interface AnatomyPanelProps {
  panel: AnatomyPanelModel;
  /** The opened node's own kind — the empty copy depends on it. */
  kind?: NodeKind;
  /** §07.3: the header IS the control. Closes the wall. */
  onClose: () => void;
}

/**
 * A CELL CARRIES ITS NAME ONLY WHERE THE WHOLE NAME FITS — `anatomyLabelFits`.
 *
 * THE PREDICATE AND ITS METRICS LIVE IN `anatomy.ts` NOW, with the reasoning and
 * the measured 6.0px advance. It moved because the card must reserve a row for
 * the bucket's written declaration, and whether that declaration renders depends
 * on whether the bucket's own name renders — so the height model has to be able
 * to ask this same question. A predicate only the painter could evaluate forced
 * the reservation to guess, and a guess is either dead ground under the map or a
 * paint over the card's border.
 */
const fitsLabel = anatomyLabelFits;

/** `1,234` — the mono numerals the rest of the board already uses. */
function grouped(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * ONE STRAIGHT ORTHOGONAL RUN, ZERO BENDS.
 *
 * The board's connector law is orthogonal elbows with at most two bends. A
 * leader out of a treemap cell needs none: it leaves the cell's centre and runs
 * to the nearest wall on one axis, so which cell it belongs to and which side
 * the traffic leaves by are both readable without following a corner.
 */
function leaderPath(rect: AnatomyRect): string {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const gaps = [
    { d: cx, to: `M ${cx} ${cy} L 0 ${cy}` },
    { d: ANATOMY_MAP - cx, to: `M ${cx} ${cy} L ${ANATOMY_MAP} ${cy}` },
    { d: cy, to: `M ${cx} ${cy} L ${cx} 0` },
    { d: ANATOMY_MAP - cy, to: `M ${cx} ${cy} L ${cx} ${ANATOMY_MAP}` },
  ];
  let best = gaps[0]!;
  for (const gap of gaps) if (gap.d < best.d) best = gap;
  return best.to;
}

function cellTitle(cell: AnatomyCell): string {
  const what = cell.container
    ? `${grouped(cell.files)} files · ${grouped(cell.loc)} lines`
    : `${grouped(cell.loc)} lines`;
  return cell.toScale
    ? `${cell.label} — ${what}`
    : `${cell.label} — holds nothing, so it is drawn in the band below the map rather than to scale`;
}

export function AnatomyPanel({ panel, kind, onClose }: AnatomyPanelProps) {
  const parts = panel.cells.length;

  return (
    <div className="ana" data-testid="board-node-anatomy" data-node-id={panel.nodeId}>
      {/* §07.3 — the whole strip is the hit target, and the count is in it in
          both states so a shut wall can never be mistaken for an empty one. */}
      <button
        type="button"
        className="ana-hd"
        data-testid="board-node-anatomy-head"
        aria-expanded="true"
        aria-label={`Close the anatomy of ${panel.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <span className="ana-hd-t">Anatomy</span>
        <span className="right mono">
          {panel.empty ? 'nothing inside' : `${grouped(parts)} · ${grouped(panel.size.loc)}`}
        </span>
      </button>

      {panel.empty ? (
        /* THE EMPTY PREDICATE IS "NO CHILDREN AT ALL" — see `anatomyIsEmpty`.
           Reaching this branch for a node with 969 file descendants and no
           direct file children is the defect that measurement caught three
           separate times. */
        <p className="ana-empty" data-testid="board-node-anatomy-empty">
          {anatomyEmptyCopy(kind)}
        </p>
      ) : (
        <svg
          className="ana-map"
          data-testid="board-node-anatomy-map"
          viewBox={`0 0 ${ANATOMY_MAP} ${ANATOMY_MAP}`}
          width={ANATOMY_MAP}
          height={ANATOMY_MAP}
          role="img"
          aria-label={`${panel.label} holds ${grouped(parts)} parts and ${grouped(panel.size.loc)} lines. Each rectangle's area is its lines of code.`}
        >
          {panel.cells.map((cell) => (
            <g
              key={cell.id}
              className={[
                'ana-cell',
                cell.container ? 'ana-container' : 'ana-leaf',
                cell.toScale ? '' : 'ana-unscaled',
              ]
                .filter(Boolean)
                .join(' ')}
              /* KEYED BY NODE ID, NEVER BY PATH. Six modules legitimately share
                 `packages/analyzer/src` — they are Louvain clusters, not
                 directories — and a path key collides six sibling cells into
                 one. `anatomyLocks.test.ts` pins this against the real graph. */
              data-cell-id={cell.id}
              data-to-scale={cell.toScale ? 'true' : 'false'}
            >
              <title>{cellTitle(cell)}</title>
              <rect x={cell.rect.x} y={cell.rect.y} width={cell.rect.w} height={cell.rect.h} />
              {fitsLabel(cell.rect, cell.label) ? (
                <text
                  className="ana-label"
                  x={cell.rect.x + ANATOMY_LABEL_INSET}
                  y={cell.rect.y + ANATOMY_LABEL_MIN_H - ANATOMY_LABEL_INSET}
                >
                  {cell.label}
                </text>
              ) : null}
            </g>
          ))}

          {/* THE LEADERS, BUNDLED AT THE ORIGIN. One stroke per cell however
              many edges leave it — 64 leave `repoServer.ts` alone, and 64
              strokes into one small cell is a legibility failure rather than a
              detail. The weight says which bundle is the trunk.

              ONE GROUP, so the whole reading recedes together — see board.css.
              Opening `analyzer` draws 53 bundles across a 129px map, and at
              full strength they took the reading away from the areas. */}
          <g className="ana-leaders">
          {panel.leaders.map((leader) => {
            const cell = leader.cellId
              ? panel.cells.find((candidate) => candidate.id === leader.cellId)
              : undefined;
            if (!cell) {
              /* THE BORDER FALLBACK — evidence naming a file that is not in
                 this node. It resolves at 100% on this repository, so this
                 branch is reached by NO real input here and is locked with
                 synthetic evidence instead. A tick on the wall, never an
                 invented cell. */
              return (
                <g key="leader-border" className="ana-leader ana-leader-border" data-leader="border">
                  <title>{`${grouped(leader.count)} edges leave from evidence outside this node — drawn on the wall, not on a cell`}</title>
                  <path d={`M ${ANATOMY_MAP} 0 L ${ANATOMY_MAP} ${ANATOMY_MAP}`} />
                </g>
              );
            }
            return (
              <g
                key={`leader-${leader.cellId}`}
                className={`ana-leader ana-leader-w${leaderWeightStep(leader.count)}`}
                data-leader={leader.cellId}
                data-leader-count={leader.count}
              >
                <title>{`${grouped(leader.count)} edges leave from ${cell.label}`}</title>
                <path d={leaderPath(cell.rect)} />
              </g>
            );
          })}
          </g>
        </svg>
      )}

      {panel.bucketUnnamed ? (
        /* THE AGGREGATE SAYS SO WHEN ITS CELL CANNOT. The loose-file bucket is
           the only cell whose subject is not in the scan — it stands for N real
           children — and it is built with `kind: 'file'`, so an unnamed bucket
           reads as ONE file and the reader is shown a structure the repository
           does not have. Measured on this monorepo: analyzer's bucket is
           61.7 x 115.0 against a 96px name, short by 34.29px.

           ONLY WHEN THE NAME IS WITHHELD. Where the cell carries "3 loose files"
           itself, this note would restate it — §3, content that names itself is
           not labelled again. `bucketUnnamed` asks exactly that question, with
           the same predicate the painter uses above. */
        <p className="ana-note" data-testid="board-node-anatomy-bucket">
          {`One cell gathers ${grouped(
            panel.cells.find((c) => isAnatomyBucket(c.id))?.files ?? 0,
          )} loose files at their combined size. Its name does not fit; hover it to read.`}
        </p>
      ) : null}

      {panel.zeroCount > 0 ? (
        /* NOT TO SCALE, AND IT SAYS SO. A child that rolls up to zero lines can
           take no area in a map whose contract is that area is lines. Dropping
           it would silently lose a child the scan found; giving it a minimum
           area would claim lines it does not have. So it is drawn in its own
           band and the band is labelled. */
        <p className="ana-note" data-testid="board-node-anatomy-zero">
          {panel.zeroCount === 1
            ? 'The bottom band holds 1 part with no files. It is not drawn to scale.'
            : `The bottom band holds ${grouped(panel.zeroCount)} parts with no files. They are not drawn to scale.`}
        </p>
      ) : null}
    </div>
  );
}
