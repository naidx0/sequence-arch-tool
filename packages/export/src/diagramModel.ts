/**
 * Renderer-neutral diagram model for macOS-native SVG export.
 * Built from the same `projectEdges` projection as Mermaid text exports.
 */
import type { ArchGraph } from '@sequence/schema';
import {
  projectEdges,
  participantKinds,
  orderParticipants,
  orderEdgesByFlow,
  type LiftedKind,
} from './project.js';

/** macOS UI tokens for SVG rendering — literals from docs/macos-ui.md */
export interface DiagramTheme {
  canvas: string;
  nodeFill: string;
  nodeBorder: string;
  text: string;
  muted: string;
  edge: Record<string, string>;
  arrowhead: string;
  fontSans: string;
  fontMono: string;
}

export interface SequenceDiagramModel {
  participants: { id: string; label: string; kind: LiftedKind }[];
  messages: { from: string; to: string; label: string; family: string }[];
}

/** Canonical macOS-dark theme for ADR-quality sequence diagrams. */
export function macOsTheme(): DiagramTheme {
  return {
    canvas: '#191919',
    nodeFill: '#29292c',
    nodeBorder: '#37373a',
    text: '#f5f5f7',
    muted: '#98989d',
    edge: {
      http: '#4b6e9e',
      grpc: '#8b7ff0',
      queue_publish: '#9a8330',
      queue_consume: '#9a8330',
      db_access: '#3f7d5a',
    },
    arrowhead: '#6a6a70',
    fontSans:
      '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","Segoe UI",sans-serif',
    fontMono: 'ui-monospace,"SF Mono","JetBrains Mono","Menlo",monospace',
  };
}

/** Project an ArchGraph to a sequence diagram model (participants + ordered messages). */
export function graphToSequenceModel(graph: ArchGraph): SequenceDiagramModel {
  const edges = projectEdges(graph);
  const order = orderParticipants(edges);
  const kinds = participantKinds(edges);
  const participants = order.map((label) => ({
    id: label,
    label,
    kind: kinds.get(label)!,
  }));
  const messages = orderEdgesByFlow(edges, order).map((e) => ({
    from: e.src,
    to: e.dst,
    label: e.labels.join(', ') || e.family,
    family: e.family,
  }));
  return { participants, messages };
}
