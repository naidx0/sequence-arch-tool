import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { executeAskTool, parseFencedToolRequests } from '../server/askTools.js';
import { renderAskInstructionBelt } from '../server/askPipeline.js';
import { renderBoardToolHintSection } from '../server/boardTools.js';

/*
 * THE WIRING, NOT THE MODULE.
 *
 * `board-tools.test.ts` proves the writers are correct. This proves they can be
 * REACHED — that a `board.*` call arriving from a model is dispatched, executed
 * and answered, and that the model is told the tools exist.
 *
 * This repo keeps shipping the other kind: `canvas/proposal` with a complete
 * ghost layer and fourteen tests, dispatched by nothing; `SeqChartView` with no
 * caller; the whiteboard itself, with a camera and fifty frames of undo and no
 * way for an agent to touch it; and `WorkspaceFiles`, which shipped green
 * earlier today and could not be rendered. A module test proves the module,
 * never the mount.
 */

const KNOWN = {
  nodeIds: ['svc:api', 'db:orders'],
  items: [{ id: 'c1', at: { x: 0, y: 0 } }],
};

describe('a board writer can be reached through the real dispatcher', () => {
  it('draws a note with no repository — a sketch needs none', async () => {
    const r = await executeAskTool(
      'board.add_note',
      { id: 'n1', text: 'where does the cache go?', at: { x: 40, y: 20 } },
      { repoRoot: null, designMode: true } as never,
    );
    assert.equal(r.ok, true, r.evidence);
    assert.equal(r.boardItems?.length, 1);
    assert.equal(r.boardItems?.[0]?.id, 'n1');
  });

  it('draws a card against a REAL node, through the same door', async () => {
    const r = await executeAskTool(
      'board.add_card',
      { id: 'c2', nodeId: 'svc:api', label: 'API', at: { x: 200, y: 0 } },
      { repoRoot: null, designMode: true, boardKnown: KNOWN } as never,
    );
    assert.equal(r.ok, true, r.evidence);
    assert.equal(r.boardItems?.[0]?.id, 'c2');
  });

  it('REFUSES an invented node id, and the refusal reaches the caller', async () => {
    const r = await executeAskTool(
      'board.add_card',
      { id: 'c3', nodeId: 'svc:invented', label: 'Nope', at: { x: 0, y: 0 } },
      { repoRoot: null, designMode: true, boardKnown: KNOWN } as never,
    );
    assert.equal(r.ok, false);
    assert.match(r.evidence, /^refused: board\.add_card — /);
    assert.equal(r.boardItems, undefined);
  });

  it('with NO boardKnown a card is refused, not quietly allowed', async () => {
    /*
     * Absent grounding is not permissive. An empty node list means "nothing to
     * ground against", which is the honest reading of a client that told us
     * nothing — not "allow anything", which would make the ungrounded case the
     * one where every invented card lands.
     */
    const r = await executeAskTool(
      'board.add_card',
      { id: 'c4', nodeId: 'svc:api', label: 'API', at: { x: 0, y: 0 } },
      { repoRoot: null, designMode: true } as never,
    );
    assert.equal(r.ok, false);
  });

  it('connects two items that are already on the board', async () => {
    const r = await executeAskTool(
      'board.connect',
      { id: 'e1', fromId: 'c1', toId: 'c5' },
      {
        repoRoot: null,
        designMode: true,
        boardKnown: { nodeIds: [], items: [{ id: 'c1', at: { x: 0, y: 0 } }, { id: 'c5', at: { x: 100, y: 0 } }] },
      } as never,
    );
    assert.equal(r.ok, true, r.evidence);
  });
});

describe('board tool fences parse like canvas writers', () => {
  it('accepts board.add_card inside a sequence-tool fence', () => {
    const text =
      'Laying it out.\n\n```sequence-tool\n' +
      '{"id":"b1","name":"board.add_card","args":{"id":"c1","nodeId":"svc:api","label":"API","at":{"x":0,"y":0}}}\n' +
      '```\nDone.';
    const { requests, stripped } = parseFencedToolRequests(text);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.name, 'board.add_card');
    assert.ok(!stripped.includes('board.add_card'));
    assert.ok(stripped.includes('Laying it out.'));
  });
});

describe('the model is told the board exists', () => {
  it('the hint names all four writers and leads with the id rule', () => {
    const hint = renderBoardToolHintSection();
    for (const t of ['board.add_note', 'board.add_card', 'board.connect', 'board.frame']) {
      assert.ok(hint.includes(t), t);
    }
    // The rule a model gets wrong first, and the one that costs a whole round.
    assert.match(hint, /YOU CHOOSE EACH ITEM'S `id`/);
    // A card is a claim; a note is not. The two must never be interchangeable.
    assert.match(hint, /never reach for a card because you want the nicer shape/);
  });

  it('the belt carries it on the BOARD surface', () => {
    const belt = renderAskInstructionBelt({
      designMode: false,
      repoRoot: '/repo',
      question: 'lay this out',
      surface: { id: 'task-board' },
    } as never);
    assert.match(belt, /--- THE WHITEBOARD \(a spatial canvas you can draw on\) ---/);
  });

  it('and NOT on an ordinary chat turn — a belt that advertises an unseen surface is spent tokens', () => {
    const belt = renderAskInstructionBelt({
      designMode: false,
      repoRoot: '/repo',
      question: 'which files import scan.ts?',
    } as never);
    assert.doesNotMatch(belt, /THE WHITEBOARD/);
  });

  it('but DOES arrive when the question asks for a sketch from anywhere', () => {
    const belt = renderAskInstructionBelt({
      designMode: false,
      repoRoot: '/repo',
      question: 'sketch out how the ingest pipeline is shaped',
    } as never);
    assert.match(belt, /THE WHITEBOARD/);
  });
});
