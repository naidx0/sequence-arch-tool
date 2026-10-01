/* ══════════════════════════════════════════════════════════════════════════
   A STROKE BECOMES AN EDIT
   packages/web2/src/canvas/inkToEdit.ts

   `packages/ink` has had stroke recognition with passing tests since it was
   written, and NOTHING IMPORTED IT. The register's row was "you cannot draw on
   the canvas at all", and this is the missing half-inch: the translation from
   what the recogniser saw to what the document does about it.

   THE OWNER'S MODEL, and it is the whole shape of this file:

     "Free drawing is real editing of a real artifact (`.seqd`), and code
      proposal is a separate, deliberate, confirmable step downstream of it."

   So a box becomes a NODE — immediately, in the document, with no ask and no
   proposal. `generateGate` is the separate step, and it is the user's to take.

   THREE OUTCOMES AND ONE OF THEM IS A REFUSAL:

     box       → a node. It carries NO `evidenceRef`, because nobody proved it;
                 that absence is what later offers it to Generate and what keeps
                 it distinguishable from a node the scan found.
     line      → an edge, but ONLY when both ends land on a node that exists. A
                 line drawn into empty space is not an edge to nowhere; it is a
                 gesture the reader has not finished, and `docEdit` would refuse
                 it anyway rather than let the document dangle.
     scribble  → nothing, said out loud. Silence after a stroke is
                 indistinguishable from a dropped event, and the reader's next
                 move is to draw it again harder.
   ══════════════════════════════════════════════════════════════════════════ */

import type { InkResult, Point } from '@sequence/ink';

import type { DocEdit } from './docEdit';

/** What the board can tell us about a point: which node is under it, if any. */
export type HitTest = (at: Point) => string | null;

export type InkOutcome =
  /** Apply this to the document. */
  | {
      kind: 'edit';
      edit: DocEdit;
      note: string;
      /**
       * Where a drawn BOX should sit, in the SAME coordinate space as the
       * stroke points handed to `inkToEdit` (client/viewport for the board).
       * Absent for edges — they attach to existing cards.
       */
      place?: { x: number; y: number };
    }
  /** Understood, and deliberately not applied. `note` is shown to the reader. */
  | { kind: 'refused'; note: string };

/**
 * Ids are derived from the stroke's own geometry, rounded.
 *
 * `draw:` prefixed so a drawn node is identifiable at a glance in the document
 * and can never collide with a scanner id (`svc:`, `file:`, `ds:`). Rounded
 * because two strokes a pixel apart are two different boxes to a float and one
 * box to a person, and an id that changed on a sub-pixel would make an undo
 * stack that cannot match its own entries.
 */
export function drawnNodeId(rect: { x: number; y: number }): string {
  return `draw:${Math.round(rect.x)}-${Math.round(rect.y)}`;
}

export function inkToEdit(
  result: InkResult,
  ctx: { hitTest: HitTest; label?: string; nextEdgeId: () => string },
): InkOutcome {
  if (result.kind === 'scribble') {
    /* SAID OUT LOUD. A stroke that vanishes is indistinguishable from a dropped
       event, and the reader's next move is to draw it again harder. */
    return {
      kind: 'refused',
      note: 'That stroke was not a box or a line — nothing was added. Draw a closed shape for a service, or a line between two of them.',
    };
  }

  if (result.kind === 'box') {
    return {
      kind: 'edit',
      edit: {
        type: 'doc/add-node',
        id: drawnNodeId(result.rect),
        /* A default the reader is expected to change: an unnamed box is
           unreadable, and asking for a name before drawing anything would put a
           dialog in front of a gesture. Rename is one right-click away. */
        label: ctx.label?.trim() || 'New service',
        kind: 'service',
      },
      place: { x: result.rect.x, y: result.rect.y },
      note: 'Added a service. Rename it, or use Generate to say what belongs in it.',
    };
  }

  const from = ctx.hitTest(result.start);
  const to = ctx.hitTest(result.end);
  if (from === null || to === null) {
    /*
     * A line into empty space is not an edge to nowhere. `docEdit` would refuse
     * it anyway — it will not let the document dangle — so refusing here is
     * saying the same thing where the reader can act on it.
     */
    return {
      kind: 'refused',
      note: 'A connection needs a service at both ends. Draw the boxes first, then the line between them.',
    };
  }
  if (from === to) {
    return { kind: 'refused', note: 'That line starts and ends on the same service.' };
  }

  return {
    kind: 'edit',
    edit: {
      type: 'doc/add-edge',
      id: ctx.nextEdgeId(),
      from,
      to,
      /*
       * `call` rather than a guess at a protocol. The stroke says these two are
       * connected and says nothing about how; naming it `http` would be the
       * canvas inventing a fact about a system that does not exist yet, which
       * is the same failure as a scanned edge with no evidence.
       */
      family: 'call',
    },
    note: 'Connected them.',
  };
}
