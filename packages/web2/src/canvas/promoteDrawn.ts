/* ══════════════════════════════════════════════════════════════════════════
   A DRAWN EDGE MEETS THE NEXT SCAN
   packages/web2/src/canvas/promoteDrawn.ts

   A reader draws Gateway -> Orders. The scan later finds that call in the code.
   Taking the new scan used to drop the drawn edge outright, so the claim and
   its proof never met: the board went from "someone says so" to "the code says
   so" without ever telling the reader that those were the same line.

   Rebasing now looks at every drawn edge:
     promoted  the scan has the same connection (same two scanned nodes, same
               direction). The scanned edge is already in the new base and is
               shown solid with its evidence; the dashed twin is not carried.
     kept      the scan does not have it. It survives as an ungrounded claim,
               dashed, so a rescan never throws away a drawing.
   An edge is only ever promoted between SCANNED nodes: a node the reader drew
   has no evidence to be matched against, so an edge touching one is a claim by
   construction, and the node it hangs on is kept with it.

   Nodes are matched by id after normalisation (case and punctuation), then by
   label, because ids drift between scans while a service keeps its name.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SeqDiagramEdge, SeqDiagramNode, SeqDiagramV1 } from '@sequence/schema';

export interface RebaseWithDrawn {
  doc: SeqDiagramV1;
  /** Ids of drawn edges the new scan now proves. */
  promoted: string[];
  /** Ids of drawn edges the scan does not have, re-added as ungrounded claims. */
  kept: string[];
  /** Ids of drawn edges dropped because a service they joined is gone from the scan. */
  dropped: string[];
}

/** The board mints `draw:` ids for edges (and boxes) the reader drew. */
export function isDrawnId(id: string): boolean {
  return id.startsWith('draw:');
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `svc:Gateway`, `svc:gateway` and `gateway` are one node. */
function idKey(id: string): string {
  const colon = id.indexOf(':');
  return norm(colon >= 0 ? id.slice(colon + 1) : id);
}

/** The node in the new scan that a previous node stands for, or null. */
function resolver(next: SeqDiagramV1): (prev: SeqDiagramNode) => string | null {
  const byId = new Set(next.nodes.map((n) => n.id));
  const byKey = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const n of next.nodes) {
    if (!byKey.has(idKey(n.id))) byKey.set(idKey(n.id), n.id);
    if (!byLabel.has(norm(n.label))) byLabel.set(norm(n.label), n.id);
  }
  return (prev) => {
    if (isDrawnId(prev.id)) return byId.has(prev.id) ? prev.id : null;
    if (byId.has(prev.id)) return prev.id;
    return byKey.get(idKey(prev.id)) ?? byLabel.get(norm(prev.label)) ?? null;
  };
}

export function rebaseWithDrawn(prevDoc: SeqDiagramV1, nextBase: SeqDiagramV1): RebaseWithDrawn {
  const drawn = prevDoc.edges.filter((e) => isDrawnId(e.id) && !e.evidenceRef);
  if (drawn.length === 0) return { doc: nextBase, promoted: [], kept: [], dropped: [] };

  const resolve = resolver(nextBase);
  const prevNode = new Map(prevDoc.nodes.map((n) => [n.id, n]));
  const nextIds = new Set(nextBase.nodes.map((n) => n.id));
  const scannedPairs = new Set(nextBase.edges.map((e) => `${e.from}\u0000${e.to}`));
  const takenEdgeIds = new Set(nextBase.edges.map((e) => e.id));

  const promoted: string[] = [];
  const dropped: string[] = [];
  const keptEdges: SeqDiagramEdge[] = [];
  const keptNodes = new Map<string, SeqDiagramNode>();

  for (const e of drawn) {
    const a = prevNode.get(e.from);
    const b = prevNode.get(e.to);
    if (!a || !b) continue; // a dangling edge cannot be carried
    const from = resolve(a);
    const to = resolve(b);
    const bothScanned = from !== null && to !== null && !isDrawnId(a.id) && !isDrawnId(b.id);
    if (bothScanned && scannedPairs.has(`${from}\u0000${to}`)) {
      promoted.push(e.id);
      continue;
    }
    /* Kept: both ends must exist in the result so the document never dangles. A
       scanned end that has gone from the scan, or a drawn box, travels as itself. */
    const ends: [string | null, SeqDiagramNode][] = [
      [from, a],
      [to, b],
    ];
    if (ends.some(([id, n]) => id === null && !isDrawnId(n.id))) {
      dropped.push(e.id); // its service is gone, and a claim about nothing is not kept
      continue;
    }
    const endpoint = (id: string | null, n: SeqDiagramNode): string => {
      if (id !== null && nextIds.has(id)) return id;
      keptNodes.set(n.id, n);
      return n.id;
    };
    const f = endpoint(from, a);
    const t = endpoint(to, b);
    if (takenEdgeIds.has(e.id)) continue;
    takenEdgeIds.add(e.id);
    keptEdges.push({ ...e, from: f, to: t });
  }

  const kept = keptEdges.map((e) => e.id);
  if (keptEdges.length === 0) return { doc: nextBase, promoted, kept, dropped };
  const addedNodes = [...keptNodes.values()].filter((n) => !nextIds.has(n.id));
  return {
    doc: { ...nextBase, nodes: [...nextBase.nodes, ...addedNodes], edges: [...nextBase.edges, ...keptEdges] },
    promoted,
    kept,
    dropped,
  };
}

/** What the reader is told after taking a new scan with drawn connections in the board. */
export function rebaseNote(promoted: number, kept: number, dropped = 0): string | null {
  const conn = (n: number) => `${n} drawn connection${n === 1 ? '' : 's'}`;
  let main: string | null = null;
  if (kept === 0 && promoted > 0) main = `${conn(promoted)} ${promoted === 1 ? 'is' : 'are'} now in the code.`;
  else if (promoted === 0 && kept > 0) main = `${conn(kept)} ${kept === 1 ? 'is' : 'are'} still a claim.`;
  else if (promoted > 0 && kept > 0)
    main = `${conn(promoted)} ${promoted === 1 ? 'is' : 'are'} now in the code; ${kept} ${kept === 1 ? 'is' : 'are'} still a claim.`;
  if (dropped === 0) return main;
  const gone = `${conn(dropped)} ${dropped === 1 ? 'was' : 'were'} removed because a service they joined is no longer in the scan.`;
  return main === null ? gone : `${main} ${gone}`;
}
