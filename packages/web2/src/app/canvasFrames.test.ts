/**
 * WAVE B2 — POSITIONS IN THE DOCUMENT (docs/research/carrying-harness-plan.md).
 *
 * Until this landed, where an artifact sat lived ONLY in this origin's
 * localStorage (`sequence.seqdraw.<id>`). A canvas opened on another machine,
 * or after site data was cleared, re-cascaded every frame down the left edge:
 * the arrangement a person made by hand was not part of the document they made
 * it in. These lock the three halves — the layout honours a stored frame, the
 * pad's geometry is read back out, and the map survives the trip to disk.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_CANVAS_FRAMES,
  blockArtifactId,
  chartArtifactId,
  framesFromDrawing,
  materializeCanvasArtifacts,
  sameFrames,
} from './materializeCanvasArtifacts';
import { fromCanvasMemory, toCanvasMemory } from '../sessions/canvasMemory';
import type { CanvasDoc } from '../state/types';

const CHART = {
  version: 1,
  kind: 'line',
  title: 'y',
  items: [{ id: 'p0', label: '0', value: 0, group: 'y' }],
} as unknown as NonNullable<CanvasDoc['charts']>[number];

function doc(over: Partial<CanvasDoc> = {}): CanvasDoc {
  return {
    blocks: [{ id: 'b1', type: 'markdown', title: 'Note', payload: '# Hi', status: 'landed' }],
    charts: [CHART],
    ...over,
  };
}

describe('a stored frame is where the artifact goes', () => {
  it('uses the saved position and size verbatim, and cascades only what has none', () => {
    const items = materializeCanvasArtifacts(
      doc({ frames: { [blockArtifactId('b1')]: { x: 900, y: 1200, w: 640, h: 400 } } }),
    );
    const block = items.find((i) => i.id === blockArtifactId('b1'))!;
    expect(block.at).toEqual({ x: 900, y: 1200 });
    expect(block.size).toEqual({ w: 640, h: 400 });
    /* The chart has no frame, so it keeps the cascade's first slot — a stored
       frame far down the plane must not push unplaced artifacts after it. */
    const chart = items.find((i) => i.id === chartArtifactId(0))!;
    expect(chart.at).toEqual({ x: 48, y: 48 });
  });

  it('with no frames at all the layout is exactly what it was', () => {
    const items = materializeCanvasArtifacts(doc());
    expect(items.map((i) => i.id)).toEqual([chartArtifactId(0), blockArtifactId('b1')]);
    expect(items[0]!.at).toEqual({ x: 48, y: 48 });
    expect(items[1]!.at.y).toBeGreaterThan(items[0]!.at.y);
  });
});

describe('the pad’s geometry read back out', () => {
  it('takes artifact frames and NOTHING else — strokes and notes are the drawing', () => {
    const frames = framesFromDrawing([
      { kind: 'artifact', id: 'artifact:block:b1', at: { x: 10.4, y: 20.6 }, size: { w: 300.2, h: 200.8 } },
      { kind: 'text', id: 't1', at: { x: 5, y: 5 } },
      { kind: 'stroke', id: 's1' },
    ]);
    expect(frames).toEqual({ 'artifact:block:b1': { x: 10, y: 21, w: 300, h: 201 } });
  });

  it('a drawing with no artifacts records NOTHING, which is different from an empty arrangement', () => {
    expect(framesFromDrawing([{ kind: 'stroke', id: 's1' }])).toBeNull();
    expect(framesFromDrawing([])).toBeNull();
  });

  it('drops a frame with a broken coordinate or no size rather than writing a hole', () => {
    const frames = framesFromDrawing([
      { kind: 'artifact', id: 'good', at: { x: 1, y: 2 }, size: { w: 3, h: 4 } },
      { kind: 'artifact', id: 'nan', at: { x: Number.NaN, y: 0 }, size: { w: 3, h: 4 } },
      { kind: 'artifact', id: 'flat', at: { x: 0, y: 0 }, size: { w: 0, h: 4 } },
      { kind: 'artifact', id: 'nosize', at: { x: 0, y: 0 } },
    ]);
    expect(Object.keys(frames!)).toEqual(['good']);
  });

  it('stops at the cap rather than growing the session file without bound', () => {
    const many = Array.from({ length: MAX_CANVAS_FRAMES + 25 }, (_, i) => ({
      kind: 'artifact',
      id: `a${i}`,
      at: { x: i, y: i },
      size: { w: 10, h: 10 },
    }));
    expect(Object.keys(framesFromDrawing(many)!)).toHaveLength(MAX_CANVAS_FRAMES);
  });
});

describe('sameFrames', () => {
  it('is true for the same arrangement and false for any move, resize, gain or loss', () => {
    const a = { x: { x: 1, y: 2, w: 3, h: 4 } };
    expect(sameFrames(a, { x: { x: 1, y: 2, w: 3, h: 4 } })).toBe(true);
    expect(sameFrames(a, { x: { x: 1, y: 9, w: 3, h: 4 } })).toBe(false);
    expect(sameFrames(a, { x: { x: 1, y: 2, w: 3, h: 40 } })).toBe(false);
    expect(sameFrames(a, { y: { x: 1, y: 2, w: 3, h: 4 } })).toBe(false);
    expect(sameFrames(a, {})).toBe(false);
    expect(sameFrames(undefined, undefined)).toBe(true);
  });
});

describe('the arrangement survives the trip to disk', () => {
  it('round-trips through the session canvas payload', () => {
    const frames = { [blockArtifactId('b1')]: { x: 900, y: 1200, w: 640, h: 400 } };
    const wire = toCanvasMemory('session-a', doc({ frames }));
    expect(wire.frames).toEqual(frames);
    /* THE WHOLE POINT: a reader with no browser storage lays the canvas out
       the way the person left it, because the document says where. */
    const back = fromCanvasMemory(JSON.parse(JSON.stringify(wire)));
    expect(back.frames).toEqual(frames);
    const items = materializeCanvasArtifacts(back);
    expect(items.find((i) => i.id === blockArtifactId('b1'))!.at).toEqual({ x: 900, y: 1200 });
  });

  it('a canvas with no arrangement sends no frames field at all', () => {
    expect(toCanvasMemory('session-a', doc()).frames).toBeUndefined();
    expect(toCanvasMemory('session-a', doc({ frames: {} })).frames).toBeUndefined();
  });

  it('refuses a junk frame from disk instead of placing an artifact nowhere', () => {
    const back = fromCanvasMemory({
      version: 1,
      sessionId: 's',
      blocks: [],
      frames: {
        ok: { x: 1, y: 2, w: 3, h: 4 },
        broken: { x: 'left', y: 2, w: 3, h: 4 },
        flat: { x: 1, y: 2, w: 0, h: 4 },
        notAnObject: 7,
      },
    });
    expect(back.frames).toEqual({ ok: { x: 1, y: 2, w: 3, h: 4 } });
    expect(fromCanvasMemory({ version: 1, sessionId: 's', blocks: [], frames: [] }).frames).toBeUndefined();
  });
});
