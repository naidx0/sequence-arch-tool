import { describe, expect, it } from 'vitest';

import { askSurfaceFromWorkspace, drawingSummaryLine, withDrawingState } from './workspaceAskSurface';
import { boardItemsForAsk, namedInkPhrase } from '../whiteboard/whiteboardAsk';
import {
  EMPTY_WHITEBOARD,
  whiteboardEdit,
  type WbItem,
  type WhiteboardDoc,
} from '../whiteboard/whiteboardModel';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE AGENT READS THE DRAWING
 *
 * Owner, 2026-09-18: "see how the freeform works, how the agent can understand
 * the drawing". Measured before this file existed
 * (`docs/research/ai-canvas-moat-audit.md` §a): NOTHING the reader draws on the
 * AI Canvas plane reaches the model. `ConnectedAiCanvas` passes no
 * `onDocChange`, the document lives in the `Whiteboard` component's own
 * `useState`, and the one wire field that could carry it —
 * `AskSurfaceContext.board` — is filled from `session.boardAgentItems`, i.e.
 * from the agent's own marks only.
 *
 * So the model was shown its own drawing and never the reader's, on the one
 * surface the owner calls the moat.
 * ══════════════════════════════════════════════════════════════════════════
 */

function boardOf(...items: WbItem[]): WhiteboardDoc {
  return items.reduce<WhiteboardDoc>(
    (doc, item) => whiteboardEdit(doc, { type: 'wb/add', item }),
    EMPTY_WHITEBOARD,
  );
}

const note = (id: string, text: string, x = 0, y = 0): WbItem => ({
  kind: 'text',
  id,
  at: { x, y },
  text,
});

const ref = (id: string, nodeId: string, label: string): WbItem => ({
  kind: 'noderef',
  id,
  at: { x: 240, y: 120 },
  nodeId,
  label,
});

const frame = (id: string, blockId: string): WbItem => ({
  kind: 'artifact',
  id,
  at: { x: 48, y: 48 },
  size: { w: 480, h: 280 },
  ref: { type: 'block', blockId },
});

/** A rough hand-drawn rectangle — closed, encloses real area. */
const drawnBox = (id: string, x: number, y: number): WbItem => ({
  kind: 'stroke',
  id,
  width: 2,
  points: [
    { x, y },
    { x: x + 140, y: y + 3 },
    { x: x + 138, y: y + 100 },
    { x: x + 2, y: y + 98 },
    { x: x + 3, y: y + 4 },
  ],
});

/** A straight open stroke — the classifier's `line`. */
const drawnLine = (id: string, x: number, y: number): WbItem => ({
  kind: 'stroke',
  id,
  width: 2,
  points: [
    { x, y },
    { x: x + 90, y: y + 2 },
    { x: x + 180, y: y + 4 },
  ],
});

describe('what the reader drew, as the wire carries it', () => {
  it('a text note travels VERBATIM', () => {
    const board = boardItemsForAsk(boardOf(note('t1', 'gateway is doing too much')));
    expect(board.items).toHaveLength(1);
    expect(board.items[0]).toMatchObject({
      id: 't1',
      kind: 'text',
      label: 'gateway is doing too much',
    });
  });

  it('a noderef keeps the id that makes it grounded', () => {
    const board = boardItemsForAsk(boardOf(ref('n1', 'svc:gateway', 'gateway')));
    expect(board.items[0]).toMatchObject({
      kind: 'noderef',
      nodeId: 'svc:gateway',
      label: 'gateway',
    });
  });

  it('an artifact frame names the block it holds, and does not repeat its contents', () => {
    /* The block itself travels on `surface.canvas` — id, type, title, size and
       an excerpt for the newest. Repeating the payload here would describe one
       document twice in one prompt. */
    const board = boardItemsForAsk(boardOf(frame('a1', 'blk-7')));
    expect(board.items[0]).toMatchObject({ kind: 'text', label: 'block:blk-7' });
  });

  it('A STROKE ARRIVES NAMED, which is the whole change', () => {
    const board = boardItemsForAsk(boardOf(drawnBox('s1', 0, 0)));
    expect(board.items[0]?.kind).toBe('stroke');
    expect(board.items[0]?.label).toMatch(/^rectangle/);
  });

  it('and carries where it sits, to a ninth of the drawing', () => {
    const board = boardItemsForAsk(
      boardOf(drawnBox('s1', 0, 0), drawnBox('s2', 800, 0), drawnBox('s3', 0, 800)),
    );
    const labels = board.items.map((i) => i.label);
    expect(labels[0]).toBe('rectangle · top-left');
    expect(labels[1]).toBe('rectangle · top-right');
    expect(labels[2]).toBe('rectangle · bottom-left');
  });

  it('NEVER A POINT LIST — the marks are described, not transmitted', () => {
    const board = boardItemsForAsk(boardOf(drawnBox('s1', 0, 0), drawnLine('s2', 400, 40)));
    const json = JSON.stringify(board);
    expect(json).not.toContain('points');
    /* One interior sample of the box, which a raw dump would have carried. */
    expect(json).not.toContain('138');
  });

  it('a stroke the classifier refuses to name is called unreadable, never guessed', () => {
    const tap: WbItem = {
      kind: 'stroke',
      id: 's9',
      width: 2,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 8, y: 2 },
      ],
    };
    const board = boardItemsForAsk(boardOf(tap));
    expect(board.items[0]?.label).toMatch(/unreadable mark/);
  });

  it('drops a whitespace-only note rather than listing an item with no words', () => {
    const board = boardItemsForAsk(boardOf(note('t1', '   '), note('t2', 'real')));
    expect(board.items.map((i) => i.id)).toEqual(['t2']);
  });

  it('an empty document says NOTHING', () => {
    expect(boardItemsForAsk(EMPTY_WHITEBOARD).items).toEqual([]);
  });
});

