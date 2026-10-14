import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setHostCommandHandler, type HostCommandId } from '../app/hostCommands';
import { BoardTurnCard } from '../chat/BoardTurnCard';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { FakeEventSource, fakeBoardsServer } from '../canvas/boards/fakeBoardsServer';
import { resetBoardsStreamForTests } from '../canvas/boards/boardsClient';
import { installResizeObserver } from '../canvas/testResizeObserver';
import { ConnectedWhiteboard } from './ConnectedWhiteboard';
import { Whiteboard } from './Whiteboard';
import { clampTime, safeDuration, sanitizeScene } from './scene';
import { remotionSource } from './sceneRemotion';
import { readScenes } from './sceneStore';
import { useCloseWhenEmpty } from './useCloseWhenEmpty';
import { cleanMediaPath, mediaUrl, VideoBody } from './videoItem';
import { readWhiteboard, type WbItem, type WbScene } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

installResizeObserver();
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setHostCommandHandler(null);
  resetBoardsStreamForTests();
});
beforeEach(() => window.localStorage.clear());

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const scene = (extra: Record<string, unknown> = {}): WbScene =>
  ({ kind: 'scene', id: 'sc1', at: { x: 0, y: 400 }, w: 480, h: 300, duration: 4000, keyframes: [], ...extra }) as WbScene;
const box = (id: string, x: number): WbItem => ({ kind: 'shape', id, shape: 'rect', from: { x, y: 0 }, to: { x: x + 100, y: 50 } }) as WbItem;

