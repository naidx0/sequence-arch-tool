import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BOARD_LABEL_ID_SUFFIX,
  BOARD_TOOL_NAMES,
  MAX_BOARD_COORD,
  MAX_BOARD_ID_CHARS,
  MAX_BOARD_ITEMS,
  MAX_LABEL_CHARS,
  MAX_NOTE_CHARS,
  MIN_FRAME_SIZE,
  executeBoardTool,
  isBoardToolName,
  validateAddCard,
  validateAddNote,
  validateConnect,
  validateFrame,
  type BoardKnown,
  type BoardWriteResult,
} from '../server/boardTools.js';

/*
 * THE AGENT'S HALF OF THE CODE CANVAS.
 *
 * `docs/research/code-canvas-program.md` §0: the whiteboard has had a camera, a
 * document, an edit vocabulary and fifty frames of undo since it was written,
 * and nothing in `packages/analyzer/` could draw on it. These four writers are
 * that half, and the rules below are what keeps a sketch surface from becoming
 * a place where invented structure looks like a finding.
 */

/** A small scanned graph, in the id shape the walker actually emits. */
const NODES = [
  'file:packages/analyzer/src/server/askPipeline.ts',
  'file:packages/analyzer/src/server/askTools.ts',
  'file:packages/web2/src/whiteboard/Whiteboard.tsx',
];

/** A board with two things already drawn, positioned, the way the read half reports it. */
const BOARD: BoardKnown = {
  nodeIds: NODES,
  items: [
    { id: 'pipeline', at: { x: 100, y: 100 } },
    { id: 'tools', at: { x: 400, y: 100 } },
  ],
};

/** An empty board on an attached repo — nothing drawn, grounding available. */
const BLANK: BoardKnown = { nodeIds: NODES, items: [] };

function reasonOf(r: BoardWriteResult): string {
  return r.ok ? '' : r.reason;
}

