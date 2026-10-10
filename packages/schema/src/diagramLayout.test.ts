import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  classifySeqDiagramLayout,
  diagramHasDirectedCycle,
  inferSeqDiagramKind,
  seqDiagramLayoutForKind,
} from './diagramLayout.js';
import type { SeqDiagramV1 } from './seqdiagram.js';

function doc(over: Partial<SeqDiagramV1> & Pick<SeqDiagramV1, 'nodes' | 'edges'>): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'service-flow',
    title: 'test',
    grounded: { graphId: 't' },
    ...over,
  } as SeqDiagramV1;
}

describe('diagramHasDirectedCycle', () => {
  it('detects a simple back-edge loop', () => {
    assert.equal(
      diagramHasDirectedCycle(['a', 'b', 'c'], [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ]),
      true,
    );
  });

  it('is false on a DAG chain', () => {
    assert.equal(
      diagramHasDirectedCycle(['a', 'b', 'c'], [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ]),
      false,
    );
  });
});

describe('inferSeqDiagramKind', () => {
  it('reads agentic loop from the user question', () => {
    assert.equal(
      inferSeqDiagramKind({
        nodes: [{ kind: 'service' }],
        edges: [],
        question: 'draw the agentic loop for our harness',
      }),
      'agent-workflow',
    );
  });

  it('detects agent-workflow from a cyclic control graph with an agent node', () => {
    assert.equal(
      inferSeqDiagramKind({
        nodes: [
          { id: 'a', kind: 'agent' },
          { id: 'b', kind: 'service' },
          { id: 'c', kind: 'service' },
        ],
        edges: [
          { from: 'a', to: 'b', family: 'control' },
          { from: 'b', to: 'c', family: 'control' },
          { from: 'c', to: 'a', family: 'control' },
        ],
      }),
      'agent-workflow',
    );
  });

  it('does not classify a cyclic business process as agent-workflow', () => {
    assert.equal(
      inferSeqDiagramKind({
        nodes: [
          { id: 'a', kind: 'service' },
          { id: 'b', kind: 'service' },
          { id: 'c', kind: 'service' },
        ],
        edges: [
          { from: 'a', to: 'b', family: 'http' },
          { from: 'b', to: 'c', family: 'http' },
          { from: 'c', to: 'a', family: 'http' },
        ],
      }),
      'service-flow',
    );
  });
});

describe('classifySeqDiagramLayout', () => {
  it('routes agent-workflow to top-down layered tree by default', () => {
    const profile = classifySeqDiagramLayout(
      doc({
        kind: 'agent-workflow',
        nodes: [
          { id: 'a', label: 'Orchestrator', kind: 'agent' },
          { id: 'b', label: 'Tools', kind: 'service' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b', family: 'control' }],
      }),
    );
    assert.equal(profile.engine, 'layered-flow');
    assert.equal(profile.direction, 'TD');
  });

  it('honors explicit circular-loop on agent-workflow when requested', () => {
    const profile = classifySeqDiagramLayout(
      doc({
        kind: 'agent-workflow',
        layout: { engine: 'circular-loop', direction: 'LR' },
        nodes: [
          { id: 'a', label: 'Orchestrator', kind: 'agent' },
          { id: 'b', label: 'Tools', kind: 'service' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b', family: 'control' }],
      }),
    );
    assert.equal(profile.engine, 'circular-loop');
  });

  it('routes service-flow to left-to-right layered by default', () => {
    const profile = classifySeqDiagramLayout(
      doc({
        nodes: [
          { id: 'a', label: 'A', kind: 'service' },
          { id: 'b', label: 'B', kind: 'service' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b', family: 'http' }],
      }),
    );
    assert.equal(profile.engine, 'layered-flow');
    assert.equal(profile.direction, 'LR');
  });

  it('routes process family service-flow to top-down tree', () => {
    const profile = classifySeqDiagramLayout(
      doc({
        meta: { diagramFamily: 'process' },
        nodes: [
          { id: 'a', label: 'A', kind: 'service' },
          { id: 'b', label: 'B', kind: 'service' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b', family: 'http' }],
      }),
    );
    assert.equal(profile.engine, 'layered-flow');
    assert.equal(profile.direction, 'TD');
  });

  it('honors explicit layout direction on the document', () => {
    const profile = classifySeqDiagramLayout(
      doc({
        layout: { engine: 'layered-flow', direction: 'TD' },
        nodes: [
          { id: 'a', label: 'A', kind: 'service' },
          { id: 'b', label: 'B', kind: 'service' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b', family: 'http' }],
      }),
    );
    assert.equal(profile.direction, 'TD');
    assert.match(profile.reason, /explicit/);
  });
});

describe('seqDiagramLayoutForKind', () => {
  it('maps package-map to grid + TD', () => {
    const layout = seqDiagramLayoutForKind('package-map', []);
    assert.equal(layout.direction, 'TD');
    assert.equal(layout.engine, 'grid');
  });
});
