/* The three node: imports and the `here` constant below them were the residue
   of a deleted source-reading doc lock and are gone — see the ruling recorded
   at orthogonalElbow.ts:227. The four assertions in this file are untouched. */
import { describe, expect, it } from 'vitest';
import {
  avoidObstacles,
  elbowPoints,
  fanT,
  pathHasElbowCorner,
  pathIsOrthogonalElbow,
  pickSides,
  polylineHitsBox,
  polylinePathD,
  routeOrthogonalElbow,
  type ElbowBox,
} from './orthogonalElbow.js';

function box(id: string, x: number, y: number, w = 180, h = 96): ElbowBox {
  return { id, x, y, w, h };
}

describe('orthogonalElbow — site H/V language', () => {
  it('picks sides from geometry, not fixed L→R', () => {
    expect(pickSides(box('a', 0, 0), box('b', 0, 200))).toEqual({ from: 'bottom', to: 'top' });
    expect(pickSides(box('a', 200, 0), box('b', 0, 0))).toEqual({ from: 'left', to: 'right' });
  });

  it('elbowPoints is H/V only and fans along a shared side', () => {
    const pts = elbowPoints({ x: 180, y: 48 }, 'right', { x: 400, y: 200 }, 'left');
    const d = polylinePathD(pts);
    expect(pathIsOrthogonalElbow(d)).toBe(true);
    expect(pathHasElbowCorner(d)).toBe(true);
    expect(d).not.toMatch(/[CQSTcqst]/);
    expect(fanT(0, 1)).toBe(0.5);
    expect(fanT(0, 3)).toBeLessThan(fanT(1, 3));
    expect(fanT(2, 3)).toBeGreaterThan(fanT(1, 3));
  });

  it('avoidObstacles detours instead of cutting a foreign card', () => {
    const mid = box('x', 220, -10, 120, 120);
    const simple = elbowPoints({ x: 180, y: 48 }, 'right', { x: 400, y: 48 }, 'left');
    expect(polylineHitsBox(simple, mid, true)).toBe(true);
    const routed = avoidObstacles(
      simple,
      { x: 180, y: 48 },
      'right',
      { x: 400, y: 48 },
      'left',
      [mid],
    );
    expect(polylineHitsBox(routed, mid, true)).toBe(false);
    expect(pathIsOrthogonalElbow(polylinePathD(routed))).toBe(true);
  });

  it('routeOrthogonalElbow fans siblings and stays orthogonal after a drag', () => {
    const a = box('hb', 200, 0);
    const b = box('r1', 0, 160);
    const c = box('r2', 220, 160);
    const d = box('r3', 440, 160);
    const siblings = [
      { id: 'e1', source: 'hb', target: 'r1' },
      { id: 'e2', source: 'hb', target: 'r2' },
      { id: 'e3', source: 'hb', target: 'r3' },
    ];
    const obstacles = [a, b, c, d];
    const d1 = polylinePathD(
      routeOrthogonalElbow({ source: a, target: b, obstacles, edgeId: 'e1', siblings }),
    );
    const d2 = polylinePathD(
      routeOrthogonalElbow({ source: a, target: c, obstacles, edgeId: 'e2', siblings }),
    );
    expect(d1).not.toBe(d2);
    expect(pathIsOrthogonalElbow(d1)).toBe(true);

    const dragged = { ...c, x: 300, y: 280 };
    const after = polylinePathD(
      routeOrthogonalElbow({
        source: a,
        target: dragged,
        obstacles: [a, b, dragged, d],
        edgeId: 'e2',
        siblings,
      }),
    );
    expect(pathIsOrthogonalElbow(after)).toBe(true);
    expect(pathHasElbowCorner(after)).toBe(true);
  });
});