describe('board.add_note — the one writer that needs no grounding', () => {
  it('puts free text at a point', () => {
    const r = validateAddNote({ id: 'n1', text: 'retry budget lives here', at: { x: 10, y: 20 } }, BLANK);
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && r.items, [
      { kind: 'text', id: 'n1', at: { x: 10, y: 20 }, text: 'retry budget lives here' },
    ]);
    // The model is told the id back, because that is the only way it can connect to this later.
    assert.match(r.ok ? r.content : '', /Use id "n1" to connect to it/);
  });

  it('a note may say anything — it is a sketch mark and claims nothing', () => {
    // `whiteboardModel.ts`: "a surface where nothing is a measured claim". A note
    // naming a service that does not exist is legal here precisely because a
    // WbText has no node id and cannot be mistaken for a finding.
    const r = validateAddNote({ id: 'n1', text: 'maybe a queue between these?', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, true, reasonOf(r));
  });

  it('refuses empty text — an invisible item that still answers hit tests', () => {
    const r = validateAddNote({ id: 'n1', text: '   ', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /needs non-empty "text"/);
  });

  it('refuses an over-length note rather than truncating it', () => {
    // SVG <text> does not wrap and `estimatedTextWidth` measures the whole
    // string as one line, so a long note makes the whole board unfittable.
    const r = validateAddNote(
      { id: 'n1', text: 'x'.repeat(MAX_NOTE_CHARS + 1), at: { x: 0, y: 0 } },
      BLANK,
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), new RegExp(`at most ${MAX_NOTE_CHARS}`));
  });

  it('refuses a missing, non-finite or runaway position', () => {
    // NaN propagates through `whiteboardBounds`' Math.min/max and breaks Fit for
    // every item on the board, including the ones drawn before this call.
    for (const at of [undefined, { x: 0 }, { x: Number.NaN, y: 0 }, { x: Infinity, y: 0 }, { x: MAX_BOARD_COORD + 1, y: 0 }]) {
      const r = validateAddNote({ id: 'n1', text: 'hi', at }, BLANK);
      assert.equal(r.ok, false, JSON.stringify(at));
      assert.match(reasonOf(r), /"at" must be/);
    }
  });

  it('refuses an id that is already on the board — these writers only ADD', () => {
    // Two items with one id would make `wb/move`, `wb/text` and `wb/delete` hit
    // whichever came first, leaving the other permanently unreachable.
    const r = validateAddNote({ id: 'pipeline', text: 'hi', at: { x: 0, y: 0 } }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /already on the board/);
    assert.match(reasonOf(r), /only ADD/);
  });

  it('refuses a missing id and says why the model has to choose it', () => {
    const r = validateAddNote({ text: 'hi', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /needs a short "id" that YOU choose/);
  });

  it('refuses an id in the reserved caption namespace', () => {
    const r = validateAddNote({ id: `mine${BOARD_LABEL_ID_SUFFIX}`, text: 'hi', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /reserved for the label/);
  });

  it('refuses a payload that is not an object at all', () => {
    for (const raw of [undefined, null, 'note', 42, ['a']]) {
      const r = validateAddNote(raw, BLANK);
      assert.equal(r.ok, false, JSON.stringify(raw));
      assert.match(reasonOf(r), /expected an object/);
    }
  });
});

describe('board.add_card — grounded or refused, never demoted', () => {
  it('produces a noderef pointing at a real scanned node', () => {
    const r = validateAddCard(
      { id: 'c1', nodeId: NODES[0], label: 'ask pipeline', at: { x: 50, y: 60 } },
      BOARD,
    );
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && r.items, [
      { kind: 'noderef', id: 'c1', at: { x: 50, y: 60 }, nodeId: NODES[0], label: 'ask pipeline' },
    ]);
  });

  it('REFUSES THE WHOLE CALL for an invented nodeId, and emits nothing', () => {
    // §3 of the program: one invented id voids the whole call, because a
    // half-applied board edit is a board the reader cannot trust — nothing on it
    // marks which half arrived.
    const r = validateAddCard(
      { id: 'c1', nodeId: 'file:src/services/AuthService.ts', label: 'auth', at: { x: 0, y: 0 } },
      BOARD,
    );
    assert.equal(r.ok, false);
    assert.ok(!('items' in r), 'a refusal carries no items at all — not even a good half');
    assert.match(reasonOf(r), /is not a node in this repository/);
    assert.match(reasonOf(r), /may not invent code/);
  });

  it('offers near misses so the next round can fix itself', () => {
    // A repository has thousands of nodes so the refusal cannot list them all,
    // and the common failure is a bare filename where the graph uses a path.
    const r = validateAddCard(
      { id: 'c1', nodeId: 'askTools.ts', label: 'tools', at: { x: 0, y: 0 } },
      BOARD,
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /Did you mean: file:packages\/analyzer\/src\/server\/askTools\.ts/);
  });

  it('a card with no nodeId is REFUSED, never quietly written as a note', () => {
    // The worst outcome available: the model reports it put the service on the
    // board, and the reader sees a sketch mark. The two surfaces exist to keep
    // "claims to be code" and "claims nothing" visually distinct.
    const r = validateAddCard({ id: 'c1', label: 'auth', at: { x: 0, y: 0 } }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /call board\.add_note instead/);
    assert.match(reasonOf(r), /never silently turned into a note/);
  });

  it('refuses every card when no graph is attached, and blames the missing scan', () => {
    // Design mode is handed no graph. A permissive empty set would make that the
    // one mode where every invented card is accepted.
    const r = validateAddCard(
      { id: 'c1', nodeId: NODES[0], label: 'pipeline', at: { x: 0, y: 0 } },
      { nodeIds: [], items: [] },
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /no scanned graph is attached/);
  });

  it('refuses an empty label — the board would show a raw path', () => {
    const r = validateAddCard({ id: 'c1', nodeId: NODES[0], label: '', at: { x: 0, y: 0 } }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /needs a "label" a person can read/);
  });

  it('refuses an over-length label instead of cutting it', () => {
    // A cut caption on a card that claims to be code names a different file.
    const r = validateAddCard(
      { id: 'c1', nodeId: NODES[0], label: 'l'.repeat(MAX_LABEL_CHARS + 1), at: { x: 0, y: 0 } },
      BOARD,
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /names a different file/);
  });
});

describe('board.connect — both endpoints, or neither', () => {
  it('draws a directed arrow between two items already on the board', () => {
    const r = validateConnect({ id: 'e1', fromId: 'pipeline', toId: 'tools' }, BOARD);
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && r.items, [
      {
        kind: 'shape',
        id: 'e1',
        shape: 'arrow',
        from: { x: 100, y: 100 },
        to: { x: 400, y: 100 },
      },
    ]);
  });

  it('directed:false draws a plain line', () => {
    const r = validateConnect({ id: 'e1', fromId: 'pipeline', toId: 'tools', directed: false }, BOARD);
    assert.equal(r.ok, true, reasonOf(r));
    assert.equal(r.ok && r.items[0]?.kind === 'shape' && r.items[0].shape, 'line');
  });

  it('a label becomes a second item at the midpoint, with a derived id', () => {
    const r = validateConnect({ id: 'e1', fromId: 'pipeline', toId: 'tools', label: 'calls' }, BOARD);
    assert.equal(r.ok, true, reasonOf(r));
    assert.equal(r.ok && r.items.length, 2);
    assert.deepEqual(r.ok && r.items[1], {
      kind: 'text',
      id: `e1${BOARD_LABEL_ID_SUFFIX}`,
      at: { x: 250, y: 100 },
      text: 'calls',
    });
  });

  it('REFUSES THE WHOLE CALL for an unknown endpoint, and lists the real ids', () => {
    // Drawing the half that resolved would leave a line pointing into empty
    // space, which reads as a relationship to something the reader cannot see.
    const r = validateConnect({ id: 'e1', fromId: 'pipeline', toId: 'cache' }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /toId "cache" is not an item on the board/);
    assert.match(reasonOf(r), /The items are: pipeline, tools\./);
  });

  it('says to draw first when the board is empty', () => {
    const r = validateConnect({ id: 'e1', fromId: 'a', toId: 'b' }, BLANK);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /Nothing is drawn yet/);
  });

  it('refuses an item to itself — a zero-length arrow is invisible', () => {
    const r = validateConnect({ id: 'e1', fromId: 'pipeline', toId: 'pipeline' }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /zero length/);
  });

  it('refuses an endpoint the board gave no position for', () => {
    // The read half omits `at` for items that have no single point — a freehand
    // stroke. An arrow to one has nowhere to land, and anchoring it at the
    // origin would put it in a corner nobody is looking at.
    const r = validateConnect(
      { id: 'e1', fromId: 'pipeline', toId: 'ink' },
      { ...BOARD, items: [...BOARD.items, { id: 'ink' }] },
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /has no position on the board/);
  });

  it('refuses two items stacked at the same point', () => {
    const r = validateConnect(
      { id: 'e1', fromId: 'a', toId: 'b' },
      { nodeIds: NODES, items: [{ id: 'a', at: { x: 5, y: 5 } }, { id: 'b', at: { x: 5, y: 5 } }] },
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /sit at the same point/);
  });

  it('refuses missing endpoints and a non-boolean "directed"', () => {
    assert.match(reasonOf(validateConnect({ id: 'e1', fromId: 'pipeline' }, BOARD)), /needs "fromId" and "toId"/);
    assert.match(
      reasonOf(validateConnect({ id: 'e1', fromId: 'pipeline', toId: 'tools', directed: 'yes' }, BOARD)),
      /"directed" must be true or false/,
    );
  });
});

