import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAskSurface, renderAskSurfaceSection } from '../explain/askSurface.js';
import { executeCanvasWrite } from '../server/canvasTools.js';

/*
 * STAGE 3 of `docs/research/agent-drawing-and-teaching-visuals.md`: the agent
 * can SEE the canvas.
 *
 * The measured defect that doc records: "What Sequence does not have is the
 * READ half — the agent cannot see what is on the canvas, in any resolution,
 * ever." Five writers, zero readers, so every request to change a drawing
 * produced a second drawing.
 */

function surfaceOf(raw: unknown) {
  const parsed = parseAskSurface(raw);
  assert.ok(!('error' in parsed), JSON.stringify(parsed));
  return parsed.surface;
}

const TWO_BLOCKS = {
  id: 'ai-canvas',
  title: 'AI Canvas',
  canvas: {
    blocks: [
      { id: 'b1', type: 'mermaid', title: 'Request flow', chars: 240 },
      { id: 'b2', type: 'svg', title: 'Attention', chars: 4096, excerpt: '<svg\n  width="800">' },
    ],
  },
};

describe('the canvas read half — two resolutions, one honest id list', () => {
  it('a well-formed canvas parses, blurry plus one focused block', () => {
    const s = surfaceOf(TWO_BLOCKS);
    assert.equal(s?.canvas?.blocks.length, 2);
    assert.equal(s?.canvas?.blocks[0]?.excerpt, undefined);
    // The excerpt keeps its newlines — flattening them is what makes mermaid
    // source and SVG markup unreadable.
    assert.equal(s?.canvas?.blocks[1]?.excerpt, '<svg\n  width="800">');
  });

  it('the prompt lists every id and says only those ids exist', () => {
    const lines = renderAskSurfaceSection(surfaceOf(TWO_BLOCKS), false).join('\n');
    assert.match(lines, /--- ALREADY ON THE AI CANVAS ---/);
    assert.match(lines, /id `b1` · mermaid "Request flow" · 240 chars/);
    assert.match(lines, /id `b2` · svg "Attention" · 4096 chars/);
    assert.match(lines, /It begins:/);
    assert.match(lines, /`blockId` set to that block's id/);
    assert.match(lines, /any other id is refused/);
  });

  it('an EMPTY canvas adds nothing — a blank canvas is the default state', () => {
    const s = surfaceOf({ id: 'ai-canvas', canvas: { blocks: [] } });
    assert.equal(s?.canvas, undefined);
    const lines = renderAskSurfaceSection(s, false).join('\n');
    assert.doesNotMatch(lines, /ALREADY ON THE AI CANVAS/);
  });

  it('a request with no canvas at all is byte-identical to the old one', () => {
    const before = renderAskSurfaceSection(surfaceOf({ id: 'architecture' }), false).join('\n');
    assert.doesNotMatch(before, /ALREADY ON THE AI CANVAS/);
    assert.match(before, /--- WHAT THE USER IS LOOKING AT ---/);
  });

  it('a malformed canvas is a 400, never a silent drop', () => {
    const bad = parseAskSurface({ id: 'ai-canvas', canvas: { blocks: 'lots' } });
    assert.ok('error' in bad);
    const worse = parseAskSurface({ id: 'ai-canvas', canvas: [] });
    assert.ok('error' in worse);
  });

  it('a block with no usable id is dropped and COUNTED, never listed', () => {
    // An id is the handle a revision names back at us. Listing a block without
    // one would hand the model a handle that opens nothing.
    const s = surfaceOf({
      id: 'ai-canvas',
      canvas: {
        blocks: [
          { id: 'b1', type: 'svg', chars: 10 },
          { type: 'svg', chars: 10 },
          { id: 'b3', type: 'hologram', chars: 10 },
        ],
      },
    });
    assert.equal(s?.canvas?.blocks.length, 1);
    assert.equal(s?.canvas?.omitted, 2);
    const lines = renderAskSurfaceSection(s, false).join('\n');
    assert.match(lines, /\+2 more block\(s\) on the canvas, not listed here/);
  });

  it('the block list is capped, and the overflow is reported not hidden', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({
      id: `b${i}`,
      type: 'markdown',
      chars: 5,
    }));
    const s = surfaceOf({ id: 'ai-canvas', canvas: { blocks } });
    assert.equal(s?.canvas?.blocks.length, 24);
    assert.equal(s?.canvas?.omitted, 16);
  });
});

describe('the canvas write half — a revision names a real block', () => {
  it('a blockId on the list REPLACES that block, and says so', () => {
    const r = executeCanvasWrite(
      'canvas.write_svg',
      { content: '<svg/>', title: 'Attention', blockId: 'b2' },
      ['b1', 'b2'],
    );
    assert.equal(r.ok, true);
    assert.equal(r.block?.id, 'b2');
    assert.match(r.content ?? '', /^Replaced svg block on AI Canvas/);
  });

  it('a blockId NOT on the list is refused — never quietly appended', () => {
    // The failure this guards: a write that cannot find its target becomes an
    // append, so the user sees two diagrams and the model believes it edited
    // one. Same law as propose_topology refusing an invented node id.
    const r = executeCanvasWrite('canvas.write_svg', { content: '<svg/>', blockId: 'nope' }, [
      'b1',
    ]);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /not on the canvas/);
    assert.match(r.evidence, /Existing block ids: b1/);
    assert.equal(r.block, undefined);
  });

  it('with an empty canvas every blockId is refused, and the refusal says why', () => {
    const r = executeCanvasWrite('canvas.write_svg', { content: '<svg/>', blockId: 'b1' }, []);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /The canvas has no blocks — omit blockId to add one\./);
  });

  it('no blockId still appends, with the wording it always had', () => {
    const r = executeCanvasWrite('canvas.write_mermaid', { content: 'graph TD;' }, ['b1']);
    assert.equal(r.ok, true);
    assert.match(r.content ?? '', /^Wrote mermaid block to AI Canvas/);
    assert.notEqual(r.block?.id, 'b1');
  });
});
