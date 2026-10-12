/* ══════════════════════════════════════════════════════════════════════════
   ROW LABELS FOLLOW THEIR MEMBERS
   packages/web2/src/canvas/rowLabels.ts

   Round 7, C.3. Jaden, on the ML harness: "under not connected, it says
   SRC... I move that, and then not connected label stays." The label was
   placed once, where the layout put the row, and never looked at the cards
   again.

   Now the label is recomputed from where its members ARE: above the top-left
   of the members still in the row. A member dragged clear of the row's laid
   band (the row as the layout placed it, padded by `ROW_SLACK`) has left the
   row and stops counting; when every member has left (one card, moved), the
   row went with them, so the label follows all of them.
   ══════════════════════════════════════════════════════════════════════════ */

/** The label's height above its row, in flow units (layout.ts ORPHAN_LABEL_H). */
export const ROW_LABEL_H = 24;
/** How far past the laid row a member may be dragged and still be in it. */
export const ROW_SLACK = 40;

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RowLabelInput {
  text: string;
  /** Where the layout put the label. */
  x: number;
  y: number;
  count: number;
  /** The row's cards. Absent: the label stays where it was laid. */
  ids?: readonly string[];
}

const overlaps = (a: Box, b: { x0: number; y0: number; x1: number; y1: number }) =>
  a.x < b.x1 && a.x + a.w > b.x0 && a.y < b.y1 && a.y + a.h > b.y0;

/**
 * The label's place and count for the members' current boxes (`now`) and
 * their laid boxes (`laid`). Null when no member is on the board.
 */
export function followRowLabel(
  row: RowLabelInput,
  now: ReadonlyMap<string, Box>,
  laid: ReadonlyMap<string, Box>,
): { x: number; y: number; count: number } | null {
  if (!row.ids || row.ids.length === 0) return { x: row.x, y: row.y, count: row.count };
  const members = row.ids.map((id) => now.get(id)).filter((b): b is Box => Boolean(b));
  if (members.length === 0) return null;
  const laidMembers = row.ids.map((id) => laid.get(id)).filter((b): b is Box => Boolean(b));
  let staying = members;
  if (laidMembers.length > 0) {
    const band = {
      x0: Math.min(...laidMembers.map((b) => b.x)) - ROW_SLACK,
      y0: Math.min(...laidMembers.map((b) => b.y)) - ROW_SLACK,
      x1: Math.max(...laidMembers.map((b) => b.x + b.w)) + ROW_SLACK,
      y1: Math.max(...laidMembers.map((b) => b.y + b.h)) + ROW_SLACK,
    };
    const inRow = members.filter((b) => overlaps(b, band));
    if (inRow.length > 0) staying = inRow;
  }
  return {
    x: Math.min(...staying.map((b) => b.x)),
    y: Math.min(...staying.map((b) => b.y)) - ROW_LABEL_H,
    count: staying.length,
  };
}
