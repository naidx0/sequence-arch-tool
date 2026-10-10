/* ══════════════════════════════════════════════════════════════════════════
   ONE LINE PER PAIR — what the board draws between two boxes
   packages/web2/src/canvas/edgeLines.ts

   Pure. Stream 3b, owner review of the shopfront board: parallel runs between
   the same two boxes stacked into thick bundles. Every edge between the same
   source and target becomes ONE line; the line keeps the strongest proof of
   the edges it stands for and says what they are on hover ("2 http · 14
   imports"). Clicking it lists the file:line evidence of all of them.

   Proof follows the scan, not the family: an http, grpc, queue or db edge the
   analyzer read in SOURCE code (`instrument: 'source'`) is traced and drawn
   solid. Dashed is kept for what was declared in config or a manifest, and
   for what is derived.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph } from '@sequence/schema';

import type { BoardEdge } from './Board.js';
import { liftTo } from './composite.js';

const STRENGTH: Record<BoardEdge['proof'], number> = { onflow: 3, traced: 2, declared: 1, derived: 0 };

export const pairKey = (source: string, target: string): string => `${source}->${target}`;

/** Pairs of drawn boxes joined by at least one non-import edge the scan read
 *  in source code. */
export function sourceReadPairs(graph: ArchGraph | null, visibleIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (!graph) return out;
  const lift = liftTo(graph, new Set(visibleIds));
  for (const e of graph.edges) {
    if (e.kind === 'import' || e.instrument !== 'source') continue;
    const a = lift(e.srcId);
    const b = lift(e.dstId);
    if (a && b && a !== b) out.add(pairKey(a, b));
  }
  return out;
}

/** A declared edge between a pair the scan read in source is traced. */
export function proofFromScan(edges: readonly BoardEdge[], read: ReadonlySet<string>): BoardEdge[] {
  if (read.size === 0) return edges as BoardEdge[];
  return edges.map((e) => (e.proof === 'declared' && read.has(pairKey(e.source, e.target)) ? { ...e, proof: 'traced' } : e));
}

/**
 * Merge every edge between the same source and target into one line. The
 * first edge's id is kept (so a click, a path trace and an overlay that know
 * that id still find it); the proof is the strongest; `title` lists what the
 * line stands for. Order follows the first appearance of each pair.
 */
export function mergeSamePair(edges: readonly BoardEdge[]): BoardEdge[] {
  const order: string[] = [];
  const groups = new Map<string, BoardEdge[]>();
  for (const e of edges) {
    const k = pairKey(e.source, e.target);
    const list = groups.get(k);
    if (list) list.push(e);
    else {
      groups.set(k, [e]);
      order.push(k);
    }
  }
  return order.map((k) => {
    const list = groups.get(k)!;
    const words = list.map((e) => e.labelFull ?? e.label ?? (e.proof === 'derived' ? 'imports' : 'call'));
    const title = words.join(', ');
    if (list.length === 1) return { ...list[0]!, title };
    const best = list.reduce((a, b) => (STRENGTH[b.proof] > STRENGTH[a.proof] ? b : a));
    const runActive = list.some((e) => e.runActive);
    const imports = list.every((e) => e.imports);
    const { imports: _drop, runActive: _run, labelFull: _full, ...first } = list[0]!;
    return {
      ...first,
      proof: best.proof,
      title,
      label: title,
      ...(runActive ? { runActive: true } : {}),
      ...(imports ? { imports: true } : {}),
      merged: list.length,
    };
  });
}
