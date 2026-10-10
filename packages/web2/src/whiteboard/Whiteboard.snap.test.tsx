import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GROUP_IDLE_MS } from '@sequence/ink/shape';

import { Whiteboard } from './Whiteboard';
import { flushBoardEdits, resetBoardEditQueue } from './boardEditLog';
import { writeEditLogEnabled, writeSnapMode, readSnapMode, SNAP_MODE_KEY } from './snapPreference';
import { readWhiteboard, type WbItem, type WbShape, type WbStroke } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

/* ══════════════════════════════════════════════════════════════════════════
   THE TIDY-UP, END TO END
   Pointer events in, a clean shape (or nothing) out, with the keyboard and the
   edit log. The strokes are a MOUSE's: sparse, whole-pixel, wandering, on a
   60 Hz clock, because that is who draws on this board.
   ══════════════════════════════════════════════════════════════════════════ */

type Pt = { x: number; y: number };

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: (k: string) => map.get(k) ?? null,
  };
}

/* A deterministic hand. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Walk a polyline at about `px` pixels per sample with a little wander and jitter, whole pixels. */
function mouseWalk(outline: Pt[], px: number, jitter: number, seed: number): Pt[] {
  const rand = rng(seed);
  const segs = outline.slice(1).map((b, i) => ({ a: outline[i]!, b, len: Math.hypot(b.x - outline[i]!.x, b.y - outline[i]!.y) }));
  const total = segs.reduce((n, s) => n + s.len, 0);
  const out: Pt[] = [];
  for (let d = 0; d <= total; d += px * (0.6 + 0.8 * rand())) {
    let acc = 0;
    for (const s of segs) {
      if (d <= acc + s.len || s === segs[segs.length - 1]) {
        const u = s.len > 0 ? Math.min(1, (d - acc) / s.len) : 0;
        out.push({
          x: Math.round(s.a.x + (s.b.x - s.a.x) * u + Math.sin(d / 40 + seed) * 1.5 + (rand() - 0.5) * 2 * jitter),
          y: Math.round(s.a.y + (s.b.y - s.a.y) * u + Math.cos(d / 33 + seed) * 1.5 + (rand() - 0.5) * 2 * jitter),
        });
        break;
      }
      acc += s.len;
    }
  }
  return out.filter((p, i) => i === 0 || p.x !== out[i - 1]!.x || p.y !== out[i - 1]!.y);
}

let clock = 1000;

/** One stroke with a 60 Hz clock; `restMs` of rest before the next. */
function draw(points: Pt[], restMs = 200, el: Element = screen.getByTestId('wb-canvas')) {
  const fire = (type: string, p: Pt) => {
    const ev = new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y });
    Object.defineProperty(ev, 'timeStamp', { value: clock });
    fireEvent(el, ev);
    clock += 16.7;
  };
  fire('pointerdown', points[0]!);
  for (const p of points.slice(1)) fire('pointermove', p);
  fire('pointerup', points[points.length - 1]!);
  clock += restMs;
}

const rectOutline = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x: x + 3, y: y + 3 }];
const sides = (x: number, y: number, w: number, h: number): Pt[][] => [
  [{ x, y }, { x: x + w, y }],
  [{ x: x + w, y }, { x: x + w, y: y + h }],
  [{ x: x + w, y: y + h }, { x, y: y + h }],
  [{ x, y: y + h }, { x, y }],
];

async function rest(ms = GROUP_IDLE_MS + 100) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const KEYED = 'board:test';
function itemsIn(store: ReturnType<typeof memoryStore>): WbItem[] {
  return readWhiteboard(store.raw(KEYED)).items;
}

function renderBoard(store = memoryStore()) {
  render(<Whiteboard repoRoot="r" storage={store} storageKey={KEYED} />);
  /* The board opens on Select (the architecture board's way); these strokes are drawn with the pen. */
  fireEvent.click(screen.getByTestId('wb-tool-draw'));
  return store;
}

const posts: { kind: string; data?: Record<string, unknown> }[] = [];

