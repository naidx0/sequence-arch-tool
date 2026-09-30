import { describe, expect, it } from 'vitest';

import { emptyScratchDoc } from '../canvas/localScratch';
import { fromBoardSeqd, toBoardSeqd, worthPersistingBoard } from './boardMemory';

describe('boardMemory', () => {
  it('round-trips agent-workflow with agent prompt packs', () => {
    const doc = {
      ...emptyScratchDoc('session-wf'),
      kind: 'agent-workflow' as const,
      nodes: [
        {
          id: 'agent:builder',
          label: 'Builder',
          kind: 'agent' as const,
          agent: { prompt: 'Build the scoped change.', scopeFiles: ['src/a.ts'] },
        },
        {
          id: 'agent:verifier',
          label: 'Verifier',
          kind: 'agent' as const,
          agent: { prompt: 'Verify against checker.' },
        },
      ],
      edges: [
        { id: 'e1', from: 'agent:builder', to: 'agent:verifier', family: 'control' as const },
      ],
    };
    const parsed = fromBoardSeqd(toBoardSeqd(doc));
    expect(parsed?.kind).toBe('agent-workflow');
    expect(parsed?.nodes).toHaveLength(2);
    expect(parsed?.nodes[0]?.agent?.prompt).toContain('Build');
  });

  it('round-trips a service-flow diagram', () => {
    const doc = {
      ...emptyScratchDoc('session-a'),
      nodes: [{ id: 'svc:orders', label: 'Orders', kind: 'service' as const }],
    };
    const parsed = fromBoardSeqd(toBoardSeqd(doc));
    expect(parsed?.nodes).toEqual(doc.nodes);
    expect(parsed?.grounded.graphId).toBe('scratch:session-a');
  });

  it('rejects corrupt or foreign shapes', () => {
    expect(fromBoardSeqd('not json')).toBeNull();
    expect(fromBoardSeqd(JSON.stringify({ version: 2 }))).toBeNull();
    expect(fromBoardSeqd(JSON.stringify({ version: 1, kind: 'package-map' }))).toBeNull();
  });

  it('worthPersistingBoard is true after edits or scratch content', () => {
    const empty = emptyScratchDoc('session-a');
    expect(worthPersistingBoard(empty, 0)).toBe(false);
    expect(worthPersistingBoard({ ...empty, nodes: [{ id: 'n', label: 'N', kind: 'service' }] }, 0)).toBe(
      true,
    );
    expect(worthPersistingBoard(empty, 1)).toBe(true);
  });
});
