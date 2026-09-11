/* ══════════════════════════════════════════════════════════════════════════
   EDITING THE DIAGRAM — create, rename, delete
   packages/web2/src/canvas/docEdit.ts

   THE DOCUMENT IS THE `.seqd`, NOT THE CANVAS SLICE. `canvasReduce` reduces
   camera, selection, flow and layout, and its header states that it "invents no
   state of its own" — it is written to be dropped into `state/store.ts` as one
   case block. Create/rename/delete are not camera moves. Putting them there
   would give that reducer a document to own and break the one property that
   makes it safe to move.

   So edits land here, on `SeqDiagramV1` — the artifact the owner named: JSON
   native, and text a model can read. That last part is the point. The same
   bytes the board paints are the bytes the assistant reads when it is asked
   *why* something was drawn, which is what makes "edit with AI" a matter of
   handing over a document rather than inventing a second description of it.

   THREE RULES THIS FILE EXISTS TO KEEP:

   1. DRAWN IS NOT FOUND. A created node gets no `evidenceRef`. Absence of that
      field is the only thing distinguishing a node someone drew from a node the
      analyzer proved, and "grounded, not guessed" is a non-negotiable. A
      synthesised evidence pointer would be a lie told in the schema's own
      vocabulary.

   2. DELETE IS NOT `nodes.filter`. A node id is referenced in nine places, and
      `validateSeqDiagram` rejects a document that dangles in eight of them. The
      ninth, `grounded.scopeNodeIds`, is checked only for string-ness — so a
      stale id there survives validation and quietly claims a scope that no
      longer exists. Purged here, and named in the test, because nothing
      downstream will catch it.

   3. A NO-OP RETURNS THE SAME OBJECT. Identity is the re-render signal. A
      reducer that returns a fresh object for an edit it declined makes every
      consumer redraw to show nothing new; one that mutates in place makes React
      skip a redraw that mattered, which reads to the user as the app ignoring
      them.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  SeqDiagramEdge,
  SeqDiagramEdgeFamily,
  SeqDiagramNode,
  SeqDiagramNodeKind,
  SeqDiagramV1,
} from '@sequence/schema';

export type DocEdit =
  | { type: 'doc/add-node'; id: string; label: string; kind: SeqDiagramNodeKind }
  | { type: 'doc/rename-node'; id: string; label: string }
  | { type: 'doc/delete-node'; id: string }
  | {
      type: 'doc/add-edge';
      id: string;
      from: string;
      to: string;
      family: SeqDiagramEdgeFamily;
      label?: string;
    }
  | { type: 'doc/delete-edge'; id: string }
  | { type: 'doc/patch-node'; id: string; patch: Partial<SeqDiagramNode> }
  | { type: 'doc/set-layout-direction'; direction: import('@sequence/schema').SeqDiagramLayoutDirection };

export interface DocEditResult {
  doc: SeqDiagramV1;
  /** False when the edit was declined; `doc` is then the untouched input. */
  changed: boolean;
  /** Why it was declined — shown to the user, never swallowed. */
  note?: string;
  /** Edges removed by a cascade, so a caller can say what else went. */
  removedEdgeIds?: string[];
}

function declined(doc: SeqDiagramV1, note: string): DocEditResult {
  return { doc, changed: false, note };
}

/**
 * Drop the derived Mermaid text on any structural change.
 *
 * The schema calls this field "derived Mermaid text — may be stale relative to
 * nodes/edges". Carrying it through an edit means an export renders the diagram
 * as it stood before the user changed it: wrong, and wrong while looking
 * authoritative. Dropping it makes the staleness impossible instead of merely
 * documented. `capNote` is kept — it describes the projection's limits, not its
 * content.
 */
function dropStaleProjection(doc: SeqDiagramV1): SeqDiagramV1 {
  if (doc.projections?.mermaid === undefined) return doc;
  const { mermaid: _dropped, ...rest } = doc.projections;
  return { ...doc, projections: rest };
}

function hasNode(doc: SeqDiagramV1, id: string): boolean {
  return doc.nodes.some((n) => n.id === id);
}

/** Filter an optional id list, returning the original array when nothing went. */
function without(ids: string[] | undefined, gone: ReadonlySet<string>): string[] | undefined {
  if (!ids) return ids;
  if (!ids.some((id) => gone.has(id))) return ids;
  return ids.filter((id) => !gone.has(id));
}

