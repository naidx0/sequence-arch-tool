import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BIND_REACH, boxAt, drewAHead, shapeFromOffer } from './snapShape';
import { SnapSession, SNAP_MIN_SCREEN_DIAG, type SnapOffer } from './snapSession';
import { DEFAULT_SNAP_MODE, EDIT_LOG_KEY, SNAP_MODE_KEY, readEditLogEnabled, readSnapMode, writeEditLogEnabled, writeSnapMode } from './snapPreference';
import { flushBoardEdits, logBoardEdit, resetBoardEditQueue } from './boardEditLog';
import { EMPTY_WHITEBOARD, strokeFrom, whiteboardEdit, type WbShape, type WbStroke } from './whiteboardModel';

const stroke = (id: string, pts: [number, number][]): WbStroke => strokeFrom(id, pts.map(([x, y], i) => ({ x, y, t: i * 16 })))!;
const rectShape = (id: string, x: number, y: number, w: number, h: number): WbShape => ({ kind: 'shape', id, shape: 'rect', from: { x, y }, to: { x: x + w, y: y + h } });

describe('wb/replace: the tidy-up is one edit', () => {
  const doc = { ...EMPTY_WHITEBOARD, items: [stroke('a', [[0, 0], [5, 5]]), stroke('b', [[9, 9], [20, 20]]), stroke('c', [[30, 30], [40, 40]])] };

  it('takes the strokes out and puts the shape where the first one stood', () => {
    const shape = rectShape('q1', 0, 0, 20, 20);
    const next = whiteboardEdit(doc, { type: 'wb/replace', remove: ['a', 'b'], add: [shape] });
    expect(next.items.map((i) => i.id)).toEqual(['q1', 'c']);
  });

  it('keeps the raw strokes byte for byte in the document it replaced (what undo restores)', () => {
    const before = JSON.stringify(doc);
    whiteboardEdit(doc, { type: 'wb/replace', remove: ['a'], add: [rectShape('q', 0, 0, 5, 5)] });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('is declined (same object) when none of the strokes is on the board any more', () => {
    expect(whiteboardEdit(doc, { type: 'wb/replace', remove: ['gone'], add: [rectShape('q', 0, 0, 5, 5)] })).toBe(doc);
  });

  it('a move keeps every point time', () => {
    const moved = whiteboardEdit(doc, { type: 'wb/move', id: 'a', dx: 10, dy: 10 });
    expect((moved.items[0] as WbStroke).points.map((p) => p.t)).toEqual([0, 16]);
  });
});

describe('snapShape', () => {
  const boxes = [rectShape('big', 0, 0, 400, 300), rectShape('small', 100, 100, 50, 50)];

  it('an end lands in the smallest box it touches, or just beside it', () => {
    expect(boxAt(boxes, { x: 120, y: 120 })).toBe('small');
    expect(boxAt(boxes, { x: 300, y: 250 })).toBe('big');
    expect(boxAt(boxes, { x: 150 + BIND_REACH - 1, y: 125 })).toBe('small');
    expect(boxAt(boxes, { x: 150 + BIND_REACH + 1, y: 125 })).toBe('big');
    expect(boxAt(boxes, { x: 900, y: 900 })).toBeUndefined();
  });

  it('a stroke that went back to draw a head is an arrow; one that ended at its tip is a line', () => {
    const tip = { x: 200, y: 0 };
    expect(drewAHead([{ x: 0, y: 0 }, tip, { x: 180, y: 10 }], tip)).toBe(true);
    expect(drewAHead([{ x: 0, y: 0 }, { x: 100, y: 2 }, { x: 199, y: 1 }], { x: 200, y: 0 })).toBe(false);
  });

  it('builds the shape from an offer, binding only the ends that touch a box', () => {
    const offer: SnapOffer = { strokeIds: ['s'], decision: 'connector', confidence: 0.9, from: { x: 120, y: 120 }, to: { x: 700, y: 700 } };
    const s = stroke('s', [[120, 120], [700, 700], [620, 690]]);
    const out = shapeFromOffer('new', offer, [s], boxes);
    expect(out).toMatchObject({ shape: 'arrow', fromId: 'small' });
    expect(out.toId).toBeUndefined();
    const box = shapeFromOffer('b', { ...offer, decision: 'diamond', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } }, [s], boxes);
    expect(box).toMatchObject({ shape: 'diamond', from: { x: 1, y: 2 }, to: { x: 30, y: 40 } });
  });
});

describe('SnapSession', () => {
  const rect = (x: number, y: number, w: number, h: number) => [
    ...Array.from({ length: 12 }, (_, i) => ({ x: x + (w * i) / 11, y })),
    ...Array.from({ length: 10 }, (_, i) => ({ x: x + w, y: y + (h * (i + 1)) / 10 })),
    ...Array.from({ length: 12 }, (_, i) => ({ x: x + w - (w * (i + 1)) / 12, y: y + h })),
    ...Array.from({ length: 10 }, (_, i) => ({ x, y: y + h - (h * (i + 1)) / 10 })),
  ];
  const fake = () => {
    const timers: { fn: () => void; ms: number }[] = [];
    return {
      timers,
      setTimer: (fn: () => void, ms: number) => {
        const t = { fn, ms };
        timers.push(t);
        return t;
      },
      clearTimer: (h: unknown) => {
        const i = timers.indexOf(h as never);
        if (i >= 0) timers.splice(i, 1);
      },
    };
  };
  const make = (over: Partial<ConstructorParameters<typeof SnapSession>[0]> = {}) => {
    const offers: SnapOffer[][] = [];
    const clock = fake();
    const session = new SnapSession({
      onOffer: (o) => offers.push(o),
      context: () => [],
      present: () => true,
      zoom: () => 1,
      recognizer: () => import('@sequence/ink/shape-model').then((m) => (p, o) => m.recognizeShape(p, o)),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      ...over,
    });
    return { session, offers, clock };
  };

  it('offers a lone closed shape at once, without waiting for the pen to rest', async () => {
    const { session, offers, clock } = make();
    await session.strokeEnded({ id: 's1', points: rect(100, 100, 220, 140), t0: 0, t1: 1000 });
    expect(offers).toHaveLength(1);
    expect(offers[0]![0]).toMatchObject({ decision: 'rect', strokeIds: ['s1'] });
    expect(clock.timers).toHaveLength(0);
  });

  it('if the model fails to load, the stroke stays ink and the next stroke tries again', async () => {
    const real = () => import('@sequence/ink/shape-model').then((m) => (p: Parameters<typeof m.recognizeShape>[0], o: Parameters<typeof m.recognizeShape>[1]) => m.recognizeShape(p, o));
    let calls = 0;
    const { session, offers } = make({
      recognizer: () => (++calls === 1 ? Promise.reject(new Error('chunk failed to load')) : real()),
    });
    await expect(session.strokeEnded({ id: 's1', points: rect(100, 100, 220, 140), t0: 0, t1: 1000 })).resolves.toBeUndefined();
    expect(offers).toEqual([]);
    await session.strokeEnded({ id: 's2', points: rect(500, 100, 220, 140), t0: 5000, t1: 6000 });
    expect(calls).toBe(2);
    expect(offers.flat().map((o) => o.strokeIds)).toEqual([['s2']]);
  });

  it('does not offer a stroke that was erased while it waited', async () => {
    const { session, offers } = make({ present: () => false });
    await session.strokeEnded({ id: 's1', points: rect(100, 100, 220, 140), t0: 0, t1: 1000 });
    expect(offers).toEqual([]);
  });

  it('does not offer a shape too small to matter at this zoom', async () => {
    const { session, offers } = make({ zoom: () => 0.1 });
    await session.strokeEnded({ id: 's1', points: rect(100, 100, 220, 140), t0: 0, t1: 1000 });
    expect(Math.hypot(220, 140) * 0.1).toBeLessThan(SNAP_MIN_SCREEN_DIAG);
    expect(offers).toEqual([]);
  });

  it('a stroke that is not yet a shape waits for the rest timer, and pen-down cancels it', async () => {
    const { session, offers, clock } = make();
    const side = Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 12, y: 100 }));
    await session.strokeEnded({ id: 's1', points: side, t0: 0, t1: 300 });
    expect(offers).toEqual([]);
    expect(clock.timers).toHaveLength(1);
    session.strokeBegan();
    expect(clock.timers).toHaveLength(0);
  });

  it('dispose stops everything', async () => {
    const { session, offers } = make();
    session.dispose();
    await session.strokeEnded({ id: 's1', points: rect(100, 100, 220, 140), t0: 0, t1: 1000 });
    expect(offers).toEqual([]);
  });
});

