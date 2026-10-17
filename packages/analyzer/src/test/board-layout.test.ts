import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BOX_EM,
  BOX_LINE,
  BOX_PAD_X,
  BOX_PAD_Y,
  measureText,
  newBoardTurn,
  wrapText,
} from '../server/boardLayout.js';
import { executeAskTool } from '../server/askTools.js';
import { executeBoardTool, type BoardItem, type BoardKnown } from '../server/boardTools.js';

/*
 * "I asked it to draw the agentic loop and it is mumbo jumbo." (owner)
 *
 * The fixture below is what a model actually sends for that request: five
 * notes at coordinates it invented, so they overlap, with one label long enough
 * to run out of any box. The board writers must turn it into a diagram.
 */

type Call = [string, Record<string, unknown>];

const AGENTIC_LOOP: Call[] = [
  ['board.add_note', { id: 'prompt', text: 'User prompt', at: { x: 0, y: 0 } }],
  ['board.add_note', { id: 'model', text: 'Model', at: { x: 20, y: 10 } }],
  ['board.add_note', { id: 'tool', text: 'Tool call', at: { x: 10, y: 30 } }],
  ['board.add_note', { id: 'result', text: 'Tool result (stdout, files, errors, anything else the tool returned)', at: { x: 5, y: 20 } }],
  ['board.add_note', { id: 'answer', text: 'Answer', at: { x: 30, y: 5 } }],
  ['board.connect', { id: 'e1', fromId: 'prompt', toId: 'model' }],
  ['board.connect', { id: 'e2', fromId: 'model', toId: 'tool', label: 'needs a tool' }],
  ['board.connect', { id: 'e3', fromId: 'tool', toId: 'result' }],
  ['board.connect', { id: 'e4', fromId: 'result', toId: 'model', label: 'loop' }],
  ['board.connect', { id: 'e5', fromId: 'model', toId: 'answer', label: 'done' }],
];