describe('the surface does not close on another project\'s list', () => {
  const setup = (first: { project: string; index: unknown; count: number }) => {
    const close = vi.fn();
    const view = renderHook((p: { project: string; index: unknown; count: number }) => useCloseWhenEmpty(p.project, p.index, p.count, close), { initialProps: first });
    return { close, view };
  };
  const A1 = { v: 'A1' };
  const A2 = { v: 'A2' };
  const B1 = { v: 'B1' };
  const B2 = { v: 'B2' };

  it('(A, 2 Spaces) then (B, still A\'s list) then (B, a fresh list with 0): no close', () => {
    const { close, view } = setup({ project: 'A', index: A1, count: 2 });
    view.rerender({ project: 'B', index: A1, count: 2 });
    view.rerender({ project: 'B', index: B1, count: 0 });
    expect(close).not.toHaveBeenCalled();
  });

  it('a stale list is never learned from: (A,2) then (B, A\'s stale list) then (B, stale list read as empty) closes nothing', () => {
    const { close, view } = setup({ project: 'A', index: A1, count: 2 });
    view.rerender({ project: 'B', index: A1, count: 0 });
    view.rerender({ project: 'B', index: B1, count: 0 });
    expect(close).not.toHaveBeenCalled();
  });

  it('after the switch, a fresh list with Spaces is recorded, and THEN emptying closes it, once', () => {
    const { close, view } = setup({ project: 'A', index: A1, count: 2 });
    view.rerender({ project: 'B', index: A1, count: 2 });
    view.rerender({ project: 'B', index: B1, count: 2 });
    expect(close).not.toHaveBeenCalled();
    view.rerender({ project: 'B', index: B2, count: 0 });
    expect(close).toHaveBeenCalledTimes(1);
    view.rerender({ project: 'B', index: { v: 'B3' }, count: 0 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('the same project still closes when its list empties', () => {
    const { close, view } = setup({ project: 'A', index: A1, count: 2 });
    view.rerender({ project: 'A', index: A2, count: 0 });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('a scene turn in the chat card plays small, with Open on surface', () => {
  it('shows the scene preview instead of the still marks, and Open calls back', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const open = vi.fn();
    render(<BoardTurnCard items={[box('a', 100), scene({ keyframes: [{ t: 500, target: 'a', x: 300 }] })]} onOpen={open} />);
    expect(screen.getByTestId('scene-preview')).toBeTruthy();
    expect(screen.getByTestId('chat-board-inline').getAttribute('data-scene')).toBe('true');
    fireEvent.click(screen.getByTestId('scene-preview-open'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a turn without a scene is the static sketch it was', () => {
    render(<BoardTurnCard items={[box('a', 100)]} />);
    expect(screen.queryByTestId('scene-preview')).toBeNull();
    expect(screen.getByTestId('chat-board-inline')).toBeTruthy();
  });

  it('a card with a video or svg mark does not crash the sketch', () => {
    render(<BoardTurnCard items={[{ kind: 'video', id: 'v', at: { x: 0, y: 0 }, w: 200, h: 100, src: 'a.mp4' } as WbItem, { kind: 'svg', id: 's', at: { x: 0, y: 120 }, w: 100, h: 80, svg: '<svg/>' } as WbItem]} />);
    expect(screen.getByTestId('chat-board-inline')).toBeTruthy();
  });
});

describe('a scene read from storage is made safe', () => {
  it('keeps only well-formed keyframes: an object, a finite t of 0 or more, a string target, an easing in the list', () => {
    const raw = scene({
      keyframes: [
        { t: 100, target: 'a', x: 5 },
        null,
        'x',
        { t: 'soon', target: 'a' },
        { t: Infinity, target: 'a' },
        { t: -5, target: 'a' },
        { t: 200, target: 7 },
        { t: 300, target: '' },
        { t: 400, target: 'a', easing: 'bounce' },
        { t: 500, target: 'a', easing: 'ease-out', x: 'far', y: NaN, scale: 2, stroke: 4, text: 'ok' },
      ],
    });
    const got = readWhiteboard(JSON.stringify({ version: 1, items: [raw] })).items[0] as WbScene;
    expect(got.keyframes).toEqual([
      { t: 100, target: 'a', x: 5 },
      { t: 500, target: 'a', easing: 'ease-out', scale: 2, text: 'ok' },
    ]);
  });

  it('an easing outside the list is dropped from the scene; a duration of 0, negative or not a number plays as one second; the stage is at least 1 x 1', () => {
    expect(sanitizeScene(scene({ easing: "x'; alert(1); //" })).easing).toBeUndefined();
    expect(sanitizeScene(scene({ easing: 'ease-in' })).easing).toBe('ease-in');
    for (const d of [0, -10, Number.NaN, 'long']) expect(sanitizeScene(scene({ duration: d })).duration).toBe(1000);
    expect(safeDuration(2500)).toBe(2500);
    const tiny = sanitizeScene(scene({ w: 0, h: -4 }));
    expect([tiny.w, tiny.h]).toEqual([1, 1]);
    expect(sanitizeScene(scene({ fps: 'fast' })).fps).toBeUndefined();
  });

  it('time never goes negative, and a keyframe past the end gets its tick on the track, not beyond it', () => {
    expect(clampTime(-50, 4000)).toBe(0);
    expect(clampTime(9000, 4000)).toBe(4000);
    expect(clampTime(100, 0)).toBe(100);
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[scene({ keyframes: [{ t: 99999, target: 'a', x: 1 }] })]} />);
    const tick = screen.getByTestId('wb-scene-tick');
    const track = screen.getByTestId('wb-scene-track').querySelector('rect')!;
    const end = Number(track.getAttribute('x')) + Number(track.getAttribute('width'));
    expect(Number(tick.getAttribute('x1'))).toBeLessThanOrEqual(end);
    /* a zero-length scene still has a playhead the player can draw */
    cleanup();
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[scene({ duration: 0 })]} />);
    expect(screen.getByTestId('wb-scene-time').textContent).toBe('0.0s / 1.0s');
  });
});

describe('the Remotion export embeds everything as data, never as source', () => {
  const compiles = (code: string) =>
    ts.transpileModule(code, { reportDiagnostics: true, fileName: 'scene.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).diagnostics ?? [];

  it('an easing or a title that tries to leave its string cannot: it is JSON, validated, and the header strips line separators', () => {
    const hostile = scene({
      title: 'Evil */ import x from "y"; \u2028 // \u2029 end',
      easing: "linear'; throw new Error('x'); //",
      keyframes: [{ t: 100, target: "a'; throw 1; //", easing: "ease-in'; throw 2; //", x: 4, text: 'line\u2028sep\u2029 `tick` ${x}' }, { t: 200, target: 'a', easing: 'ease-out', x: 9 }],
    });
    const code = remotionSource({ scene: hostile, items: [box('a', 0)] });
    expect(compiles(code)).toEqual([]);
    expect(code).not.toContain('throw 1');
    expect(code).not.toContain('throw 2');
    expect(code).not.toContain("throw new Error('x')");
    expect(code).toContain("const DEFAULT_EASING: Easing_ = \"ease-in-out\";");
    const header = code.split('\n')[0]!;
    expect(header).not.toMatch(/[\u2028\u2029]/);
    expect(header).not.toContain('*/');
    expect(code.includes('\u2028') || code.includes('\u2029')).toBe(false);
    expect(code).toContain('"easing": "ease-out"');
  });

  it('a zero duration, a zero-size stage and a bad fps still export frames of at least 1 and a stage of at least 1 x 1', () => {
    const code = remotionSource({ scene: scene({ duration: 0, w: 0, h: 0, fps: 0 }), items: [] });
    expect(compiles(code)).toEqual([]);
    expect(code).toContain('durationInFrames: 30');
    expect(code).toContain('width: 1,');
    expect(code).toContain('height: 1,');
    expect(code).toContain('fps: 30');
  });
});

describe('scenes are saved per board', () => {
  it('a scene added on one Space and another added on the next each land in their own board\'s store', async () => {
    const server = fakeBoardsServer();
    vi.stubGlobal('fetch', server.fetch);
    vi.stubGlobal('EventSource', FakeEventSource);
    const asked: HostCommandId[] = [];
    setHostCommandHandler((id) => void asked.push(id));
    const store = createStore({ project: () => ({ nodes: [], edges: [] }) as never, tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
    render(
      <StoreProvider store={store}>
        <ConnectedWhiteboard />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    const addScene = async () => {
      fireEvent.click(screen.getByTestId('wb-more'));
      fireEvent.click(screen.getByTestId('wb-more-scene'));
    };
    await addScene();
    await waitFor(() => expect(readScenes('whiteboard')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('board-tab-new'));
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('board-2'));
    await addScene();
    await waitFor(() => expect(readScenes('board-2')).toHaveLength(1));
    expect(readScenes('whiteboard')).toHaveLength(1);
    expect(readScenes('whiteboard')[0]!.id).not.toBe(readScenes('board-2')[0]!.id);
    /* and the first Space's scene is back when you return to it */
    fireEvent.click(screen.getByTestId('board-tab-whiteboard'));
    await waitFor(() => expect(screen.getByTestId('wb-scene')).toBeTruthy());
    await act(async () => undefined);
  });
});

describe('a video on a Space', () => {
  it('accepts only repo-relative .mp4/.webm/.gif paths', () => {
    expect(cleanMediaPath('out/demo.mp4')).toBe('out/demo.mp4');
    expect(cleanMediaPath('a\\b\\c.webm')).toBe('a/b/c.webm');
    expect(cleanMediaPath('x.GIF')).toBe('x.GIF');
    for (const bad of ['http://evil/x.mp4', '//evil/x.mp4', '/etc/x.mp4', '../x.mp4', 'a/../../x.mp4', 'x.mp4?y=1', 'x.mp4#t=1', 'x.exe', 'data:video/mp4;base64,AAA', 'javascript:alert(1).mp4', '', 42]) {
      expect(cleanMediaPath(bad as string), String(bad)).toBeNull();
    }
    expect(mediaUrl('out/my demo.mp4')).toBe('/api/media?path=out%2Fmy%20demo.mp4');
  });

  it('plays a valid file from the app\'s file route with controls, a poster, and a name', () => {
    const { container } = render(<VideoBody src="out/demo.mp4" poster="out/poster.png" label="Demo" w={320} h={180} />);
    const v = container.querySelector('video')!;
    expect(v.getAttribute('src')).toBe('/api/media?path=out%2Fdemo.mp4');
    expect(v.getAttribute('poster')).toBe('/api/media?path=out%2Fposter.png');
    expect(v.hasAttribute('controls')).toBe(true);
    expect(v.getAttribute('aria-label')).toBe('Demo');
  });

  it('is 404-safe: a file that will not load, and a path that is not allowed, leave a placeholder and no player', () => {
    const { container } = render(<VideoBody src="out/missing.mp4" label="Demo" w={320} h={180} />);
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByTestId('wb-video-gone').textContent).toContain('Video unavailable');
    expect(container.querySelector('video')).toBeNull();
    cleanup();
    const bad = render(<VideoBody src="http://evil/x.mp4" w={100} h={100} />);
    expect(bad.container.querySelector('video, img')).toBeNull();
    expect(screen.getByTestId('wb-video').getAttribute('data-state')).toBe('unavailable');
  });

  it('a gif is an image; and a video item renders on the board as one movable item', () => {
    const { container } = render(<VideoBody src="a/b.gif" w={100} h={100} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/media?path=a%2Fb.gif');
    cleanup();
    const item = { kind: 'video', id: 'v1', at: { x: 10, y: 20 }, w: 320, h: 180, src: 'out/demo.mp4', label: 'Demo' } as WbItem;
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[item]} />);
    expect(screen.getByTestId('wb-item').getAttribute('data-kind')).toBe('video');
    expect(document.querySelector('[data-item-id="v1"] video')).toBeTruthy();
    expect(readWhiteboard(JSON.stringify({ version: 1, items: [item] })).items).toHaveLength(1);
    expect(readWhiteboard(JSON.stringify({ version: 1, items: [{ kind: 'video', id: 'x', at: { x: 0, y: 0 }, w: 1, h: 1 }] })).items).toHaveLength(0);
  });
});
