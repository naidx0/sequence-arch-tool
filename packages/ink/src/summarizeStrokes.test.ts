/**
 * `summarizeStrokes` — the translation from recognised shapes to WORDS.
 *
 * The recognizer's own contracts are locked in `index.test.ts` and
 * `recognizeStroke.moat.test.ts`; this file locks the only thing those cannot,
 * which is what a DRAWING (a set of strokes) says about itself: the counted
 * phrase, the coarse layout, and the refusal to name a stroke the classifier
 * would not name.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inkGridCell, summarizeStrokes, INK_SHAPE_NAMES } from './index.js';

/** A rough rectangle at (x, y) of the given size — closed, high fill. */
function boxAt(x: number, y: number, w = 120, h = 90) {
  return {
    points: [
      { x, y },
      { x: x + w, y: y + 2 },
      { x: x + w - 1, y: y + h },
      { x: x + 1, y: y + h - 1 },
      { x: x + 2, y: y + 3 },
    ],
  };
}

/** A straight open stroke from (x, y). */
function lineAt(x: number, y: number, dx = 160, dy = 4) {
  return {
    points: [
      { x, y },
      { x: x + dx / 2, y: y + dy / 2 },
      { x: x + dx, y: y + dy },
    ],
  };
}

/** A closed loop that encloses no area — the classifier's own `scribble`. */
function scribbleAt(x: number, y: number) {
  return {
    points: [
      { x, y },
      { x: x + 80, y: y + 80 },
      { x, y: y + 80 },
      { x: x + 80, y },
      { x: x + 1, y: y + 1 },
    ],
  };
}

describe('a drawing describes itself in words, never in points', () => {
  it('counts each kind and says so in one English phrase', () => {
    const s = summarizeStrokes([
      boxAt(0, 0),
      boxAt(400, 0),
      boxAt(0, 400),
      lineAt(150, 40),
      lineAt(150, 440),
    ]);
    assert.equal(s.counts.box, 3);
    assert.equal(s.counts.line, 2);
    assert.equal(s.counts.scribble, 0);
    assert.equal(s.phrase, '3 rectangles and 2 lines');
  });

  it('a single mark of a kind is singular', () => {
    const s = summarizeStrokes([boxAt(0, 0)]);
    assert.equal(s.phrase, '1 rectangle');
  });

  it('three kinds read with a comma then an "and"', () => {
    const s = summarizeStrokes([boxAt(0, 0), lineAt(300, 0), scribbleAt(600, 0)]);
    assert.equal(s.counts.scribble, 1);
    assert.equal(s.phrase, '1 rectangle, 1 line and 1 unreadable mark');
  });

  it('NAMES NOTHING THE CLASSIFIER WOULD NOT NAME — a scribble stays unreadable', () => {
    const s = summarizeStrokes([scribbleAt(0, 0)]);
    assert.equal(s.strokes[0]?.kind, 'scribble');
    assert.equal(s.strokes[0]?.name, INK_SHAPE_NAMES.scribble.one);
    assert.doesNotMatch(s.phrase, /rectangle|line\b/);
  });

  it('an empty drawing says NOTHING rather than "0 marks"', () => {
    const s = summarizeStrokes([]);
    assert.equal(s.phrase, '');
    assert.deepEqual(s.strokes, []);
    assert.equal(s.counts.box, 0);
  });

  it('carries a bounding box and NEVER the point list', () => {
    const s = summarizeStrokes([boxAt(10, 20, 100, 60)]);
    const only = s.strokes[0]!;
    assert.deepEqual(only.rect, { x: 10, y: 20, width: 100, height: 60 });
    assert.equal(Object.prototype.hasOwnProperty.call(only, 'points'), false);
    assert.equal(JSON.stringify(s).includes('"points"'), false);
  });

  it('keeps the input index so a caller can pair a summary back to its stroke', () => {
    /* The first entry has no points and is skipped — the indexes must still
       point at the ORIGINAL list, or a caller pairs the wrong stroke. */
    const s = summarizeStrokes([{ points: [] }, boxAt(0, 0), lineAt(300, 0)]);
    assert.deepEqual(s.strokes.map((x) => x.index), [1, 2]);
  });
});

describe('where a mark sits, to a ninth of the drawing', () => {
  const outer = { x: 0, y: 0, width: 300, height: 300 };

  it('names the nine cells, with the middle one called "centre"', () => {
    assert.equal(inkGridCell({ x: 10, y: 10 }, outer), 'top-left');
    assert.equal(inkGridCell({ x: 150, y: 10 }, outer), 'top-centre');
    assert.equal(inkGridCell({ x: 290, y: 10 }, outer), 'top-right');
    assert.equal(inkGridCell({ x: 10, y: 150 }, outer), 'middle-left');
    assert.equal(inkGridCell({ x: 150, y: 150 }, outer), 'centre');
    assert.equal(inkGridCell({ x: 290, y: 150 }, outer), 'middle-right');
    assert.equal(inkGridCell({ x: 10, y: 290 }, outer), 'bottom-left');
    assert.equal(inkGridCell({ x: 150, y: 290 }, outer), 'bottom-centre');
    assert.equal(inkGridCell({ x: 290, y: 290 }, outer), 'bottom-right');
  });

  it('a flat drawing collapses that axis to its middle band, never to NaN', () => {
    const flat = { x: 0, y: 40, width: 300, height: 0 };
    assert.equal(inkGridCell({ x: 10, y: 40 }, flat), 'middle-left');
  });

  it('the grid is the box of the DRAWING itself, not the viewport — offsets do not move cells', () => {
    const near = summarizeStrokes([boxAt(0, 0), boxAt(400, 0), boxAt(0, 400), boxAt(400, 400)]);
    const far = summarizeStrokes([
      boxAt(9000, 9000),
      boxAt(9400, 9000),
      boxAt(9000, 9400),
      boxAt(9400, 9400),
    ]);
    assert.deepEqual(near.strokes.map((s) => s.cell), far.strokes.map((s) => s.cell));
    assert.equal(near.strokes[0]?.cell, 'top-left');
    assert.equal(near.strokes[3]?.cell, 'bottom-right');
  });
});