/** What the client holds after the stream: removals applied, then appends, in order. */
function runTurn(calls: Call[], withLayout: boolean, flowTopDown = false): BoardItem[] {
  const known: BoardKnown = { nodeIds: [], items: [], ...(withLayout ? { turn: newBoardTurn() } : {}), ...(flowTopDown ? { flowTopDown: true } : {}) };
  let wire: BoardItem[] = [];
  for (const [name, args] of calls) {
    const r = executeBoardTool(name, args, known);
    assert.equal(r.ok, true, `${name}: ${r.ok ? '' : r.reason}`);
    if (!r.ok) continue;
    /* The pipeline's own bookkeeping (askPipeline.ts), restated. */
    const drop = new Set(r.removeIds ?? []);
    known.items = known.items.filter((i) => !drop.has(i.id));
    wire = wire.filter((i) => !drop.has(i.id));
    for (const item of r.items) {
      known.items = [...known.items, 'at' in item ? { id: item.id, at: item.at } : { id: item.id }];
      wire.push(item);
    }
  }
  return wire;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxesOf(wire: BoardItem[]): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const it of wire) {
    if (it.kind === 'shape' && it.shape === 'rect' && it.id.endsWith(':box')) {
      out.set(it.id.slice(0, -4), {
        x: Math.min(it.from.x, it.to.x),
        y: Math.min(it.from.y, it.to.y),
        w: Math.abs(it.to.x - it.from.x),
        h: Math.abs(it.to.y - it.from.y),
      });
    }
  }
  return out;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('"draw the agentic loop" comes out as a diagram, not a pile', () => {
  const wire = runTurn(AGENTIC_LOOP, true);
  const boxes = boxesOf(wire);

  it('draws one box per node, and no two boxes overlap', () => {
    assert.equal(boxes.size, 5);
    const ids = [...boxes.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        assert.ok(!overlaps(boxes.get(ids[i]!)!, boxes.get(ids[j]!)!), `${ids[i]} overlaps ${ids[j]}`);
      }
    }
  });

  it('every label stays inside its box: measured lines fit the width, and the box is tall enough', () => {
    for (const [id, box] of boxes) {
      const label = wire.find((i) => i.id === id);
      assert.ok(label && label.kind === 'text', `${id} has its label`);
      const lines = label.text.split('\n');
      for (const line of lines) {
        assert.ok(
          measureText(line, BOX_EM) <= box.w - 2 * BOX_PAD_X,
          `"${line}" is ${measureText(line, BOX_EM)} wide in a box whose inner width is ${box.w - 2 * BOX_PAD_X}`,
        );
      }
      assert.ok(lines.length * BOX_LINE + 2 * BOX_PAD_Y <= box.h, `${id}: ${lines.length} lines in a box ${box.h} tall`);
    }
    /* The long one really did need wrapping: this is not a vacuous pass. */
    const long = wire.find((i) => i.id === 'result');
    assert.ok(long && long.kind === 'text' && long.text.split('\n').length >= 3);
  });

  it('ranks run monotonically along the main flow', () => {
    const top = (id: string) => boxes.get(id)!.y;
    assert.ok(top('prompt') < top('model'));
    assert.ok(top('model') < top('tool'));
    assert.ok(top('tool') < top('result'));
    assert.ok(top('model') < top('answer'));
    /* The two branches share a rank. */
    assert.equal(top('tool'), top('answer'));
  });

  it('draws the way back as a loop AROUND the boxes, never through one', () => {
    const segments = wire.filter((i) => i.kind === 'shape' && (i.id === 'e4' || i.id.startsWith('e4:s')));
    assert.ok(segments.length >= 3, `the back edge is routed (${segments.length} segments)`);
    const last = segments[segments.length - 1]!;
    assert.ok(last.kind === 'shape' && last.shape === 'arrow', 'it ends in the arrowhead');
    for (const seg of wire.filter((i) => i.kind === 'shape' && !i.id.endsWith(':box') && i.shape !== 'rect')) {
      if (seg.kind !== 'shape') continue;
      const x0 = Math.min(seg.from.x, seg.to.x);
      const x1 = Math.max(seg.from.x, seg.to.x);
      const y0 = Math.min(seg.from.y, seg.to.y);
      const y1 = Math.max(seg.from.y, seg.to.y);
      for (const [id, b] of boxes) {
        /* Strictly inside: touching a face is how a connector arrives. */
        const crosses = x1 > b.x + 1 && x0 < b.x + b.w - 1 && y1 > b.y + 1 && y0 < b.y + b.h - 1;
        assert.ok(!crosses, `connector ${seg.id} runs through ${id}`);
      }
    }
  });

  it('connector labels sit clear of every box, and stay on the board', () => {
    for (const it of wire) {
      if (it.kind !== 'text' || !it.id.endsWith(':label')) continue;
      const r = { x: it.at.x, y: it.at.y - 12, w: measureText(it.text, 12), h: 16 };
      assert.ok(r.x >= 0 && r.y >= 0, `${it.id} is on the board`);
      for (const [id, b] of boxes) assert.ok(!overlaps(r, b), `label ${it.id} overlaps box ${id}`);
    }
  });

  it('control: WITHOUT the layout the same calls are the pile the owner saw', () => {
    const raw = runTurn(AGENTIC_LOOP, false);
    const notes = raw.filter((i) => i.kind === 'text' && !i.id.endsWith(':label'));
    assert.equal(notes.length, 5);
    const xs = notes.map((n) => (n.kind === 'text' ? n.at.x : 0));
    const ys = notes.map((n) => (n.kind === 'text' ? n.at.y : 0));
    /* Five boxes' worth of words inside a 30x30 patch: nothing a box could fit between. */
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 30 && Math.max(...ys) - Math.min(...ys) <= 30);
  });
});

describe('the layout is a function of the connections', () => {
  it('a short chain runs left to right on one line, evenly spaced', () => {
    const wire = runTurn(
      [
        ['board.add_note', { id: 'a', text: 'Input', at: { x: 0, y: 0 } }],
        ['board.add_note', { id: 'b', text: 'Parse', at: { x: 0, y: 0 } }],
        ['board.add_note', { id: 'c', text: 'Output', at: { x: 0, y: 0 } }],
        ['board.connect', { id: 'x', fromId: 'a', toId: 'b' }],
        ['board.connect', { id: 'y', fromId: 'b', toId: 'c' }],
      ],
      true,
    );
    const boxes = boxesOf(wire);
    const a = boxes.get('a')!;
    const b = boxes.get('b')!;
    const c = boxes.get('c')!;
    assert.equal(a.y, b.y);
    assert.equal(b.y, c.y);
    assert.equal(b.x - (a.x + a.w), c.x - (b.x + b.w));
    assert.ok(a.x < b.x && b.x < c.x);
  });

  it('three unconnected notes become a grid, not a pile', () => {
    const wire = runTurn(
      ['a', 'b', 'c'].map((id) => ['board.add_note', { id, text: id, at: { x: 1, y: 1 } }] as Call),
      true,
    );
    const boxes = [...boxesOf(wire).values()];
    assert.equal(boxes.length, 3);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i]!, boxes[j]!));
  });

  it('two stray notes stay exactly where the model put them', () => {
    const wire = runTurn(
      [
        ['board.add_note', { id: 'a', text: 'beside the db', at: { x: 700, y: 40 } }],
        ['board.add_note', { id: 'b', text: 'beside the api', at: { x: 100, y: 300 } }],
      ],
      true,
    );
    const a = wire.find((i) => i.id === 'a');
    assert.ok(a && a.kind === 'text' && a.at.x === 700 && a.at.y === 40);
    assert.equal(boxesOf(wire).size, 0);
  });

  it('a long unbroken word is cut to the box rather than allowed through it', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious_and_more_characters', 128);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(measureText(line) <= 128);
  });

  it('refuses ids that would collide with the box and segment ids it draws', () => {
    const known: BoardKnown = { nodeIds: [], items: [], turn: newBoardTurn() };
    for (const id of ['a:box', 'e:s1']) {
      const r = executeBoardTool('board.add_note', { id, text: 'x' }, known);
      assert.equal(r.ok, false, id);
    }
  });
});

