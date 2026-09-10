import { describe, expect, it } from 'vitest';

import {
  EMPTY_WHITEBOARD,
  WB_UNDO_DEPTH,
  readWhiteboard,
  strokeFrom,
  whiteboardBounds,
  whiteboardEdit,
  whiteboardKey,
  writeWhiteboard,
  type WhiteboardDoc,
  type WbItem,
} from './whiteboardModel';
import { arrowHead } from './Whiteboard';

/**
 * THE WHITEBOARD — a surface where nothing is a measured claim.
 *
 * Owner walk 2026-08-22: "a separate kind of whiteboard you can switch tabs
 * between… just like a Miro board where you can literally just draw from
 * scratch."
 *
 * The architecture board is DERIVED — every node from a parser, every edge
 * citing a file and a line. This holds whatever somebody drew. Mixed into one
 * surface those are indistinguishable after a week, and a sketch would sit
 * beside a finding in the same visual language.
 */

function doc(...items: WbItem[]): WhiteboardDoc {
  return { version: 1, items };
}

const S = (id: string): WbItem => ({
  kind: 'stroke',
  id,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
  width: 2,
});

describe('drawing', () => {
  it('keeps a freehand stroke AS a stroke — nothing is recognised', () => {
    /*
     * The load-bearing difference from the architecture board. There,
     * `recognizeStroke` turns a rough box into a node and refuses a scribble.
     * Doing that here would silently convert a sketch into something that
     * looks like a finding.
     */
    const path = [
      { x: 1, y: 1 },
      { x: 40, y: 2 },
      { x: 41, y: 39 },
      { x: 2, y: 38 },
      { x: 1, y: 1 },
    ];
    const stroke = strokeFrom('s1', path)!;
    expect(stroke.kind).toBe('stroke');
    /* A near-perfect rectangle, and it stays five points of ink. */
    expect(stroke.points).toHaveLength(5);
  });

  it('a single point is not a stroke', () => {
    /* That is a click. Storing it makes an invisible item that still answers
       hit tests, which reads as a board that cannot be cleaned up. */
    expect(strokeFrom('s1', [{ x: 5, y: 5 }])).toBeNull();
    expect(strokeFrom('s1', [])).toBeNull();
  });

  it('adds, moves, retitles and deletes', () => {
    let d = whiteboardEdit(EMPTY_WHITEBOARD, { type: 'wb/add', item: S('a') });
    expect(d.items).toHaveLength(1);

    d = whiteboardEdit(d, { type: 'wb/move', id: 'a', dx: 5, dy: -3 });
    expect((d.items[0] as { points: { x: number; y: number }[] }).points[0]).toEqual({ x: 5, y: -3 });

    d = whiteboardEdit(d, { type: 'wb/delete', id: 'a' });
    expect(d.items).toHaveLength(0);
  });

  it('moving a shape moves BOTH of its corners', () => {
    const d = whiteboardEdit(
      doc({ kind: 'shape', id: 'r', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }),
      { type: 'wb/move', id: 'r', dx: 4, dy: 4 },
    );
    /* Moving only `from` would resize the shape instead of moving it — a
       silent corruption that looks like a drag that went wrong. */
    expect(d.items[0]).toMatchObject({ from: { x: 4, y: 4 }, to: { x: 14, y: 14 } });
  });

  it('clear empties the board', () => {
    const d = whiteboardEdit(doc(S('a'), S('b')), { type: 'wb/clear' });
    expect(d.items).toHaveLength(0);
  });
});

describe('a no-op returns the SAME document', () => {
  /*
   * Identity is how a caller decides whether to push an undo frame. An undo
   * stack that grows on no-ops makes Ctrl-Z appear broken — the reader presses
   * it and nothing visible happens, several times.
   */
  it('for a move of zero', () => {
    const before = doc(S('a'));
    expect(whiteboardEdit(before, { type: 'wb/move', id: 'a', dx: 0, dy: 0 })).toBe(before);
  });

  it('for a move of something that is not there', () => {
    const before = doc(S('a'));
    expect(whiteboardEdit(before, { type: 'wb/move', id: 'nope', dx: 5, dy: 5 })).toBe(before);
  });

  it('for deleting something that is not there', () => {
    const before = doc(S('a'));
    expect(whiteboardEdit(before, { type: 'wb/delete', id: 'nope' })).toBe(before);
  });

  it('for clearing an empty board', () => {
    expect(whiteboardEdit(EMPTY_WHITEBOARD, { type: 'wb/clear' })).toBe(EMPTY_WHITEBOARD);
  });

  it('for setting text to what it already says', () => {
    const before = doc({ kind: 'text', id: 't', at: { x: 0, y: 0 }, text: 'same' });
    expect(whiteboardEdit(before, { type: 'wb/text', id: 't', text: 'same' })).toBe(before);
  });
});

describe('NOTHING HERE IS A GRAPH NODE', () => {
  it('a node reference is a POINTER, not a copy', () => {
    /*
     * It carries an id and the label as it read at the time. Copying the
     * node's substance would put a second, staler answer on screen beside the
     * graph's, and the two would drift with nothing to say which was right.
     */
    const ref: WbItem = {
      kind: 'noderef',
      id: 'n1',
      at: { x: 0, y: 0 },
      nodeId: 'svc:checkout',
      label: 'checkout',
    };
    const d = whiteboardEdit(EMPTY_WHITEBOARD, { type: 'wb/add', item: ref });
    const stored = d.items[0] as unknown as Record<string, unknown>;
    expect(stored.nodeId).toBe('svc:checkout');
    /* Not an edge, not evidence, not a kind. */
    expect(stored.evidence).toBeUndefined();
    expect(stored.edges).toBeUndefined();
  });

  it('no item type carries evidence at all', () => {
    /* The type has no such field; this is the runtime lock, so a future item
       kind cannot quietly gain one and start looking measured. */
    const d = doc(S('a'), { kind: 'text', id: 't', at: { x: 1, y: 1 }, text: 'hi' });
    for (const it of d.items) {
      expect((it as unknown as Record<string, unknown>).evidence).toBeUndefined();
    }
  });
});

