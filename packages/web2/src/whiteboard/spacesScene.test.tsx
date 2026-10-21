import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { diffOps } from '../canvas/boards/boardsModel';
import { Whiteboard } from './Whiteboard';
import { SceneInlinePreview } from './SceneStage';
import { readScenes, writeScenes } from './sceneStore';
import { EASE, scenePoses, stepAt, trackAt, upsertKeyframe, type SceneSpec } from './scene';
import { remotionSource } from './sceneRemotion';
import { readWhiteboard, whiteboardEdit, type WbItem, type WbScene, type WhiteboardDoc } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => window.localStorage.clear());

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const box = (id: string, x: number, y = 0, extra: Record<string, unknown> = {}): WbItem =>
  ({ kind: 'shape', id, shape: 'rect', from: { x, y }, to: { x: x + 100, y: y + 50 }, ...extra }) as WbItem;
const scene = (extra: Partial<WbScene> = {}): WbScene => ({
  kind: 'scene',
  id: 'sc1',
  at: { x: 0, y: 400 },
  w: 480,
  h: 300,
  duration: 4000,
  title: 'Intro',
  keyframes: [],
  ...extra,
});
const spec = (keyframes: SceneSpec['keyframes'], extra: Partial<SceneSpec> = {}): SceneSpec => ({ duration: 4000, easing: 'linear', keyframes, ...extra });

describe('keyframe interpolation (pure)', () => {
  it('is linear between keyframes, holds after the last, and starts from the board at t=0 (the base is the implicit keyframe)', () => {
    const s = spec([{ t: 1000, target: 'a', x: 300 }, { t: 3000, target: 'a', x: 500 }]);
    expect(trackAt(s, 'a', 'x', 0, 100)).toBe(100);
    expect(trackAt(s, 'a', 'x', 500, 100)).toBe(200);
    expect(trackAt(s, 'a', 'x', 1000, 100)).toBe(300);
    expect(trackAt(s, 'a', 'x', 2000, 100)).toBe(400);
    expect(trackAt(s, 'a', 'x', 3000, 100)).toBe(500);
    expect(trackAt(s, 'a', 'x', 9999, 100)).toBe(500);
    /* a property no keyframe sets is the board's own; another target is untouched */
    expect(trackAt(s, 'a', 'y', 2000, 77)).toBe(77);
    expect(trackAt(s, 'b', 'x', 2000, 5)).toBe(5);
  });

  it('eases: in is slower than linear early, out faster, in-out passes through the middle; a keyframe easing beats the scene one', () => {
    for (const e of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(EASE[e](0)).toBe(0);
      expect(EASE[e](1)).toBe(1);
    }
    expect(EASE['ease-in'](0.5)).toBeLessThan(0.5);
    expect(EASE['ease-out'](0.5)).toBeGreaterThan(0.5);
    expect(EASE['ease-in-out'](0.5)).toBeCloseTo(0.5, 6);
    const eased = spec([{ t: 1000, target: 'a', opacity: 0, easing: 'ease-in' }], { easing: 'linear' });
    expect(trackAt(eased, 'a', 'opacity', 500, 1)).toBeCloseTo(1 - EASE['ease-in'](0.5), 6);
  });

  it('colour names and text step: the last keyframe at or before t, else the board\'s own', () => {
    const s = spec([{ t: 1000, target: 'a', stroke: 'danger', text: 'Hot' }, { t: 2500, target: 'a', stroke: 'positive' }]);
    expect(stepAt(s, 'a', 'stroke', 999)).toBeUndefined();
    expect(stepAt(s, 'a', 'stroke', 1000)).toBe('danger');
    expect(stepAt(s, 'a', 'stroke', 2400)).toBe('danger');
    expect(stepAt(s, 'a', 'stroke', 3000)).toBe('positive');
    expect(stepAt(s, 'a', 'text', 3000)).toBe('Hot');
  });

  it('scenePoses gives each keyframed item its offset from where the board has it, its scale about the centre and its opacity', () => {
    const items = [box('a', 100, 50), box('b', 400)];
    const poses = scenePoses(items, spec([{ t: 2000, target: 'a', x: 300, y: 150, scale: 2, opacity: 0.5, fill: 'surface' }]), 1000);
    const a = poses.get('a')!;
    expect([a.dx, a.dy]).toEqual([100, 50]);
    expect([a.scale, a.opacity]).toEqual([1.5, 0.75]);
    expect([a.cx, a.cy]).toEqual([150, 75]);
    expect(a.fill).toBeUndefined();
    expect(scenePoses(items, spec([{ t: 2000, target: 'a', fill: 'surface' }]), 2000).get('a')!.fill).toBe('surface');
    expect(poses.has('b')).toBe(false);
    /* paused at 0 is the board as drawn */
    const first = scenePoses(items, spec([{ t: 2000, target: 'a', x: 300 }]), 0).get('a')!;
    expect([first.dx, first.dy, first.scale, first.opacity]).toEqual([0, 0, 1, 1]);
  });

  it('upsertKeyframe writes x,y into the keyframe at that time for that target and keeps what else it says', () => {
    const base = spec([{ t: 1000, target: 'a', stroke: 'danger' }]);
    const next = upsertKeyframe(base, { t: 1000, target: 'a', x: 5, y: 6 });
    expect(next).toEqual([{ t: 1000, target: 'a', stroke: 'danger', x: 5, y: 6 }]);
    expect(upsertKeyframe(base, { t: 500, target: 'a', x: 1, y: 1 }).map((k) => k.t)).toEqual([500, 1000]);
    const doc: WhiteboardDoc = { version: 1, items: [scene({ keyframes: [] }), box('a', 0)] };
    const after = whiteboardEdit(doc, { type: 'wb/scene-key', id: 'sc1', key: { t: 1500, target: 'a', x: 9, y: 9 } });
    expect((after.items[0] as WbScene).keyframes).toEqual([{ t: 1500, target: 'a', x: 9, y: 9 }]);
  });
});