describe('the measurement and padding match the client that wraps with them', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const model = readFileSync(path.resolve(here, '../../../web2/src/whiteboard/whiteboardModel.ts'), 'utf8');

  it('whiteboardModel.ts declares the same constants', () => {
    for (const declaration of [
      `export const WB_BOX_EM = ${BOX_EM};`,
      `export const WB_BOX_LINE = ${BOX_LINE};`,
      `export const WB_BOX_PAD_X = ${BOX_PAD_X};`,
      `export const WB_BOX_PAD_Y = ${BOX_PAD_Y};`,
    ]) {
      assert.ok(model.includes(declaration), `whiteboardModel.ts no longer declares \`${declaration}\``);
    }
  });

  it('whiteboardModel.ts uses the same advance buckets', () => {
    for (const bucket of [
      "/\\s/u.test(character)) return 0.35",
      "[ilI1.,'`:;|!]/u.test(character)) return 0.32",
      '[MWmw@#%&]/u.test(character)) return 0.9',
      '[A-Z0-9]/u.test(character)) return 0.68',
    ]) {
      assert.ok(model.includes(bucket), `advance bucket drifted: ${bucket}`);
    }
  });
});

describe('the real dispatcher lays the drawing out and tells the client what to drop', () => {
  it('a connect that completes a diagram re-sends every box with removeIds', async () => {
    const known: BoardKnown = { nodeIds: [], items: [] };
    const ctx = { repoRoot: null, designMode: true, boardKnown: known } as never;
    const run = async (name: string, args: Record<string, unknown>) => {
      const r = await executeAskTool(name, args, ctx);
      assert.equal(r.ok, true, r.evidence);
      const drop = new Set(r.boardRemoveIds ?? []);
      known.items = known.items.filter((i) => !drop.has(i.id));
      for (const it of r.boardItems ?? []) known.items = [...known.items, 'at' in it ? { id: it.id, at: it.at } : { id: it.id }];
      return r;
    };
    await run('board.add_note', { id: 'a', text: 'Plan', at: { x: 0, y: 0 } });
    await run('board.add_note', { id: 'b', text: 'Act', at: { x: 0, y: 0 } });
    const last = await run('board.connect', { id: 'ab', fromId: 'a', toId: 'b' });
    assert.deepEqual([...(last.boardRemoveIds ?? [])].sort(), ['a', 'b']);
    const ids = (last.boardItems ?? []).map((i) => i.id);
    assert.ok(ids.includes('a:box') && ids.includes('b:box') && ids.includes('ab'));
  });
});

