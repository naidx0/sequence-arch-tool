import { describe, expect, it } from 'vitest';

import { compileSeqDiagramToProgram } from '@sequence/schema';

import { programNodeStatusForBoardNode, initBoardRunOverlay } from './workflowRunOverlay.js';

describe('workflowRunOverlay', () => {
  it('maps program node ids to board node status', () => {
    initBoardRunOverlay({
      runId: 'run-1',
      programId: 'build-architecture',
      nodeIds: ['scout', 'wf:agent:builder'],
    });
    const status = programNodeStatusForBoardNode('agent:builder', {
      runId: 'run-1',
      programId: 'build-architecture',
      startedAt: Date.now(),
      elapsedMs: 0,
      status: 'running',
      nodeStatus: { 'wf:agent:builder': 'running' },
      activeEdgeId: null,
      lastEventSeq: 1,
    });
    expect(status).toBe('running');
  });
});

describe('workflow compile from board', () => {
  it('blocks launch when agent prompt is empty', () => {
    const result = compileSeqDiagramToProgram({
      version: 1,
      kind: 'agent-workflow',
      title: 't',
      grounded: { graphId: 'g' },
      nodes: [{ id: 'a', label: 'A', kind: 'agent' }],
      edges: [],
    });
    expect(result.ok).toBe(false);
  });
});