describe('the player on the board: play, pause, scrub, ticks, time', () => {
  const seeded = (extra: Partial<WbScene> = {}) => scene({ keyframes: [{ t: 1000, target: 'a', x: 300, y: 0 }, { t: 3000, target: 'a', x: 500, y: 0, text: 'Done' }], ...extra });
  const mount = () => render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[box('a', 100, 100, { label: 'Start' }), seeded()]} />);

  it('starts paused on the first frame (0.0s) with a Play button and a tick per keyframe', () => {
    mount();
    expect(screen.getByTestId('wb-scene').getAttribute('data-playing')).toBe('false');
    expect(screen.getByTestId('wb-scene-play').getAttribute('aria-label')).toBe('Play');
    expect(screen.getByTestId('wb-scene-time').textContent).toBe('0.0s / 4.0s');
    expect(screen.getAllByTestId('wb-scene-tick').map((t) => t.getAttribute('data-t'))).toEqual(['1000', '3000']);
  });

  it('Play toggles to Pause and back; the playhead advances only while playing', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    mount();
    fireEvent.click(screen.getByTestId('wb-scene-play'));
    expect(screen.getByTestId('wb-scene').getAttribute('data-playing')).toBe('true');
    expect(screen.getByTestId('wb-scene-play').getAttribute('aria-label')).toBe('Pause');
    act(() => void vi.advanceTimersByTime(1000));
    const at = Number(screen.getByTestId('wb-scene').getAttribute('data-t'));
    expect(at).toBeGreaterThan(500);
    fireEvent.click(screen.getByTestId('wb-scene-play'));
    expect(screen.getByTestId('wb-scene').getAttribute('data-playing')).toBe('false');
    const paused = screen.getByTestId('wb-scene').getAttribute('data-t');
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('wb-scene').getAttribute('data-t')).toBe(paused);
    /* play to the end: it stops at the duration, and Play again starts over from 0 */
    fireEvent.click(screen.getByTestId('wb-scene-play'));
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('wb-scene').getAttribute('data-playing')).toBe('false');
    expect(screen.getByTestId('wb-scene-time').textContent).toBe('4.0s / 4.0s');
    fireEvent.click(screen.getByTestId('wb-scene-play'));
    expect(screen.getByTestId('wb-scene-time').textContent).toMatch(/^0\.\ds \/ 4\.0s$/);
  });

  it('scrubbing sets the playhead (and pauses), and the items take their pose at that time: moved, with the keyframe words', () => {
    mount();
    const canvas = screen.getByTestId('wb-canvas');
    const track = screen.getByTestId('wb-scene-track');
    /* the scene is at (0,400): track starts at x=40 and is 252 wide; the middle is x=166 */
    fireEvent(track, new MouseEvent('pointerdown', { bubbles: true, clientX: 166, clientY: 420 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 166, clientY: 420 }));
    expect(screen.getByTestId('wb-scene-time').textContent).toBe('2.0s / 4.0s');
    expect(screen.getByTestId('wb-scene').getAttribute('data-playing')).toBe('false');
    const group = document.querySelector('[data-item-id="a"]')!;
    /* from (100,100) on the board to (400,0) at 2.0s: +300, -100 */
    expect(group.getAttribute('transform')).toContain('translate(300,-100)');
    fireEvent(track, new MouseEvent('pointerdown', { bubbles: true, clientX: 40 + 252, clientY: 420 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 292, clientY: 420 }));
    expect(screen.getByTestId('wb-scene-time').textContent).toBe('4.0s / 4.0s');
    expect(group.textContent).toContain('Done');
    fireEvent(track, new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 420 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 40, clientY: 420 }));
    expect(group.getAttribute('transform')).toBeNull();
  });

  it('More > Add scene puts a stage with a player on the board', () => {
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} />);
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-scene'));
    const added = seen[seen.length - 1]!.items[0] as WbScene;
    expect([added.kind, added.duration, added.keyframes]).toEqual(['scene', 4000, []]);
    expect(screen.getByTestId('wb-scene-play')).toBeTruthy();
  });

  it('with the scene armed and the playhead past 0, dragging an item writes a keyframe at that time and leaves the item where it is', () => {
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} agentItems={[box('a', 100, 100), scene({ keyframes: [] })]} />);
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent(screen.getByTestId('wb-scene-track'), new MouseEvent('pointerdown', { bubbles: true, clientX: 166, clientY: 420 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 166, clientY: 420 }));
    const item = document.querySelector('[data-item-id="a"] [data-testid="wb-item"]')!;
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 120 }));
    fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: 220, clientY: 150 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 220, clientY: 150 }));
    const items = seen[seen.length - 1]!.items;
    const a = items.find((i) => i.id === 'a') as Extract<WbItem, { kind: 'shape' }>;
    expect(a.from).toEqual({ x: 100, y: 100 });
    expect((items.find((i) => i.kind === 'scene') as WbScene).keyframes).toEqual([{ t: 2000, target: 'a', x: 200, y: 130 }]);
  });
});

