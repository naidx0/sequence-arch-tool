import { describe, expect, it } from 'vitest';

import { canvasReduce } from './canvasReduce';
import { docEdit } from './docEdit';
import { EMPTY_CANVAS } from '../state/initial';
import type { TopologyProposal } from '../state/types';
import type { SeqDiagramV1 } from '@sequence/schema';

/**
 * S4 — THE PROPOSAL GHOST. One of five documented canvas states, and the one
 * that did not exist: a type with no reducer case and no render arm.
 *
 * It was recorded as blocked on draw mode, and it is not. `TopologyProposal`
 * carries a `turnId`: the ghost arrives from an ASK, not from a drawing, so an
 * agent can propose a service without anybody picking up a pen. That
 * mis-scoping is worth writing down, because it kept a buildable row shut.
 *
 * ACCEPT IS NOT IN THIS REDUCER. Applying a proposal edits the DOCUMENT, and
 * `canvasReduce`'s own header says it "invents no state of its own" and holds
 * no document. So accept runs through `docEdit` — the same funnel a human's
 * rename goes through — which is what stops an accepted proposal from being a
 * second way to change a diagram with its own rules about what is legal.
 */

const PROPOSAL: TopologyProposal = {
  id: 'p1',
  turnId: 't1',
  title: 'Split billing out of orders',
  rationale: 'orders writes three billing tables',
  nodes: [{ id: 'svc:billing', label: 'billing', kind: 'service' }],
  edges: [{ id: 'e:new', from: 'svc:orders', to: 'svc:billing', family: 'http' }],
  status: 'pending',
  verify: null,
};

const DOC = {
  version: 1,
  kind: 'service-flow',
  title: 'shop',
  grounded: { graphId: 'g1' },
  nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service', evidenceRef: 'scan:a.ts:1' }],
  edges: [],
} as unknown as SeqDiagramV1;

describe('S4 — the proposal ghost', () => {
  it('enters S4 with the proposal the agent made', () => {
    const c = canvasReduce(EMPTY_CANVAS, { type: 'canvas/proposal', proposal: PROPOSAL });
    expect(c.view.state).toBe('S4');
    if (c.view.state !== 'S4') throw new Error('unreachable');
    expect(c.view.proposal.title).toBe('Split billing out of orders');
  });

  it('clears the selection and the dim on the way in', () => {
    const busy = canvasReduce(
      canvasReduce(EMPTY_CANVAS, { type: 'canvas/select', nodeId: 'svc:orders', additive: false }),
      { type: 'canvas/flow-focus', dim: { litNodeIds: ['svc:orders'] } as never, focus: 'svc:orders' },
    );
    const c = canvasReduce(busy, { type: 'canvas/proposal', proposal: PROPOSAL });
    /*
     * A ghost the reader is meant to JUDGE should not arrive with three cards
     * still lit from the last question, and a dim spent on a flow says
     * something about a flow that is no longer on screen.
     */
    expect(c.selection.nodeIds).toEqual([]);
    expect(c.dim).toBeNull();
  });

  it('a second proposal REPLACES the first — it is not merged', () => {
    const first = canvasReduce(EMPTY_CANVAS, { type: 'canvas/proposal', proposal: PROPOSAL });
    const second = canvasReduce(first, {
      type: 'canvas/proposal',
      proposal: { ...PROPOSAL, id: 'p2', title: 'Different idea' },
    });
    if (second.view.state !== 'S4') throw new Error('unreachable');
    /* A second answer to the same question is still a second answer; merging
       them would draw a topology no agent proposed. */
    expect(second.view.proposal.id).toBe('p2');
    expect(second.view.proposal.title).toBe('Different idea');
  });

  it('clearing returns to S1, the grounded document — never to what came before', () => {
    const focused = canvasReduce(EMPTY_CANVAS, {
      type: 'canvas/select',
      nodeId: 'svc:orders',
      additive: false,
    });
    const ghost = canvasReduce(focused, { type: 'canvas/proposal', proposal: PROPOSAL });
    const back = canvasReduce(ghost, { type: 'canvas/proposal-clear' });
    /*
     * Whatever was focused or playing before the ghost is a state the reader
     * LEFT. Restoring it would be the board deciding they wanted to go back.
     */
    expect(back.view.state).toBe('S1');
    expect(back.selection.nodeIds).toEqual([]);
  });

  it('clearing when no ghost is up changes nothing', () => {
    const c = canvasReduce(EMPTY_CANVAS, { type: 'canvas/proposal-clear' });
    expect(c).toBe(EMPTY_CANVAS);
  });

  it('accepting runs through docEdit — the same funnel a human rename uses', () => {
    /*
     * THE COMPOSITION, and the reason accept is not a canvas action.
     * `canvasReduce` holds no document; `docEdit` is the one place a diagram
     * changes. An accepted proposal that wrote to the document directly would
     * be a second way to change a diagram, with its own opinion about what is
     * legal — and the first thing it would skip is the referential integrity
     * `docEdit` exists to keep.
     */
    let doc = DOC;
    for (const n of PROPOSAL.nodes) {
      const r = docEdit(doc, { type: 'doc/add-node', id: n.id, label: n.label, kind: n.kind });
      expect(r.changed).toBe(true);
      doc = r.doc;
    }
    for (const e of PROPOSAL.edges) {
      const r = docEdit(doc, {
        type: 'doc/add-edge',
        id: e.id,
        from: e.from,
        to: e.to,
        family: e.family,
      });
      expect(r.changed).toBe(true);
      doc = r.doc;
    }
    expect(doc.nodes.map((n) => n.id)).toEqual(['svc:orders', 'svc:billing']);
    /* And the accepted node is NOT grounded, because nothing proved it: an
       agent proposing a service is not evidence that one exists. */
    expect(doc.nodes.find((n) => n.id === 'svc:billing')?.evidenceRef).toBeUndefined();
  });

  it('a proposal whose edge lands on a node that does not exist is refused by docEdit', () => {
    /* The ghost may draw anything; the DOCUMENT may not accept anything. An
       agent proposing an edge to a node it forgot to propose would otherwise
       produce a diagram that will not load. */
    const r = docEdit(DOC, {
      type: 'doc/add-edge',
      id: 'e:bad',
      from: 'svc:orders',
      to: 'svc:ghost',
      family: 'http',
    });
    expect(r.changed).toBe(false);
    expect(r.note).toMatch(/svc:ghost/);
  });
});