describe('the preference module', () => {
  beforeEach(() => window.localStorage.clear());

  it('suggest is the default and bad values fall back to it', () => {
    expect(DEFAULT_SNAP_MODE).toBe('suggest');
    expect(readSnapMode()).toBe('suggest');
    window.localStorage.setItem(SNAP_MODE_KEY, '{"broken');
    expect(readSnapMode()).toBe('suggest');
  });

  it('a stored choice is read back, and a storage that throws does not break the board', () => {
    writeSnapMode('auto');
    expect(readSnapMode()).toBe('auto');
    const angry = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readSnapMode(angry)).toBe('suggest');
    expect(() => writeSnapMode('off', angry)).not.toThrow();
    expect(readEditLogEnabled(angry)).toBe(true);
  });

  it('the edit log is on until the person turns it off', () => {
    expect(readEditLogEnabled()).toBe(true);
    writeEditLogEnabled(false);
    expect(window.localStorage.getItem(EDIT_LOG_KEY)).toBe('off');
    expect(readEditLogEnabled()).toBe(false);
  });
});

describe('the edit log client', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetBoardEditQueue();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends one batch to this app only', async () => {
    logBoardEdit('whiteboard', 'move', { dx: 4, dy: 0 });
    logBoardEdit('whiteboard', 'rename', { length: 6 });
    await flushBoardEdits();
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/api/boards/edit-log');
    expect(JSON.parse((calls[0]![1] as { body: string }).body).events.map((e: { kind: string }) => e.kind)).toEqual(['move', 'rename']);
  });

  it('survives a failing server', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    logBoardEdit('whiteboard', 'add');
    await expect(flushBoardEdits()).resolves.toBeUndefined();
  });

  it('the module has no destination but its own origin: no absolute URL, no beacon, no socket', () => {
    const src = fs.readFileSync(path.join(__dirname, 'boardEditLog.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/sendBeacon|WebSocket|XMLHttpRequest|EventSource/);
    expect(src.match(/fetch\(/g)).toHaveLength(1);
  });
});