export function docEdit(doc: SeqDiagramV1, edit: DocEdit): DocEditResult {
  switch (edit.type) {
    /* ── create ────────────────────────────────────────────────────────── */

    case 'doc/add-node': {
      const label = edit.label.trim();
      if (!label) return declined(doc, 'A node needs a name — an unlabelled card cannot be read.');
      if (hasNode(doc, edit.id)) {
        /* Never overwrite. The id may belong to a scanned node, and drawing
           over it would destroy grounded evidence with a gesture. */
        return declined(doc, `A node with the id "${edit.id}" already exists.`);
      }
      const node: SeqDiagramNode = { id: edit.id, label, kind: edit.kind };
      /* No evidenceRef, deliberately — see rule 1 in this file's header. */
      return {
        doc: dropStaleProjection({ ...doc, nodes: [...doc.nodes, node] }),
        changed: true,
      };
    }

    case 'doc/add-edge': {
      if (doc.edges.some((e) => e.id === edit.id)) {
        return declined(doc, `An edge with the id "${edit.id}" already exists.`);
      }
      /* Refused here rather than discovered later as a document that will not
         load. The note names the missing endpoint because "invalid edge" sends
         the reader looking at the wrong end. */
      for (const [end, id] of [
        ['from', edit.from],
        ['to', edit.to],
      ] as const) {
        if (!hasNode(doc, id)) {
          return declined(doc, `Cannot connect ${end} "${id}" — no such node on this diagram.`);
        }
      }
      const e: SeqDiagramEdge = {
        id: edit.id,
        from: edit.from,
        to: edit.to,
        family: edit.family,
        ...(edit.label ? { label: edit.label } : {}),
      };
      return { doc: dropStaleProjection({ ...doc, edges: [...doc.edges, e] }), changed: true };
    }

    /* ── rename ────────────────────────────────────────────────────────── */

    case 'doc/rename-node': {
      const label = edit.label.trim();
      if (!label) return declined(doc, 'A node needs a name — the label cannot be empty.');
      if (!hasNode(doc, edit.id)) return declined(doc, `There is no node "${edit.id}".`);
      const target = doc.nodes.find((n) => n.id === edit.id);
      if (target?.label === label) return declined(doc, 'The name is unchanged.');
      /*
       * The label changes; the id and the evidenceRef do not. The id is the
       * reference every other section holds, so renaming it would orphan the
       * edges, the group, the flow, the boundary and the external dependency in
       * one keystroke. The evidenceRef survives because relabelling a scanned
       * node does not unground it — the file it was found in is still that file.
       */
      return {
        doc: dropStaleProjection({
          ...doc,
          nodes: doc.nodes.map((n) => (n.id === edit.id ? { ...n, label } : n)),
        }),
        changed: true,
      };
    }

    /* ── delete ────────────────────────────────────────────────────────── */

    case 'doc/delete-node': {
      if (!hasNode(doc, edit.id)) return declined(doc, `There is no node "${edit.id}".`);
      const goneNodes = new Set([edit.id]);

      /* Both directions. Purging only inbound (or only outbound) is the obvious
         half-fix and it leaves a dangling edge that fails validation. */
      const removedEdgeIds = doc.edges
        .filter((e) => e.from === edit.id || e.to === edit.id)
        .map((e) => e.id);
      const goneEdges = new Set(removedEdgeIds);

      const next: SeqDiagramV1 = {
        ...doc,
        nodes: doc.nodes.filter((n) => n.id !== edit.id),
        edges: doc.edges.filter((e) => !goneEdges.has(e.id)),
        grounded: { ...doc.grounded, scopeNodeIds: without(doc.grounded.scopeNodeIds, goneNodes) },
      };

      if (doc.primaryNodeIds) next.primaryNodeIds = without(doc.primaryNodeIds, goneNodes);
      if (doc.groups) {
        next.groups = doc.groups.map((g) => ({
          ...g,
          memberIds: g.memberIds.filter((m) => !goneNodes.has(m)),
        }));
      }
      if (doc.boundaries) {
        next.boundaries = doc.boundaries.map((b) => ({
          ...b,
          memberIds: b.memberIds?.filter((m) => !goneNodes.has(m)),
        }));
      }
      if (doc.flows) {
        /* The second-order purge: deleting the node deleted its edges, and a
           flow that still lists one of them fails `validateEdgeRefs`. */
        next.flows = doc.flows.map((f) => ({
          ...f,
          nodeIds: f.nodeIds?.filter((n) => !goneNodes.has(n)),
          edgeIds: f.edgeIds?.filter((e) => !goneEdges.has(e)),
        }));
      }
      if (doc.externalDependencies) {
        /* A dependency anchored to a node that no longer exists cannot be
           re-anchored from here, so it goes with the node rather than being
           left pointing at nothing. */
        next.externalDependencies = doc.externalDependencies.filter(
          (d) => !(d.boundaryNodeId !== undefined && goneNodes.has(d.boundaryNodeId))
        );
      }

      return { doc: dropStaleProjection(next), changed: true, removedEdgeIds };
    }

    case 'doc/delete-edge': {
      if (!doc.edges.some((e) => e.id === edit.id)) {
        return declined(doc, `There is no edge "${edit.id}".`);
      }
      const gone = new Set([edit.id]);
      const next: SeqDiagramV1 = { ...doc, edges: doc.edges.filter((e) => e.id !== edit.id) };
      if (doc.flows) {
        next.flows = doc.flows.map((f) => ({
          ...f,
          edgeIds: f.edgeIds?.filter((e) => !gone.has(e)),
        }));
      }
      return { doc: dropStaleProjection(next), changed: true, removedEdgeIds: [edit.id] };
    }

    case 'doc/patch-node': {
      const idx = doc.nodes.findIndex((n) => n.id === edit.id);
      if (idx < 0) return declined(doc, `There is no node "${edit.id}".`);
      const prev = doc.nodes[idx]!;
      const merged = { ...prev, ...edit.patch };
      if (JSON.stringify(merged) === JSON.stringify(prev)) {
        return { doc, changed: false };
      }
      const nodes = doc.nodes.slice();
      nodes[idx] = merged;
      return { doc: dropStaleProjection({ ...doc, nodes }), changed: true };
    }

    case 'doc/set-layout-direction': {
      const prevDir = doc.layout?.direction;
      if (prevDir === edit.direction) return { doc, changed: false };
      const engine = doc.layout?.engine ?? 'layered-flow';
      return {
        doc: dropStaleProjection({
          ...doc,
          layout: { engine, direction: edit.direction },
        }),
        changed: true,
      };
    }

    default: {
      /* Exhaustiveness: a new edit kind must be handled, not silently dropped. */
      const never: never = edit;
      return declined(doc, `Unsupported edit: ${JSON.stringify(never)}`);
    }
  }
}
