/**
 * Architecture board persistence — the session's `.seqd` snapshot on disk.
 */

import type { SeqDiagramKind, SeqDiagramV1 } from '@sequence/schema';

import { isScratchDoc } from '../canvas/localScratch.js';

/** Diagram kinds the Architecture board session may persist. */
const BOARD_PERSIST_KINDS: ReadonlySet<SeqDiagramKind> = new Set([
  'service-flow',
  'agent-workflow',
]);

/** Serialize a diagram for PUT `boardSeqd`. */
export function toBoardSeqd(doc: SeqDiagramV1): string {
  return JSON.stringify(doc);
}

function parseNode(raw: unknown): SeqDiagramV1['nodes'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.label !== 'string' || typeof o.kind !== 'string') {
    return null;
  }
  return o as unknown as SeqDiagramV1['nodes'][number];
}

function parseEdge(raw: unknown): SeqDiagramV1['edges'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.id !== 'string' ||
    typeof o.from !== 'string' ||
    typeof o.to !== 'string' ||
    typeof o.family !== 'string'
  ) {
    return null;
  }
  return o as unknown as SeqDiagramV1['edges'][number];
}

/** Parse stored board text; corrupt or foreign shapes return null. */
export function fromBoardSeqd(raw: string): SeqDiagramV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const doc = parsed as Partial<SeqDiagramV1>;
  if (doc.version !== 1 || typeof doc.kind !== 'string' || !BOARD_PERSIST_KINDS.has(doc.kind)) {
    return null;
  }
  if (typeof doc.title !== 'string' || !doc.grounded || typeof doc.grounded.graphId !== 'string') {
    return null;
  }
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return null;
  const nodes: SeqDiagramV1['nodes'] = [];
  for (const entry of doc.nodes) {
    const node = parseNode(entry);
    if (!node) return null;
    nodes.push(node);
  }
  const edges: SeqDiagramV1['edges'] = [];
  for (const entry of doc.edges) {
    const edge = parseEdge(entry);
    if (!edge) return null;
    edges.push(edge);
  }
  return {
    version: 1,
    kind: doc.kind,
    title: doc.title,
    grounded: doc.grounded,
    nodes,
    edges,
    ...(doc.projections ? { projections: doc.projections } : {}),
    ...(doc.meta ? { meta: doc.meta } : {}),
    ...(doc.layout ? { layout: doc.layout } : {}),
  };
}

/** Whether this session doc should be written back to `boardSeqd`. */
export function worthPersistingBoard(doc: SeqDiagramV1 | null, edits: number): boolean {
  if (doc === null) return false;
  if (edits > 0) return true;
  if (isScratchDoc(doc)) return doc.nodes.length > 0 || doc.edges.length > 0;
  return false;
}