describe('export as Remotion', () => {
  const rich = (): { s: WbScene; items: WbItem[] } => ({
    s: scene({
      fps: 24,
      keyframes: [
        { t: 500, target: 'a', x: 300, y: 80, scale: 1.5, opacity: 0.6, easing: 'ease-out' },
        { t: 2500, target: 'a', stroke: 'danger', fill: 'surface', text: 'Done' },
        { t: 3000, target: 'n', x: 40, y: 10 },
      ],
    }),
    items: [
      box('a', 100, 100, { label: 'Start', stroke: 'info', dash: 'dashed', strokeWidth: 3 }),
      { kind: 'text', id: 'n', at: { x: 10, y: 20 }, text: 'Hello "world" `tick` ${x}', color: 'chart2' } as WbItem,
      { kind: 'shape', id: 'p', shape: 'path', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, points: [{ x: 0, y: 0 }, { x: 3, y: 9 }, { x: 5, y: 5 }], arrowEnd: 'arrow' } as WbItem,
    ],
  });

  it('is TSX that parses and transpiles with no diagnostics, and imports only react and remotion', () => {
    const { s, items } = rich();
    const code = remotionSource({ scene: s, items });
    const out = ts.transpileModule(code, {
      reportDiagnostics: true,
      fileName: 'scene.tsx',
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    });
    expect(out.diagnostics ?? []).toEqual([]);
    expect(out.outputText.length).toBeGreaterThan(1000);
    const imports = [...code.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['react', 'remotion']);
    expect(code).toContain('durationInFrames: 96');
    expect(code).toContain('fps: 24');
    expect(code).toContain('width: 480');
    expect(code).toContain('export const RemotionRoot');
    expect(code).toContain('interpolate(');
    expect(code).toContain('"target": "a"');
    expect(code).toContain('"easing": "ease-out"');
    /* the items and their words survive as data, including text that would break a naive template */
    expect(code).toContain('Hello \\"world\\" `tick` ${x}');
  });

  it('a scene with no keyframes and no items still exports valid TSX', () => {
    const code = remotionSource({ scene: scene(), items: [] });
    const out = ts.transpileModule(code, { reportDiagnostics: true, fileName: 'scene.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX } });
    expect(out.diagnostics ?? []).toEqual([]);
    expect(code).toContain('durationInFrames: 120');
  });

  it('Copy puts the composition on the clipboard and says so; Save downloads a .tsx', async () => {
    const { s, items } = rich();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const created: { parts: string[] }[] = [];
    vi.stubGlobal('Blob', class { constructor(readonly parts: string[]) {} });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: { parts: string[] }) => (created.push(b), 'blob:x'), revokeObjectURL: () => undefined }));
    const clicks: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[...items, s]} />);
    fireEvent.click(screen.getByTestId('wb-scene-copy'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]![0])).toContain('AbsoluteFill');
    await vi.waitFor(() => expect(screen.getByTestId('wb-scene-note').textContent).toMatch(/Copied/));
    fireEvent.click(screen.getByTestId('wb-scene-save'));
    HTMLAnchorElement.prototype.click = click;
    expect(clicks).toEqual(['intro.remotion.tsx']);
    expect(created[0]!.parts.join('')).toContain('RemotionRoot');
  });
});

