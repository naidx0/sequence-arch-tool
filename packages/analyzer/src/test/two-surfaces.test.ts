import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AI_CANVAS_TOOL_DESCRIPTION,
  ASK_TOOL_ALLOWLIST,
  openaiAskToolDefinitions,
  renderCanvasToolHintSection,
} from '../server/askTools.js';

/*
 * TWO SURFACES, TWO JOBS — owner, 2026-09-22: the AI Canvas is free-form, the
 * Architecture board is grounded. The model reads that in the tool
 * descriptions or nowhere; photo 1 was "show me on the arch board" answered
 * by asking for a canvas block.
 */
test('the board tool says it is the grounded map, and sends everything else to the canvas', () => {
  const defs = openaiAskToolDefinitions([...ASK_TOOL_ALLOWLIST], { canvas: true });
  const topo = defs.find((d) => d.function.name === 'propose_topology');
  assert.ok(topo);
  assert.match(topo.function.description, /ARCHITECTURE BOARD/);
  assert.match(topo.function.description, /grounded/);
  assert.match(topo.function.description, /AI Canvas instead/);
});

test('every canvas writer says the canvas is free-form, and what it writes', () => {
  const defs = openaiAskToolDefinitions([...ASK_TOOL_ALLOWLIST], { canvas: true });
  const writers = defs.filter((d) => d.function.name.startsWith('canvas.write_'));
  assert.ok(writers.length >= 5, `found ${writers.length}`);
  for (const w of writers) {
    assert.ok(w.function.description.startsWith(AI_CANVAS_TOOL_DESCRIPTION), w.function.name);
    assert.match(w.function.description, /This one writes (?!a block\.)/, w.function.name);
  }
});

test('the canvas hint no longer tells the model not to use bold', () => {
  const hint = renderCanvasToolHintSection().join('\n');
  assert.doesNotMatch(hint, /asterisks/);
  assert.match(hint, /Two surfaces, two jobs/);
});

/*
 * THE PHOTO, 2026-09-22: "can you draw the plan visually as a diagram flow
 * chart maybe on the ai canvas please so i can just see how it looks" — drawn
 * with board.* as two specks and a stray line, then "Would you like me to draw
 * this on the AI Canvas?".
 */
const OWNER_DRAW_ASK =
  'can you draw the plan visually as a diagram flow chart maybe on the ai canvas please so i can just see how it flooks without actually doign anything and moving on those';

test('loose board marks are not offered for his flow-chart ask, and are where the whiteboard is meant', async () => {
  const { boardMarksFit } = await import('../server/askTools.js');
  assert.equal(boardMarksFit(OWNER_DRAW_ASK), false);
  assert.equal(boardMarksFit('draw a flowchart of the checkout'), false);
  assert.equal(boardMarksFit('sketch out how the ingest pipeline is shaped'), true, 'the earlier ruling stands');
  assert.equal(boardMarksFit('put sticky notes for each risk'), true);
  assert.equal(boardMarksFit('lay this out', 'task-board'), true);
  assert.equal(boardMarksFit('sketch it', 'ai-canvas'), false);
});

test('his ask gets the canvas writers and the drawing guidance, and no whiteboard section', async () => {
  const { renderAskInstructionBelt } = await import('../server/askPipeline.js');
  const belt = renderAskInstructionBelt({ designMode: false, repoRoot: '/repo', question: OWNER_DRAW_ASK } as never);
  assert.match(belt, /DRAWING SO A PERSON CAN READ IT/);
  assert.match(belt, /canvas\.write_mermaid/);
  assert.match(belt, /draw it in this turn/);
  assert.doesNotMatch(belt, /--- THE WHITEBOARD/);
  const supp = (await import('../server/askTools.js')).askOpenAiToolSupplemental({ teachTurn: false, question: OWNER_DRAW_ASK });
  assert.equal(supp?.canvas, true);
  assert.equal(supp?.board, undefined);
});
