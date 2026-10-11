import { describe, expect, it } from 'vitest';

import { RAIL_KEYS, railKey, type RailKeyRow } from './railKeys';

/**
 * MOVING THROUGH THE RAIL WITH A KEYBOARD.
 *
 * The rail is a plain `ul` of buttons: Tab visits every row one at a time, so
 * reaching a file four hundred rows down means four hundred Tab presses, and
 * nothing can be expanded or collapsed without a mouse.
 */

const rows: RailKeyRow[] = [
  { id: 'card', expandable: false, expanded: false },
  { id: 'fileA', expandable: true, expanded: false },
  { id: 'fileB', expandable: true, expanded: true },
  { id: 'fnB1', expandable: false, expanded: false },
];

const press = (key: string, index: number) => railKey({ key, index, rows });

describe('moving', () => {
  it('Down and Up step one row', () => {
    expect(press('ArrowDown', 0)).toEqual({ kind: 'move', index: 1 });
    expect(press('ArrowUp', 2)).toEqual({ kind: 'move', index: 1 });
  });

  it('ARROWS DO NOT WRAP', () => {
    /*
     * A list that jumps from the last row to the first when a reader holds
     * Down has lost them. In a file tree "I am at the end" is information, and
     * silently teleporting to the top destroys it.
     */
    expect(press('ArrowDown', rows.length - 1)).toEqual({ kind: 'move', index: rows.length - 1 });
    expect(press('ArrowUp', 0)).toEqual({ kind: 'move', index: 0 });
  });

  it('Home and End are how you reach the ends deliberately', () => {
    expect(press('Home', 2)).toEqual({ kind: 'move', index: 0 });
    expect(press('End', 0)).toEqual({ kind: 'move', index: rows.length - 1 });
  });

  it('from NOWHERE, Down enters at the top and Up enters at the bottom', () => {
    /* The reader pressed a key meaning "into the list"; doing nothing would
       make the rail look unreachable by keyboard, which is the bug. */
    expect(press('ArrowDown', -1)).toEqual({ kind: 'move', index: 0 });
    expect(press('ArrowUp', -1)).toEqual({ kind: 'move', index: rows.length - 1 });
  });
});

describe('opening and closing', () => {
  it('Right opens a closed row', () => {
    expect(press('ArrowRight', 1)).toEqual({ kind: 'expand', index: 1 });
  });

  it('RIGHT ON AN OPEN ROW STEPS INTO IT', () => {
    /* What every tree does. A Right that did nothing there would feel broken
       to anyone who has used one. */
    expect(press('ArrowRight', 2)).toEqual({ kind: 'move', index: 3 });
  });

  it('Left closes an open row', () => {
    expect(press('ArrowLeft', 2)).toEqual({ kind: 'collapse', index: 2 });
  });

  it('Left on a child goes to its PARENT', () => {
    /* The nearest preceding expandable row — which is how you climb out of a
       folder without reaching for the mouse. */
    expect(press('ArrowLeft', 3)).toEqual({ kind: 'move', index: 2 });
  });

  it('Right on something that cannot open does nothing', () => {
    expect(press('ArrowRight', 0)).toEqual({ kind: 'none' });
  });
});

describe('what it refuses to touch', () => {
  it('EVERY OTHER KEY IS THE READER’S', () => {
    /*
     * Typing must reach the filter field. A navigation handler that swallowed
     * letters would make the rail's own search box unusable — the one control
     * the rail exists to make fast.
     */
    for (const key of ['a', 'z', '/', 'Escape', 'Tab', 'x']) {
      expect(railKey({ key, index: 1, rows })).toEqual({ kind: 'none' });
    }
  });

  it('an empty rail answers nothing to everything', () => {
    for (const key of [...RAIL_KEYS]) {
      expect(railKey({ key, index: -1, rows: [] })).toEqual({ kind: 'none' });
    }
  });

  it('A KEY IN THE SET CAN STILL DO NOTHING, and must not be swallowed', () => {
    /*
     * THE TEST THAT CHANGED THE DESIGN. ArrowLeft on a top-level row has
     * nothing to close and no parent to climb to, so it answers `none` — and
     * preventDefault'ing it on the strength of the key alone would take the
     * browser's own behaviour away and put nothing in its place.
     *
     * So the caller's rule is: preventDefault on the ACTION, never on the key.
     * `RAIL_KEYS` exists only to skip the call for ordinary typing, which has
     * to reach the filter field.
     */
    expect(RAIL_KEYS.has('ArrowLeft')).toBe(true);
    expect(railKey({ key: 'ArrowLeft', index: 0, rows }).kind).toBe('none');
  });

  it('every key in the set is one the function branches on', () => {
    /* A key nobody handles would be in the set for no reason at all. Checked
       across positions rather than at one index, because whether a key acts
       depends on where focus is. */
    for (const key of [...RAIL_KEYS]) {
      const acts = rows.some((_, i) => railKey({ key, index: i, rows }).kind !== 'none');
      expect(acts, `${key} should act somewhere`).toBe(true);
    }
  });
});
