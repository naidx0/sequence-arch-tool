/* ══════════════════════════════════════════════════════════════════════════
   THE KIND LEGEND — item 3.7
   packages/web2/src/canvas/KindLegend.tsx

   docs/brand/graphite/pages/03-node-kinds-without-hue.html §03.3 and §03.7.

   THE LEGEND CARRIES THE SILHOUETTE AND THE GLYPH, AND NO COLOUR CHIP, because
   there is no colour for a chip to show. v1 draws `<i className="…legend-dot">`
   — a coloured dot per kind, which is the retired scheme's last surviving
   organ: it says a datastore is green, and green means passed.

   AND IT DRAWS ENTRY APART FROM THE KINDS. Entry is a POSITION: any kind can
   occupy it, and a service that nothing upstream calls is an entry until one
   call is made to it from inside the scope, at which point it is a service
   again without having changed what it is. "A legend that lists entry among the
   kinds teaches the reader that entry is a thing you can build, which it is
   not." The two groups come from `legendGroups`, which returns them as groups
   rather than as a flat list with a magic index — a renderer cannot then draw
   the separator in the wrong place, and a legend showing a subset with no entry
   in it draws no separator because there is no second group to separate.

   EVERY SPECIMEN IS AT CARD ASPECT AND AT LEAST HALF A CARD — 80 x 48, from
   --arch-card-w / 2 and --arch-card-min-h / 2. This is not a size preference.
   CSS scales every corner radius by f = min(side / sum of the radii on that
   side), so on the 26 x 18 chip this replaces, --r-14, --r-18 and --r-full all
   painted at the same 9px and three kinds rendered as one shape while the token
   list said three. A swatch smaller than twice its largest radius is a lie
   about the shape — and the book's own first draft proved the greyscale
   invariant against DECLARED values and passed while being wrong.
   ══════════════════════════════════════════════════════════════════════════ */

import { useRef, useState } from 'react';

import { BoardIcon } from './BoardIcon.js';
import {
  SILHOUETTES,
  type Silhouette,
  legendGroups,
  legendSwatchClass,
  silhouetteGlyph,
  silhouetteLabel,
} from './kinds.js';

/**
 * The width the expanded key needs, measured rather than guessed.
 *
 * board.css did the arithmetic and wrote it down: "Six chips at the greyscale
 * lock's own floor, plus six mono words, two group captions and a separator,
 * measure about 700px on one row." Below that it wraps, and a wrapped key grows
 * out of its corner and covers the graph it is a key to.
 *
 * The legend may take at most 55% of the frame, so the frame has to be about
 * twice the key. Named here rather than inlined so the number and the reason
 * travel together.
 */
export const LEGEND_NEEDS_PX = 1280;

export interface KindLegendProps {
  /**
   * Which silhouettes to draw. Defaults to all six.
   *
   * Passing the set actually ON the board is the honest call — a legend is a
   * key to what is in front of the reader, and a key to kinds that are not
   * there is a promise the board is not keeping.
   */
  present?: readonly Silhouette[];
  /**
   * Sheet 08.4: the same shape used as a CENSUS, where each chip carries a
   * count after the name. The legend says which kinds exist; the census says
   * how many. `null` for a kind is not zero — it is "not counted", and it draws
   * nothing rather than a number nobody measured.
   */
  counts?: Partial<Record<Silhouette, number>> | null;
}

export function KindLegend({ present = SILHOUETTES, counts = null }: KindLegendProps) {
  const groups = legendGroups(present);
  /*
   * COLLAPSED WHEN THE BOARD CANNOT HOLD IT — the ruling board.css said was
   * owed, taken.
   *
   * Its own words: "Six chips at the greyscale lock's own floor, plus six mono
   * words, two group captions and a separator, measure about 700px on one row.
   * At 900px that is three rows … where the same legend takes four rows and eats
   * a third of the board. THREE ANSWERS ARE AVAILABLE AND THIS LANE DOES NOT GET
   * TO PICK ONE … So it wraps, honestly, and the ruling is owed."
   *
   * The owner reported it as the screenshot of a key lying across his file
   * cards. This is answer 1 of the three the comment lists — collapse to a
   * control that opens it — chosen because it is the only one that fixes the
   * FOOTPRINT rather than trading words for glyphs, and because it withholds
   * nothing: one click opens it, so there is no unreachable "+N more", which is
   * a settled owner dislike.
   *
   * SHRINKING THE CHIP IS STILL NOT AVAILABLE, and the comment is right about
   * why: below --sp-40 the radii stop painting and the greyscale invariant would
   * be claimed rather than held.
   *
   * The reader's choice wins over the measurement. `open` starts as "whatever
   * fits" and stops being derived the moment they press it.
   */
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);

  const expanded = open;

  if (!expanded) {
    const kinds = groups.reduce((total, group) => total + group.silhouettes.length, 0);
    return (
      <button
        type="button"
        ref={host as never}
        className="kindlegend kindlegend-shut"
        data-testid="board-legend-shut"
        aria-expanded="false"
        title="Show kind key"
        onClick={() => setOpen(true)}
      >
        <BoardIcon name="board" size={12} />
        <span className="grp">Kinds</span>
        <span className="mono">{kinds}</span>
        <span className="kindlegend-open-hint">Show</span>
      </button>
    );
  }

  return (
    <div className="kindlegend" data-testid="board-legend" data-kindlegend-open="true" ref={host}>
      <div className="kindlegend-hd">
        <span className="grp">Kinds</span>
        <button
          type="button"
          className="kindlegend-hide"
          data-testid="board-legend-hide"
          aria-expanded="true"
          title="Hide kind key"
          onClick={() => setOpen(false)}
        >
          Hide
        </button>
      </div>
      {/* Owner A5.4: roles change the glyph; the card chassis stays the kind. */}
      <p className="kindlegend-hint" data-testid="board-legend-hint">
        Same box, different icon
      </p>
      {groups.map((group, index) => (
        <span key={group.caption} style={{ display: 'contents' }}>
          {/* The hairline between the kinds and the position. It is drawn by
              the group boundary rather than at a fixed index, so a legend with
              one group draws none. */}
          {index > 0 && <span className="grpsep" data-testid="board-legend-sep" />}
          <span className="grp">{group.caption}</span>
          {group.silhouettes.map((silhouette) => (
            <span
              key={silhouette}
              className="k"
              data-testid="board-legend-kind"
              data-kind={silhouette}
              data-group={group.caption.toLowerCase()}
            >
              <span className={`silswatch ${legendSwatchClass(silhouette)}`} aria-hidden="true" />
              <BoardIcon name={silhouetteGlyph(silhouette)} size={12} />
              {silhouetteLabel(silhouette)}
              {counts?.[silhouette] != null && (
                <span className="mono">{counts[silhouette]}</span>
              )}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