describe('board.frame — a labelled region', () => {
  it('produces the rectangle and a caption above its top-left corner', () => {
    const r = validateFrame(
      { id: 'f1', label: 'ask loop', from: { x: 80, y: 80 }, to: { x: 480, y: 220 } },
      BOARD,
    );
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && r.items, [
      { kind: 'shape', id: 'f1', shape: 'rect', from: { x: 80, y: 80 }, to: { x: 480, y: 220 } },
      { kind: 'text', id: `f1${BOARD_LABEL_ID_SUFFIX}`, at: { x: 84, y: 76 }, text: 'ask loop' },
    ]);
  });

  it('places the caption from the top-left whichever way the corners were given', () => {
    // The corners are "two opposite corners", not "top-left then bottom-right",
    // and `whiteboardBounds` does not care — but the caption has to.
    const r = validateFrame(
      { id: 'f1', label: 'ask loop', from: { x: 480, y: 220 }, to: { x: 80, y: 80 } },
      BOARD,
    );
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && r.items[1]?.kind === 'text' && r.items[1].at, { x: 84, y: 76 });
  });

  it('refuses a frame with no area — that is a line wearing a label', () => {
    for (const to of [{ x: 80, y: 80 }, { x: 480, y: 80 + MIN_FRAME_SIZE - 1 }]) {
      const r = validateFrame({ id: 'f1', label: 'x', from: { x: 80, y: 80 }, to }, BOARD);
      assert.equal(r.ok, false, JSON.stringify(to));
      assert.match(reasonOf(r), /A frame with no area is a line/);
    }
  });

  it('refuses an unlabelled frame', () => {
    const r = validateFrame({ id: 'f1', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /belong together without saying why/);
  });

  it('refuses corners that are not points', () => {
    const r = validateFrame({ id: 'f1', label: 'x', from: { x: 0, y: 0 }, to: null }, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /"from" and "to" must each be/);
  });

  it('refuses when an orphaned caption already holds the derived id', () => {
    // Deleting a frame's rectangle can leave `f1:label` behind; reusing "f1"
    // would then put two items under one id and make one unreachable.
    const r = validateFrame(
      { id: 'f1', label: 'x', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } },
      { nodeIds: NODES, items: [{ id: `f1${BOARD_LABEL_ID_SUFFIX}`, at: { x: 0, y: 0 } }] },
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /already on the board/);
  });
});

