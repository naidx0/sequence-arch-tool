import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { executeCanvasWrite, isCanvasToolName } from '../server/canvasTools.js';
import { executeAskTool } from '../server/askTools.js';

describe('canvas write tools', () => {
  it('isCanvasToolName recognises the closed set', () => {
    assert.equal(isCanvasToolName('canvas.write_markdown'), true);
    assert.equal(isCanvasToolName('read_file'), false);
  });

  it('executeCanvasWrite returns a block with content', () => {
    const r = executeCanvasWrite('canvas.write_mermaid', {
      title: 'Flow',
      content: 'graph LR; A-->B;',
    });
    assert.equal(r.ok, true);
    assert.equal(r.block?.type, 'mermaid');
    assert.equal(r.block?.title, 'Flow');
  });

  it('executeAskTool runs canvas writer when enabled without a repo', async () => {
    const r = await executeAskTool(
      'canvas.write_markdown',
      { content: '# Plan\n\nStep 1.' },
      {
        resolveReadable: () => null,
        repoRoot: null,
        designMode: true,
        canvasToolsEnabled: true,
      },
    );
    assert.equal(r.ok, true);
    assert.equal(r.canvasBlock?.type, 'markdown');
  });

  it('executeAskTool refuses canvas writer when not enabled', async () => {
    const r = await executeAskTool(
      'canvas.write_markdown',
      { content: 'nope' },
      {
        resolveReadable: () => null,
        repoRoot: '/tmp',
        designMode: false,
        canvasToolsEnabled: false,
      },
    );
    assert.equal(r.ok, false);
    assert.match(r.evidence, /not active/);
  });
});
