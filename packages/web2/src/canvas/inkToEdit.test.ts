import { describe, expect, it } from 'vitest';

import { recognizeStroke } from '@sequence/ink';

import { drawnNodeId, inkToEdit } from './inkToEdit';
import { docEdit } from './docEdit';
import { isGeneratable } from './generateGate';
import type { SeqDiagramV1 } from '@sequence/schema';

/**
 * A STROKE BECOMES AN EDIT.
 *
 * `packages/ink` has had stroke recognition with passing tests since it was
 * written and NOTHING IMPORTED IT. The register's row was "you cannot draw on
 * the canvas at all", and the missing half-inch was this: the translation from
 * what the recogniser saw to what the document does about it.
 *
 * The owner's model is the shape of the whole file: "Free drawing is real
 * editing of a real artifact (`.seqd`), and code proposal is a separate,
 * deliberate, confirmable step downstream of it."
 *
 * These drive the REAL recogniser rather than hand-built `InkResult`s, so the
 * test exercises the module that was never wired instead of a description of
 * it.
 */

const DOC = {
  version: 1,
  kind: 'service-flow',
  title: 'shop',
  grounded: { graphId: 'g1' },
  nodes: [
    { id: 'svc:a', label: 'A', kind: 'service', evidenceRef: 'scan:a.ts:1' },
    { id: 'svc:b', label: 'B', kind: 'service', evidenceRef: 'scan:b.ts:1' },
  ],
  edges: [],
} as unknown as SeqDiagramV1;

/** A hand-drawn-ish closed box, wobbly on purpose. */
function boxStroke(x = 100, y = 100, w = 120, h = 80) {
  const pts: { x: number; y: number }[] = [];
  const wobble = (i: number) => (i % 3) - 1;
  for (let i = 0; i <= 20; i += 1) pts.push({ x: x + (w * i) / 20, y: y + wobble(i) });
  for (let i = 0; i <= 20; i += 1) pts.push({ x: x + w + wobble(i), y: y + (h * i) / 20 });
  for (let i = 0; i <= 20; i += 1) pts.push({ x: x + w - (w * i) / 20, y: y + h + wobble(i) });
  for (let i = 0; i <= 20; i += 1) pts.push({ x: x + wobble(i), y: y + h - (h * i) / 20 });
  return pts;
}

/** A straight-ish line from one point to another. */
function lineStroke(x1: number, y1: number, x2: number, y2: number) {
  return Array.from({ length: 25 }, (_v, i) => ({
    x: x1 + ((x2 - x1) * i) / 24,
    y: y1 + ((y2 - y1) * i) / 24,
  }));
}

const NO_HITS = () => null;
let edgeSeq = 0;
const nextEdgeId = () => `draw:e${++edgeSeq}`;