describe('the caps', () => {
  it('refuses a call that would push the board past its limit', () => {
    const full: BoardKnown = {
      nodeIds: NODES,
      items: Array.from({ length: MAX_BOARD_ITEMS }, (_, i) => ({ id: `i${i}`, at: { x: i, y: 0 } })),
    };
    const r = validateAddNote({ id: 'one-more', text: 'hi', at: { x: 0, y: 0 } }, full);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), new RegExp(`limit is ${MAX_BOARD_ITEMS}`));
    assert.match(reasonOf(r), /Say what should be removed/);
  });

  it('counts the items the read half hid, so the cap does not lie on a big board', () => {
    // `askSurface.ts` caps the prompt at forty items and reports the rest as a
    // count. A cap that only saw forty would let a 3000-item board keep growing.
    const r = validateAddNote(
      { id: 'one-more', text: 'hi', at: { x: 0, y: 0 } },
      { nodeIds: NODES, items: [{ id: 'a', at: { x: 0, y: 0 } }], omitted: MAX_BOARD_ITEMS },
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), new RegExp(`already holds ${MAX_BOARD_ITEMS + 1} items`));
  });

  it('a frame is two items, so it is refused one slot earlier than a note', () => {
    const nearFull: BoardKnown = {
      nodeIds: NODES,
      items: Array.from({ length: MAX_BOARD_ITEMS - 1 }, (_, i) => ({ id: `i${i}`, at: { x: i, y: 0 } })),
    };
    assert.equal(validateAddNote({ id: 'n', text: 'hi', at: { x: 0, y: 0 } }, nearFull).ok, true);
    assert.equal(
      validateFrame({ id: 'f', label: 'x', from: { x: 0, y: 0 }, to: { x: 99, y: 99 } }, nearFull).ok,
      false,
    );
  });

  it('refuses an over-length id', () => {
    const r = validateAddNote(
      { id: 'x'.repeat(MAX_BOARD_ID_CHARS + 1), text: 'hi', at: { x: 0, y: 0 } },
      BLANK,
    );
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), new RegExp(`at most ${MAX_BOARD_ID_CHARS}`));
  });

  it('NO writer can emit more than two items, whatever it is handed', () => {
    // The structural cap behind `MAX_BOARD_ITEMS`: one call is one or two marks,
    // so no single tool round can flood the board.
    const calls: Array<[string, unknown]> = [
      ['board.add_note', { id: 'a', text: 'hi', at: { x: 0, y: 0 } }],
      ['board.add_card', { id: 'b', nodeId: NODES[0], label: 'p', at: { x: 0, y: 0 } }],
      ['board.connect', { id: 'c', fromId: 'pipeline', toId: 'tools', label: 'calls' }],
      ['board.frame', { id: 'd', label: 'g', from: { x: 0, y: 0 }, to: { x: 99, y: 99 } }],
    ];
    for (const [name, args] of calls) {
      const r = executeBoardTool(name, args, BOARD);
      assert.equal(r.ok, true, `${name}: ${reasonOf(r)}`);
      assert.ok(r.ok && r.items.length <= 2, name);
    }
  });
});