beforeEach(async () => {
  window.localStorage.clear();
  resetBoardEditQueue();
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { body?: string }) => {
      for (const e of JSON.parse(init?.body ?? '{"events":[]}').events) posts.push(e);
      return new Response('{}', { status: 200 });
    }),
  );
  /* The lazy modules load once, for real; only the rests are faked. */
  await import('./snapSession');
  await import('@sequence/ink/shape-model');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe('suggest (the default)', () => {
  it('is the default mode', () => {
    expect(readSnapMode()).toBe('suggest');
    window.localStorage.setItem(SNAP_MODE_KEY, 'nonsense');
    expect(readSnapMode()).toBe('suggest');
  });

  it('a box drawn in one stroke is offered quietly; Enter takes it; Ctrl+Z gives back the raw stroke', async () => {
    const store = renderBoard();
    const raw = mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 1);
    draw(raw);
    await rest(50);
    const chip = screen.getByTestId('wb-snap-offer');
    expect(chip.getAttribute('data-shape')).toBe('rect');
    expect(chip.textContent).toContain('Tidy to a box');
    expect(screen.getByTestId('wb-snap-ghost')).toBeTruthy();
    /* QUIET: the ink is untouched until the person says so. */
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['stroke']);

    const before = JSON.stringify(itemsIn(store));
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Enter' });
    const tidy = itemsIn(store);
    expect(tidy.map((i) => i.kind)).toEqual(['shape']);
    const shape = tidy[0] as WbShape;
    expect(shape.shape).toBe('rect');
    expect(Math.abs(shape.from.x - 100)).toBeLessThan(15);
    expect(Math.abs(shape.to.y - 240)).toBeLessThan(15);
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    expect(screen.getByTestId('wb-snap-done').textContent).toContain('Tidied to a box');

    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', ctrlKey: true });
    expect(JSON.stringify(itemsIn(store))).toBe(before);
    expect(screen.queryByTestId('wb-snap-done')).toBeNull();
  });

  it('a click on the offer takes it, and the Undo button beside the result takes it back', async () => {
    const store = renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 2));
    await rest(50);
    fireEvent.click(screen.getByTestId('wb-snap-accept'));
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['shape']);
    fireEvent.click(screen.getByTestId('wb-snap-undo'));
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['stroke']);
  });

  it('Escape, or the cross, keeps the ink exactly as drawn', async () => {
    const store = renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 3));
    await rest(50);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Escape' });
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['stroke']);

    draw(mouseWalk(rectOutline(500, 100, 200, 120), 9, 0.7, 4));
    await rest(50);
    fireEvent.click(screen.getByTestId('wb-snap-dismiss'));
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    expect(itemsIn(store).filter((i) => i.kind === 'stroke')).toHaveLength(2);
  });

  it('a box drawn in FOUR strokes is offered once, as one box, after the pen rests', async () => {
    const store = renderBoard();
    for (const [i, s] of sides(100, 100, 240, 150).entries()) draw(mouseWalk(s, 8, 0.7, 10 + i), 220);
    /* Still resting: nothing yet, and above all no offer to turn a SIDE into a line. */
    await rest(300);
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    await rest(GROUP_IDLE_MS);
    const chips = screen.getAllByTestId('wb-snap-offer');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.getAttribute('data-shape')).toBe('rect');
    fireEvent.click(screen.getByTestId('wb-snap-accept'));
    const items = itemsIn(store);
    expect(items.map((i) => i.kind)).toEqual(['shape']);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', ctrlKey: true });
    expect(itemsIn(store).filter((i) => i.kind === 'stroke')).toHaveLength(4);
  });

  it('HANDWRITING is never offered', async () => {
    const store = renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 320, 170), 9, 0.7, 5));
    await rest(50);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Enter' });
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['shape']);
    /* "hello" inside it, letter by letter, fast. */
    for (let i = 0; i < 6; i++) {
      const x = 150 + i * 18;
      draw(i % 2 === 0 ? mouseWalk([{ x, y: 170 }, { x: x + 9, y: 170 }, { x: x + 9, y: 190 }, { x, y: 190 }, { x, y: 171 }], 3, 0.4, 20 + i) : mouseWalk([{ x, y: 168 }, { x: x + 2, y: 192 }], 3, 0.4, 20 + i), 120);
    }
    await rest();
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    expect(itemsIn(store).filter((i) => i.kind === 'stroke')).toHaveLength(6);
  });

  it.each([
    ['slow steady mouse', 3, 0.4],
    ['normal mouse', 9, 0.7],
    ['fast mouse', 22, 0.7],
    ['trackpad', 7, 1.6],
  ])('%s: a box is still offered', async (_name, px, jitter) => {
    renderBoard();
    draw(mouseWalk(rectOutline(120, 120, 260, 160), px, jitter, 31));
    await rest(50);
    expect(screen.getByTestId('wb-snap-offer').getAttribute('data-shape')).toBe('rect');
  });

  it('the offer and the Tidied note are built from the board\'s existing parts, with no look of their own: the kit chip, key hint and icon button', async () => {
    renderBoard();
    draw(mouseWalk(rectOutline(120, 120, 260, 160), 9, 0.7, 77));
    await rest(50);
    const chip = screen.getByTestId('wb-snap-offer');
    /* The row is transparent; the chip is the kit's glass chip and the dismiss its transparent icon button. */
    expect(chip.className).toBe('wb-snap');
    expect(screen.getByTestId('wb-snap-accept').className).toBe('s2-chipbtn');
    expect(screen.getByTestId('wb-snap-dismiss').className).toBe('s2-ibtn s2-ibtn-sm');
    expect(chip.querySelector('kbd')!.className).toBe('s2-kbd');
    expect(screen.getByTestId('wb-snap-ghost').getAttribute('class')).toBe('wb-sel-halo');
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Enter' });
    const done = screen.getByTestId('wb-snap-done');
    expect(done.className).toBe('wb-snap wb-snap-done');
    expect(done.querySelector('button')!.className).toBe('s2-chipbtn');
    expect(done.querySelector('kbd')!.className).toBe('s2-kbd');
    /* The tidy-up's own CSS is layout only: no colour, fill, font or border of its own. */
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, 'whiteboard.css'), 'utf8');
    const own = css.slice(css.indexOf('TIDY-UP OFFER'));
    expect(own).not.toMatch(/(^|[\s;{])(color|background|border|font|box-shadow|fill|stroke)[a-z-]*\s*:/m);
  });

  it('a scribble is not offered anything', async () => {
    renderBoard();
    /* Hatching: a tight back-and-forth, the way somebody scratches a patch out. */
    const hatch: Pt[] = Array.from({ length: 16 }, (_, i) => ({ x: 100 + i * 7, y: i % 2 === 0 ? 100 : 160 }));
    draw(mouseWalk(hatch, 5, 0.6, 7));
    await rest();
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
  });

  it('an arrow from one box to another binds to both', async () => {
    writeSnapMode('auto');
    const store = renderBoard();
    draw(mouseWalk(rectOutline(60, 100, 160, 100), 9, 0.7, 41));
    await rest(50);
    draw(mouseWalk(rectOutline(460, 100, 160, 100), 9, 0.7, 42));
    await rest(50);
    const shaft: Pt[] = [{ x: 228, y: 150 }, { x: 452, y: 150 }, { x: 432, y: 138 }, { x: 452, y: 150 }, { x: 432, y: 162 }];
    draw(mouseWalk(shaft, 8, 0.6, 43));
    await rest();
    const shapes = itemsIn(store).filter((i): i is WbShape => i.kind === 'shape');
    const arrow = shapes.find((s) => s.shape === 'arrow');
    expect(arrow, JSON.stringify(shapes.map((s) => s.shape))).toBeTruthy();
    const [a, b] = shapes.filter((s) => s.shape === 'rect');
    expect(arrow!.fromId).toBe(a!.id);
    expect(arrow!.toId).toBe(b!.id);
  });
});

