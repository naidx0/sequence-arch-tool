import assert from 'node:assert';
import { describe, it } from 'node:test';

import { compileSeqDiagramToProgram, hashSeqDiagram } from './compileSeqDiagram.js';
import { validateProgram } from './program.js';
import type { SeqDiagramV1 } from './seqdiagram.js';

function agentWorkflowFixture(): SeqDiagramV1 {
  return {
    version: 1,
    kind: 'agent-workflow',
    title: 'Owner build loop',
    grounded: { graphId: 'shopfront', origin: 'design' },
    nodes: [
      {
        id: 'agent:orchestrator',
        label: 'Orchestrator',
        kind: 'agent',
        agent: { prompt: 'Coordinate the workflow and write scoutNotes.' },
      },
      {
        id: 'agent:planner',
        label: 'Planner',
        kind: 'agent',
        agent: { prompt: 'Plan the build steps grounded in the scan.' },
      },
      {
        id: 'agent:builder',
        label: 'Builder',
        kind: 'agent',
        agent: { prompt: 'Propose claimedNodeIds for implementation.', runtime: 'acp' },
      },
      {
        id: 'agent:verifier',
        label: 'Verifier',
        kind: 'agent',
        agent: { prompt: 'Verify the build against checker output.' },
      },
    ],
    edges: [
      { id: 'e1', from: 'agent:orchestrator', to: 'agent:planner', family: 'control' },
      { id: 'e2', from: 'agent:planner', to: 'agent:builder', family: 'control' },
      { id: 'e3', from: 'agent:builder', to: 'agent:verifier', family: 'control' },
      { id: 'e4', from: 'agent:verifier', to: 'agent:builder', family: 'control' },
    ],
  };
}

describe('compileSeqDiagramToProgram', () => {
  it('compiles agent-workflow Tier 2 to a valid program', () => {
    const doc = agentWorkflowFixture();
    const result = compileSeqDiagramToProgram(doc, { tier: 'standard' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.program.id, 'build-architecture');
    assert.equal(validateProgram(result.program).ok, true);
    assert.ok(result.program.nodes.length >= 4);
    assert.match(result.diagramHash, /^[0-9a-f]{8}$/);
  });

  it('uses diagram prompts in compiled scout/build agents', () => {
    const doc = agentWorkflowFixture();
    const result = compileSeqDiagramToProgram(doc, { tier: 'standard' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const scout = result.program.nodes.find((n) => n.id === 'scout');
    assert.ok(scout?.agent?.prompt.includes('Coordinate'));
    const build = result.program.nodes.find((n) => n.id === 'build');
    assert.ok(build?.agent?.prompt.includes('claimedNodeIds'));
    assert.equal(build?.agent?.runtime, 'acp');
  });

  it('rejects agent-workflow nodes missing prompts at validation', () => {
    const doc = agentWorkflowFixture();
    doc.nodes[0] = { id: 'bad', label: 'Bad', kind: 'agent' };
    const result = compileSeqDiagramToProgram(doc);
    assert.equal(result.ok, false);
  });

  it('hash is stable for the same diagram', () => {
    const doc = agentWorkflowFixture();
    assert.equal(hashSeqDiagram(doc), hashSeqDiagram(doc));
  });
});
