import { describe, expect, it } from 'vitest';
import { validateSeqDiagram, type SeqDiagramV1 } from '@sequence/schema';

import { docEdit } from './docEdit.js';

/**
 * EDITING THE DOCUMENT, NOT THE CAMERA.
 *
 * `canvasReduce` is layout-only on purpose — its header says it "invents no
 * state of its own" and reduces the frozen `CanvasSlice`. Create / rename /
 * delete are not camera moves, so bolting them on there would be the exact
 * thing that file was written to prevent. The document a user edits is the
 * `.seqd` (`SeqDiagramV1`), which the owner named as the artifact: JSON-native,
 * and text a model can read.
 *
 * THE INVARIANT UNDER TEST IS "the document still validates", not "the reducer
 * wrote the field I expected". `validateSeqDiagram` enforces referential
 * integrity — `edge <id> has unknown from-node <id>` — so an edit that leaves a
 * dangling reference produces a document the app cannot load. Asserting the
 * invariant rather than the expression is what makes this test survive a
 * refactor of how the purge is implemented.
 *
 * A node id is referenced in NINE places. Delete is not `nodes.filter`:
 *
 *   1. edges[].from            5. flows[].edgeIds     (indirectly — cascade)
 *   2. edges[].to              6. boundaries[].memberIds
 *   3. primaryNodeIds[]        7. externalDependencies[].boundaryNodeId
 *   4. groups[].memberIds[]    8. flows[].nodeIds[]
 *   9. grounded.scopeNodeIds[]
 *
 * Eight of those nine fail `validateSeqDiagram`. The ninth — `scopeNodeIds` —
 * is checked only for "non-empty string", so a deleted id left there passes
 * validation and silently claims the diagram is scoped to a node that no longer
 * exists. It is called out by name below precisely because the validator will
 * not catch a regression there.
 */

/** A fixture that populates all nine reference sites, so delete has work to do. */
function fixture(): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-flow',
    title: 'shopfront',
    grounded: {
      graphId: 'g1',
      repoPath: '/repo',
      origin: 'scan',
      scopeNodeIds: ['gateway', 'shipping'],
    },
    nodes: [
      { id: 'gateway', label: 'Gateway', kind: 'service', evidenceRef: 'scan:gateway/src/app.ts:1' },
      { id: 'shipping', label: 'Shipping', kind: 'service', evidenceRef: 'scan:shipping/main.go:1' },
      { id: 'db', label: 'Orders', kind: 'datastore', evidenceRef: 'scan:db.py:3' },
    ],
    edges: [
      { id: 'e1', from: 'gateway', to: 'shipping', family: 'http' },
      { id: 'e2', from: 'shipping', to: 'db', family: 'db' },
    ],
    groups: [{ id: 'grp', label: 'Backend', memberIds: ['shipping', 'db'] }],
    flows: [{ id: 'f1', label: 'Order', nodeIds: ['gateway', 'shipping'], edgeIds: ['e1'] }],
    primaryNodeIds: ['gateway', 'shipping'],
    boundaries: [{ id: 'b1', label: 'Cluster', memberIds: ['shipping'] }],
    externalDependencies: [{ id: 'x1', label: 'Stripe', boundaryNodeId: 'shipping' }],
    projections: { mermaid: 'graph LR; gateway-->shipping;' },
  } as SeqDiagramV1;
}

/** The fixture has to be valid, or every assertion below proves nothing. */
function assertValid(doc: SeqDiagramV1, when: string) {
  const res = validateSeqDiagram(doc);
  expect(res.ok, `${when}: ${JSON.stringify(res.errors)}`).toBe(true);
}

