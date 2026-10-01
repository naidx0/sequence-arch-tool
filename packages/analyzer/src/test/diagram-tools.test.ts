/**
 * diagram.* tools — SystemBoard IR → SeqDraw wire items.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { executeDiagramTool, isDiagramToolName } from '../server/diagramTools.js';
import { ASK_DISPATCHABLE_TOOLS, executeAskTool, isFencedAskToolName } from '../server/askTools.js';

describe('diagram tools', () => {
  it('names are dispatchable and fenced-parseable', () => {
    for (const name of ['diagram.upsert', 'diagram.layout', 'diagram.delete'] as const) {
      assert.equal(isDiagramToolName(name), true);
      assert.equal(isFencedAskToolName(name), true);
      assert.ok(ASK_DISPATCHABLE_TOOLS.includes(name));
    }
  });

  it('diagram.upsert materializes a 2-track board with stable ids', () => {
    const result = executeDiagramTool(
      'diagram.upsert',
      {
        title: 'Fan-out',
        layoutProfile: 'lane',
        nodes: [
          { id: 'a', role: 'component', track: 'search', label: 'API' },
          { id: 'b', role: 'store', track: 'search', label: 'Cache' },
          { id: 'c', role: 'runtime', track: 'coord', label: 'Worker' },
        ],
        edges: [{ id: 'e1', from: 'a', to: 'b', pin: 'P1' }],
        issues: [{ id: 'i1', priority: 'P1', title: 'Hot path' }],
      },
      { nodeIds: [], items: [] },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.items.length >= 5);
    assert.ok(result.items.some((i) => i.id === 'sb-title'));
    assert.ok(result.items.some((i) => i.id.startsWith('sb-track-')));
    assert.ok(result.items.some((i) => i.id === 'sb-node-a'));
    assert.ok(result.items.some((i) => i.id === 'sb-edge-e1'));
  });

  it('diagram.upsert refuses invented evidence.nodeId when known set provided', () => {
    const result = executeDiagramTool(
      'diagram.upsert',
      {
        layoutProfile: 'lane',
        nodes: [
          {
            id: 'a',
            role: 'component',
            label: 'Fake',
            evidence: { nodeId: 'svc:nope' },
          },
        ],
      },
      { nodeIds: ['svc:api'], items: [] },
    );
    assert.equal(result.ok, false);
  });

  it('diagram.delete removes known ids', () => {
    const result = executeDiagramTool(
      'diagram.delete',
      { ids: ['sb-node-a'] },
      { nodeIds: [], items: [{ id: 'sb-node-a', at: { x: 1, y: 2 } }] },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.removeIds, ['sb-node-a']);
  });

  it('respectPins keeps human at on re-upsert', () => {
    const first = executeDiagramTool(
      'diagram.upsert',
      {
        layoutProfile: 'lane',
        nodes: [{ id: 'a', role: 'note', track: 't', label: 'A' }],
      },
      { nodeIds: [], items: [] },
    );
    assert.ok(first.ok);
    if (!first.ok) return;
    const node = first.items.find((i) => i.id === 'sb-node-a');
    assert.ok(node && 'at' in node);
    const pinnedAt = { x: 900, y: 900 };
    const second = executeDiagramTool(
      'diagram.upsert',
      {
        layoutProfile: 'lane',
        nodes: [{ id: 'a', role: 'note', track: 't', label: 'A' }],
        respectPins: true,
      },
      { nodeIds: [], items: [{ id: 'sb-node-a', at: pinnedAt }] },
    );
    assert.ok(second.ok);
    if (!second.ok) return;
    const again = second.items.find((i) => i.id === 'sb-node-a');
    assert.ok(again && 'at' in again);
    assert.deepEqual(again.at, pinnedAt);
  });

  it('executeAskTool dispatches diagram.upsert', async () => {
    const result = await executeAskTool(
      'diagram.upsert',
      {
        layoutProfile: 'lane',
        nodes: [
          { id: 'a', role: 'component', track: 't1', label: 'X' },
          { id: 'b', role: 'action', track: 't2', label: 'Y' },
        ],
      },
      { repoRoot: null, designMode: true, boardKnown: { nodeIds: [], items: [] } } as never,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.boardItems && result.boardItems.length > 0);
  });
});
