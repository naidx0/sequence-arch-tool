/* ══════════════════════════════════════════════════════════════════════════
   A SNAP OFFER BECOMES AN INK RESULT
   packages/web2/src/canvas/snapToEdit.ts

   The architecture board's Sketch used the old hand-rule recognizer, one stroke
   at a time, so a box drawn in four strokes was four scribbles. The whiteboard
   already reads strokes with the trained, grouped shape model (`SnapSession`).
   This is the adapter that lets the board use it: an offer in, the same
   `InkResult` `inkToEdit` already understands out. Nothing downstream changes.

   rect / ellipse / diamond all mean "a closed shape", so they all become a
   box (and a service); picking a node kind per shape would be inventing a fact
   about the system. A connector becomes a line from its tail to its tip.
   ══════════════════════════════════════════════════════════════════════════ */

import type { InkResult } from '@sequence/ink';

import type { SnapOffer } from '../whiteboard/snapSession';

export function offerToInk(o: SnapOffer): InkResult {
  if (o.decision === 'connector') {
    return { kind: 'line', start: { ...o.from }, end: { ...o.to }, confidence: o.confidence };
  }
  const x = Math.min(o.from.x, o.to.x);
  const y = Math.min(o.from.y, o.to.y);
  return {
    kind: 'box',
    rect: { x, y, width: Math.abs(o.to.x - o.from.x), height: Math.abs(o.to.y - o.from.y) },
    confidence: o.confidence,
  };
}
