import { describe, expect, it } from 'vitest';
import type { SeqDiagramV1 } from '@sequence/schema';

import { EMPTY_DOC_SESSION, docSessionReduce, type DocSession } from './docSession.js';

/**
 * DELETE WITHOUT UNDO IS A TRAP, AND THE DOCUMENTS ARE ALREADY IMMUTABLE.
 *
 * `docEdit` returns a new document and never mutates the old one, which is
 * asserted in its own suite. So the previous document is still there, intact,
 * for as long as something holds a reference — undo is a stack of references,
 * not a diff engine, and refusing to keep it would be choosing a destructive
 * delete over a five-line one.
 *
 * The depth is bounded. An unbounded stack on a board that can hold a thousand
 * nodes is a slow memory leak that only shows up in a long session, which is
 * exactly the session where losing work hurts most.
 */

function doc(graphId = 'g1'): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-flow',
    title: 'shopfront',
    grounded: { graphId },
    nodes: [
      { id: 'a', label: 'A', kind: 'service', evidenceRef: 'scan:a.ts:1' },
      { id: 'b', label: 'B', kind: 'service', evidenceRef: 'scan:b.ts:1' },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', family: 'http' }],
  } as SeqDiagramV1;
}

function loaded(): DocSession {
  return docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc() });
}

describe('undo', () => {
  it('nothing to undo on a freshly loaded document', () => {
    const s = loaded();
    expect(s.canUndo).toBe(false);
    /* The same object back: a disabled control must not cause a render. */
    expect(docSessionReduce(s, { type: 'doc/undo' })).toBe(s);
  });

  it('undo restores the document exactly as it was', () => {
    let s = loaded();
    const before = s.doc;
    s = docSessionReduce(s, { type: 'doc/delete-node', id: 'b' });
    expect(s.doc?.nodes).toHaveLength(1);
    expect(s.canUndo).toBe(true);

    s = docSessionReduce(s, { type: 'doc/undo' });
    /* Identity, not deep equality. The previous document was never mutated, so
       undo is the reference that was already being held — nothing is rebuilt
       and nothing can be rebuilt slightly differently. */
    expect(s.doc).toBe(before);
    expect(s.canUndo).toBe(false);
  });

  it('undo takes the cascade back with the node', () => {
    let s = loaded();
    s = docSessionReduce(s, { type: 'doc/delete-node', id: 'b' });
    expect(s.doc?.edges).toHaveLength(0);
    s = docSessionReduce(s, { type: 'doc/undo' });
    /* The edge deleted as a consequence comes back too — an undo that restored
       the node and not its connections would be a different diagram wearing the
       old one's name. */
    expect(s.doc?.edges).toHaveLength(1);
  });

  it('the edit count goes back down, so "unsaved" stays true', () => {
    let s = loaded();
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'a', label: 'A2' });
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'b', label: 'B2' });
    expect(s.edits).toBe(2);
    s = docSessionReduce(s, { type: 'doc/undo' });
    expect(s.edits).toBe(1);
    s = docSessionReduce(s, { type: 'doc/undo' });
    expect(s.edits).toBe(0);
    expect(s.canUndo).toBe(false);
  });

  it('undo walks back through several edits in order', () => {
    let s = loaded();
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'a', label: 'first' });
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'a', label: 'second' });
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'a', label: 'third' });
    expect(s.doc?.nodes[0]?.label).toBe('third');
    s = docSessionReduce(s, { type: 'doc/undo' });
    expect(s.doc?.nodes[0]?.label).toBe('second');
    s = docSessionReduce(s, { type: 'doc/undo' });
    expect(s.doc?.nodes[0]?.label).toBe('first');
    s = docSessionReduce(s, { type: 'doc/undo' });
    expect(s.doc?.nodes[0]?.label).toBe('A');
  });

  it('a declined edit pushes nothing — undo does not consume a refusal', () => {
    let s = loaded();
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'a', label: 'renamed' });
    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'ghost', label: 'X' });
    /*
     * The refusal must not occupy a slot. Otherwise the first undo after a
     * mistyped id appears to do nothing at all, and the reader presses it again
     * and loses an edit they meant to keep.
     */
    s = docSessionReduce(s, { type: 'doc/undo' });
    expect(s.doc?.nodes[0]?.label).toBe('A');
    expect(s.canUndo).toBe(false);
  });

  it('adopting a new base clears the stack — you cannot undo into another repo', () => {
    let s = loaded();
    s = docSessionReduce(s, { type: 'doc/delete-node', id: 'b' });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g2') });
    expect(s.canUndo).toBe(false);
    expect(docSessionReduce(s, { type: 'doc/undo' })).toBe(s);
  });

  it('the stack is bounded, and the oldest edit is the one that goes', () => {
    let s = loaded();
    for (let i = 0; i < 60; i += 1) {
      s = docSessionReduce(s, { type: 'doc/rename-node', id: 'a', label: `label-${i}` });
    }
    let depth = 0;
    while (s.canUndo) {
      s = docSessionReduce(s, { type: 'doc/undo' });
      depth += 1;
      if (depth > 200) throw new Error('undo never bottomed out');
    }
    expect(depth).toBe(50);
    /* Bottoming out on the 11th-oldest label rather than on 'A' is the honest
       consequence of a bounded stack, and it is asserted so that the bound is a
       decision rather than a surprise. */
    expect(s.doc?.nodes[0]?.label).toBe('label-9');
  });
});