describe('a stroke becomes an edit', () => {
  it('a drawn box is a NODE, in the document, with no ask and no proposal', () => {
    const result = recognizeStroke(boxStroke());
    expect(result.kind).toBe('box');

    const outcome = inkToEdit(result, { hitTest: NO_HITS, nextEdgeId });
    expect(outcome.kind).toBe('edit');
    if (outcome.kind !== 'edit') throw new Error('unreachable');

    /*
     * "Free drawing is REAL EDITING of a real artifact." The stroke lands in
     * the document immediately — no dialog, no proposal, no run.
     */
    const after = docEdit(DOC, outcome.edit);
    expect(after.changed).toBe(true);
    expect(after.doc.nodes).toHaveLength(3);
  });

  it('a drawn node carries no evidence, so Generate offers itself on it', () => {
    const outcome = inkToEdit(recognizeStroke(boxStroke()), { hitTest: NO_HITS, nextEdgeId });
    if (outcome.kind !== 'edit') throw new Error('unreachable');
    const after = docEdit(DOC, outcome.edit).doc;
    const drawn = after.nodes.find((n) => n.id.startsWith('draw:'))!;

    /*
     * The composition of everything the editing model asks for: nobody proved
     * this box, so it is distinguishable from a scanned node AND it is the
     * thing Generate is allowed to act on.
     */
    expect(drawn.evidenceRef).toBeUndefined();
    expect(isGeneratable(drawn)).toBe(true);
  });

  it('a line between two services is an EDGE', () => {
    const stroke = lineStroke(10, 10, 300, 12);
    const result = recognizeStroke(stroke);
    expect(result.kind).toBe('line');

    const outcome = inkToEdit(result, {
      hitTest: (p) => (p.x < 150 ? 'svc:a' : 'svc:b'),
      nextEdgeId,
    });
    if (outcome.kind !== 'edit') throw new Error('unreachable');
    expect(outcome.edit.type).toBe('doc/add-edge');

    const after = docEdit(DOC, outcome.edit);
    expect(after.changed).toBe(true);
    expect(after.doc.edges[0]!.from).toBe('svc:a');
    expect(after.doc.edges[0]!.to).toBe('svc:b');
  });

  it('the drawn edge claims no protocol', () => {
    const outcome = inkToEdit(recognizeStroke(lineStroke(10, 10, 300, 12)), {
      hitTest: (p) => (p.x < 150 ? 'svc:a' : 'svc:b'),
      nextEdgeId,
    });
    if (outcome.kind !== 'edit' || outcome.edit.type !== 'doc/add-edge') {
      throw new Error('unreachable');
    }
    /*
     * The stroke says these two are connected and says NOTHING about how.
     * Naming it `http` would be the canvas inventing a fact about a system that
     * does not exist yet — the same failure as a scanned edge with no evidence.
     */
    expect(outcome.edit.family).toBe('call');
  });

  it('a line into empty space is REFUSED, and says what to do instead', () => {
    const outcome = inkToEdit(recognizeStroke(lineStroke(10, 10, 300, 12)), {
      hitTest: NO_HITS,
      nextEdgeId,
    });
    expect(outcome.kind).toBe('refused');
    /* `docEdit` would refuse a dangling edge anyway; refusing here says the
       same thing where the reader can act on it. */
    expect((outcome as { note: string }).note).toMatch(/service at both ends/i);
  });

  it('a line that starts and ends on one service is refused', () => {
    const outcome = inkToEdit(recognizeStroke(lineStroke(10, 10, 300, 12)), {
      hitTest: () => 'svc:a',
      nextEdgeId,
    });
    expect(outcome.kind).toBe('refused');
  });

  it('a scribble adds nothing AND SAYS SO', () => {
    const scribble = Array.from({ length: 60 }, (_v, i) => ({
      x: 100 + Math.sin(i) * 40 + i,
      y: 100 + Math.cos(i * 1.7) * 40,
    }));
    const outcome = inkToEdit(recognizeStroke(scribble), { hitTest: NO_HITS, nextEdgeId });
    expect(outcome.kind).toBe('refused');
    /*
     * Silence after a stroke is indistinguishable from a dropped event, and the
     * reader's next move is to draw it again harder.
     */
    expect((outcome as { note: string }).note).toMatch(/not a box or a line/i);
  });

  it('a tap is a scribble, not an accidental service', () => {
    const outcome = inkToEdit(recognizeStroke([{ x: 5, y: 5 }, { x: 6, y: 6 }]), {
      hitTest: NO_HITS,
      nextEdgeId,
    });
    expect(outcome.kind).toBe('refused');
  });

  it('the id comes from the geometry and is stable under sub-pixel jitter', () => {
    /* Two strokes a pixel apart are two boxes to a float and one box to a
       person; an id that changed on a sub-pixel would make an undo stack that
       cannot match its own entries. */
    expect(drawnNodeId({ x: 100.4, y: 200.4 })).toBe(drawnNodeId({ x: 100.2, y: 200.1 }));
    expect(drawnNodeId({ x: 100, y: 200 })).toMatch(/^draw:/);
  });

  it('two boxes in the same place do not stack — docEdit refuses the duplicate', () => {
    const outcome = inkToEdit(recognizeStroke(boxStroke()), { hitTest: NO_HITS, nextEdgeId });
    if (outcome.kind !== 'edit') throw new Error('unreachable');
    const once = docEdit(DOC, outcome.edit).doc;
    const twice = docEdit(once, outcome.edit);
    expect(twice.changed).toBe(false);
    expect(twice.note).toMatch(/already/i);
  });

  it('a drawn box gets a name a person can read, and can rename', () => {
    const outcome = inkToEdit(recognizeStroke(boxStroke()), { hitTest: NO_HITS, nextEdgeId });
    if (outcome.kind !== 'edit' || outcome.edit.type !== 'doc/add-node') {
      throw new Error('unreachable');
    }
    /* An unnamed box is unreadable; asking for a name before drawing anything
       would put a dialog in front of a gesture. Rename is one right-click
       away. */
    expect(outcome.edit.label).toBe('New service');
    expect(outcome.note).toMatch(/Rename it/);
  });

  it('carries place for a drawn box so the board can pin it where the stroke was', () => {
    const outcome = inkToEdit(recognizeStroke(boxStroke()), { hitTest: NO_HITS, nextEdgeId });
    expect(outcome.kind).toBe('edit');
    if (outcome.kind !== 'edit') return;
    expect(outcome.place).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });
});