describe('it survives a reload', () => {
  it('round-trips', () => {
    const before = doc(S('a'), { kind: 'text', id: 't', at: { x: 3, y: 4 }, text: 'plan' });
    expect(readWhiteboard(writeWhiteboard(before))).toEqual(before);
  });

  it('a corrupt blob costs the drawing, never the tab', () => {
    /* A sketchpad that refuses to open because of one bad string has traded a
       drawing for the whole feature. */
    for (const bad of ['', 'not json', '{', 'null', '[]', '{"version":2,"items":[]}']) {
      expect(readWhiteboard(bad)).toEqual(EMPTY_WHITEBOARD);
    }
    expect(readWhiteboard(null)).toEqual(EMPTY_WHITEBOARD);
  });

  it('drops items whose kind this build does not know', () => {
    /*
     * A document written by a newer build must not smuggle something this one
     * renders as a shape it does not understand — that is how a surface draws
     * a claim nobody made.
     */
    const raw = JSON.stringify({
      version: 1,
      items: [S('keep'), { kind: 'hologram', id: 'x' }, { id: 'no-kind' }],
    });
    const read = readWhiteboard(raw);
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.id).toBe('keep');
  });

  it('drops a malformed item of a KNOWN kind', () => {
    const raw = JSON.stringify({
      version: 1,
      items: [{ kind: 'stroke', id: 'bad' }, S('good')],
    });
    expect(readWhiteboard(raw).items.map((i) => i.id)).toEqual(['good']);
  });
});

describe('one whiteboard per repository', () => {
  it('two repositories get two keys', () => {
    /* Carrying one repo's sketches into another is worse than losing them: the
       reader is looking at notes for a system they are not in. */
    expect(whiteboardKey('C:/repos/shop')).not.toBe(whiteboardKey('C:/repos/other'));
  });

  it('separators and trailing slashes do not make a second board', () => {
    expect(whiteboardKey('C:\\repos\\shop\\')).toBe(whiteboardKey('C:/repos/shop'));
  });

  it('no repository still has a key, rather than throwing', () => {
    expect(typeof whiteboardKey(null)).toBe('string');
  });
});

describe('bounds', () => {
  it('covers every item type', () => {
    const b = whiteboardBounds(
      doc(
        S('a'),
        { kind: 'shape', id: 'r', shape: 'rect', from: { x: -5, y: 0 }, to: { x: 30, y: 20 } },
        { kind: 'text', id: 't', at: { x: 50, y: 60 }, text: 'x' },
      ),
    )!;
    expect(b.x).toBe(-5);
    expect(b.y).toBe(0);
    /* The earlier assertion ended at the text ANCHOR (50, 60), which recorded
       the Fit defect as the spec. Painted words must extend both dimensions. */
    expect(b.width).toBeGreaterThan(55);
    expect(b.height).toBeGreaterThan(60);
  });

  it('an empty board has no bounds, rather than a zero box at the origin', () => {
    /* A zero box would make Fit scroll to a corner and look broken. */
    expect(whiteboardBounds(EMPTY_WHITEBOARD)).toBeNull();
  });
});

it('undo depth matches the architecture board', () => {
  /* Two surfaces in one product forgetting at different depths is a difference
     a reader feels and cannot explain. */
  expect(WB_UNDO_DEPTH).toBe(50);
});

describe('the arrow — a line that points', () => {
  /*
   * Asked for directly: "I just wish I could see an arrow for the whiteboard as
   * well."
   *
   * Its own shape rather than a flag on `line`, because direction is the whole
   * content of the mark. The architecture board has had directed edges since it
   * was written; a sketching surface that could only draw undirected lines
   * cannot express "A calls B", which is most of what anyone draws on one.
   */
  it('points from the start of the drag to the end', () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 });
    /* The tip is AT the far end — an arrow whose point stops short of where the
       reader released is pointing at nothing in particular. */
    expect(head).toContain('L100,0');
  });

  it('turns with the line rather than always pointing one way', () => {
    const right = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 });
    const down = arrowHead({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(right).not.toBe(down);
    expect(down).toContain('L0,100');
  });

  it('IS THE SAME SIZE WHATEVER THE LENGTH', () => {
    /*
     * Absolute units, not a fraction of the line. A proportional head turns a
     * long arrow into a dart and a short one into a smudge — the mark would
     * mean "direction" at one scale and "decoration" at another.
     */
    const spread = (d: string) => {
      const pts = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      return Math.hypot(pts[0] - pts[4], pts[1] - pts[5]);
    };
    const short = arrowHead({ x: 0, y: 0 }, { x: 30, y: 0 });
    const long = arrowHead({ x: 0, y: 0 }, { x: 900, y: 0 });
    expect(spread(short)).toBeCloseTo(spread(long), 5);
  });

  it('a zero-length drag draws no head rather than an arbitrary one', () => {
    /* There is no direction to point in, and inventing one would draw a claim
       the gesture never made. */
    expect(arrowHead({ x: 40, y: 40 }, { x: 40, y: 40 })).toBe('');
  });
});
