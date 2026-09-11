/**
 * Repository integration — layout classifier against shopfront + live workspace scan.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';

import { archGraphToSeqDiagram } from '@sequence/export';
import {
  classifySeqDiagramLayout,
  inferSeqDiagramKind,
  type ArchGraph,
  type SeqDiagramV1,
} from '@sequence/schema';

import { cardBox } from './cardBox';
import { elkGraphFor, positionsFrom } from './layout';
import { projectDocument } from './project';

const FRAME = { width: 1280, height: 800 };

/** Shopfront topology — same shape export tests use (8 services + datastores + topic). */
function shopfrontGraph(): ArchGraph {
  const nodes = [
    { id: 'repo', kind: 'repo' as const, label: 'shopfront' },
    { id: 'svc:edge', kind: 'service' as const, label: 'edge', parentId: 'repo' },
    { id: 'svc:gateway', kind: 'service' as const, label: 'gateway', parentId: 'repo' },
    { id: 'svc:orders', kind: 'service' as const, label: 'orders', parentId: 'repo' },
    { id: 'svc:payments', kind: 'service' as const, label: 'payments', parentId: 'repo' },
    { id: 'svc:inventory', kind: 'service' as const, label: 'inventory', parentId: 'repo' },
    { id: 'svc:notifications', kind: 'service' as const, label: 'notifications', parentId: 'repo' },
    { id: 'svc:shipping', kind: 'service' as const, label: 'shipping', parentId: 'repo' },
    { id: 'svc:invoices', kind: 'service' as const, label: 'invoices', parentId: 'repo' },
    { id: 'ds:postgres', kind: 'datastore' as const, label: 'postgres', parentId: 'repo' },
    { id: 'ds:redis', kind: 'datastore' as const, label: 'redis', parentId: 'repo' },
    { id: 'topic:order.created', kind: 'topic' as const, label: 'order.created', parentId: 'ds:redis' },
  ];
  const edges = [
    { id: 'e1', srcId: 'svc:gateway', dstId: 'svc:orders', kind: 'http' as const, confidence: 1, origin: 'deterministic' as const, evidence: [{ file: 'f', line: 1, snippet: 'x' }] },
    { id: 'e2', srcId: 'svc:gateway', dstId: 'svc:payments', kind: 'http' as const, confidence: 1, origin: 'deterministic' as const, evidence: [{ file: 'f', line: 1, snippet: 'x' }] },
    { id: 'e3', srcId: 'svc:orders', dstId: 'ds:postgres', kind: 'db_access' as const, confidence: 1, origin: 'deterministic' as const, evidence: [{ file: 'f', line: 1, snippet: 'x' }] },
    { id: 'e4', srcId: 'svc:edge', dstId: 'svc:gateway', kind: 'http' as const, confidence: 1, origin: 'deterministic' as const, evidence: [{ file: 'f', line: 1, snippet: 'x' }] },
  ];
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/fixtures/shopfront',
    repoName: 'shopfront',
    nodes,
    edges,
    warnings: [],
  };
}