describe('attaching it to the surface the reader is asking from', () => {
  const surface = askSurfaceFromWorkspace('ai-canvas');

  it('the AI Canvas is the surface it names', () => {
    expect(surface).toEqual({ id: 'ai-canvas', title: 'AI Canvas' });
  });

  it('the drawing lands on `board`, the field the server already renders', () => {
    const next = withDrawingState(
      surface,
      boardOf(note('t1', 'split auth out'), drawnBox('s1', 0, 0)),
    );
    expect(next?.board?.items.map((i) => i.id)).toEqual(['t1', 's1']);
  });

  it('AN EMPTY DRAWING CHANGES NOTHING — the request stays byte-identical', () => {
    expect(withDrawingState(surface, EMPTY_WHITEBOARD)).toBe(surface);
    expect(withDrawingState(surface, null)).toBe(surface);
    expect(withDrawingState(null, boardOf(note('t1', 'x')))).toBeNull();
  });

  it('keeps the agent items beside the reader marks, and never duplicates an id', () => {
    /* The agent's marks are how it revises its own drawing; dropping them to
       make room for the human's would cost it the ids it needs. */
    const withAgent = {
      ...surface!,
      board: {
        items: [
          { id: 'agent-1', kind: 'text' as const, label: 'cache' },
          { id: 't1', kind: 'text' as const, label: 'stale' },
        ],
      },
    };
    const next = withDrawingState(withAgent, boardOf(note('t1', 'split auth out')));
    const ids = next?.board?.items.map((i) => i.id) ?? [];
    expect(ids).toEqual(['t1', 'agent-1']);
    /* The live document wins the collision — it is where a landed agent item is. */
    expect(next?.board?.items[0]?.label).toBe('split auth out');
  });

  it('does not invent a focus for a drawing', () => {
    const next = withDrawingState(surface, boardOf(note('t1', 'a plan')));
    expect(next?.focus).toBeUndefined();
  });
});

describe('the shape of the whole drawing, in one sentence', () => {
  it('counts what the recogniser named', () => {
    const doc = boardOf(
      drawnBox('s1', 0, 0),
      drawnBox('s2', 400, 0),
      drawnBox('s3', 0, 400),
      drawnLine('s4', 200, 60),
      drawnLine('s5', 200, 460),
    );
    expect(namedInkPhrase(doc)).toBe('3 rectangles and 2 lines');
    expect(drawingSummaryLine(doc)).toBe('Freehand on this surface: 3 rectangles and 2 lines.');
  });

  it('says nothing at all when there is no freehand', () => {
    expect(drawingSummaryLine(boardOf(note('t1', 'just words')))).toBe('');
    expect(drawingSummaryLine(null)).toBe('');
    expect(namedInkPhrase(EMPTY_WHITEBOARD)).toBe('');
  });
});