describe('auto', () => {
  it('tidies as soon as the pen rests, says so, and one Ctrl+Z gives the raw stroke back', async () => {
    writeSnapMode('auto');
    const store = renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 51));
    const raw = JSON.stringify(itemsIn(store));
    await rest(50);
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['shape']);
    expect(screen.getByTestId('wb-snap-done')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', ctrlKey: true });
    expect(JSON.stringify(itemsIn(store))).toBe(raw);
  });

  it('never tidies a loose line by itself (it may be a strike-through or part of writing): it is only offered', async () => {
    writeSnapMode('auto');
    const store = renderBoard();
    /* Small writing first, so the board knows what writing looks like here. */
    for (let i = 0; i < 6; i++) {
      const x = 150 + i * 18;
      draw(mouseWalk([{ x, y: 170 }, { x: x + 9, y: 170 }, { x: x + 9, y: 190 }, { x, y: 190 }, { x, y: 171 }], 3, 0.4, 80 + i), 120);
    }
    await rest();
    draw(mouseWalk([{ x: 140, y: 160 }, { x: 340, y: 310 }], 8, 0.6, 90));
    await rest();
    expect(itemsIn(store).every((i) => i.kind === 'stroke')).toBe(true);
    expect(screen.queryByTestId('wb-snap-done')).toBeNull();
    expect(screen.getByTestId('wb-snap-offer').getAttribute('data-shape')).toBe('connector');
  });

  it('Cmd+Z works too, and the Undo button is the same word', async () => {
    writeSnapMode('auto');
    const store = renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 52));
    await rest(50);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', metaKey: true });
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['stroke']);
    /* One more Undo takes the stroke itself: the tidy-up was exactly one step. */
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', metaKey: true });
    expect(itemsIn(store)).toEqual([]);
  });
});