describe('the inline preview', () => {
  const items: WbItem[] = [box('a', 100, 100), scene({ keyframes: [{ t: 1000, target: 'a', x: 300 }] })];
  const sc = items[1] as WbScene;

  it('plays on its own with a Pause button, and Open on surface calls back', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const open = vi.fn();
    render(<SceneInlinePreview scene={sc} items={items} onOpen={open} />);
    expect(screen.getByTestId('scene-preview').getAttribute('data-playing')).toBe('true');
    expect(screen.getByTestId('scene-preview-toggle').textContent).toBe('Pause');
    fireEvent.click(screen.getByTestId('scene-preview-open'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('scene-preview-stage').getAttribute('viewBox')).toBe('0 400 480 300');
  });

  it('with reduced motion it shows the first frame and a Play button, and moves only when Play is pressed', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), addEventListener: () => undefined, removeEventListener: () => undefined }));
    render(<SceneInlinePreview scene={sc} items={items} />);
    const card = screen.getByTestId('scene-preview');
    expect(card.getAttribute('data-reduced')).toBe('true');
    expect(card.getAttribute('data-playing')).toBe('false');
    expect(card.getAttribute('data-t')).toBe('0');
    expect(screen.getByTestId('scene-preview-toggle').textContent).toBe('Play');
    expect(screen.queryByTestId('scene-preview-open')).toBeNull();
    fireEvent.click(screen.getByTestId('scene-preview-toggle'));
    expect(card.getAttribute('data-playing')).toBe('true');
  });
});

describe('a scene is kept locally until the store takes the kind', () => {
  it('is not sent as an op, survives a reload through the local store, and a stored scene must be well formed', () => {
    const s = scene({ keyframes: [{ t: 1, target: 'a', x: 1 }] });
    expect(diffOps([], [box('a', 0), s]).map((o) => (o.op === 'put' ? o.item.id : o.id))).toEqual(['a']);
    writeScenes('whiteboard', [box('a', 0), s]);
    expect(readScenes('whiteboard')).toEqual([s]);
    expect(readScenes('other')).toEqual([]);
    writeScenes('whiteboard', []);
    expect(readScenes('whiteboard')).toEqual([]);
    expect(readWhiteboard(JSON.stringify({ version: 1, items: [s] })).items).toHaveLength(1);
    expect(readWhiteboard(JSON.stringify({ version: 1, items: [{ kind: 'scene', id: 'x', at: { x: 0, y: 0 }, w: 1, h: 1 }] })).items).toHaveLength(0);
  });
});
