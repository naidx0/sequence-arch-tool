import { describe, expect, it } from 'vitest';
import type { SeqDiagramV1 } from '@sequence/schema';

import { EMPTY_DOC_SESSION, docSessionReduce } from './docSession.js';

/**
 * WHOSE DOCUMENT WINS WHEN THE REPO MOVES UNDER AN EDIT.
 *
 * `docEdit` answers "what does this edit do". This answers the question that
 * only shows up once editing is wired to a live scanner: a scan finishes while
 * the user has drawn three nodes that are not in the code yet. Re-seeding from
 * the scan is the one-liner, and it deletes their work without a word.
 *
 * The rule below is that a fresh scan wins ONLY when there is nothing to lose.
 * With local edits outstanding it is held as a pending base, and the session
 * says so — which is also the mechanism the board needs to stop claiming to be
 * current after the code changed behind it.
 */

function doc(graphId: string, title = 'shopfront'): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-flow',
    title,
    grounded: { graphId },
    nodes: [{ id: 'gateway', label: 'Gateway', kind: 'service', evidenceRef: 'scan:a.ts:1' }],
    edges: [],
  } as SeqDiagramV1;
}

describe('docSession', () => {
  it('starts with no document — the store has none before a repo is attached', () => {
    expect(EMPTY_DOC_SESSION.doc).toBeNull();
    expect(EMPTY_DOC_SESSION.edits).toBe(0);
    expect(EMPTY_DOC_SESSION.baseChanged).toBe(false);
  });

  it('adopts the first scanned document', () => {
    const s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1') });
    expect(s.doc?.grounded.graphId).toBe('g1');
    expect(s.baseGraphId).toBe('g1');
    expect(s.edits).toBe(0);
  });

  it('an edit before any document is declined rather than crashing', () => {
    const s = docSessionReduce(EMPTY_DOC_SESSION, {
      type: 'doc/add-node',
      id: 'x',
      label: 'X',
      kind: 'service',
    });
    expect(s.doc).toBeNull();
    expect(s.lastNote).toMatch(/no diagram|not.*loaded/i);
  });

  it('counts accepted edits and keeps the note from a declined one', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1') });
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'store-1', label: 'Store 1', kind: 'service' });
    expect(s.edits).toBe(1);
    expect(s.lastNote).toBeNull();

    s = docSessionReduce(s, { type: 'doc/rename-node', id: 'ghost', label: 'X' });
    /* A declined edit must not advance the counter — otherwise "3 unsaved
       changes" counts refusals as work. */
    expect(s.edits).toBe(1);
    expect(s.lastNote).toMatch(/no node/i);
  });

  /* ── the rescan ────────────────────────────────────────────────────────── */

  it('a fresh scan of the same repo wins when there is nothing to lose', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'old') });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'new') });
    expect(s.doc?.title).toBe('new');
    expect(s.baseChanged).toBe(false);
    expect(s.pendingBase).toBeNull();
  });

  it('a different repo replaces the document outright — the edits belonged to the old one', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1') });
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'n', label: 'N', kind: 'service' });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g2') });
    expect(s.doc?.grounded.graphId).toBe('g2');
    expect(s.edits).toBe(0);
    /* Not a conflict: nobody expects a drawing on repo A to survive opening
       repo B. Holding it as "pending" would ask the user a question that has
       only one sensible answer. */
    expect(s.baseChanged).toBe(false);
  });

  it('a rescan of the SAME repo under local edits does not silently discard them', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'old') });
    s = docSessionReduce(s, {
      type: 'doc/add-node',
      id: 'store-1',
      label: 'Franchise Store 1',
      kind: 'service',
    });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'rescanned') });

    /* The drawing survives... */
    expect(s.doc?.title).toBe('old');
    expect(s.doc?.nodes.some((n) => n.id === 'store-1')).toBe(true);
    expect(s.edits).toBe(1);
    /* ...and the session says the ground moved, which is what lets the board
       stop claiming to be current. */
    expect(s.baseChanged).toBe(true);
    expect(s.pendingBase?.title).toBe('rescanned');
  });

  it('rebasing accepts the pending scan and clears the edit count', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'old') });
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'n', label: 'N', kind: 'service' });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'rescanned') });
    s = docSessionReduce(s, { type: 'doc/rebase' });

    expect(s.doc?.title).toBe('rescanned');
    expect(s.doc?.nodes.some((n) => n.id === 'n')).toBe(false);
    expect(s.edits).toBe(0);
    expect(s.baseChanged).toBe(false);
    expect(s.pendingBase).toBeNull();
  });

  it('rebasing with nothing pending is a no-op that returns the same session', () => {
    const s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1') });
    expect(docSessionReduce(s, { type: 'doc/rebase' })).toBe(s);
  });

  it('the newest scan replaces an older pending one rather than queueing', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'old') });
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'n', label: 'N', kind: 'service' });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'scan-2') });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'scan-3') });
    /* Offering to rebase onto a scan that is already two generations stale
       would be worse than not offering at all. */
    expect(s.pendingBase?.title).toBe('scan-3');
  });

  it('editing while a rescan is pending keeps the pending base', () => {
    let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'old') });
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'n1', label: 'N1', kind: 'service' });
    s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'rescanned') });
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'n2', label: 'N2', kind: 'service' });
    expect(s.edits).toBe(2);
    expect(s.baseChanged).toBe(true);
    expect(s.pendingBase?.title).toBe('rescanned');
  });

  it('a declined edit returns the same session object, so nothing re-renders', () => {
    const s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1') });
    const after = docSessionReduce(s, { type: 'doc/delete-node', id: 'ghost' });
    /* The note changes, so it cannot be the identical object — but the document
       must be, or every consumer of `doc` redraws to show nothing new. */
    expect(after.doc).toBe(s.doc);
  });
});
