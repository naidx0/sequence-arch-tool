import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardTurnCard } from '../chat/BoardTurnCard';
import { boardsApi, resetBoardsStreamForTests, useBoardsIndex } from '../canvas/boards/boardsClient';
import { diffOps, SCENE_ON_SERVER, VIDEO_ON_SERVER, type BoardsIndex } from '../canvas/boards/boardsModel';
import { boardWireToWbItem } from '../draw/seqDraw';
import { createStore } from '../state/store';
import { sanitizeScene } from './scene';
import { remotionSource } from './sceneRemotion';
import { cleanMediaPath, mediaUrl, MEDIA_ROUTE, VideoBody } from './videoItem';
import { useCloseWhenEmpty } from './useCloseWhenEmpty';
import { readWhiteboard, type WbItem, type WbScene } from './whiteboardModel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetBoardsStreamForTests();
});
beforeEach(() => window.localStorage.clear());

const scene = (extra: Record<string, unknown> = {}): WbScene =>
  ({ kind: 'scene', id: 'sc1', at: { x: 0, y: 400 }, w: 480, h: 300, duration: 4000, keyframes: [], ...extra }) as WbScene;
const video = (extra: Record<string, unknown> = {}): WbItem => ({ kind: 'video', id: 'v1', at: { x: 0, y: 0 }, w: 320, h: 180, src: 'out/demo.mp4', ...extra }) as WbItem;
const box = (id: string): WbItem => ({ kind: 'shape', id, shape: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }) as WbItem;

describe('video is kept locally until the store takes the kind', () => {
  it('both flags are off, and diffOps sends neither a scene nor a video, so one refused kind cannot sink the other edits', () => {
    expect(SCENE_ON_SERVER).toBe(false);
    expect(VIDEO_ON_SERVER).toBe(false);
    const ops = diffOps([], [box('a'), scene(), video()]);
    expect(ops.map((o) => (o.op === 'put' ? o.item.id : o.id))).toEqual(['a']);
    expect(diffOps([box('a'), video()], [box('a')])).toEqual([]);
  });
});

