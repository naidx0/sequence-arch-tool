/* ══════════════════════════════════════════════════════════════════════════
   MOVING THROUGH THE RAIL WITH A KEYBOARD
   packages/web2/src/rail/railKeys.ts

   The rail is a plain `ul` of buttons: Tab visits every row one at a time, so
   reaching a file four hundred rows down means four hundred Tab presses, and
   there is no way to collapse or expand without a mouse.

   Every file browser a developer has ever used answers this with the same four
   keys, and they are the ones implemented here — a rail that invented its own
   would be a rail the reader has to learn.

   ── WHY A PURE FUNCTION ──────────────────────────────────────────────────

   Keyboard navigation is arithmetic over a list — where am I, what is the next
   thing I can reach — and it is the part that goes subtly wrong: off-by-ones
   at the ends, skipping collapsed children, wrapping when it should stop.
   Answering it here means every one of those cases is a test rather than a
   thing to click.
   ══════════════════════════════════════════════════════════════════════════ */

/** What a key press should do to the rail. */
export type RailKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'expand'; index: number }
  | { kind: 'collapse'; index: number }
  | { kind: 'activate'; index: number }
  | { kind: 'none' };

export interface RailKeyRow {
  /** Rows a reader can land on. A collapsed file's functions are not here. */
  id: string;
  /** True for a row that can open, i.e. a file with functions under it. */
  expandable: boolean;
  expanded: boolean;
}

export interface RailKeyInput {
  key: string;
  /** Where focus is now. -1 when nothing in the rail has it. */
  index: number;
  rows: readonly RailKeyRow[];
}

/**
 * Decide what one key press means.
 *
 * ARROWS DO NOT WRAP. A list that jumps from the last row to the first when a
 * reader holds Down is a list that has lost them — in a file tree, "I am at the
 * end" is information, and silently teleporting to the top destroys it. Home
 * and End are how you get to the ends deliberately.
 */
export function railKey(input: RailKeyInput): RailKeyAction {
  const { key, index, rows } = input;
  if (rows.length === 0) return { kind: 'none' };

  const current = rows[index];

  switch (key) {
    case 'ArrowDown':
      /* From nowhere, Down enters at the top rather than doing nothing — the
         reader pressed a key meaning "into the list". */
      return { kind: 'move', index: index < 0 ? 0 : Math.min(index + 1, rows.length - 1) };

    case 'ArrowUp':
      /* And from nowhere, Up enters at the BOTTOM, for the same reason in the
         other direction. */
      if (index < 0) return { kind: 'move', index: rows.length - 1 };
      return { kind: 'move', index: Math.max(index - 1, 0) };

    case 'Home':
      return { kind: 'move', index: 0 };

    case 'End':
      return { kind: 'move', index: rows.length - 1 };

    case 'ArrowRight':
      /*
       * OPEN, OR STEP INTO WHAT IS ALREADY OPEN. Right on an open row moving
       * to its first child is what every tree does, and a Right that did
       * nothing there would feel broken to anyone who has used one.
       */
      if (!current) return { kind: 'none' };
      if (current.expandable && !current.expanded) return { kind: 'expand', index };
      if (current.expandable && current.expanded && index + 1 < rows.length) {
        return { kind: 'move', index: index + 1 };
      }
      return { kind: 'none' };

    case 'ArrowLeft':
      /* Close, or — when there is nothing to close — go to the parent, which
         is the nearest preceding expandable row. */
      if (!current) return { kind: 'none' };
      if (current.expandable && current.expanded) return { kind: 'collapse', index };
      for (let i = index - 1; i >= 0; i--) {
        if (rows[i]!.expandable) return { kind: 'move', index: i };
      }
      return { kind: 'none' };

    case 'Enter':
    case ' ':
      return current ? { kind: 'activate', index } : { kind: 'none' };

    default:
      /* Every other key is the reader's — typing must reach the filter field,
         not be swallowed by a navigation handler. */
      return { kind: 'none' };
  }
}

/**
 * Keys the rail is INTERESTED IN.
 *
 * NOT the same as "keys to preventDefault". A key in this set can still answer
 * `none` in a particular position — ArrowLeft on a top-level row has nothing
 * to close and no parent to climb to — and swallowing it there would take the
 * browser's own behaviour away and put nothing in its place.
 *
 * So the caller's rule is: preventDefault when the ACTION is not `none`, never
 * on the key alone. This set exists to let a caller skip the call entirely for
 * ordinary typing, which must reach the filter field.
 */
export const RAIL_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'Enter',
  ' ',
]);