describe('model-supplied text cannot break the item shape', () => {
  it('extra keys in the payload never reach the item', () => {
    // Built field by field, never spread: a "note" that arrives as a noderef
    // claiming a file would be an invented citation with a writer's blessing.
    const r = validateAddNote(
      {
        id: 'n1',
        text: 'hi',
        at: { x: 0, y: 0 },
        kind: 'noderef',
        nodeId: 'file:invented.ts',
        label: 'auth',
        points: [{ x: 0, y: 0 }],
        evidence: 'trust me',
      },
      BLANK,
    );
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && Object.keys(r.items[0] ?? {}).sort(), ['at', 'id', 'kind', 'text']);
    assert.equal(r.ok && r.items[0]?.kind, 'text');
  });

  it('a card carries the nodeId that was CHECKED, not a second one in the payload', () => {
    const r = validateAddCard(
      { id: 'c1', nodeId: NODES[1], label: 'tools', at: { x: 0, y: 0 }, kind: 'text', text: 'x' },
      BOARD,
    );
    assert.equal(r.ok, true, reasonOf(r));
    assert.deepEqual(r.ok && Object.keys(r.items[0] ?? {}).sort(), ['at', 'id', 'kind', 'label', 'nodeId']);
    assert.equal(r.ok && r.items[0]?.kind === 'noderef' && r.items[0].nodeId, NODES[1]);
  });

  it('newlines collapse — SVG text does not wrap and Fit measures one line', () => {
    const r = validateAddNote({ id: 'n1', text: 'one\n\ntwo\tthree', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, true, reasonOf(r));
    assert.equal(r.ok && r.items[0]?.kind === 'text' && r.items[0].text, 'one two three');
  });

  it('a bidi override cannot make a card display a file it does not point at', () => {
    // U+202E renders the rest of the run right-to-left. On the one surface where
    // a caption is a claim about real code, that is a forgery.
    const r = validateAddCard(
      { id: 'c1', nodeId: NODES[1], label: 'st\u202egpj.eruces', at: { x: 0, y: 0 } },
      BOARD,
    );
    assert.equal(r.ok, true, reasonOf(r));
    const label = r.ok && r.items[0]?.kind === 'noderef' ? r.items[0].label : '';
    assert.ok(!label.includes('\u202e'), label);
  });

  it('zero-width characters become a space rather than vanishing', () => {
    // Deleting them would let `fi<U+200B>le.ts` render as `file.ts` while being a
    // different string — a caption that reads as a file it is not.
    const r = validateAddNote({ id: 'n1', text: 'fi\u200ble.ts', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, true, reasonOf(r));
    assert.equal(r.ok && r.items[0]?.kind === 'text' && r.items[0].text, 'fi le.ts');
  });

  it('a control character in an id does not survive into the document', () => {
    const r = validateAddNote({ id: 'n\u00001', text: 'hi', at: { x: 0, y: 0 } }, BLANK);
    assert.equal(r.ok, true, reasonOf(r));
    assert.equal(r.ok && r.items[0]?.id, 'n 1');
  });
});

describe('the dispatch', () => {
  it('names exactly the four writers', () => {
    assert.deepEqual([...BOARD_TOOL_NAMES], [
      'board.add_note',
      'board.add_card',
      'board.connect',
      'board.frame',
    ]);
    for (const n of BOARD_TOOL_NAMES) assert.ok(isBoardToolName(n));
    assert.ok(!isBoardToolName('board.add_stroke'));
    assert.ok(!isBoardToolName('canvas.write_markdown'));
  });

  it('an unknown name refuses in the same voice rather than throwing', () => {
    const r = executeBoardTool('board.draw_everything', {}, BOARD);
    assert.equal(r.ok, false);
    assert.match(reasonOf(r), /not a board writer/);
    assert.match(reasonOf(r), /board\.add_note, board\.add_card, board\.connect, board\.frame/);
  });

  it('every refusal carries the ledger prefix the ask loop already uses', () => {
    const r = executeBoardTool('board.add_card', { id: 'c', nodeId: 'nope', label: 'x', at: { x: 0, y: 0 } }, BOARD);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.evidence, /^refused: board\.add_card — /);
  });

  it('there is no writer for freehand — a stroke is the human\'s mark', () => {
    // A model emitting a point path draws a pile, and a stroke carries no words,
    // so the read half could not tell the next turn what it drew.
    assert.ok(!BOARD_TOOL_NAMES.some((n) => /stroke|draw|ink/.test(n)));
  });
});

describe('the restated item types still match the document they are written into', () => {
  /*
   * `boardTools.ts` restates `WbText`, `WbShape` and `WbNodeRef` rather than
   * importing them, because `@sequence/analyzer` does not depend on the browser
   * package. The cost of a restatement is silent drift, and the failure mode is
   * ugly: a card would reach the client and be dropped by `readWhiteboard`'s
   * unknown-shape filter with nothing in the log. So read the real file.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const modelPath = path.resolve(here, '../../../web2/src/whiteboard/whiteboardModel.ts');
  const source = readFileSync(modelPath, 'utf8');

  it('declares every field and literal the writers emit', () => {
    for (const declaration of [
      "kind: 'text';",
      "kind: 'shape';",
      "kind: 'noderef';",
      "shape: 'rect' | 'ellipse' | 'line' | 'arrow';",
      'at: Point;',
      'from: Point;',
      'to: Point;',
      'text: string;',
      'nodeId: string;',
      'label: string;',
    ]) {
      assert.ok(source.includes(declaration), `whiteboardModel.ts no longer declares \`${declaration}\``);
    }
  });

  it('still has no evidence field anywhere on an item', () => {
    // The two-surface law: nothing drawn here ever becomes a graph node, which
    // is enforced in the types. If that ever changes, these writers are wrong.
    assert.ok(!/\bevidence\??:/.test(source), 'a WbItem gained an evidence field');
  });
});