describe('docEdit', () => {
  it('the fixture is a valid document before anything is edited', () => {
    assertValid(fixture(), 'fixture');
  });

  /* ── create ────────────────────────────────────────────────────────────── */

  it('a drawn node carries NO evidenceRef — drawn is not found', () => {
    const { doc, changed } = docEdit(fixture(), {
      type: 'doc/add-node',
      id: 'store-1',
      label: 'Franchise Store 1',
      kind: 'service',
    });
    expect(changed).toBe(true);
    const added = doc.nodes.find((n) => n.id === 'store-1');
    expect(added?.label).toBe('Franchise Store 1');
    /*
     * The non-negotiable is "grounded, not guessed". A node the user drew has
     * no evidence behind it, and the ONLY thing separating it from a scanned
     * node in this document is the absence of this field. Giving a drawn node a
     * synthesised evidenceRef would make the board unable to tell a claim about
     * the repo from a claim about someone's intent.
     */
    expect(added?.evidenceRef).toBeUndefined();
    assertValid(doc, 'after add-node');
  });

  it('adding a node whose id is taken changes nothing and says why', () => {
    const before = fixture();
    const { doc, changed, note } = docEdit(before, {
      type: 'doc/add-node',
      id: 'gateway',
      label: 'Another Gateway',
      kind: 'service',
    });
    expect(changed).toBe(false);
    expect(note).toMatch(/already/i);
    /* The existing node keeps its label — a silent overwrite would destroy a
       scanned node by drawing over it. */
    expect(doc.nodes.find((n) => n.id === 'gateway')?.label).toBe('Gateway');
    expect(doc.nodes).toHaveLength(3);
  });

  /* ── rename ────────────────────────────────────────────────────────────── */

  it('rename changes the label and never the id, so edges keep pointing', () => {
    const { doc, changed } = docEdit(fixture(), {
      type: 'doc/rename-node',
      id: 'shipping',
      label: 'Fulfilment',
    });
    expect(changed).toBe(true);
    const n = doc.nodes.find((x) => x.id === 'shipping');
    expect(n?.label).toBe('Fulfilment');
    expect(n?.id).toBe('shipping');
    /* The id is the reference. Renaming it would orphan e1, e2, the group, the
       flow, the boundary and the external dep in one keystroke. */
    expect(doc.edges.map((e) => e.to)).toContain('shipping');
    assertValid(doc, 'after rename');
  });

  it('rename keeps the evidenceRef — relabelling a scanned node does not unground it', () => {
    const { doc } = docEdit(fixture(), {
      type: 'doc/rename-node',
      id: 'shipping',
      label: 'Fulfilment',
    });
    expect(doc.nodes.find((x) => x.id === 'shipping')?.evidenceRef).toBe('scan:shipping/main.go:1');
  });

  it('renaming an unknown node is a no-op that reports itself, not a throw', () => {
    const { changed, note } = docEdit(fixture(), {
      type: 'doc/rename-node',
      id: 'nope',
      label: 'X',
    });
    expect(changed).toBe(false);
    expect(note).toMatch(/no node/i);
  });

  it('a blank label is refused — an unnamed card is unreadable on the board', () => {
    const { changed, note } = docEdit(fixture(), {
      type: 'doc/rename-node',
      id: 'shipping',
      label: '   ',
    });
    expect(changed).toBe(false);
    expect(note).toMatch(/empty|blank/i);
  });

  /* ── delete: the one that is not `nodes.filter` ────────────────────────── */

  it('deleting a node leaves a document that still validates', () => {
    const { doc, changed } = docEdit(fixture(), { type: 'doc/delete-node', id: 'shipping' });
    expect(changed).toBe(true);
    /* THE assertion. Every purge below is a consequence of this one holding. */
    assertValid(doc, 'after delete-node');
  });

  it('deleting a node cascades to every edge touching it, in and out', () => {
    const { doc, removedEdgeIds } = docEdit(fixture(), {
      type: 'doc/delete-node',
      id: 'shipping',
    });
    /* e1 points AT shipping, e2 points FROM it. Purging one direction is the
       obvious half-fix, and it leaves a dangling edge that fails validation. */
    expect(doc.edges).toHaveLength(0);
    expect(removedEdgeIds?.slice().sort()).toEqual(['e1', 'e2']);
  });

  it('deleting a node purges it from groups, flows, boundaries, primary and external deps', () => {
    const { doc } = docEdit(fixture(), { type: 'doc/delete-node', id: 'shipping' });
    expect(doc.groups?.[0]?.memberIds).toEqual(['db']);
    expect(doc.flows?.[0]?.nodeIds).toEqual(['gateway']);
    expect(doc.primaryNodeIds).toEqual(['gateway']);
    expect(doc.boundaries?.[0]?.memberIds).toEqual([]);
    /* An external dependency anchored to a node that no longer exists cannot be
       re-anchored by this reducer, so it goes with the node rather than being
       left pointing at nothing. */
    expect(doc.externalDependencies?.some((d) => d.boundaryNodeId === 'shipping')).toBe(false);
  });

  it('the cascade reaches flows[].edgeIds, which reference EDGES not nodes', () => {
    const { doc } = docEdit(fixture(), { type: 'doc/delete-node', id: 'shipping' });
    /*
     * The second-order purge, and the one a `nodes.filter` fix never reaches:
     * deleting the node deletes e1, and f1 still listed e1. `validateEdgeRefs`
     * calls that `flows[0].edgeIds references unknown edge e1`.
     */
    expect(doc.flows?.[0]?.edgeIds).toEqual([]);
  });

  it('deleting a node purges grounded.scopeNodeIds, which the validator does NOT check', () => {
    const { doc } = docEdit(fixture(), { type: 'doc/delete-node', id: 'shipping' });
    /*
     * Called out separately because `validateSeqDiagram` only checks these are
     * non-empty strings. A stale id here passes every other assertion in this
     * file while the document claims to be scoped to a node it no longer
     * contains — the kind of quiet wrongness that surfaces later as a scan
     * result nobody can reproduce.
     */
    expect(doc.grounded.scopeNodeIds).toEqual(['gateway']);
  });

  it('deleting an unknown node is a no-op that reports itself', () => {
    const { doc, changed, note } = docEdit(fixture(), { type: 'doc/delete-node', id: 'nope' });
    expect(changed).toBe(false);
    expect(note).toMatch(/no node/i);
    expect(doc.nodes).toHaveLength(3);
  });

  /* ── edges ─────────────────────────────────────────────────────────────── */

  it('a drawn edge between two real nodes validates and carries no evidence', () => {
    const { doc, changed } = docEdit(fixture(), {
      type: 'doc/add-edge',
      id: 'e3',
      from: 'gateway',
      to: 'db',
      family: 'db',
    });
    expect(changed).toBe(true);
    expect(doc.edges.find((e) => e.id === 'e3')?.evidenceRef).toBeUndefined();
    assertValid(doc, 'after add-edge');
  });

  it('an edge to a node that does not exist is refused before it can corrupt the document', () => {
    const { changed, note } = docEdit(fixture(), {
      type: 'doc/add-edge',
      id: 'e3',
      from: 'gateway',
      to: 'ghost',
      family: 'http',
    });
    /* Refusing here is what keeps `assertValid` from being the thing that
       discovers it, several screens later, as a document that will not load. */
    expect(changed).toBe(false);
    expect(note).toMatch(/ghost/);
  });

  it('deleting an edge purges it from flows[].edgeIds too', () => {
    const { doc, changed } = docEdit(fixture(), { type: 'doc/delete-edge', id: 'e1' });
    expect(changed).toBe(true);
    expect(doc.edges.map((e) => e.id)).toEqual(['e2']);
    expect(doc.flows?.[0]?.edgeIds).toEqual([]);
    assertValid(doc, 'after delete-edge');
  });

  /* ── the stale projection ──────────────────────────────────────────────── */

  it('any structural edit drops the derived mermaid projection', () => {
    for (const edit of [
      { type: 'doc/add-node', id: 'n9', label: 'New', kind: 'service' },
      { type: 'doc/rename-node', id: 'gateway', label: 'Edge' },
      { type: 'doc/delete-node', id: 'db' },
      { type: 'doc/delete-edge', id: 'e1' },
    ] as const) {
      const { doc } = docEdit(fixture(), edit);
      /*
       * `projections.mermaid` is DERIVED text, and the schema says so: "may be
       * stale relative to nodes/edges". Carrying it through an edit means the
       * export renders the diagram as it was before the user changed it —
       * wrong, and wrong while looking authoritative. Dropping it makes the
       * staleness impossible rather than merely documented.
       */
      expect(doc.projections?.mermaid, `${edit.type} kept a stale projection`).toBeUndefined();
    }
  });

  /* ── purity ────────────────────────────────────────────────────────────── */

  it('the input document is never mutated', () => {
    const before = fixture();
    const snapshot = JSON.stringify(before);
    docEdit(before, { type: 'doc/delete-node', id: 'shipping' });
    docEdit(before, { type: 'doc/add-node', id: 'z', label: 'Z', kind: 'service' });
    docEdit(before, { type: 'doc/rename-node', id: 'gateway', label: 'Changed' });
    /* The store holds this document. A reducer that edits in place makes React
       skip the re-render, which reads to the user as "the app ignored me". */
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('a no-op returns the very same document object, so nothing downstream re-renders', () => {
    const before = fixture();
    const { doc, changed } = docEdit(before, { type: 'doc/delete-node', id: 'nope' });
    expect(changed).toBe(false);
    expect(doc).toBe(before);
  });
});