describe('repository layout integration', () => {
  it('classifies shopfront scan as service-flow LR and ELK lays it out', async () => {
    const seqd = archGraphToSeqDiagram(shopfrontGraph(), { origin: 'scan' });
    const profile = classifySeqDiagramLayout(seqd);

    expect(seqd.nodes.length).toBeGreaterThan(5);
    expect(profile.engine).toBe('layered-flow');
    expect(profile.direction).toBe('LR');

    const projection = projectDocument(seqd);
    const boxes = projection.nodes.map((n) =>
      cardBox(n, projection.positions[n.id] ?? { x: 0, y: 0 }, 1),
    );
    const laid = await new ELK().layout(
      elkGraphFor(boxes, projection.edges, FRAME, {
        direction: profile.direction,
        engine: profile.engine,
      }),
    );
    const positions = positionsFrom(laid as never);
    expect(Object.keys(positions).length).toBe(seqd.nodes.length);
    if (projection.edges.length >= 2) {
      expect(positions['svc:edge']!.x).toBeLessThan(positions['svc:gateway']!.x);
    }
  });

  it('classifies live /workspace archgraph when the app is serving it', async () => {
    let graph: ArchGraph | null = null;
    try {
      const res = await fetch('http://127.0.0.1:4173/archgraph.json');
      if (res.ok) graph = (await res.json()) as ArchGraph;
    } catch {
      /* app not running in CI — skip */
    }
    if (!graph) return;

    const seqd = archGraphToSeqDiagram(graph, { origin: 'scan' });
    const profile = classifySeqDiagramLayout(seqd);
    expect(profile.engine).toBe('layered-flow');
    expect(seqd.nodes.length).toBeGreaterThan(8);
  });

  it('lays agentic harness loop as a top-down tree on real card sizes', async () => {
    const agentLoop: SeqDiagramV1 = {
      version: 1,
      kind: 'agent-workflow',
      title: 'Agentic harness loop',
      grounded: { graphId: 'test:agent-loop', origin: 'design' },
      meta: { diagramFamily: 'process' },
      nodes: [
        { id: 'agent:orchestrator', label: 'Orchestrator', kind: 'agent' },
        { id: 'svc:planner', label: 'Planner', kind: 'service' },
        { id: 'svc:router', label: 'Provider Router', kind: 'service' },
        { id: 'svc:tools', label: 'Tool Registry', kind: 'service' },
        { id: 'svc:memory', label: 'Memory', kind: 'service' },
      ],
      edges: [
        { id: 'e1', from: 'agent:orchestrator', to: 'svc:planner', family: 'control' },
        { id: 'e2', from: 'svc:planner', to: 'svc:router', family: 'control' },
        { id: 'e3', from: 'svc:router', to: 'svc:tools', family: 'control' },
        { id: 'e4', from: 'svc:tools', to: 'svc:memory', family: 'control' },
        { id: 'e5', from: 'svc:memory', to: 'agent:orchestrator', family: 'control' },
      ],
    };

    expect(
      inferSeqDiagramKind({
        nodes: agentLoop.nodes,
        edges: agentLoop.edges,
        question: 'draw the agentic loop on the board',
      }),
    ).toBe('agent-workflow');

    const profile = classifySeqDiagramLayout(agentLoop);
    expect(profile.engine).toBe('layered-flow');
    expect(profile.direction).toBe('TD');

    const projection = projectDocument(agentLoop);
    const boxes = projection.nodes.map((n) =>
      cardBox(n, projection.positions[n.id] ?? { x: 0, y: 0 }, 1),
    );
    const laid = await new ELK().layout(
      elkGraphFor(boxes, projection.edges, FRAME, {
        direction: profile.direction,
        engine: profile.engine,
      }),
    );
    const positions = positionsFrom(laid as never);
    expect(Object.keys(positions).length).toBe(agentLoop.nodes.length);
    expect(positions['agent:orchestrator']!.y).toBeLessThan(positions['svc:planner']!.y);
  });

  it('routes process-family tree top-down with ELK DOWN', async () => {
    const tree: SeqDiagramV1 = {
      version: 1,
      kind: 'service-flow',
      title: 'Org tree',
      grounded: { graphId: 'test:tree' },
      meta: { diagramFamily: 'process' },
      nodes: [
        { id: 'a', label: 'Root', kind: 'service' },
        { id: 'b', label: 'Branch A', kind: 'service' },
        { id: 'c', label: 'Branch B', kind: 'service' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b', family: 'http' },
        { id: 'e2', from: 'a', to: 'c', family: 'http' },
      ],
    };

    const profile = classifySeqDiagramLayout(tree);
    expect(profile.direction).toBe('TD');

    const projection = projectDocument(tree);
    const boxes = projection.nodes.map((n) =>
      cardBox(n, projection.positions[n.id] ?? { x: 0, y: 0 }, 1),
    );
    const laid = await new ELK().layout(
      elkGraphFor(boxes, projection.edges, FRAME, { direction: profile.direction }),
    );
    const positions = positionsFrom(laid as never);
    expect(positions.a!.y).toBeLessThan(positions.b!.y);
    expect(positions.a!.y).toBeLessThan(positions.c!.y);
  });
});
