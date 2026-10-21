import { afterEach, expect, it } from 'vitest';
import { readScenes, writeScenes } from './sceneStore';
import type { WbScene } from './whiteboardModel';

afterEach(() => localStorage.clear());
const scene: WbScene = { kind: 'scene', id: 's', at: { x: 0, y: 0 }, w: 480, h: 300, duration: 4000, keyframes: [] };

it('local scenes never cross projects with the same board id', () => {
  writeScenes('board', [scene], 'A');
  expect(readScenes('board', 'A')).toEqual([scene]);
  expect(readScenes('board', 'B')).toEqual([]);
  writeScenes('board', [], 'B');
  expect(readScenes('board', 'A')).toEqual([scene]);
});

it('unscoped legacy bytes are retained, but cannot be guessed to belong to a project', () => {
  const raw = JSON.stringify({ version: 1, items: [scene] });
  localStorage.setItem('sequence.scenes.board', raw);
  expect(readScenes('board', 'A')).toEqual([]);
  writeScenes('board', [], 'A');
  expect(localStorage.getItem('sequence.scenes.board')).toBe(raw);
  expect(readScenes('board')).toEqual([scene]);
});
