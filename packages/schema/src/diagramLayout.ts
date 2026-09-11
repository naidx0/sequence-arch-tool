/**
 * Deterministic layout routing for SeqDiagram documents — classifies system
 * shape (service flow, agent loop, package map, sequence) and picks a layout
 * engine + direction for the Architecture board and SVG export.
 *
 * PURE — no fs, no network.
 */
import type {
  SeqDiagramEdge,
  SeqDiagramKind,
  SeqDiagramLayout,
  SeqDiagramLayoutDirection,
  SeqDiagramLayoutEngine,
  SeqDiagramV1,
} from './seqdiagram.js';

export interface SeqDiagramLayoutProfile {
  engine: SeqDiagramLayoutEngine;
  direction: SeqDiagramLayoutDirection;
  /** Why this profile was chosen — for tests and debug overlays. */
  reason: string;
}

const LAYERED: SeqDiagramLayoutEngine = 'layered-flow';
const SEQUENCE: SeqDiagramLayoutEngine = 'sequence';
const GRID: SeqDiagramLayoutEngine = 'grid';

/** True when the directed edge set contains a cycle (agentic / feedback loop). */
export function diagramHasDirectedCycle(
  nodeIds: readonly string[],
  edges: readonly Pick<SeqDiagramEdge, 'from' | 'to'>[],
): boolean {
  const known = new Set(nodeIds);
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const id of nodeIds) {
    if (!visited.has(id) && dfs(id)) return true;
  }
  return false;
}

/** True when edges look like orchestrator ↔ tool control wiring (not business http). */
export function diagramLooksLikeAgentLoop(
  nodes: readonly { id?: string; kind?: string }[],
  edges: readonly SeqDiagramEdge[],
): boolean {
  const agentIds = new Set(
    nodes.filter((n) => n.kind === 'agent' && n.id).map((n) => n.id as string),
  );
  if (agentIds.size === 0) return false;

  let controlTouchingAgent = 0;
  for (const e of edges) {
    if (e.from === e.to) return true;
    if (e.family !== 'control') continue;
    if (agentIds.has(e.from) || agentIds.has(e.to)) controlTouchingAgent += 1;
  }
  return controlTouchingAgent >= 2;
}

/** Infer diagram kind from topology + optional user question (propose_topology). */
export function inferSeqDiagramKind(input: {
  nodes: readonly { id?: string; kind?: string }[];
  edges: readonly Pick<SeqDiagramEdge, 'from' | 'to' | 'family'>[];
  question?: string;
  explicitKind?: string;
}): SeqDiagramKind {
  const explicit = input.explicitKind?.trim();
  if (
    explicit === 'agent-workflow' ||
    explicit === 'service-flow' ||
    explicit === 'service-sequence' ||
    explicit === 'package-map' ||
    explicit === 'function-path' ||
    explicit === 'breakout-interior'
  ) {
    return explicit;
  }

  const q = input.question?.toLowerCase() ?? '';
  if (/agentic|agent loop|orchestrat|workflow|harness|tool loop|reasoning loop/.test(q)) {
    return 'agent-workflow';
  }
  if (/package map|module map|folder structure|monorepo map/.test(q)) {
    return 'package-map';
  }
  if (/sequence diagram|message flow|request.?response chain/.test(q)) {
    return 'service-sequence';
  }

  const agentNodes = input.nodes.filter((n) => n.kind === 'agent').length;
  if (
    agentNodes >= 1 &&
    diagramLooksLikeAgentLoop(input.nodes, input.edges as SeqDiagramEdge[])
  ) {
    return 'agent-workflow';
  }

  if (/tree|top.?down|hierarch|layered stack|org chart/.test(q)) {
    return 'service-flow';
  }

  return 'service-flow';
}

function profileFromLayout(layout: SeqDiagramLayout | undefined): SeqDiagramLayoutProfile | null {
  if (!layout?.engine) return null;
  return {
    engine: layout.engine,
    direction: layout.direction ?? 'LR',
    reason: 'explicit layout on document',
  };
}

function defaultProfileForKind(kind: SeqDiagramKind): SeqDiagramLayoutProfile {
  switch (kind) {
    case 'agent-workflow':
      /* Agent loops lay out as a top-down tree — circular is opt-in via explicit layout.engine. */
      return { engine: LAYERED, direction: 'TD', reason: 'agent-workflow kind → top-down layered tree' };
    case 'service-sequence':
      return { engine: SEQUENCE, direction: 'LR', reason: 'service-sequence kind → sequence lanes' };
    case 'package-map':
      return { engine: GRID, direction: 'TD', reason: 'package-map kind → top-down grid' };
    case 'function-path':
      return { engine: LAYERED, direction: 'LR', reason: 'function-path kind → left-to-right path' };
    case 'breakout-interior':
      return { engine: LAYERED, direction: 'TD', reason: 'breakout-interior kind → top-down tree' };
    case 'service-flow':
    default:
      return { engine: LAYERED, direction: 'LR', reason: 'service-flow default → left-to-right layered' };
  }
}

/**
 * Resolve the layout engine + direction for a diagram.
 * Honors explicit `doc.layout` when both engine and direction are set.
 */
export function classifySeqDiagramLayout(doc: SeqDiagramV1): SeqDiagramLayoutProfile {
  const explicit = profileFromLayout(doc.layout);
  if (explicit && doc.layout?.direction) return explicit;

  const kindProfile = defaultProfileForKind(doc.kind);

  if (explicit && !doc.layout?.direction) {
    return { ...kindProfile, engine: explicit.engine, reason: `${kindProfile.reason}; engine overridden` };
  }

  if (doc.meta?.diagramFamily === 'process' && doc.kind === 'service-flow' && kindProfile.engine === LAYERED) {
    return {
      engine: LAYERED,
      direction: 'TD',
      reason: 'process diagram family → top-down layered tree',
    };
  }

  if (doc.layout?.direction === 'TD' || doc.layout?.direction === 'LR') {
    return { ...kindProfile, direction: doc.layout.direction, reason: `${kindProfile.reason}; explicit direction` };
  }

  return kindProfile;
}

/** Build layout block for a proposed or exported diagram. */
export function seqDiagramLayoutForKind(kind: SeqDiagramKind, _edges?: readonly SeqDiagramEdge[]): SeqDiagramLayout {
  const profile = defaultProfileForKind(kind);
  return { engine: profile.engine, direction: profile.direction };
}
