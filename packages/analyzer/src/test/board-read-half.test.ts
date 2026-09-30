import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAskSurface, renderAskSurfaceSection } from '../explain/askSurface.js';

/*
 * THE WHITEBOARD'S READ HALF — `docs/research/code-canvas-program.md` item 1.3.
 *
 * The same hole the AI Canvas had until this week, on the other spatial
 * surface. `packages/web2/src/whiteboard/` has had a camera, a document, an
 * edit vocabulary and fifty frames of undo since it was written, and a grep for
 * it across `packages/analyzer/` returned two comment mentions and no code: the
 * agent could not see the board, so it could not draw on it either.
 */

function surfaceOf(raw: unknown) {
  const parsed = parseAskSurface(raw);
  assert.ok(!('error' in parsed), JSON.stringify(parsed));
  return parsed.surface;
}

const BOARD = {
  id: 'task-board',
  title: 'Whiteboard',
  board: {
    items: [
      { id: 'i1', kind: 'text', label: 'cache?', at: { x: 120.4, y: -40.8 } },
      { id: 'i2', kind: 'noderef', label: 'api', at: { x: 300, y: 12 }, nodeId: 'svc:api' },
      { id: 'i3', kind: 'stroke' },
    ],
  },
};

describe('the agent can see what is on the whiteboard', () => {
  it('parses items, and ROUNDS their positions', () => {
    const s = surfaceOf(BOARD);
    assert.equal(s?.board?.items.length, 3);
    // Sub-pixel precision on a board coordinate is noise in a prompt, and six
    // decimals per item is real tokens for no meaning.
    assert.deepEqual(s?.board?.items[0]?.at, { x: 120, y: -41 });
  });

  it('carries the nodeId only where the item stands for real code', () => {
    const s = surfaceOf(BOARD);
    assert.equal(s?.board?.items[1]?.nodeId, 'svc:api');
    assert.equal(s?.board?.items[0]?.nodeId, undefined);
  });

  it('a stroke has no words, and is not given any', () => {
    const s = surfaceOf(BOARD);
    assert.equal(s?.board?.items[2]?.kind, 'stroke');
    assert.equal(s?.board?.items[2]?.label, undefined);
  });

  it('the prompt lists ids WITH positions, and says only those ids exist', () => {
    const lines = renderAskSurfaceSection(surfaceOf(BOARD), false).join('\n');
    assert.match(lines, /--- ALREADY ON THE WHITEBOARD ---/);
    assert.match(lines, /id `i1` · text "cache\?" at \(120, -41\)/);
    assert.match(lines, /id `i2` · noderef "api" at \(300, 12\) → node `svc:api`/);
    // Position is the point of this surface: an agent that knows what exists
    // but not where it sits draws a pile at the origin.
    assert.match(lines, /place ?\n?.*new items in free space NEAR/s);
    assert.match(lines, /Any id not listed above is refused/);
    // A sketch must never read as a claim about the repository.
    assert.match(lines, /a sketch and claims nothing about/);
  });

  it('an EMPTY board adds nothing — blank is the default state', () => {
    const s = surfaceOf({ id: 'task-board', board: { items: [] } });
    assert.equal(s?.board, undefined);
    assert.doesNotMatch(renderAskSurfaceSection(s, false).join('\n'), /WHITEBOARD/);
  });

  it('a request with no board is byte-identical to the old one', () => {
    const before = renderAskSurfaceSection(surfaceOf({ id: 'architecture' }), false).join('\n');
    assert.doesNotMatch(before, /ALREADY ON THE WHITEBOARD/);
    assert.match(before, /--- WHAT THE USER IS LOOKING AT ---/);
  });

  it('a malformed board is a 400, never a silent drop', () => {
    assert.ok('error' in parseAskSurface({ id: 'task-board', board: { items: 'many' } }));
    assert.ok('error' in parseAskSurface({ id: 'task-board', board: [] }));
  });

  it('an item with no usable id is dropped and COUNTED', () => {
    /*
     * Sharper here than on the canvas: an id on this surface is not only an
     * edit target, it is a CONNECTION endpoint. Listing an item under an id
     * that does not exist would manufacture a refusal the model cannot
     * diagnose.
     */
    const s = surfaceOf({
      id: 'task-board',
      board: {
        items: [
          { id: 'ok', kind: 'text', label: 'a' },
          { kind: 'text', label: 'no id' },
          { id: 'bad-kind', kind: 'hologram' },
        ],
      },
    });
    assert.equal(s?.board?.items.length, 1);
    assert.equal(s?.board?.omitted, 2);
    assert.match(
      renderAskSurfaceSection(s, false).join('\n'),
      /\+2 more item\(s\) on the board, not listed here/,
    );
  });

  it('caps the list and reports the overflow', () => {
    const items = Array.from({ length: 55 }, (_, i) => ({ id: `i${i}`, kind: 'text', label: 'x' }));
    const s = surfaceOf({ id: 'task-board', board: { items } });
    assert.equal(s?.board?.items.length, 40);
    assert.equal(s?.board?.omitted, 15);
  });

  it('the canvas and the board are independent — one does not imply the other', () => {
    const both = surfaceOf({
      id: 'task-board',
      board: { items: [{ id: 'i1', kind: 'text', label: 'a' }] },
      canvas: { blocks: [{ id: 'b1', type: 'svg', chars: 10 }] },
    });
    const lines = renderAskSurfaceSection(both, false).join('\n');
    assert.match(lines, /ALREADY ON THE WHITEBOARD/);
    assert.match(lines, /ALREADY ON THE AI CANVAS/);
  });
});
