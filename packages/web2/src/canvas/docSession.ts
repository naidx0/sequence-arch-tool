/* ══════════════════════════════════════════════════════════════════════════
   THE EDITING SESSION — what happens when the repo moves under an edit
   packages/web2/src/canvas/docSession.ts

   `docEdit` is pure and answers one question: what does this edit do to this
   document. This file answers the question that only appears once editing meets
   a live scanner — a scan finishes while the user has drawn three services that
   do not exist in the code yet.

   RE-SEEDING FROM THE SCAN IS THE ONE-LINER, AND IT DELETES THEIR WORK. The
   rule here is that a fresh scan wins only when there is nothing to lose:

     · no document yet            → adopt it.
     · a DIFFERENT repo           → adopt it. Nobody expects a drawing on repo A
                                    to survive opening repo B, and asking would
                                    be a question with one sensible answer.
     · the same repo, no edits    → adopt it. The scan is strictly better
                                    information about the same subject.
     · the same repo, with edits  → HOLD IT as `pendingBase` and raise
                                    `baseChanged`. The drawing survives and the
                                    board can stop claiming to be current.

   THAT LAST BRANCH IS ALSO THE `stale` SIGNAL. The register has carried a row
   for it — "edit a file behind the app's back and the board still claims to be
   current; the renderers exist and nothing can put the app in the state". This
   is the state, produced by the thing that was going to need it anyway rather
   than by a flag someone remembers to set.

   THE COUNTER COUNTS ACCEPTED EDITS ONLY. A refusal that advanced it would put
   "3 unsaved changes" on screen when one of the three was the app saying no.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SeqDiagramV1 } from '@sequence/schema';

import { type DocEdit, docEdit } from './docEdit.js';

export interface DocSession {
  /** Null until a repo is attached — the store has no document before that. */
  doc: SeqDiagramV1 | null;
  /** `grounded.graphId` of the document in hand, to tell a rescan from a swap. */
  baseGraphId: string | null;
  /** Accepted edits since the base. Zero means the scan can be adopted freely. */
  edits: number;
  /** A newer scan of the SAME repo, withheld because edits would be lost. */
  pendingBase: SeqDiagramV1 | null;
  /** True while `pendingBase` is held: the board is no longer current. */
  baseChanged: boolean;
  /** Why the last edit was declined, or null when it was accepted. */
  lastNote: string | null;
  /**
   * Previous documents, oldest first, bounded at `UNDO_DEPTH`.
   *
   * A stack of REFERENCES, not diffs: `docEdit` never mutates its input, so the
   * document before an edit is still intact and still reachable. Undo is
   * therefore incapable of rebuilding a document slightly differently from the
   * one that was there, which a replay-the-inverse-edit design is not.
   */
  past: readonly SeqDiagramV1[];
  /** Derived at the single exit — the control is live or it is not. */
  canUndo: boolean;
}

/**
 * How far back undo reaches.
 *
 * Unbounded is a slow leak on a board that can hold a thousand nodes, and it
 * only shows up in a long session — which is the session where losing work
 * hurts most. Fifty is the depth at which a reader stops expecting undo to be
 * the thing that saves them and starts expecting the file to be.
 */
export const UNDO_DEPTH = 50;

export const EMPTY_DOC_SESSION: DocSession = {
  doc: null,
  baseGraphId: null,
  edits: 0,
  pendingBase: null,
  baseChanged: false,
  lastNote: null,
  past: [],
  canUndo: false,
};

export type DocSessionAction =
  | { type: 'doc/base'; doc: SeqDiagramV1 }
  | { type: 'doc/rebase' }
  | { type: 'doc/reset' }
  | { type: 'doc/undo' }
  | DocEdit;

function adopt(doc: SeqDiagramV1): DocSession {
  return {
    doc,
    baseGraphId: doc.grounded.graphId,
    edits: 0,
    pendingBase: null,
    baseChanged: false,
    lastNote: null,
    /* A new base clears the stack. Undoing into a document from another repo —
       or from before a rescan the user accepted — would restore a diagram that
       describes code nobody is looking at. */
    past: [],
    canUndo: false,
  };
}

export function docSessionReduce(session: DocSession, action: DocSessionAction): DocSession {
  switch (action.type) {
    case 'doc/base': {
      const incoming = action.doc;
      const sameRepo = session.baseGraphId === incoming.grounded.graphId;
      if (session.doc === null || !sameRepo || session.edits === 0) return adopt(incoming);
      /* Held, not queued: offering a rebase onto a scan that is already two
         generations stale would be worse than not offering one. */
      return { ...session, pendingBase: incoming, baseChanged: true };
    }

    case 'doc/rebase': {
      if (session.pendingBase === null) return session;
      return adopt(session.pendingBase);
    }

    case 'doc/reset':
      return EMPTY_DOC_SESSION;

    case 'doc/undo': {
      if (session.past.length === 0) return session;
      const past = session.past.slice(0, -1);
      return {
        ...session,
        doc: session.past[session.past.length - 1]!,
        past,
        canUndo: past.length > 0,
        /* The count goes back down with the document, so "2 unsaved changes"
           never outlives the two changes. */
        edits: Math.max(0, session.edits - 1),
        lastNote: null,
      };
    }

    default: {
      if (session.doc === null) {
        return { ...session, lastNote: 'No diagram is loaded yet — attach a repo first.' };
      }
      const result = docEdit(session.doc, action);
      /* A refusal pushes nothing. If it occupied a slot, the first undo after a
         mistyped id would appear to do nothing, and the reader would press it
         again and lose an edit they meant to keep. */
      if (!result.changed) return { ...session, lastNote: result.note ?? 'That edit changed nothing.' };
      const past = [...session.past, session.doc].slice(-UNDO_DEPTH);
      return {
        ...session,
        doc: result.doc,
        past,
        canUndo: true,
        edits: session.edits + 1,
        lastNote: null,
      };
    }
  }
}