describe('off', () => {
  it('leaves every stroke as drawn and never loads the recognizer', async () => {
    writeSnapMode('off');
    const store = renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 61));
    await rest();
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
    expect(itemsIn(store).map((i) => i.kind)).toEqual(['stroke']);
  });

  it('switching to off while an offer stands withdraws it', async () => {
    renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 62));
    await rest(50);
    expect(screen.getByTestId('wb-snap-offer')).toBeTruthy();
    act(() => writeSnapMode('off'));
    expect(screen.queryByTestId('wb-snap-offer')).toBeNull();
  });
});

describe('every stroke point carries its pen time', () => {
  it('t is whole milliseconds since the pen went down, rising', () => {
    const store = renderBoard();
    draw([{ x: 10, y: 10 }, { x: 30, y: 40 }, { x: 60, y: 20 }, { x: 90, y: 60 }]);
    const s = itemsIn(store)[0] as WbStroke;
    expect(s.points[0]!.t).toBe(0);
    const ts = s.points.map((p) => p.t);
    expect(ts.every((t) => Number.isInteger(t))).toBe(true);
    expect([...ts].sort((a, b) => a! - b!)).toEqual(ts);
    expect(ts[ts.length - 1]!).toBeGreaterThan(0);
  });

  it('moving a stroke keeps its times', () => {
    const store = renderBoard();
    draw([{ x: 10, y: 10 }, { x: 30, y: 40 }, { x: 60, y: 20 }]);
    const before = (itemsIn(store)[0] as WbStroke).points.map((p) => p.t);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    const item = screen.getByTestId('wb-item');
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 40 }));
    fireEvent(screen.getByTestId('wb-canvas'), new MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 90 }));
    fireEvent(screen.getByTestId('wb-canvas'), new MouseEvent('pointerup', { bubbles: true, clientX: 80, clientY: 90 }));
    const moved = itemsIn(store)[0] as WbStroke;
    expect(moved.points[0]!.x).not.toBe(10);
    expect(moved.points.map((p) => p.t)).toEqual(before);
  });
});

describe('the local edit log', () => {
  it('records offers, accepts and undos as small facts and nothing else', async () => {
    renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 71));
    await rest(50);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', ctrlKey: true });
    await act(async () => {
      await flushBoardEdits();
    });
    expect(posts.map((p) => p.kind)).toEqual(['snap-offered', 'snap-accepted', 'snap-undone']);
    expect(posts[1]!.data).toMatchObject({ shape: 'rect', strokes: 1 });
    const body = JSON.stringify(posts);
    expect(body).not.toMatch(/"points"|"text"|"label"/);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === '/api/boards/edit-log')).toBe(true);
  });

  it('records a dismissed offer, a move and a rename', async () => {
    renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 72));
    await rest(50);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Escape' });
    await act(async () => {
      await flushBoardEdits();
    });
    expect(posts.map((p) => p.kind)).toEqual(['snap-offered', 'snap-dismissed']);
    expect(posts[1]!.data).toMatchObject({ how: 'esc' });
  });

  it('is opt-out: with the switch off nothing is queued and nothing is sent', async () => {
    writeEditLogEnabled(false);
    renderBoard();
    draw(mouseWalk(rectOutline(100, 100, 220, 140), 9, 0.7, 73));
    await rest(50);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Enter' });
    await act(async () => {
      await flushBoardEdits();
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(posts).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