describe('the chat card is a boundary', () => {
  it('a scene with a null keyframe, a bad easing and an absurd duration renders; it does not take the transcript down', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const bad = scene({ duration: 0, easing: 'wobble', keyframes: [null, { t: 'x' }, { t: 100, target: 'a', x: 5 }] });
    render(<BoardTurnCard items={[box('a'), bad]} onOpen={() => undefined} />);
    expect(screen.getByTestId('scene-preview')).toBeTruthy();
  });

  it('shows ONE Open on surface for a scene', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const open = vi.fn();
    render(<BoardTurnCard items={[box('a'), scene()]} onOpen={open} />);
    expect(screen.getAllByText('Open on surface')).toHaveLength(1);
    expect(screen.queryByTestId('chat-board-open')).toBeNull();
    fireEvent.click(screen.getByTestId('scene-preview-open'));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('caps on what a scene or a video may claim', () => {
  it('at most 500 keyframes, a stage of 1..8192, a duration of 1..600000 ms, fps 1..120', () => {
    const many = Array.from({ length: 800 }, (_, i) => ({ t: i, target: 'a', x: i }));
    const s = sanitizeScene(scene({ keyframes: many, w: 99999, h: -3, duration: 9e9, fps: 999 }));
    expect(s.keyframes).toHaveLength(500);
    expect(s.keyframes[499]!.t).toBe(499);
    expect([s.w, s.h, s.duration, s.fps]).toEqual([8192, 1, 600000, 120]);
    expect(sanitizeScene(scene({ fps: 0.2 })).fps).toBe(1);
    expect(sanitizeScene(scene({ fps: 'x' })).fps).toBeUndefined();
    expect(sanitizeScene(scene({ duration: 10 })).duration).toBe(10);
    expect(sanitizeScene(scene({ duration: -1 })).duration).toBe(1000);
  });

  it('the export clamps the same way and takes a title that is not a string for no title', () => {
    for (const title of [5, { a: 1 }, null, ['x']]) {
      const code = remotionSource({ scene: scene({ title, w: 99999, h: 99999, fps: 9999, duration: 9e9 }), items: [] });
      const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'scene.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
      expect(out.diagnostics ?? []).toEqual([]);
      expect(code).toContain('width: 8192,');
      expect(code).toContain('fps: 120');
      expect(code).toContain(`durationInFrames: ${600 * 120}`);
    }
  });

  it('a stored video is clamped to 1..8192 on read', () => {
    const got = readWhiteboard(JSON.stringify({ version: 1, items: [video({ w: 1e9, h: -5 })] })).items[0] as Extract<WbItem, { kind: 'video' }>;
    expect([got.w, got.h]).toEqual([8192, 1]);
  });
});

describe('the media route is one constant, and a path may not hide a traversal in a percent escape', () => {
  it('rejects any %', () => {
    for (const bad of ['a%2e%2e/x.mp4', 'a%20b.mp4', '%2e%2e/x.mp4', 'x%00.mp4', 'a/%2F/b.webm']) expect(cleanMediaPath(bad), bad).toBeNull();
    expect(cleanMediaPath('out/demo.mp4')).toBe('out/demo.mp4');
  });
  it('mediaUrl is /api/media?path=, for the video and for the poster', () => {
    expect(MEDIA_ROUTE).toBe('/api/media');
    expect(mediaUrl('out/my demo.mp4')).toBe('/api/media?path=out%2Fmy%20demo.mp4');
    const { container } = render(<VideoBody src="out/demo.mp4" poster="out/p.png" w={10} h={10} />);
    const v = container.querySelector('video')!;
    expect(v.getAttribute('src')).toBe('/api/media?path=out%2Fdemo.mp4');
    expect(v.getAttribute('poster')).toBe('/api/media?path=out%2Fp.png');
  });
});

describe('the boards list belongs to a project', () => {
  const index = (name: string): BoardsIndex => ({ version: 1, boards: [{ id: name, name, kind: 'whiteboard', rev: 0, createdAt: '', updatedAt: '' }] });

  it('a late answer from A after switching to B is ignored, and the old list is dropped at the switch', async () => {
    const pending: { resolve: (v: BoardsIndex) => void }[] = [];
    vi.spyOn(boardsApi, 'list').mockImplementation(() => new Promise<BoardsIndex>((resolve) => void pending.push({ resolve })));
    vi.stubGlobal('EventSource', undefined);
    const view = renderHook((p: { project: string }) => useBoardsIndex(true, p.project), { initialProps: { project: 'A' } });
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(index('a1'));
    await waitFor(() => expect(view.result.current.index?.boards[0]!.id).toBe('a1'));
    view.rerender({ project: 'B' });
    expect(view.result.current.index).toBeNull();
    expect(pending).toHaveLength(2);
    /* a refresh for A was still in flight when B began */
    view.rerender({ project: 'B' });
    pending[1]!.resolve(index('b1'));
    await waitFor(() => expect(view.result.current.index?.boards[0]!.id).toBe('b1'));
    /* an answer for A that lands now must not replace B's list */
    view.rerender({ project: 'A' });
    view.rerender({ project: 'B' });
    const stale = pending[pending.length - 2]!;
    const fresh = pending[pending.length - 1]!;
    fresh.resolve(index('b2'));
    await waitFor(() => expect(view.result.current.index?.boards[0]!.id).toBe('b2'));
    stale.resolve(index('a-late'));
    await new Promise((r) => setTimeout(r, 20));
    expect(view.result.current.index?.boards[0]!.id).toBe('b2');
    vi.restoreAllMocks();
  });

  it('A then B then A again: A\'s Spaces are learned afresh, and only then does emptying A close', () => {
    const close = vi.fn();
    const A1 = { v: 'A1' };
    const B1 = { v: 'B1' };
    const A2 = { v: 'A2' };
    const A3 = { v: 'A3' };
    const view = renderHook((p: { project: string; index: unknown; count: number }) => useCloseWhenEmpty(p.project, p.index, p.count, close), {
      initialProps: { project: 'A', index: A1 as unknown, count: 2 },
    });
    view.rerender({ project: 'B', index: B1, count: 1 });
    view.rerender({ project: 'A', index: B1, count: 1 });
    view.rerender({ project: 'A', index: A2, count: 0 });
    expect(close).not.toHaveBeenCalled();
    view.rerender({ project: 'A', index: { v: 'A2b' }, count: 2 });
    view.rerender({ project: 'A', index: A3, count: 0 });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('a board-marks event carries scenes, svgs and videos', () => {
  const send = (items: unknown[]) => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'draw' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'board:item', items } as never, at: 2 });
    return store.getState().session;
  };

  it('a scene reaches the turn\'s marks sanitised, and the chat card plays it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const session = send([
      { kind: 'shape', id: 'a', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 50, y: 30 } },
      { kind: 'scene', id: 'sc', at: { x: 0, y: 0 }, w: 400, h: 200, duration: 3000, keyframes: [null, { t: 500, target: 'a', x: 90 }], easing: 'nope' },
    ]);
    const marks = session.inFlight?.boardMarks ?? [];
    const sc = marks.find((m) => m.kind === 'scene') as WbScene;
    expect(sc.keyframes).toEqual([{ t: 500, target: 'a', x: 90 }]);
    expect(sc.easing).toBeUndefined();
    expect(sc.by).toBe('agent');
    expect(session.boardAgentItems.map((i) => i.kind)).toEqual(['shape', 'scene']);
    render(<BoardTurnCard items={marks} onOpen={() => undefined} />);
    expect(screen.getByTestId('scene-preview').getAttribute('data-playing')).toBe('true');
  });

  it('an svg is sanitised (script and handlers gone), a video keeps a clean path and a clamped size', () => {
    const session = send([
      { kind: 'svg', id: 'v', at: { x: 0, y: 0 }, w: 100, h: 60, svg: '<svg viewBox="0 0 10 10" onload="x()"><script>x()</script><rect width="5" height="5" onclick="y()"/></svg>' },
      { kind: 'video', id: 'm', at: { x: 0, y: 70 }, w: 99999, h: 180, src: 'out/a.mp4', poster: 'out/a.png' },
    ]);
    const [svg, vid] = session.boardAgentItems as [Extract<WbItem, { kind: 'svg' }>, Extract<WbItem, { kind: 'video' }>];
    expect(svg.kind).toBe('svg');
    expect(svg.svg).not.toMatch(/script|onload|onclick/);
    expect(svg.svg).toContain('<rect');
    expect([vid.kind, vid.src, vid.poster, vid.w]).toEqual(['video', 'out/a.mp4', 'out/a.png', 8192]);
  });

  it('a video with a path that is not allowed, and a kind nobody knows, still fall back to the card they always did', () => {
    const items = [
      boardWireToWbItem({ kind: 'video', id: 'bad', at: { x: 1, y: 2 }, w: 10, h: 10, src: 'http://x/y.mp4' }),
      boardWireToWbItem({ kind: 'hologram', id: 'weird', at: { x: 3, y: 4 } }),
      boardWireToWbItem({ kind: 'noderef', id: 'n', at: { x: 5, y: 6 }, nodeId: 'svc:a', label: 'A' }),
    ];
    expect(items.map((i) => i.kind)).toEqual(['noderef', 'noderef', 'noderef']);
    expect(items[2]).toMatchObject({ nodeId: 'svc:a', label: 'A' });
  });
});
