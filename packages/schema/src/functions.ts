/**
 * Function-level graph contract — separate from ArchGraph.
 *
 * Grounded function nodes (tree-sitter spans) plus call and cross-service
 * communication edges attributed to enclosing functions where evidence allows.
 */

export type FunctionNodeKind = 'function' | 'service' | 'datastore' | 'topic';

export interface FunctionNode {
  id: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  lang: string;
  /** Omitted or `'function'` for source spans; boundary nodes reuse arch ids. */
  kind?: FunctionNodeKind;
}

export type FunctionEdgeKind = 'call' | 'http' | 'grpc' | 'queue' | 'db';

export interface FunctionEdge {
  id: string;
  srcId: string;
  dstId: string;
  kind: FunctionEdgeKind;
  /** Copied from the arch interaction edge when cross-service. */
  confidence?: number;
  /** Human label, e.g. `GET /orders` or topic/table name. */
  label?: string;
}

export interface FunctionGraph {
  nodes: FunctionNode[];
  edges: FunctionEdge[];
}

/** Deterministic node id for a function span. */
export function functionNodeId(file: string, name: string, startLine: number): string {
  return `fn:${file}#${name}@${startLine}`;
}

/** Deterministic edge id for a function-graph relationship. */
export function functionEdgeId(
  kind: FunctionEdgeKind,
  srcId: string,
  dstId: string
): string {
  return `${kind}:${srcId}->${dstId}`;
}
