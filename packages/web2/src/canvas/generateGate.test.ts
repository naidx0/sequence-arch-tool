import { describe, expect, it } from 'vitest';

import { buildGenerateRequest, generateContext, isGeneratable } from './generateGate';
import { docEdit } from './docEdit';
import { canvasReduce } from './canvasReduce';
import { EMPTY_CANVAS } from '../state/initial';
import type { SeqDiagramV1 } from '@sequence/schema';

/**
 * THE GENERATE GATE — and most of it is a refusal.
 *
 * The owner's constraint, verbatim, and the sharpest one in the editing model:
 *
 *   "you can do agentic coding with drawing, editing the diagram, and proposing
 *    code as well, BUT NOT AT EVERY JUNCTION… If somebody does something, it
 *    doesn't automatically have to propose code."
 *
 *   "Drawing a box must NOT fire a code proposal. Generate is an explicit act
 *    with a confirmation step. This is the difference between a canvas that
 *    thinks with you and one that panics at every stroke."
 *
 * So the first test in this file is about what does NOT happen.
 */

const DOC = {
  version: 1,
  kind: 'service-flow',
  title: 'shop',
  grounded: { graphId: 'g1' },
  nodes: [
    { id: 'svc:gateway', label: 'gateway', kind: 'service', evidenceRef: 'scan:gw.ts:1' },
    { id: 'ds:pg', label: 'postgres', kind: 'datastore', evidenceRef: 'scan:compose:pg' },
  ],
  edges: [],
} as unknown as SeqDiagramV1;

/** The doc after a person adds a node between the two. */
function withDrawn(): SeqDiagramV1 {
  let doc = docEdit(DOC, {
    type: 'doc/add-node',
    id: 'draw:billing',
    label: 'Billing',
    kind: 'service',
  }).doc;
  doc = docEdit(doc, {
    type: 'doc/add-edge',
    id: 'e1',
    from: 'svc:gateway',
    to: 'draw:billing',
    family: 'http',
  }).doc;
  doc = docEdit(doc, {
    type: 'doc/add-edge',
    id: 'e2',
    from: 'draw:billing',
    to: 'ds:pg',
    family: 'db',
  }).doc;
  return doc;
}

/* ═══ THE GATE — what does not happen ═════════════════════════════════════ */

describe('the gate', () => {
  it('adding a node proposes NOTHING — the canvas does not panic at a stroke', () => {
    const doc = withDrawn();
    /*
     * The owner's rule, tested where it can actually be broken. `docEdit` adds
     * a node and that is ALL it does: no ask, no proposal, no spinner. A canvas
     * that fired a code proposal here would be the one this constraint exists
     * to prevent.
     */
    expect(doc.nodes.some((n) => n.id === 'draw:billing')).toBe(true);
    /* And the canvas is not put into the proposal state by an edit. S4 is
       entered by `canvas/proposal`, which only an agent's answer dispatches. */
    expect(EMPTY_CANVAS.view.state).not.toBe('S4');
    expect(canvasReduce(EMPTY_CANVAS, { type: 'canvas/clear' }).view.state).not.toBe('S4');
  });

  it('Generate is offered only on a node nobody proved', () => {
    const doc = withDrawn();
    const drawn = doc.nodes.find((n) => n.id === 'draw:billing')!;
    const scanned = doc.nodes.find((n) => n.id === 'svc:gateway')!;
    expect(isGeneratable(drawn)).toBe(true);
    /*
     * A scanned node already has an implementation. Asking an AI what goes in
     * `gateway` when `gateway/` is on disk invites a second answer to a
     * question the repository has settled — and afterwards nobody could tell
     * the invented one from the found one.
     */
    expect(isGeneratable(scanned)).toBe(false);
  });

  it('a request cannot be built for a grounded node, so the check cannot be routed around', () => {
    const doc = withDrawn();
    expect(buildGenerateRequest(doc, 'svc:gateway', 'scaffold')).toBeNull();
    expect(buildGenerateRequest(doc, 'nope', 'describe')).toBeNull();
  });
});

/* ═══ what Generate actually asks ═════════════════════════════════════════ */

describe('the request', () => {
  it('carries the neighbours, because that IS the intent', () => {
    const ctx = generateContext(withDrawn(), 'draw:billing');
    /*
     * A service between a gateway and a datastore is a different thing from the
     * same box floating alone, and that difference is the whole of what the
     * person meant. Sending the entire diagram would bury it.
     */
    expect(ctx.inbound).toEqual(['gateway']);
    expect(ctx.outbound).toEqual(['postgres']);
  });

  it('says what it is connected to, in words', () => {
    const req = buildGenerateRequest(withDrawn(), 'draw:billing', 'describe')!;
    expect(req.prompt).toMatch(/called by gateway/);
    expect(req.prompt).toMatch(/calls postgres/);
    /* And that it is NOT in the code, which is the fact that makes the question
       answerable at all. */
    expect(req.prompt).toMatch(/not in the code yet/);
  });

  it('an unconnected box says so rather than implying connections', () => {
    const doc = docEdit(DOC, {
      type: 'doc/add-node',
      id: 'draw:lonely',
      label: 'Lonely',
      kind: 'service',
    }).doc;
    const req = buildGenerateRequest(doc, 'draw:lonely', 'describe')!;
    expect(req.prompt).toMatch(/Nothing is connected to it yet/);
  });

  it('the person’s own words come first, and are not paraphrased', () => {
    const req = buildGenerateRequest(
      withDrawn(),
      'draw:billing',
      'describe',
      'this should own invoices, orders must not write them',
    )!;
    /*
     * Step 5 of the owner's model: the AI reads what the human built AND WHY
     * they built it that way. A prompt that paraphrased their note would be
     * answering a question they did not ask.
     */
    expect(req.prompt).toContain('this should own invoices, orders must not write them');
  });

  it('no note is stated as no note — never invented', () => {
    const req = buildGenerateRequest(withDrawn(), 'draw:billing', 'describe')!;
    expect(req.prompt).toMatch(/did not say what it is for/);
  });

  it('describe explicitly forbids files; scaffold explicitly says PROPOSAL', () => {
    const describe_ = buildGenerateRequest(withDrawn(), 'draw:billing', 'describe')!;
    const scaffold = buildGenerateRequest(withDrawn(), 'draw:billing', 'scaffold')!;
    /*
     * Step 4: "let a strong architect scaffold it themselves". Describe must
     * not quietly return files, and scaffold must not imply anything is
     * written — `propose_files` stages and a human accepts.
     */
    expect(describe_.prompt).toMatch(/Do not propose files/);
    expect(scaffold.prompt).toMatch(/nothing is written until a human accepts/i);
  });

  it('is deterministic — the same node and doc give the same prompt', () => {
    const doc = withDrawn();
    expect(buildGenerateRequest(doc, 'draw:billing', 'describe')).toEqual(
      buildGenerateRequest(doc, 'draw:billing', 'describe'),
    );
  });
});
