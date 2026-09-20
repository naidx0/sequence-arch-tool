import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANVAS_TOOL_NAMES,
  CANVAS_TOOL_SCHEMAS,
  canvasBlockTypeForTool,
  executeCanvasStoryRoute,
} from '../server/canvasTools.js';

test('canvas tools: closed set of five native writers', () => {
  assert.deepStrictEqual([...CANVAS_TOOL_NAMES], [
    'canvas.write_markdown',
    'canvas.write_mermaid',
    'canvas.write_html',
    'canvas.write_react',
    'canvas.write_svg',
  ]);
  for (const name of CANVAS_TOOL_NAMES) {
    assert.ok(CANVAS_TOOL_SCHEMAS[name], `${name} has a schema`);
    assert.ok(canvasBlockTypeForTool(name));
  }
});

test('canvas.set_story_route validates title and steps', () => {
  assert.deepStrictEqual(executeCanvasStoryRoute(undefined), {
    ok: false,
    evidence: 'refused: canvas.set_story_route missing "title"',
  });
  assert.deepStrictEqual(executeCanvasStoryRoute({ title: 'Tour', steps: [] }), {
    ok: false,
    evidence: 'refused: canvas.set_story_route needs at least one step',
  });
  const ok = executeCanvasStoryRoute({
    title: 'Deploy',
    steps: [{ blockId: 'b1', caption: 'Overview' }],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.storyRoute?.title, 'Deploy');
  assert.equal(ok.storyRoute?.steps[0]?.blockId, 'b1');
});
