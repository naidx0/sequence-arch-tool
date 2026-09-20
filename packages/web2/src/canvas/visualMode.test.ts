import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  VISUAL_MODE_DEFAULT,
  VISUAL_MODE_STORAGE_KEY,
  boardVisualKey,
  readBoardVisual,
  writeBoardVisual,
} from './visualMode';

/* ══════════════════════════════════════════════════════════════════════════
   THE SWITCH POINTS ON OUT OF THE BOX — MADR §0 amendment A1
   packages/web2/src/canvas/visualMode.test.ts

   Max, 2026-09-02: "I want it to be toggleable so people don't have to choose.
   They just load it, and it's always going to be doing this."

   A1 REVERSES the MADR's own decision 3 ("Default: Off"), so the direction is
   the thing worth locking: every path that does not carry an explicit `false`
   written by a reader pressing the toggle must answer ON. The reason a whole
   describe block is spent on the failure paths is that this is exactly the
   shape of defect that ships silently — a JSON.parse in a try/catch that
   returns `{}` and a caller that reads `{}[key]` as falsy would turn Visual OFF
   for every reader whose storage was ever touched by another version.
   ══════════════════════════════════════════════════════════════════════════ */

const KEY = boardVisualKey('/tmp/repo', 'session-1');

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('A1 — Visual is on by default and the toggle turns it OFF', () => {
  it('is ON when nothing has ever been written', () => {
    expect(VISUAL_MODE_DEFAULT).toBe(true);
    expect(readBoardVisual(KEY)).toBe(true);
  });

  it('is ON when the record is not JSON at all', () => {
    window.localStorage.setItem(VISUAL_MODE_STORAGE_KEY, 'not json {');
    expect(readBoardVisual(KEY)).toBe(true);
  });

  it('is ON when the record is JSON of the wrong shape', () => {
    for (const raw of ['null', '[]', '"a string"', '42']) {
      window.localStorage.setItem(VISUAL_MODE_STORAGE_KEY, raw);
      expect(readBoardVisual(KEY), raw).toBe(true);
    }
  });

  it('is ON when the record is from a version this build does not understand', () => {
    window.localStorage.setItem(
      VISUAL_MODE_STORAGE_KEY,
      JSON.stringify({ version: 99, boards: { [KEY]: false } }),
    );
    expect(readBoardVisual(KEY)).toBe(true);
  });

  it('is ON when the stored value is not a boolean', () => {
    /* `0`, `''` and `null` are all falsy, and a reader who never pressed
       anything must not be handed the plain board because some other writer
       left a number in the slot. */
    for (const value of [0, '', null, 'false']) {
      window.localStorage.setItem(
        VISUAL_MODE_STORAGE_KEY,
        JSON.stringify({ version: 1, boards: { [KEY]: value } }),
      );
      expect(readBoardVisual(KEY), JSON.stringify(value)).toBe(true);
    }
  });

  it('is OFF only when a reader actually turned it off', () => {
    writeBoardVisual(KEY, false);
    expect(readBoardVisual(KEY)).toBe(false);
    writeBoardVisual(KEY, true);
    expect(readBoardVisual(KEY)).toBe(true);
  });
});

describe('the record is per board and versioned', () => {
  it('one board turned off leaves every other board on', () => {
    /* MERGED, NOT REPLACED. A reader has a monorepo, a second repository and a
       scratch pad; writing only the current board would reset the other two to
       the default on the next boot, which reads as the toggle forgetting. */
    const other = boardVisualKey('/tmp/other', 'session-1');
    const scratch = boardVisualKey(null, 'session-2');
    writeBoardVisual(KEY, false);
    writeBoardVisual(other, false);
    expect(readBoardVisual(KEY)).toBe(false);
    expect(readBoardVisual(other)).toBe(false);
    expect(readBoardVisual(scratch)).toBe(true);
  });

  it('keys a repository on its ROOT, so a rescan does not forget the choice', () => {
    /* `ConnectedBoard.attachIdentity` is `root|scannedAt` and re-decides things
       per scan on purpose. A preference is not one of those things. */
    expect(boardVisualKey('/tmp/repo', 'a')).toBe(boardVisualKey('/tmp/repo', 'b'));
  });

  it('keys a board with no repository on its own session', () => {
    expect(boardVisualKey(null, 'a')).not.toBe(boardVisualKey(null, 'b'));
  });

  it('writes the version, so a later shape change can refuse this record', () => {
    writeBoardVisual(KEY, false);
    const raw = JSON.parse(window.localStorage.getItem(VISUAL_MODE_STORAGE_KEY)!);
    expect(raw.version).toBe(1);
    expect(raw.boards[KEY]).toBe(false);
  });
});