describe('fix round: free space, the cap, parallel edges, cross-turn connectors', () => {
  const note = (id: string, text = id): Call => ['board.add_note', { id, text }];

  it('a lone note with no `at` lands beside the person\'s marks, not on them', () => {
    const known: BoardKnown = { nodeIds: [], items: [{ id: 'mine', at: { x: 0, y: 0 } }], turn: newBoardTurn() };
    const r = executeBoardTool('board.add_note', { id: 'n', text: 'hello' }, known);
    assert.ok(r.ok);
    const it = r.ok ? r.items[0] : undefined;
    assert.ok(it && it.kind === 'text' && it.at.x >= 156 + 40, `landed at ${JSON.stringify(it && 'at' in it ? it.at : null)}`);
  });

  it('the 300-item cap counts what the layout EMITS, and refuses cleanly', () => {
    const items = Array.from({ length: 296 }, (_, i) => ({ id: `p${i}`, at: { x: i, y: 0 } }));
    const known: BoardKnown = { nodeIds: [], items, turn: newBoardTurn() };
    const results = ['a', 'b', 'c'].map((id) => executeBoardTool('board.add_note', { id, text: id, at: { x: 1, y: 1 } }, known));
    /* The third makes it a diagram: 3 boxes x 2 items would be 302. */
    assert.equal(results[2]!.ok, false);
    assert.match(results[2]!.ok ? '' : results[2]!.reason, /limit is 300/);
    assert.equal(known.turn!.nodes.length, 2, 'a refused call leaves the turn as it was');
  });

  it('two connectors between the same boxes are drawn apart, labels included', () => {
    const wire = runTurn(
      [
        note('a'),
        note('b'),
        ['board.connect', { id: 'x', fromId: 'a', toId: 'b', label: 'calls' }],
        ['board.connect', { id: 'y', fromId: 'a', toId: 'b', label: 'returns' }],
      ],
      true,
    );
    const first = (id: string) => wire.find((i) => i.id === id);
    const x = first('x');
    const y = first('y');
    assert.ok(x && y && x.kind === 'shape' && y.kind === 'shape');
    assert.notDeepEqual([x.from, x.to], [y.from, y.to]);
    const lx = first('x:label');
    const ly = first('y:label');
    assert.ok(lx && ly && lx.kind === 'text' && ly.kind === 'text');
    assert.ok(Math.abs(lx.at.x - ly.at.x) >= 8 || Math.abs(lx.at.y - ly.at.y) >= 8);
  });

  it('a connector to a box from an EARLIER turn ends on that box\'s edge, not at its label', () => {
    const first = runTurn(AGENTIC_LOOP, true);
    const prompt = boxesOf(first).get('prompt')!;
    /* What the pipeline would know at the start of the next turn. */
    const known: BoardKnown = {
      nodeIds: [],
      items: first.map((i) => ('at' in i ? { id: i.id, at: i.at } : { id: i.id })),
      turn: newBoardTurn(),
    };
    for (const id of ['n1', 'n2', 'n3']) {
      const added = executeBoardTool('board.add_note', { id, text: id }, known);
      assert.ok(added.ok);
      if (!added.ok) continue;
      const drop = new Set(added.removeIds ?? []);
      known.items = known.items.filter((i) => !drop.has(i.id));
      for (const it of added.items) known.items = [...known.items, 'at' in it ? { id: it.id, at: it.at } : { id: it.id }];
    }
    const r = executeBoardTool('board.connect', { id: 'cross', fromId: 'n1', toId: 'prompt' }, known);
    assert.ok(r.ok);
    const arrow = r.ok ? r.items.find((i) => i.id === 'cross') : undefined;
    assert.ok(arrow && arrow.kind === 'shape');
    const end = arrow.to;
    const onEdge =
      (Math.abs(end.x - prompt.x) < 1.5 || Math.abs(end.x - (prompt.x + prompt.w)) < 1.5 || Math.abs(end.y - prompt.y) < 1.5 || Math.abs(end.y - (prompt.y + prompt.h)) < 1.5) &&
      end.x >= prompt.x - 1.5 && end.x <= prompt.x + prompt.w + 1.5 && end.y >= prompt.y - 1.5 && end.y <= prompt.y + prompt.h + 1.5;
    assert.ok(onEdge, `ends at ${JSON.stringify(end)}, box is ${JSON.stringify(prompt)}`);
  });
});

describe('short flows top to bottom (claims-audit 1.6, V05): a setting that defaults to the current layout', () => {
  const THREE_STEP: Call[] = [
    ['board.add_note', { id: 'a', text: 'Ask', at: { x: 0, y: 0 } }],
    ['board.add_note', { id: 'b', text: 'Plan', at: { x: 0, y: 0 } }],
    ['board.add_note', { id: 'c', text: 'Answer', at: { x: 0, y: 0 } }],
    ['board.connect', { id: 'x', fromId: 'a', toId: 'b' }],
    ['board.connect', { id: 'y', fromId: 'b', toId: 'c' }],
  ];

  it('default (setting off): a 3-step flow still runs left to right, on one row', () => {
    const boxes = boxesOf(runTurn(THREE_STEP, true));
    const [a, b, c] = ['a', 'b', 'c'].map((k) => boxes.get(k)!);
    assert.equal(a!.y, b!.y);
    assert.equal(b!.y, c!.y);
    assert.ok(a!.x < b!.x && b!.x < c!.x);
  });

  it('setting on: the same 3-step flow runs top to bottom, in one column', () => {
    const boxes = boxesOf(runTurn(THREE_STEP, true, true));
    const [a, b, c] = ['a', 'b', 'c'].map((k) => boxes.get(k)!);
    assert.ok(a!.y < b!.y && b!.y < c!.y, 'each step sits below the one before');
    const mid = (r: { x: number; w: number }) => r.x + r.w / 2;
    assert.ok(Math.abs(mid(a!) - mid(b!)) < 1 && Math.abs(mid(b!) - mid(c!)) < 1, 'one column');
  });
});
